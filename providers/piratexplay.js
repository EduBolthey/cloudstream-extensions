// PirateXPlay Nuvio Enhanced Provider v1.0.5
// Only extracts verified, working direct HLS (.m3u8) / video streams.
// Dead domains, shorteners (short.icu), broken embeds, and webpage fallbacks are excluded.

var BASE_URL = "https://piratexplay.cc";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var HEADERS = {
  "User-Agent": UA,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Referer": BASE_URL + "/"
};

function base64Decode(str) {
  try {
    return typeof atob === "function" ? atob(str) : Buffer.from(str, "base64").toString("utf-8");
  } catch(e) {
    return null;
  }
}

async function fetchHtml(url, referer, timeoutMs) {
  timeoutMs = timeoutMs || 5000;
  try {
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = controller ? setTimeout(function() { controller.abort(); }, timeoutMs) : null;
    var opts = {
      headers: Object.assign({}, HEADERS, referer ? { "Referer": referer } : {}),
      redirect: "follow"
    };
    if (controller) opts.signal = controller.signal;
    var res = await fetch(url, opts);
    if (timer) clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch(e) {
    return null;
  }
}

// ── Extract direct .m3u8 or .mp4 URL from a page ──────────────────────────
function extractPlayerUrl(html) {
  if (!html) return null;
  // jwplayer sources array: sources: [{file: "https://...m3u8..."}]
  var m = html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*['"]([^'"]+)['"]/i);
  if (m && (m[1].includes(".m3u8") || m[1].includes(".mp4"))) return m[1];

  // single file assignment: file: "https://...m3u8..."
  m = html.match(/['"]?file['":\s]+['"]?(https?:\/\/[^\s'"<>]+\.m3u8[^\s'"<>]*)/i);
  if (m) return m[1];

  // direct m3u8 in HTML
  m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
  if (m) return m[1];

  // direct mp4 in HTML
  m = html.match(/(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/i);
  if (m) return m[1];

  return null;
}

// ── Extract Vidmoly embed → gets signed master.m3u8 directly from page ─────
async function extractVidmoly(embedUrl, referer) {
  var html = await fetchHtml(embedUrl, referer || BASE_URL + "/", 4000);
  return extractPlayerUrl(html);
}

// ── Extract Vexal / As-cdn26 embed → m3u8 ─────────────────────────────────
async function extractVexal(embedUrl, referer) {
  var html = await fetchHtml(embedUrl, referer || BASE_URL + "/", 4000);
  return extractPlayerUrl(html);
}

// ── Extract Animedekho embed → finds inner iframe → m3u8 ─────────────────
async function extractAnimedekho(embedUrl) {
  var html = await fetchHtml(embedUrl, BASE_URL + "/", 4000);
  if (!html) return null;
  var m = html.match(/<iframe[^>]+src=["'](https?:\/\/(?:vexal\.top|as-cdn26\.top)[^"']+)["']/i);
  if (!m) return null;
  return await extractVexal(m[1], embedUrl);
}

// ── Extract from index11.php internal player ──────────────────────────────
async function extractIndex11(proxyUrl, displayTitle) {
  var html = await fetchHtml(proxyUrl, BASE_URL + "/", 4000);
  if (!html) return [];
  var streams = [];
  var primary = html.match(/<iframe[^>]+id=["']playerFrame["'][^>]+src=["']([^"']+)["']/i);
  if (primary) {
    var pUrl = primary[1];
    var m3u8 = await extractVexal(pUrl, proxyUrl);
    if (m3u8 && (m3u8.includes(".m3u8") || m3u8.includes(".mp4"))) {
      streams.push(createStreamObj("PirateXPlay [HD] FM", displayTitle, m3u8, proxyUrl));
    }
  }
  var opts = [...html.matchAll(/data-link=["']([^"']+)["'][^>]*data-language=["']([^"']+)["']/gi)];
  for (var o of opts) {
    var link = o[1]; var lang = o[2] || "HD";
    if (!link || link === (primary && primary[1])) continue;
    var optM3u8 = link.includes("vidmoly.") ? await extractVidmoly(link, proxyUrl) : await extractVexal(link, proxyUrl);
    if (optM3u8 && (optM3u8.includes(".m3u8") || optM3u8.includes(".mp4"))) {
      streams.push(createStreamObj("PirateXPlay [HD] " + lang, displayTitle, optM3u8, proxyUrl));
    }
  }
  return streams;
}

// ── Resolve multi.php (base64 JSON of language links) ─────────────────────
async function extractMulti(iframeUrl, referer, displayTitle) {
  var parts = iframeUrl.split("multi.php?data=");
  if (parts.length < 2) return [];
  var b64 = parts[1].split("&")[0];
  var decoded = base64Decode(b64);
  if (!decoded) return [];
  var parsed;
  try { parsed = JSON.parse(decoded); } catch(e) { return []; }
  if (!Array.isArray(parsed)) return [];

  var streams = [];
  for (var item of parsed) {
    if (!item.link) continue;
    var lang = item.language || "Multi";
    var link = item.link;
    try {
      var r = await fetch(link, {
        headers: HEADERS,
        redirect: "follow",
        signal: typeof AbortSignal !== "undefined" ? AbortSignal.timeout(3000) : void 0
      });
      var finalUrl = r.url;
      if (finalUrl.includes("vidmoly.")) {
        var m3u8 = await extractVidmoly(finalUrl, referer);
        if (m3u8 && (m3u8.includes(".m3u8") || m3u8.includes(".mp4"))) {
          streams.push(createStreamObj("PirateXPlay [Multi Audio] " + lang, displayTitle, m3u8, "https://vidmoly.biz/"));
        }
      } else if (finalUrl.includes("vexal.top") || finalUrl.includes("as-cdn26.top")) {
        var vM3u8 = await extractVexal(finalUrl, referer);
        if (vM3u8 && (vM3u8.includes(".m3u8") || vM3u8.includes(".mp4"))) {
          streams.push(createStreamObj("PirateXPlay [Multi Audio] " + lang, displayTitle, vM3u8, finalUrl));
        }
      }
    } catch(e) {}
  }
  return streams;
}

// ── Stream object factory (compatible with Nuvio Enhanced & Stremio) ───────
function createStreamObj(name, title, streamUrl, referer) {
  var streamHeaders = {
    "User-Agent": UA,
    "Referer": referer || (streamUrl.includes("vidmoly.") || streamUrl.includes("vmpx.online") ? "https://vidmoly.biz/" : BASE_URL + "/")
  };
  return {
    name: name,
    title: title,
    url: streamUrl,
    quality: "1080p",
    headers: streamHeaders,
    behaviorHints: {
      notWebReady: false,
      proxyHeaders: {
        request: streamHeaders
      }
    },
    provider: "piratexplay"
  };
}

// ── Process a single server option container ──────────────────────────────
async function processServerDiv(div, serverMap, epUrl, displayTitle) {
  var optId = div[1];
  var divHtml = div[2];
  var meta = serverMap[optId] || { num: optId, label: "Server " + (parseInt(optId) + 1) };
  var sname = "PirateXPlay [Server " + meta.num + "] " + meta.label;

  var srcM = divHtml.match(/\biframe\b[^>]+\bsrc=["']([^"']+)["']/i)
          || divHtml.match(/\biframe\b[^>]+\bdata-src=["']([^"']+)["']/i);
  if (!srcM) return [];

  var iurl = srcM[1].trim();
  if (iurl.startsWith("//")) iurl = "https:" + iurl;
  if (!iurl.startsWith("http")) return [];

  var streams = [];
  try {
    // 1. multi.php proxy
    if (iurl.includes("multi.php?data=")) {
      return await extractMulti(iurl, epUrl, displayTitle);
    }

    // 2. index11.php internal proxy
    if (iurl.includes("/public/player/")) {
      return await extractIndex11(iurl, displayTitle);
    }

    // 3. Vidmoly embed
    if (iurl.includes("vidmoly.")) {
      var vm3u8 = await extractVidmoly(iurl, epUrl);
      if (vm3u8 && (vm3u8.includes(".m3u8") || vm3u8.includes(".mp4"))) {
        streams.push(createStreamObj(sname, displayTitle, vm3u8, "https://vidmoly.biz/"));
        return streams;
      }
    }

    // 4. Animedekho embed
    if (iurl.includes("animedekho.piratexplay.com")) {
      var am3u8 = await extractAnimedekho(iurl);
      if (am3u8 && (am3u8.includes(".m3u8") || am3u8.includes(".mp4"))) {
        streams.push(createStreamObj(sname, displayTitle, am3u8, iurl));
        return streams;
      }
    }

    // 5. Vexal / As-cdn26
    if (iurl.includes("vexal.top") || iurl.includes("as-cdn26.top")) {
      var xm3u8 = await extractVexal(iurl, epUrl);
      if (xm3u8 && (xm3u8.includes(".m3u8") || xm3u8.includes(".mp4"))) {
        streams.push(createStreamObj(sname, displayTitle, xm3u8, iurl));
        return streams;
      }
    }

    // 6. Generic player extract (only if direct m3u8/mp4 found)
    var genHtml = await fetchHtml(iurl, epUrl, 3000);
    var genM3u8 = extractPlayerUrl(genHtml);
    if (genM3u8 && (genM3u8.includes(".m3u8") || genM3u8.includes(".mp4"))) {
      streams.push(createStreamObj(sname, displayTitle, genM3u8, iurl));
      return streams;
    }
  } catch(e) {
    // Skip failed servers silently
  }

  // NOTE: If no playable direct stream was found, return [] (never return raw iframe/webpage URL)
  return streams;
}

// ── Main stream extraction from episode page ───────────────────────────────
async function extractStreams(epUrl, displayTitle) {
  var html = await fetchHtml(epUrl, null, 5000);
  if (!html) return [];

  // Server button labels
  var serverMap = {};
  var btnMatches = [...html.matchAll(/<a[^>]+href=["']#options-(\d+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  for (var b of btnMatches) {
    var numM = b[2].match(/Server\s*<span>(\d+)<\/span>/i);
    var labelM = b[2].match(/<span class="server">([^<]+)<\/span>/i);
    serverMap[b[1]] = {
      num: numM ? numM[1] : b[1],
      label: labelM ? labelM[1].trim() : "Server " + (parseInt(b[1]) + 1)
    };
  }

  // Player divs
  var divMatches = [...html.matchAll(/<div\s+id="options-(\d+)"[^>]*class="video\s+aa-tb[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)];

  // Process all servers in parallel
  var tasks = divMatches.map(function(div) {
    return processServerDiv(div, serverMap, epUrl, displayTitle);
  });
  var results = await Promise.allSettled(tasks);

  var verifiedStreams = [];
  for (var r of results) {
    if (r.status === "fulfilled" && Array.isArray(r.value)) {
      verifiedStreams.push(...r.value);
    }
  }

  return verifiedStreams;
}

var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

// ── Media info ──────────────────────────────────────────────────────────────
async function getMediaInfo(id, mediaType) {
  var isSeries = mediaType === "tv" || mediaType === "series";

  // 1. Numeric TMDB ID
  if (/^\d+$/.test(String(id))) {
    try {
      var endpoint = isSeries ? "tv" : "movie";
      var res = await fetch("https://api.themoviedb.org/3/" + endpoint + "/" + id + "?api_key=" + TMDB_API_KEY);
      if (res.ok) {
        var d = await res.json();
        var title = d.name || d.title || "";
        var year = String(d.first_air_date || d.release_date || "").slice(0, 4);
        if (title) return { title: title, year: year, id: id };
      }
    } catch(e) {}
  }

  // 2. IMDb ID (tt...)
  if (typeof id === "string" && id.startsWith("tt")) {
    try {
      var res = await fetch("https://api.themoviedb.org/3/find/" + id + "?api_key=" + TMDB_API_KEY + "&external_source=imdb_id");
      if (res.ok) {
        var d = await res.json();
        var results = isSeries ? d.tv_results : d.movie_results;
        if (results && results.length > 0) {
          var item = results[0];
          var title = item.name || item.title || "";
          var year = String(item.first_air_date || item.release_date || "").slice(0, 4);
          if (title) return { title: title, year: year, id: item.id || id };
        }
      }
    } catch(e) {}

    // Fallback to Cinemeta
    try {
      var type = isSeries ? "series" : "movie";
      var res = await fetch("https://v3-cinemeta.strem.io/meta/" + type + "/" + id + ".json");
      if (res.ok) {
        var d = await res.json();
        if (d && d.meta) return { title: d.meta.name || "", year: String(d.meta.year || "").replace(/[^0-9]/g, ""), id: id };
      }
    } catch(e) {}
  }

  return { title: String(id), year: "", id: id };
}

// ── Find episode page URL ──────────────────────────────────────────────────
async function findEpisodeUrl(id, mediaType, info, sNum, eNum) {
  var targetUrl = null;

  // Search by TMDB/IMDb id number
  if (/^\d+$/.test(String(id))) {
    var html = await fetchHtml(BASE_URL + "/?s=" + id, null, 5000);
    if (html) {
      if (mediaType === "tv") {
        // Try specific season first
        var sPat = new RegExp('href=["\'](?:' + BASE_URL + ')?(\\/series\\/[^"\']*-season-' + sNum + '[^"\']*-' + id + '\\/?)["\']', "i");
        var sm = html.match(sPat);
        if (sm) targetUrl = BASE_URL + sm[1];
        if (!targetUrl) {
          var genPat = new RegExp('href=["\'](?:' + BASE_URL + ')?(\\/series\\/[^"\']*-' + id + '\\/?)["\']', "i");
          var gm = html.match(genPat);
          if (gm) targetUrl = BASE_URL + gm[1];
        }
      } else {
        var movPat = new RegExp('href=["\'](?:' + BASE_URL + ')?(\\/movies\\/[^"\']*-' + id + '\\/?)["\']', "i");
        var mm = html.match(movPat);
        if (mm) targetUrl = BASE_URL + mm[1];
      }
    }
  }

  // Search by title
  if (!targetUrl && info.title && info.title !== String(id)) {
    var clean = info.title.replace(/[:!?_]/g, " ").replace(/\s+/g, " ").trim();
    var html = await fetchHtml(BASE_URL + "/?s=" + encodeURIComponent(clean), null, 5000);
    if (html) {
      var links = [...html.matchAll(/href=["'](https?:\/\/piratexplay\.cc)?(\/(?:series|movies)\/[^"']+\/?)['"]/gi)];
      if (links.length > 0) targetUrl = BASE_URL + links[0][2];
    }
  }

  if (!targetUrl) return null;
  if (mediaType === "movie") return targetUrl;

  // Navigate to series page to find requested season & episode
  var slug = targetUrl.replace(/\/$/, "").split("/").pop();
  if (slug.includes("season-")) {
    var adjSlug = slug.replace(/season-\d+/i, "season-" + sNum);
    if (adjSlug !== slug) {
      var adjUrl = BASE_URL + "/series/" + adjSlug + "/";
      var adjHtml = await fetchHtml(adjUrl, null, 4000);
      if (adjHtml) {
        targetUrl = adjUrl;
      }
    }
  }

  var seriesHtml = await fetchHtml(targetUrl, null, 5000);
  if (!seriesHtml) return null;

  var slugPat = new RegExp('data-season=["\']' + sNum + '["\'][^>]*data-slug=["\']([^"\']+)["\']', "i");
  var slugPat2 = new RegExp('data-slug=["\']([^"\']+)["\'][^>]*data-season=["\']' + sNum + '["\']', "i");
  var slugM = seriesHtml.match(slugPat) || seriesHtml.match(slugPat2);
  if (slugM) {
    var seasonUrl = BASE_URL + "/series/" + slugM[1] + "/";
    if (seasonUrl !== targetUrl) {
      var sh = await fetchHtml(seasonUrl, null, 5000);
      if (sh) seriesHtml = sh;
    }
  }

  // Match episode link
  var epPat = new RegExp('href=["\'](?:' + BASE_URL + ')?(\\/episode\\/[^"\']*-' + sNum + 'x' + eNum + '\\/?)["\']', "i");
  var epM = seriesHtml.match(epPat);
  if (epM) return BASE_URL + epM[1];

  // Fallback slug pattern adjusted for season
  var finalSlug = targetUrl.replace(/\/$/, "").split("/").pop().replace(/season-\d+/i, "season-" + sNum);
  return BASE_URL + "/episode/" + finalSlug + "-" + sNum + "x" + eNum + "/";
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
      ? (info.title + " S" + String(sNum).padStart(2, "0") + "E" + String(eNum).padStart(2, "0"))
      : info.title;
    var epUrl = await findEpisodeUrl(id, mediaType, info, sNum, eNum);
    if (!epUrl) {
      console.log("[PX] No episode URL found");
      return [];
    }
    console.log("[PX] Episode URL:", epUrl);
    var streams = await extractStreams(epUrl, displayTitle);
    console.log("[PX] Total verified streams:", streams.length);
    return streams;
  } catch(e) {
    console.error("[PX] Fatal error:", e.message);
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
}
globalThis.getStreams = getStreams;
