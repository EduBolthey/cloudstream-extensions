// PirateXPlay Nuvio Enhanced Provider v1.0.4
// Correctly extracts: Vidmoly m3u8 (from jwplayer sources in page source),
// Vexal/As-cdn26 m3u8, Animedekho inner iframe, and other servers

var BASE_URL = "https://piratexplay.cc";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var HEADERS = { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Referer": BASE_URL + "/" };

function base64Decode(str) {
  try { return typeof atob === "function" ? atob(str) : Buffer.from(str,"base64").toString("utf-8"); }
  catch(e) { return null; }
}

async function fetchHtml(url, referer) {
  try {
    var res = await fetch(url, { headers: Object.assign({}, HEADERS, referer ? {"Referer": referer} : {}), redirect: "follow" });
    if (!res.ok) return null;
    return await res.text();
  } catch(e) { console.log("[PX] fetchHtml failed:", url, e.message); return null; }
}

// ── Extract .m3u8 or .mp4 URL from a page that uses jwplayer ──────────────
// Looks for:  sources:[{file:"https://...m3u8..."}]  or  file: "https://...m3u8..."
function extractPlayerUrl(html) {
  if (!html) return null;
  // jwplayer sources array
  var m = html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*['"]([^'"]+)['"]/i);
  if (m) return m[1];
  // single file assignment
  m = html.match(/['"?]?file['":\s]+['"]?(https?:\/\/[^\s'"<>]+\.m3u8[^\s'"<>]*)/i);
  if (m) return m[1];
  // direct m3u8 in HTML
  m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
  if (m) return m[1];
  // direct mp4
  m = html.match(/(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/i);
  if (m) return m[1];
  return null;
}

// Extract iframe src from html
function extractIframeSrc(html) {
  if (!html) return null;
  var m = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

// ── Resolve a Vidmoly embed URL → get the signed m3u8 directly from page ──
async function extractVidmoly(embedUrl, referer) {
  var html = await fetchHtml(embedUrl, referer || BASE_URL + "/");
  return extractPlayerUrl(html);
}

// ── Resolve Vexal / As-cdn26 player → m3u8 ────────────────────────────────
async function extractVexal(embedUrl, referer) {
  var html = await fetchHtml(embedUrl, referer || BASE_URL + "/");
  return extractPlayerUrl(html);
}

// ── Resolve Animedekho embed → finds inner vexal iframe → m3u8 ──────────
async function extractAnimedekho(embedUrl) {
  var html = await fetchHtml(embedUrl, BASE_URL + "/");
  if (!html) return null;
  // inner iframe src (vexal.top or as-cdn26.top)
  var m = html.match(/<iframe[^>]+src=["'](https?:\/\/(?:vexal\.top|as-cdn26\.top)[^"']+)["']/i);
  if (!m) return null;
  return await extractVexal(m[1], embedUrl);
}

// ── Extract from index11.php internal player ──────────────────────────────
async function extractIndex11(proxyUrl) {
  var html = await fetchHtml(proxyUrl, BASE_URL + "/");
  if (!html) return [];
  var streams = [];
  // Primary playerFrame iframe src
  var primary = html.match(/<iframe[^>]+id=["']playerFrame["'][^>]+src=["']([^"']+)["']/i);
  if (primary) {
    var pUrl = primary[1];
    var m3u8 = await extractVexal(pUrl, proxyUrl);
    if (m3u8) streams.push({ url: m3u8, label: "FM", isHls: true });
    else streams.push({ url: pUrl, label: "FM", isHls: false });
  }
  // Server modal options
  var opts = [...html.matchAll(/data-link=["']([^"']+)["'][^>]*data-language=["']([^"']+)["']/gi)];
  for (var o of opts) {
    var link = o[1]; var lang = o[2];
    if (!link || link === (primary && primary[1])) continue;
    var m3u8 = await extractVexal(link, proxyUrl);
    if (m3u8) streams.push({ url: m3u8, label: lang, isHls: true });
    else streams.push({ url: link, label: lang, isHls: false });
  }
  return streams;
}

// ── Resolve multi.php (base64 JSON of language links) ─────────────────────
async function extractMulti(iframeUrl, referer) {
  var b64 = iframeUrl.split("multi.php?data=")[1].split("&")[0];
  var decoded = base64Decode(b64);
  if (!decoded) return [];
  var parsed; try { parsed = JSON.parse(decoded); } catch(e) { return []; }
  if (!Array.isArray(parsed)) return [];
  var streams = [];
  for (var item of parsed) {
    if (!item.link) continue;
    var lang = item.language || "Multi";
    var link = item.link;
    // Follow redirect for short URLs
    try {
      var r = await fetch(link, { headers: HEADERS, redirect: "manual" });
      var loc = r.headers.get("location");
      if (loc && loc !== link) {
        link = loc;
        // 2nd hop
        var r2 = await fetch(link, { headers: HEADERS, redirect: "manual" });
        var loc2 = r2.headers.get("location");
        if (loc2 && loc2 !== link) link = loc2;
      }
    } catch(e) {}

    if (link.includes("vidmoly.")) {
      var m3u8 = await extractVidmoly(link, referer);
      if (m3u8) { streams.push({ url: m3u8, label: lang, isHls: true }); continue; }
    }
    if (link.includes("vexal.top") || link.includes("as-cdn26.top")) {
      var m3u8 = await extractVexal(link, referer);
      if (m3u8) { streams.push({ url: m3u8, label: lang, isHls: true }); continue; }
    }
    streams.push({ url: link, label: lang, isHls: false });
  }
  return streams;
}

// ── Media info ──────────────────────────────────────────────────────────────
async function getMediaInfo(id, mediaType) {
  if (typeof id === "string" && id.startsWith("tt")) {
    try {
      var type = mediaType === "movie" ? "movie" : "series";
      var res = await fetch("https://v3-cinemeta.strem.io/meta/" + type + "/" + id + ".json");
      if (res.ok) { var d = await res.json(); if (d && d.meta) return { title: d.meta.name || "", year: String(d.meta.year||"").replace(/[^0-9]/g,""), id }; }
    } catch(e) {}
  }
  return { title: String(id), year: "", id };
}

// ── Find episode page URL ──────────────────────────────────────────────────
async function findEpisodeUrl(id, mediaType, info, sNum, eNum) {
  var targetUrl = null;
  // Search by TMDB/IMDb id number
  if (/^\d+$/.test(String(id))) {
    var html = await fetchHtml(BASE_URL + "/?s=" + id);
    if (html) {
      var pat = mediaType === "tv"
        ? new RegExp('href=["\'](?:' + BASE_URL + ')?(\\/series\\/[^"\']*-' + id + '\\/?)["\']',"i")
        : new RegExp('href=["\'](?:' + BASE_URL + ')?(\\/movies\\/[^"\']*-' + id + '\\/?)["\']',"i");
      var m = html.match(pat); if (m) targetUrl = BASE_URL + m[1];
    }
  }
  // Search by title
  if (!targetUrl && info.title && info.title !== String(id)) {
    var clean = info.title.replace(/[:!?_]/g," ").replace(/\s+/g," ").trim();
    var html = await fetchHtml(BASE_URL + "/?s=" + encodeURIComponent(clean));
    if (html) {
      var links = [...html.matchAll(/href=["'](https?:\/\/piratexplay\.cc)?(\/(?:series|movies)\/[^"']+\/?)['"]/gi)];
      if (links.length > 0) targetUrl = BASE_URL + links[0][2];
    }
  }
  if (!targetUrl) return null;
  if (mediaType === "movie") return targetUrl;

  // Navigate to correct season + episode
  var seriesHtml = await fetchHtml(targetUrl);
  if (!seriesHtml) return null;

  // Find season slug for the requested season
  var slugPat = new RegExp('data-season=["\']' + sNum + '["\'][^>]*data-slug=["\']([^"\']+)["\']',"i");
  var slugPat2 = new RegExp('data-slug=["\']([^"\']+)["\'][^>]*data-season=["\']' + sNum + '["\']',"i");
  var slugM = seriesHtml.match(slugPat) || seriesHtml.match(slugPat2);
  if (slugM) {
    var seasonUrl = BASE_URL + "/series/" + slugM[1] + "/";
    if (seasonUrl !== targetUrl) {
      var sh = await fetchHtml(seasonUrl);
      if (sh) seriesHtml = sh;
    }
  }

  // Find episode
  var epPat = new RegExp('href=["\'](?:' + BASE_URL + ')?(\\/episode\\/[^"\']*-' + sNum + 'x' + eNum + '\\/?)["\']',"i");
  var epM = seriesHtml.match(epPat);
  if (epM) return BASE_URL + epM[1];

  // Construct fallback
  var slug2 = targetUrl.replace(/\/$/, "").split("/").pop();
  return BASE_URL + "/episode/" + slug2 + "-" + sNum + "x" + eNum + "/";
}

// ── Main stream extraction from episode page ───────────────────────────────
async function extractStreams(epUrl, displayTitle) {
  var html = await fetchHtml(epUrl);
  if (!html) return [];

  // Server labels map
  var serverMap = {};
  var btnMatches = [...html.matchAll(/<a[^>]+href=["']#options-(\d+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  for (var b of btnMatches) {
    var numM = b[2].match(/Server\s*<span>(\d+)<\/span>/i);
    var labelM = b[2].match(/<span class="server">([^<]+)<\/span>/i);
    serverMap[b[1]] = { num: numM ? numM[1] : b[1], label: labelM ? labelM[1].trim() : "Server " + (parseInt(b[1])+1) };
  }

  // Player divs — first has src=, rest have data-src=
  var divMatches = [...html.matchAll(/<div\s+id="options-(\d+)"[^>]*class="video\s+aa-tb[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)];

  var directStreams = [];
  var otherStreams = [];

  for (var div of divMatches) {
    var optId = div[1];
    var divHtml = div[2];
    var meta = serverMap[optId] || { num: optId, label: "Server " + (parseInt(optId)+1) };
    var sname = "PirateXPlay [Server " + meta.num + "] " + meta.label;

    var srcM = divHtml.match(/\biframe\b[^>]+\bsrc=["']([^"']+)["']/i)
            || divHtml.match(/\biframe\b[^>]+\bdata-src=["']([^"']+)["']/i);
    if (!srcM) continue;

    var iurl = srcM[1].trim();
    if (iurl.startsWith("//")) iurl = "https:" + iurl;
    if (!iurl.startsWith("http")) continue;

    try {
      // ── multi.php (multi-audio proxy) ─────────────────────────────────
      if (iurl.includes("multi.php?data=")) {
        var multiStreams = await extractMulti(iurl, epUrl);
        for (var s of multiStreams) {
          (s.isHls ? directStreams : otherStreams).push({
            name: sname + " [" + s.label + "]" + (s.isHls ? " [Playable HLS]" : ""),
            title: displayTitle, url: s.url, quality: "1080p",
            headers: { "User-Agent": UA, "Referer": BASE_URL + "/" },
            provider: "piratexplay"
          });
        }
        continue;
      }

      // ── index11.php (internal HD proxy player) ─────────────────────────
      if (iurl.includes("/public/player/")) {
        var inner = await extractIndex11(iurl);
        for (var s of inner) {
          (s.isHls ? directStreams : otherStreams).push({
            name: sname + " [" + s.label + "]" + (s.isHls ? " [Playable HLS]" : ""),
            title: displayTitle, url: s.url, quality: "1080p",
            headers: { "User-Agent": UA, "Referer": iurl },
            provider: "piratexplay"
          });
        }
        continue;
      }

      // ── Vidmoly (m3u8 from page source) ───────────────────────────────
      if (iurl.includes("vidmoly.")) {
        var m3u8 = await extractVidmoly(iurl, epUrl);
        if (m3u8) {
          directStreams.push({ name: sname + " [Playable HLS]", title: displayTitle, url: m3u8, quality: "1080p", headers: { "User-Agent": UA }, provider: "piratexplay" });
          continue;
        }
      }

      // ── Animedekho (piratexplay.com subdomain) ────────────────────────
      if (iurl.includes("animedekho.piratexplay.com")) {
        var m3u8 = await extractAnimedekho(iurl);
        if (m3u8) {
          directStreams.push({ name: sname + " [Playable HLS]", title: displayTitle, url: m3u8, quality: "1080p", headers: { "User-Agent": UA }, provider: "piratexplay" });
          continue;
        }
      }

      // ── Vexal / As-cdn26 direct ────────────────────────────────────────
      if (iurl.includes("vexal.top") || iurl.includes("as-cdn26.top")) {
        var m3u8 = await extractVexal(iurl, epUrl);
        if (m3u8) {
          directStreams.push({ name: sname + " [Playable HLS]", title: displayTitle, url: m3u8, quality: "1080p", headers: { "User-Agent": UA }, provider: "piratexplay" });
          continue;
        }
      }

      // ── Abyssplayer ─────────────────────────────────────────────────────
      if (iurl.includes("abyssplayer.com")) {
        var abHtml = await fetchHtml(iurl, epUrl);
        var abM3u8 = extractPlayerUrl(abHtml);
        if (abM3u8) {
          directStreams.push({ name: sname + " [Playable HLS]", title: displayTitle, url: abM3u8, quality: "1080p", headers: { "User-Agent": UA }, provider: "piratexplay" });
          continue;
        }
        // Try iframe inside
        var abIframe = extractIframeSrc(abHtml);
        if (abIframe) {
          var abInnerHtml = await fetchHtml(abIframe, iurl);
          var abInnerM3u8 = extractPlayerUrl(abInnerHtml);
          if (abInnerM3u8) {
            directStreams.push({ name: sname + " [Playable HLS]", title: displayTitle, url: abInnerM3u8, quality: "1080p", headers: { "User-Agent": UA }, provider: "piratexplay" });
            continue;
          }
        }
      }

      // ── Strmup ──────────────────────────────────────────────────────────
      if (iurl.includes("strmup.to")) {
        var stHtml = await fetchHtml(iurl, epUrl);
        var stM3u8 = extractPlayerUrl(stHtml);
        if (stM3u8) {
          directStreams.push({ name: sname + " [Playable HLS]", title: displayTitle, url: stM3u8, quality: "1080p", headers: { "User-Agent": UA }, provider: "piratexplay" });
          continue;
        }
      }

      // ── Cloudy player ────────────────────────────────────────────────────
      if (iurl.includes("cloudy.upns.one")) {
        var clHtml = await fetchHtml(iurl, epUrl);
        var clM3u8 = extractPlayerUrl(clHtml);
        if (clM3u8) {
          directStreams.push({ name: sname + " [Playable HLS]", title: displayTitle, url: clM3u8, quality: "1080p", headers: { "User-Agent": UA }, provider: "piratexplay" });
          continue;
        }
      }

      // ── Fallback: return iframe URL as-is ─────────────────────────────
      otherStreams.push({
        name: sname, title: displayTitle, url: iurl, quality: "1080p",
        headers: { "Referer": BASE_URL + "/", "User-Agent": UA },
        provider: "piratexplay"
      });

    } catch(e) {
      console.log("[PX] Error on server " + sname + ":", e.message);
    }
  }

  return [...directStreams, ...otherStreams];
}

// ── Main entry point ───────────────────────────────────────────────────────
async function getStreams(id, mediaType, season, episode) {
  mediaType = mediaType || "tv";
  var sNum = parseInt(season) || 1;
  var eNum = parseInt(episode) || 1;
  console.log("[PX] id=" + id + " type=" + mediaType + " S" + sNum + "E" + eNum);
  try {
    var info = await getMediaInfo(id, mediaType);
    console.log("[PX] title:", info.title);
    var displayTitle = mediaType === "tv"
      ? (info.title + " S" + String(sNum).padStart(2,"0") + "E" + String(eNum).padStart(2,"0"))
      : info.title;
    var epUrl = await findEpisodeUrl(id, mediaType, info, sNum, eNum);
    if (!epUrl) { console.log("[PX] No URL found"); return []; }
    console.log("[PX] episode URL:", epUrl);
    var streams = await extractStreams(epUrl, displayTitle);
    console.log("[PX] total streams:", streams.length);
    return streams;
  } catch(e) {
    console.error("[PX] Fatal:", e.message);
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) { module.exports = { getStreams }; }
globalThis.getStreams = getStreams;
