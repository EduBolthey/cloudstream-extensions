// PirateXPlay Nuvio Enhanced Provider v1.0.3
// Fixed: correct iframe selectors (src + data-src), multi.php proxy decoding,
//        index11.php inner proxy player, short URL resolution, error isolation

var BASE_URL = "https://piratexplay.cc";
var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Referer": BASE_URL + "/"
};

function base64Decode(str) {
  try {
    if (typeof atob === "function") return atob(str);
    return Buffer.from(str, "base64").toString("utf-8");
  } catch (e) { return null; }
}

async function fetchHtml(url, referer) {
  try {
    const res = await fetch(url, {
      headers: { ...HEADERS, "Referer": referer || BASE_URL + "/" },
      redirect: "follow"
    });
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    console.log("[PirateXPlay] fetchHtml error:", url, e.message);
    return null;
  }
}

// Follow redirect chain (up to 3 hops) without downloading the body
async function resolveRedirect(url) {
  let current = url;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(current, {
        headers: HEADERS,
        redirect: "manual"
      });
      const loc = res.headers.get("location");
      if (!loc || loc === current) break;
      current = loc.startsWith("http") ? loc : new URL(loc, current).href;
    } catch (e) { break; }
  }
  return current;
}

// Extract .m3u8 URL from a video embed page
async function extractM3u8(embedUrl, referer) {
  try {
    const html = await fetchHtml(embedUrl, referer);
    if (!html) return null;
    const m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
    return m ? m[1] : null;
  } catch (e) { return null; }
}

// ─── Media Info ──────────────────────────────────────────────────────────────
async function getMediaInfo(id, mediaType) {
  if (typeof id === "string" && id.startsWith("tt")) {
    try {
      const type = mediaType === "movie" ? "movie" : "series";
      const res = await fetch("https://v3-cinemeta.strem.io/meta/" + type + "/" + id + ".json");
      if (res.ok) {
        const data = await res.json();
        if (data && data.meta) {
          return {
            title: data.meta.name || "",
            year: String(data.meta.year || "").replace(/[^0-9]/g, ""),
            id
          };
        }
      }
    } catch (e) { console.log("[PirateXPlay] Cinemeta error:", e.message); }
  }
  return { title: String(id), year: "", id };
}

// ─── Find the episode page URL ────────────────────────────────────────────────
async function findEpisodeUrl(id, mediaType, info, sNum, eNum) {
  let targetUrl = null;

  // 1. Search by numeric ID
  if (/^\d+$/.test(String(id))) {
    const html = await fetchHtml(BASE_URL + "/?s=" + id);
    if (html) {
      const pat = mediaType === "tv"
        ? new RegExp('href=["\'](?:' + BASE_URL + ')?(\\/series\\/[^"\']*-' + id + '\\/?)["\']', "i")
        : new RegExp('href=["\'](?:' + BASE_URL + ')?(\\/movies\\/[^"\']*-' + id + '\\/?)["\']', "i");
      const m = html.match(pat);
      if (m) targetUrl = BASE_URL + m[1];
    }
  }

  // 2. Search by title
  if (!targetUrl && info.title && info.title !== String(id)) {
    const clean = info.title.replace(/[:!?_]/g, " ").replace(/\s+/g, " ").trim();
    const html = await fetchHtml(BASE_URL + "/?s=" + encodeURIComponent(clean));
    if (html) {
      const links = [...html.matchAll(/href=["'](https?:\/\/piratexplay\.cc)?(\/(?:series|movies)\/[^"']+\/?)['"]/gi)];
      if (links.length > 0) targetUrl = BASE_URL + links[0][2];
    }
  }

  if (!targetUrl) return null;

  // For movies, return directly
  if (mediaType === "movie") return targetUrl;

  // For TV: navigate to the correct season page, then find the episode link
  let seriesPageUrl = targetUrl;

  // Check if we need to switch to a specific season page
  const seriesHtml1 = await fetchHtml(seriesPageUrl);
  if (!seriesHtml1) return null;

  // Look for season-btn with data-season matching sNum
  const seasonPat = new RegExp(
    'class=["\'][^"\']*season-btn[^"\']*["\'][^>]*data-slug=["\']([^"\']+)["\'][^>]*data-season=["\']' + sNum + '["\']',
    "i"
  );
  const seasonPat2 = new RegExp(
    'data-season=["\']' + sNum + '["\'][^>]*data-slug=["\']([^"\']+)["\']',
    "i"
  );
  const slugMatch = seriesHtml1.match(seasonPat) || seriesHtml1.match(seasonPat2);
  if (slugMatch) {
    const slug = slugMatch[1];
    const seasonUrl = BASE_URL + "/series/" + slug + "/";
    if (seasonUrl !== seriesPageUrl) {
      const seasonHtml = await fetchHtml(seasonUrl);
      if (seasonHtml) seriesPageUrl = seasonUrl;
    }
  }

  const seriesHtml = await fetchHtml(seriesPageUrl);
  if (!seriesHtml) return null;

  // Find episode link: pattern SxE e.g. 1x1, 2x5
  const epPat1 = new RegExp(
    'href=["\'](?:' + BASE_URL + ')?(\\/episode\\/[^"\']*-' + sNum + 'x' + eNum + '\\/?)["\']', "i"
  );
  const epPat2 = new RegExp(
    'href=["\'](?:' + BASE_URL + ')?(\\/episode\\/[^"\']*[_-]s0?' + sNum + 'e0?' + eNum + '[^"\']*)["\']', "i"
  );
  const epMatch = seriesHtml.match(epPat1) || seriesHtml.match(epPat2);

  if (epMatch) return BASE_URL + epMatch[1];

  // Construct fallback URL
  const slug2 = seriesPageUrl.replace(/\/$/, "").split("/").pop();
  return BASE_URL + "/episode/" + slug2 + "-" + sNum + "x" + eNum + "/";
}

// ─── Extract all streams from an episode page ─────────────────────────────────
async function extractStreams(episodePageUrl, displayTitle) {
  const html = await fetchHtml(episodePageUrl);
  if (!html) return [];

  // Build server label map: options-N → label text
  const serverMap = {};
  const btnMatches = [...html.matchAll(/<a[^>]+href=["']#options-(\d+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  for (const b of btnMatches) {
    const optId = b[1];
    const content = b[2];
    const numM = content.match(/Server\s*<span>(\d+)<\/span>/i);
    const labelM = content.match(/<span class="server">([^<]+)<\/span>/i);
    serverMap[optId] = {
      num: numM ? numM[1] : optId,
      label: labelM ? labelM[1].trim() : "Server " + (parseInt(optId) + 1)
    };
  }

  // Extract all player divs:  <div id="options-N" class="video aa-tb …">
  // First div has src=, rest have data-src=
  const divMatches = [...html.matchAll(/<div\s+id="options-(\d+)"[^>]+class="video\s+aa-tb[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)];

  const directStreams = [];
  const otherStreams  = [];

  for (const div of divMatches) {
    const optId = div[1];
    const divHtml = div[2];
    const meta = serverMap[optId] || { num: optId, label: "Server " + (parseInt(optId) + 1) };
    const serverName = "PirateXPlay [Server " + meta.num + "] " + meta.label;

    // Read src= first (active server), then data-src= (lazy servers)
    const srcMatch = divHtml.match(/\biframe\b[^>]+\bsrc=["']([^"']+)["']/i)
                  || divHtml.match(/\biframe\b[^>]+\bdata-src=["']([^"']+)["']/i);
    if (!srcMatch) continue;

    let iframeUrl = srcMatch[1].trim();
    if (iframeUrl.startsWith("//")) iframeUrl = "https:" + iframeUrl;
    if (!iframeUrl.startsWith("http")) continue;

    try {
      // ── Multi-audio proxy (base64 JSON of language links) ──────────────────
      if (iframeUrl.includes("multi.php?data=")) {
        const b64 = iframeUrl.split("multi.php?data=")[1].split("&")[0];
        const decoded = base64Decode(b64);
        if (!decoded) continue;
        let parsed;
        try { parsed = JSON.parse(decoded); } catch(e) { continue; }
        if (!Array.isArray(parsed)) continue;

        for (const audio of parsed) {
          if (!audio.link) continue;
          let link = audio.link;
          const lang = audio.language || "Multi";

          // Resolve short/redirect URLs
          if (link.includes("short.icu") || link.match(/^https?:\/\/[a-z0-9-]+\.[a-z]{2,3}\/[a-zA-Z0-9]{5,}/)) {
            link = await resolveRedirect(link);
          }

          if (link.includes("vidmoly.") || link.includes("vidmoly.net") || link.includes("vidmoly.biz")) {
            const m3u8 = await extractM3u8(link, episodePageUrl);
            if (m3u8) {
              directStreams.push({
                name: serverName + " [" + lang + "] [Playable HLS]",
                title: displayTitle, url: m3u8, quality: "1080p",
                headers: { "User-Agent": HEADERS["User-Agent"] },
                provider: "piratexplay"
              });
              continue;
            }
          }

          otherStreams.push({
            name: serverName + " [" + lang + "]",
            title: displayTitle, url: link, quality: "1080p",
            headers: { "Referer": BASE_URL + "/", "User-Agent": HEADERS["User-Agent"] },
            provider: "piratexplay"
          });
        }
        continue;
      }

      // ── Internal HD proxy player (index11.php) ─────────────────────────────
      if (iframeUrl.includes("/public/player/")) {
        const innerHtml = await fetchHtml(iframeUrl, BASE_URL + "/");
        if (!innerHtml) continue;

        // Primary iframe inside the proxy
        const primaryM = innerHtml.match(/<iframe[^>]+id="playerFrame"[^>]+src="([^"]+)"/i);
        if (primaryM) {
          const primaryUrl = primaryM[1].trim();
          const m3u8 = await extractM3u8(primaryUrl, iframeUrl);
          if (m3u8) {
            directStreams.push({
              name: serverName + " [FM] [Playable HLS]",
              title: displayTitle, url: m3u8, quality: "1080p",
              headers: { "User-Agent": HEADERS["User-Agent"] },
              provider: "piratexplay"
            });
          } else {
            otherStreams.push({
              name: serverName + " [FM]",
              title: displayTitle, url: primaryUrl, quality: "1080p",
              headers: { "Referer": iframeUrl, "User-Agent": HEADERS["User-Agent"] },
              provider: "piratexplay"
            });
          }
        }

        // Additional servers listed in the proxy modal
        const modalMatches = [...innerHtml.matchAll(/data-link="([^"]+)"[^>]*data-language="([^"]+)"/gi)];
        for (const opt of modalMatches) {
          const link = opt[1].trim();
          const lang = opt[2].trim();
          if (!link || link === (primaryM && primaryM[1])) continue;
          otherStreams.push({
            name: serverName + " [" + lang + "]",
            title: displayTitle, url: link, quality: "1080p",
            headers: { "Referer": iframeUrl, "User-Agent": HEADERS["User-Agent"] },
            provider: "piratexplay"
          });
        }
        continue;
      }

      // ── Vidmoly direct ─────────────────────────────────────────────────────
      if (iframeUrl.includes("vidmoly.")) {
        const m3u8 = await extractM3u8(iframeUrl, episodePageUrl);
        if (m3u8) {
          directStreams.push({
            name: serverName + " [Playable HLS]",
            title: displayTitle, url: m3u8, quality: "1080p",
            headers: { "User-Agent": HEADERS["User-Agent"] },
            provider: "piratexplay"
          });
          continue;
        }
      }

      // ── Standard iframe server ─────────────────────────────────────────────
      otherStreams.push({
        name: serverName,
        title: displayTitle, url: iframeUrl, quality: "1080p",
        headers: { "Referer": BASE_URL + "/", "User-Agent": HEADERS["User-Agent"] },
        provider: "piratexplay"
      });

    } catch (e) {
      console.log("[PirateXPlay] Server error, skipping " + serverName + ":", e.message);
    }
  }

  return [...directStreams, ...otherStreams];
}

// ─── Main entry point ─────────────────────────────────────────────────────────
async function getStreams(id, mediaType, season, episode) {
  mediaType = mediaType || "tv";
  const sNum = parseInt(season) || 1;
  const eNum = parseInt(episode) || 1;

  console.log("[PirateXPlay] Request: ID=" + id + ", type=" + mediaType + ", S" + sNum + "E" + eNum);

  try {
    const info = await getMediaInfo(id, mediaType);
    console.log("[PirateXPlay] Resolved title:", info.title);

    const displayTitle = mediaType === "tv"
      ? info.title + " S" + String(sNum).padStart(2,"0") + "E" + String(eNum).padStart(2,"0")
      : info.title;

    const episodeUrl = await findEpisodeUrl(id, mediaType, info, sNum, eNum);

    if (!episodeUrl) {
      console.log("[PirateXPlay] No episode URL found for:", id);
      return [];
    }

    console.log("[PirateXPlay] Episode URL:", episodeUrl);
    const streams = await extractStreams(episodeUrl, displayTitle);
    console.log("[PirateXPlay] Returning", streams.length, "streams");
    return streams;

  } catch (e) {
    console.error("[PirateXPlay] Fatal error:", e.message);
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
}
globalThis.getStreams = getStreams;
