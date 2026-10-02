// PirateXPlay Nuvio Enhanced Provider v1.0.7
// Direct HLS (.m3u8) extractor with unblocked TMDB Web & TVMaze metadata resolvers.

var BASE_URL = "https://piratexplay.cc";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var HEADERS = {
  "User-Agent": UA,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Referer": BASE_URL + "/"
};

function matchAllRegex(str, regex) {
  var results = [];
  if (!str) return results;
  var flags = regex.flags || "";
  if (flags.indexOf("g") === -1) flags += "g";
  var r = new RegExp(regex.source, flags);
  var m;
  while ((m = r.exec(str)) !== null) results.push(m);
  return results;
}

function base64Decode(str) {
  try {
    return typeof atob === "function" ? atob(str) : Buffer.from(str, "base64").toString("utf-8");
  } catch(e) {
    return null;
  }
}

async function fetchHtml(url, referer, timeoutMs) {
  timeoutMs = timeoutMs || 4000;
  return new Promise(function(resolve) {
    var timer = setTimeout(function() { resolve(null); }, timeoutMs);
    try {
      var opts = {
        headers: Object.assign({}, HEADERS, referer ? { "Referer": referer } : {})
      };
      fetch(url, opts).then(function(res) {
        clearTimeout(timer);
        if (!res.ok) return resolve(null);
        return res.text().then(function(text) { resolve(text); }).catch(function() { resolve(null); });
      }).catch(function() {
        clearTimeout(timer);
        resolve(null);
      });
    } catch(e) {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

function extractPlayerUrl(html) {
  if (!html) return null;
  var m = html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*['"]([^'"]+)['"]/i);
  if (m && (m[1].includes(".m3u8") || m[1].includes(".mp4"))) return m[1];

  m = html.match(/['"]?file['":\s]+['"]?(https?:\/\/[^\s'"<>]+\.m3u8[^\s'"<>]*)/i);
  if (m) return m[1];

  m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
  if (m) return m[1];

  m = html.match(/(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/i);
  if (m) return m[1];

  return null;
}

async function extractVidmoly(embedUrl, referer) {
  var html = await fetchHtml(embedUrl, referer || BASE_URL + "/");
  return extractPlayerUrl(html);
}

async function extractVexal(embedUrl, referer) {
  var html = await fetchHtml(embedUrl, referer || BASE_URL + "/");
  return extractPlayerUrl(html);
}

async function extractAnimedekho(embedUrl) {
  var html = await fetchHtml(embedUrl, BASE_URL + "/");
  if (!html) return null;
  var m = html.match(/<iframe[^>]+src=["'](https?:\/\/(?:vexal\.top|as-cdn26\.top)[^"']+)["']/i);
  if (!m) return null;
  return await extractVexal(m[1], embedUrl);
}

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
      proxyHeaders: { request: streamHeaders }
    },
    subtitles: []
  };
}

async function extractIndex11(proxyUrl, displayTitle) {
  var html = await fetchHtml(proxyUrl, BASE_URL + "/");
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
  var opts = matchAllRegex(html, /data-link=["']([^"']+)["'][^>]*data-language=["']([^"']+)["']/gi);
  for (var i = 0; i < opts.length; i++) {
    var link = opts[i][1]; var lang = opts[i][2] || "HD";
    if (!link || link === (primary && primary[1])) continue;
    var optM3u8 = link.includes("vidmoly.") ? await extractVidmoly(link, proxyUrl) : await extractVexal(link, proxyUrl);
    if (optM3u8 && (optM3u8.includes(".m3u8") || optM3u8.includes(".mp4"))) {
      streams.push(createStreamObj("PirateXPlay [HD] " + lang, displayTitle, optM3u8, proxyUrl));
    }
  }
  return streams;
}

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
  for (var i = 0; i < parsed.length; i++) {
    var item = parsed[i];
    if (!item || !item.link) continue;
    var lang = item.language || "Multi";
    var link = item.link;
    try {
      var r = await fetch(link, { headers: HEADERS });
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
    if (iurl.includes("multi.php?data=")) {
      return await extractMulti(iurl, epUrl, displayTitle);
    }
    if (iurl.includes("/public/player/")) {
      return await extractIndex11(iurl, displayTitle);
    }
    if (iurl.includes("vidmoly.")) {
      var vm3u8 = await extractVidmoly(iurl, epUrl);
      if (vm3u8 && (vm3u8.includes(".m3u8") || vm3u8.includes(".mp4"))) {
        streams.push(createStreamObj(sname, displayTitle, vm3u8, "https://vidmoly.biz/"));
        return streams;
      }
    }
    if (iurl.includes("animedekho.piratexplay.com")) {
      var am3u8 = await extractAnimedekho(iurl);
      if (am3u8 && (am3u8.includes(".m3u8") || am3u8.includes(".mp4"))) {
        streams.push(createStreamObj(sname, displayTitle, am3u8, iurl));
        return streams;
      }
    }
    if (iurl.includes("vexal.top") || iurl.includes("as-cdn26.top")) {
      var xm3u8 = await extractVexal(iurl, epUrl);
      if (xm3u8 && (xm3u8.includes(".m3u8") || xm3u8.includes(".mp4"))) {
        streams.push(createStreamObj(sname, displayTitle, xm3u8, iurl));
        return streams;
      }
    }
    var genHtml = await fetchHtml(iurl, epUrl, 3000);
    var genM3u8 = extractPlayerUrl(genHtml);
    if (genM3u8 && (genM3u8.includes(".m3u8") || genM3u8.includes(".mp4"))) {
      streams.push(createStreamObj(sname, displayTitle, genM3u8, iurl));
      return streams;
    }
  } catch(e) {}

  return streams;
}

async function extractStreams(epUrl, displayTitle) {
  var html = await fetchHtml(epUrl, null, 5000);
  if (!html) return [];

  var serverMap = {};
  var btnMatches = matchAllRegex(html, /<a[^>]+href=["']#options-(\d+)["'][^>]*>([\s\S]*?)<\/a>/gi);
  for (var i = 0; i < btnMatches.length; i++) {
    var b = btnMatches[i];
    var numM = b[2].match(/Server\s*<span>(\d+)<\/span>/i);
    var labelM = b[2].match(/<span class="server">([^<]+)<\/span>/i);
    serverMap[b[1]] = {
      num: numM ? numM[1] : b[1],
      label: labelM ? labelM[1].trim() : "Server " + (parseInt(b[1]) + 1)
    };
  }

  var divMatches = matchAllRegex(html, /<div\s+id="options-(\d+)"[^>]*class="video\s+aa-tb[^"]*"[^>]*>([\s\S]*?)<\/div>/gi);
  var tasks = divMatches.map(function(div) {
    return processServerDiv(div, serverMap, epUrl, displayTitle).catch(function() { return []; });
  });
  var results = await Promise.all(tasks);

  var verifiedStreams = [];
  for (var j = 0; j < results.length; j++) {
    if (Array.isArray(results[j])) {
      for (var k = 0; k < results[j].length; k++) {
        verifiedStreams.push(results[j][k]);
      }
    }
  }
  return verifiedStreams;
}

function cleanWordList(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(function(w) {
    return w.length > 0 && w !== "the" && w !== "a" && w !== "an" && w !== "season";
  });
}

function scoreSlugMatch(slug, searchWords) {
  var slugWords = slug.toLowerCase().split(/[-_]/);
  var matches = 0;
  for (var i = 0; i < searchWords.length; i++) {
    if (slugWords.indexOf(searchWords[i]) !== -1) matches++;
  }
  return matches / Math.max(searchWords.length, 1);
}

// ── Media info resolver (TMDB Website Scrape + TVMaze + Cinemeta) ──────────
async function getMediaInfo(rawId, mediaType) {
  var id = String(rawId || "").split(":")[0].trim();
  var isSeries = mediaType === "tv" || mediaType === "series";

  // 1. Numeric TMDB ID -> scrape www.themoviedb.org (bypasses ISP api block)
  if (/^\d+$/.test(id)) {
    try {
      var endpoint = isSeries ? "tv" : "movie";
      var url = "https://www.themoviedb.org/" + endpoint + "/" + id;
      var html = await fetchHtml(url, null, 3000);
      if (html) {
        var og = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
        if (og && og[1]) {
          var title = og[1].replace(/\s*\(\d{4}\)$/, "").trim();
          var yr = html.match(/\((\d{4})\)/);
          return { title: title, year: yr ? yr[1] : "", id: id };
        }
      }
    } catch(e) {}
  }

  // 2. IMDb ID (tt...) -> TVMaze / Cinemeta
  if (id.startsWith("tt")) {
    if (isSeries) {
      try {
        var mres = await fetch("https://api.tvmaze.com/lookup/shows?imdb=" + id);
        if (mres.ok) {
          var md = await mres.json();
          if (md && md.name) {
            return { title: md.name, year: String(md.premiered || "").slice(0, 4), id: id };
          }
        }
      } catch(e) {}
    }
    try {
      var ctype = isSeries ? "series" : "movie";
      var cres = await fetch("https://v3-cinemeta.strem.io/meta/" + ctype + "/" + id + ".json");
      if (cres.ok) {
        var cd = await cres.json();
        if (cd && cd.meta && cd.meta.name) {
          return { title: cd.meta.name, year: String(cd.meta.year || "").slice(0, 4), id: id };
        }
      }
    } catch(e) {}
  }

  return { title: id, year: "", id: id };
}

// ── Find episode page URL ──────────────────────────────────────────────────
async function findEpisodeUrl(id, mediaType, info, sNum, eNum) {
  var isSeries = mediaType === "tv" || mediaType === "series";

  // 1. Direct search by numeric ID on piratexplay
  if (/^\d+$/.test(String(info.id))) {
    var searchHtml = await fetchHtml(BASE_URL + "/?s=" + info.id);
    if (searchHtml) {
      if (isSeries) {
        var sPat = new RegExp('href=["\'](?:' + BASE_URL + ')?(\\/series\\/[^"\']*-' + info.id + '\\/?)["\']', "i");
        var sm = searchHtml.match(sPat);
        if (sm) {
          var baseSlug = sm[1].replace(/\/$/, "").split("/").pop();
          var adjSlug = baseSlug.replace(/season-\d+/i, "season-" + sNum);
          return BASE_URL + "/episode/" + adjSlug + "-" + sNum + "x" + eNum + "/";
        }
      } else {
        var mPat = new RegExp('href=["\'](?:' + BASE_URL + ')?(\\/movies\\/[^"\']*-' + info.id + '\\/?)["\']', "i");
        var mm = searchHtml.match(mPat);
        if (mm) return BASE_URL + mm[1];
      }
    }
  }

  // 2. Search by title
  var searchTitle = info.title && info.title !== info.id ? info.title : String(id);
  var clean = searchTitle.replace(/[:!?_]/g, " ").replace(/\s+/g, " ").trim();
  var searchHtml2 = await fetchHtml(BASE_URL + "/?s=" + encodeURIComponent(clean));
  if (searchHtml2) {
    var matches = matchAllRegex(searchHtml2, /href=["'](https?:\/\/piratexplay\.cc)?(\/(?:series|movies)\/[^"']+\/?)["']/gi);
    var unique = [];
    for (var i = 0; i < matches.length; i++) {
      var u = matches[i][2];
      if (unique.indexOf(u) === -1) unique.push(u);
    }

    if (unique.length > 0) {
      var searchWords = cleanWordList(searchTitle);
      var best = null;
      var bestScore = -1;
      for (var j = 0; j < unique.length; j++) {
        var slugCandidate = unique[j].replace(/\/$/, "").split("/").pop();
        var score = scoreSlugMatch(slugCandidate, searchWords);
        if (score > bestScore) {
          bestScore = score;
          best = unique[j];
        }
      }

      if (best && bestScore >= 0.25) {
        if (!isSeries || best.indexOf("/movies/") !== -1) return BASE_URL + best;
        var baseSlug = best.replace(/\/$/, "").split("/").pop();
        var adjSlug = baseSlug.replace(/season-\d+/i, "season-" + sNum);
        return BASE_URL + "/episode/" + adjSlug + "-" + sNum + "x" + eNum + "/";
      }
    }
  }

  return null;
}

// ── Main entry point ───────────────────────────────────────────────────────
async function getStreams(id, mediaType, season, episode) {
  if (typeof id === "object" && id !== null) {
    var obj = id;
    id = obj.id || obj.tmdbId || obj.imdbId;
    mediaType = obj.type || obj.mediaType || mediaType;
    if (obj.season !== undefined) season = obj.season;
    if (obj.episode !== undefined) episode = obj.episode;
  }
  if (typeof id === "string" && id.indexOf(":") !== -1) {
    var parts = id.split(":");
    id = parts[0];
    if (season === undefined || season === null) season = parseInt(parts[1]);
    if (episode === undefined || episode === null) episode = parseInt(parts[2]);
  }

  id = String(id || "").trim();
  mediaType = mediaType || "tv";
  var sNum = parseInt(season) || 1;
  var eNum = parseInt(episode) || 1;

  try {
    var info = await getMediaInfo(id, mediaType);
    var displayTitle = (mediaType === "tv" || mediaType === "series")
      ? (info.title + " S" + String(sNum).padStart(2, "0") + "E" + String(eNum).padStart(2, "0"))
      : info.title;

    var epUrl = await findEpisodeUrl(id, mediaType, info, sNum, eNum);
    if (!epUrl) return [];

    return await extractStreams(epUrl, displayTitle);
  } catch(e) {
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
}
if (typeof globalThis !== "undefined") {
  globalThis.getStreams = getStreams;
}
if (typeof window !== "undefined") {
  window.getStreams = getStreams;
}
