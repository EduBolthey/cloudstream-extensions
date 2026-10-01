var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// C:/Users/chalak_LOMBDI/.gemini/antigravity-ide/brain/3cc3a6f6-bfb2-4d02-8bd2-37217facaf37/scratch/src_piratexplay.js
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var BASE_URL = "https://piratexplay.cc";
var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Referer": `${BASE_URL}/`
};
function makeRequest(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const res = yield fetch(url, __spreadProps(__spreadValues({}, options), {
      headers: __spreadValues(__spreadValues({}, HEADERS), options.headers)
    }));
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res;
  });
}
function getTmdbDetails(tmdbId, mediaType) {
  return __async(this, null, function* () {
    const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const res = yield fetch(url);
    if (!res.ok) throw new Error(`TMDB error: ${res.status}`);
    const data = yield res.json();
    return {
      title: data.title || data.name || data.original_title || data.original_name,
      originalTitle: data.original_title || data.original_name,
      year: (data.release_date || data.first_air_date || "").split("-")[0]
    };
  });
}
function base64Decode(str) {
  try {
    if (typeof atob === "function") return atob(str);
    if (typeof Buffer !== "undefined") return Buffer.from(str, "base64").toString("utf-8");
    return null;
  } catch (e) {
    return null;
  }
}
function getStreams(tmdbId, mediaType = "tv", season = 1, episode = 1) {
  return __async(this, null, function* () {
    console.log(`[PirateXPlay] Fetching streams for TMDB: ${tmdbId}, Type: ${mediaType}, S${season}E${episode}`);
    try {
      const tmdb = yield getTmdbDetails(tmdbId, mediaType);
      console.log(`[PirateXPlay] TMDB Info: "${tmdb.title}" (${tmdb.year})`);
      let targetUrl = null;
      try {
        const tmdbSearchRes = yield makeRequest(`${BASE_URL}/?s=${tmdbId}`);
        const tmdbSearchHtml = yield tmdbSearchRes.text();
        const pattern = mediaType === "tv" ? new RegExp(`href=["'](https?:\\/\\/piratexplay\\.cc)?(\\/series\\/[^"']*${tmdbId}[^"']*)["']`, "i") : new RegExp(`href=["'](https?:\\/\\/piratexplay\\.cc)?(\\/movies\\/[^"']*${tmdbId}[^"']*)["']`, "i");
        const match = tmdbSearchHtml.match(pattern);
        if (match) {
          targetUrl = match[2].startsWith("http") ? match[2] : `${BASE_URL}${match[2]}`;
          console.log(`[PirateXPlay] Matched by TMDB ID: ${targetUrl}`);
        }
      } catch (e) {
        console.log(`[PirateXPlay] TMDB ID search note: ${e.message}`);
      }
      if (!targetUrl) {
        const cleanTitle = tmdb.title.replace(/[:!?]/g, " ").trim();
        const titleSearchRes = yield makeRequest(`${BASE_URL}/?s=${encodeURIComponent(cleanTitle)}`);
        const titleSearchHtml = yield titleSearchRes.text();
        const articles = [...titleSearchHtml.matchAll(/<article[^>]*>[\s\S]*?href=["'](https?:\/\/piratexplay\.cc)?(\/(?:series|movies)\/[^"']+)["'][\s\S]*?<\/article>/gi)];
        if (articles.length > 0) {
          targetUrl = articles[0][2].startsWith("http") ? articles[0][2] : `${BASE_URL}${articles[0][2]}`;
          console.log(`[PirateXPlay] Matched by title search: ${targetUrl}`);
        }
      }
      if (!targetUrl) {
        console.log("[PirateXPlay] No matching series/movie found");
        return [];
      }
      let episodePageUrl = targetUrl;
      if (mediaType === "tv") {
        console.log(`[PirateXPlay] Fetching series page: ${targetUrl}`);
        const seriesRes = yield makeRequest(targetUrl);
        const seriesHtml = yield seriesRes.text();
        const epPattern1 = new RegExp(`href=["'](https?:\\/\\/piratexplay\\.cc)?(\\/episode\\/[^"']*-${season}x${episode}\\/?)["']`, "i");
        const epPattern2 = new RegExp(`href=["'](https?:\\/\\/piratexplay\\.cc)?(\\/episode\\/[^"']*s0?${season}e0?${episode}[^"']*)["']`, "i");
        const epMatch = seriesHtml.match(epPattern1) || seriesHtml.match(epPattern2);
        if (epMatch) {
          const epPath = epMatch[2];
          episodePageUrl = epPath.startsWith("http") ? epPath : `${BASE_URL}${epPath}`;
          console.log(`[PirateXPlay] Found episode page: ${episodePageUrl}`);
        } else {
          const slug = targetUrl.replace(/\/$/, "").split("/").pop();
          episodePageUrl = `${BASE_URL}/episode/${slug}-${season}x${episode}/`;
          console.log(`[PirateXPlay] Trying constructed episode URL: ${episodePageUrl}`);
        }
      }
      console.log(`[PirateXPlay] Fetching player page: ${episodePageUrl}`);
      const epPageRes = yield makeRequest(episodePageUrl);
      const epPageHtml = yield epPageRes.text();
      const iframes = [...epPageHtml.matchAll(/<iframe[^>]+(?:src|data-src)=["']([^"']+)["']/gi)].map((m) => m[1]);
      console.log(`[PirateXPlay] Found ${iframes.length} iframes`);
      const streams = [];
      const displayTitle = mediaType === "tv" ? `${tmdb.title} S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}` : `${tmdb.title} (${tmdb.year})`;
      for (let i = 0; i < iframes.length; i++) {
        let iframeUrl = iframes[i];
        if (iframeUrl.startsWith("//")) iframeUrl = "https:" + iframeUrl;
        if (iframeUrl.includes("multi.php?data=")) {
          try {
            const b64 = iframeUrl.split("multi.php?data=")[1].split("&")[0];
            const decoded = base64Decode(b64);
            if (decoded) {
              const parsed = JSON.parse(decoded);
              if (Array.isArray(parsed)) {
                for (const audio of parsed) {
                  if (audio.link) {
                    streams.push({
                      name: `PirateXPlay [${audio.language || "Multi"}]`,
                      title: displayTitle,
                      url: audio.link,
                      quality: "1080p",
                      headers: {
                        "Referer": `${BASE_URL}/`,
                        "User-Agent": HEADERS["User-Agent"]
                      },
                      provider: "piratexplay"
                    });
                  }
                }
              }
            }
          } catch (e) {
            console.log(`[PirateXPlay] Multi-audio decode note: ${e.message}`);
          }
        } else if (iframeUrl.includes("as-cdn") || iframeUrl.includes("vexal.top") || iframeUrl.includes("animedekho")) {
          streams.push({
            name: `PirateXPlay AnimeSalt HD`,
            title: displayTitle,
            url: iframeUrl,
            quality: "1080p",
            headers: {
              "Referer": `${BASE_URL}/`,
              "User-Agent": HEADERS["User-Agent"]
            },
            provider: "piratexplay"
          });
        } else if (iframeUrl.includes("abyssplayer.com")) {
          streams.push({
            name: `PirateXPlay Abyss HD`,
            title: displayTitle,
            url: iframeUrl,
            quality: "1080p",
            headers: {
              "Referer": `${BASE_URL}/`,
              "User-Agent": HEADERS["User-Agent"]
            },
            provider: "piratexplay"
          });
        } else if (!iframeUrl.includes("ads") && !iframeUrl.includes("googletagmanager")) {
          const serverName = iframeUrl.split("/")[2] || `Server ${i + 1}`;
          streams.push({
            name: `PirateXPlay ${serverName}`,
            title: displayTitle,
            url: iframeUrl,
            quality: "1080p",
            headers: {
              "Referer": `${BASE_URL}/`,
              "User-Agent": HEADERS["User-Agent"]
            },
            provider: "piratexplay"
          });
        }
      }
      console.log(`[PirateXPlay] Returning ${streams.length} streams!`);
      return streams;
    } catch (error) {
      console.error(`[PirateXPlay] Error:`, error.message);
      return [];
    }
  });
}
module.exports = { getStreams };
