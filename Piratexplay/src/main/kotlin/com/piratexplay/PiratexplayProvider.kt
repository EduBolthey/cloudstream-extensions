package com.piratexplay

import com.lagradost.cloudstream3.*
import com.lagradost.cloudstream3.utils.*
import com.lagradost.cloudstream3.utils.AppUtils.tryParseJson
import org.jsoup.nodes.Element
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runBlocking

class PiratexplayProvider : MainAPI() {
    override var mainUrl = "https://piratexplay.cc"
    override var name = "PirateXPlay"
    override val hasMainPage = true
    override var lang = "hi"
    override val hasDownloadSupport = true
    override val supportedTypes = setOf(
        TvType.Anime,
        TvType.AnimeMovie,
        TvType.Cartoon,
        TvType.Movie,
        TvType.TvSeries
    )

    override val mainPage = mainPageOf(
        "/home" to "Latest Releases",
        "/category/anime/" to "Anime",
        "/category/movie/" to "Movies",
        "/category/cartoon/" to "Cartoons",
        "/language/hindi/" to "Hindi Dubbed",
        "/language/tamil/" to "Tamil Dubbed",
        "/language/telugu/" to "Telugu Dubbed",
        "/category/top-airing/" to "Top Airing",
        "/category/popular/" to "Popular"
    )

    override suspend fun getMainPage(page: Int, request: MainPageRequest): HomePageResponse {
        val url = if (page == 1) {
            "$mainUrl${request.data}"
        } else {
            "$mainUrl${request.data}page/$page/"
        }
        val document = app.get(url).document
        val items = document.select("ul.post-lst li article.post").mapNotNull {
            it.toSearchResult()
        }
        return newHomePageResponse(request.name, items)
    }

    private fun Element.toSearchResult(): SearchResponse? {
        val title = this.selectFirst("header.entry-header h2.entry-title")?.text()?.trim()
            ?: this.selectFirst("h2.entry-title")?.text()?.trim()
            ?: return null

        val href = fixUrlNull(this.selectFirst("a.lnk-blk")?.attr("href")) ?: return null
        val posterImg = this.selectFirst("div.post-thumbnail img")
        val posterUrl = posterImg?.let { img ->
            val src = img.attr("data-src")
            fixUrlNull(if (src.isBlank()) img.attr("src") else src)
        }
        val isMovie = href.contains("/movies/")

        return if (isMovie) {
            newMovieSearchResponse(title, href, TvType.Movie) {
                this.posterUrl = posterUrl
            }
        } else {
            newTvSeriesSearchResponse(title, href, TvType.Anime) {
                this.posterUrl = posterUrl
            }
        }
    }

    override suspend fun search(query: String): List<SearchResponse> {
        val searchUrl = "$mainUrl/?s=${query.trim().replace(" ", "+")}"
        val document = app.get(searchUrl).document
        return document.select("ul.post-lst li article.post").mapNotNull {
            it.toSearchResult()
        }
    }

    override suspend fun load(url: String): LoadResponse {
        val document = app.get(url).document

        val title = document.selectFirst("h1.entry-title")?.text()?.trim()
            ?: document.selectFirst("meta[property=og:title]")?.attr("content")
            ?: "Unknown"

        val posterImg = document.selectFirst("article.post.single img")
        val poster = posterImg?.let { img ->
            val src = img.attr("data-src")
            fixUrlNull(if (src.isBlank()) img.attr("src") else src)
        }

        val description = document.selectFirst("div.description p")?.text()?.trim()
        val year = document.selectFirst("span.year span.overviewCss")?.text()?.trim()?.toIntOrNull()
        val genres = document.select("ul.cast-lst p.genres a").map { it.text().trim() }

        val isMovie = url.contains("/movies/")

        if (isMovie) {
            return newMovieLoadResponse(title, url, TvType.Movie, url) {
                this.posterUrl = poster
                this.plot = description
                this.year = year
                this.tags = genres
            }
        }

        val episodesList = mutableListOf<Episode>()

        // Season buttons use data-slug to identify each season page
        val seasonBtns = document.select("div.season-swiper div.swiper-slide a.season-btn")

        if (seasonBtns.isNotEmpty()) {
            for (seasonBtn in seasonBtns) {
                val seasonNum = seasonBtn.attr("data-season").toIntOrNull() ?: 1
                val slug = seasonBtn.attr("data-slug").trim()

                val seasonDoc = try {
                    app.get("$mainUrl/series/$slug/").document
                } catch (e: Exception) {
                    if (seasonNum == 1) document else null
                } ?: continue

                seasonDoc.select("ul#episode_by_temp li article.episodes").forEach { epArticle ->
                    val epHref = fixUrlNull(epArticle.selectFirst("a.lnk-blk")?.attr("href")) ?: return@forEach
                    val epCode = epArticle.selectFirst("span.num-epi")?.text()?.trim()
                    val epNum = epCode?.substringAfter("x")?.toIntOrNull()
                    val epTitle = epArticle.selectFirst("h2.entry-title")?.text()?.trim() ?: "Episode $epNum"
                    val epImg = epArticle.selectFirst("img")
                    val epThumb = epImg?.let { img ->
                        val src = img.attr("data-src")
                        fixUrlNull(if (src.isBlank()) img.attr("src") else src)
                    }
                    episodesList.add(
                        newEpisode(epHref) {
                            this.name = epTitle
                            this.season = seasonNum
                            this.episode = epNum
                            this.posterUrl = epThumb
                        }
                    )
                }
            }
        }

        // Fallback: episodes directly from current page
        if (episodesList.isEmpty()) {
            document.select("ul#episode_by_temp li article.episodes").forEach { epArticle ->
                val epHref = fixUrlNull(epArticle.selectFirst("a.lnk-blk")?.attr("href")) ?: return@forEach
                val epCode = epArticle.selectFirst("span.num-epi")?.text()?.trim()
                val epNum = epCode?.substringAfter("x")?.toIntOrNull()
                val epTitle = epArticle.selectFirst("h2.entry-title")?.text()?.trim() ?: "Episode $epNum"
                episodesList.add(
                    newEpisode(epHref) {
                        this.name = epTitle
                        this.episode = epNum
                    }
                )
            }
        }

        return newTvSeriesLoadResponse(title, url, TvType.Anime, episodesList) {
            this.posterUrl = poster
            this.plot = description
            this.year = year
            this.tags = genres
        }
    }

    // ────────────────────────────────────────────────────────────────────────────
    // loadLinks — extract every server; skip any that fail / produce no streams
    // ────────────────────────────────────────────────────────────────────────────
    override suspend fun loadLinks(
        data: String,
        isCasting: Boolean,
        subtitleCallback: (SubtitleFile) -> Unit,
        callback: (ExtractorLink) -> Unit
    ): Boolean {
        val document = app.get(data, referer = "$mainUrl/").document

        // Server sidebar labels  →  <a href="#options-N"> … <span class="server">Name</span>
        val serverLabels = document.select("aside.video-options ul.aa-tbs-video li a")

        // Player divs  →  <div id="options-N" class="video aa-tb …"><iframe …></div>
        // The FIRST div has its iframe src= set; all others use data-src= (lazy-loaded by JS)
        val playerDivs = document.select("aside.video-player.aa-cn div.video.aa-tb")

        coroutineScope {
            playerDivs.mapIndexed { index, div ->
                async {
                    val iframe = div.selectFirst("iframe") ?: return@async

                    // Read src (active) or data-src (lazy)
                    val rawSrc = iframe.attr("src").trim().ifBlank { iframe.attr("data-src").trim() }
                    if (rawSrc.isBlank()) return@async

                    val divId = div.attr("id") // "options-0", "options-1", …
                    val serverLabel = serverLabels.firstOrNull { btn ->
                        btn.attr("href").trimStart('#') == divId
                    }
                    val serverNameRaw = serverLabel
                        ?.selectFirst("span.server")?.text()?.trim()
                        ?: "Server ${index + 1}"
                    val serverName = "PirateXPlay [$serverNameRaw]"

                    try {
                        when {
                            // ── Multi-audio proxy  (base64-encoded JSON of language links) ──
                            rawSrc.contains("multi.php?data=") -> {
                                val b64 = rawSrc.substringAfter("multi.php?data=").substringBefore("&")
                                val decoded = base64Decode(b64)
                                val audioList = tryParseJson<List<MultiAudioItem>>(decoded) ?: return@async
                                audioList.forEach { item ->
                                    if (item.link.isBlank()) return@forEach
                                    // Resolve short URLs one hop deep
                                    val resolvedUrl = resolveShortUrl(item.link) ?: item.link
                                    tryLoadExtractor(
                                        url = resolvedUrl,
                                        name = "$serverName [${item.language}]",
                                        referer = "$mainUrl/",
                                        subtitleCallback = subtitleCallback,
                                        callback = callback
                                    )
                                }
                            }

                            // ── Internal HD proxy player  (/public/player/index11.php?id=…) ──
                            rawSrc.contains("/public/player/") -> {
                                val innerDoc = app.get(rawSrc, referer = "$mainUrl/").document
                                val primarySrc = innerDoc.selectFirst("iframe#playerFrame")?.attr("src")?.trim()
                                if (!primarySrc.isNullOrBlank()) {
                                    tryLoadExtractor(
                                        url = primarySrc,
                                        name = "$serverName [FM]",
                                        referer = rawSrc,
                                        subtitleCallback = subtitleCallback,
                                        callback = callback
                                    )
                                }
                                // Additional servers listed in the proxy modal
                                innerDoc.select("div.server-option[data-link]").forEach { opt ->
                                    val link = opt.attr("data-link").trim()
                                    val lang = opt.attr("data-language").trim()
                                    if (link.isBlank() || link == primarySrc) return@forEach
                                    tryLoadExtractor(
                                        url = link,
                                        name = "$serverName [$lang]",
                                        referer = rawSrc,
                                        subtitleCallback = subtitleCallback,
                                        callback = callback
                                    )
                                }
                            }

                            // ── Standard extractor (vidmoly, abyssplayer, gdmirrorbot, …) ──
                            else -> {
                                tryLoadExtractor(
                                    url = fixUrl(rawSrc),
                                    name = serverName,
                                    referer = "$mainUrl/",
                                    subtitleCallback = subtitleCallback,
                                    callback = callback
                                )
                            }
                        }
                    } catch (_: Exception) {
                        // Server failed — silently skip so it never appears in the stream list
                    }
                }
            }.forEach { it.await() }
        }

        return true
    }

    // ────────────────────────────────────────────────────────────────────────────
    // Helpers
    // ────────────────────────────────────────────────────────────────────────────

    /**
     * Wraps loadExtractor in a try/catch and re-labels the stream with [name].
     * Any extractor that throws or finds nothing is silently dropped.
     */
    private suspend fun tryLoadExtractor(
        url: String,
        name: String,
        referer: String,
        subtitleCallback: (SubtitleFile) -> Unit,
        callback: (ExtractorLink) -> Unit
    ) {
        try {
            loadExtractor(url = url, referer = referer, subtitleCallback = subtitleCallback) { link ->
                runBlocking {
                    callback(
                        newExtractorLink(
                            source = name,
                            name = name,
                            url = link.url,
                            type = link.type
                        ) {
                            this.referer = link.referer
                            this.quality = link.quality
                            this.headers = link.headers
                            this.extractorData = link.extractorData
                        }
                    )
                }
            }
        } catch (_: Exception) {
            // Extractor failed — skip
        }
    }

    /**
     * Follows a short/redirect URL one or two hops to get the final destination URL.
     * Returns null on error so the caller can fall back to the original link.
     */
    private suspend fun resolveShortUrl(url: String): String? {
        return try {
            val resp = app.get(url, allowRedirects = false, timeout = 10)
            val loc1 = resp.headers["location"]?.takeIf { it.isNotBlank() } ?: return url
            if (loc1 == url) return url
            val resp2 = app.get(loc1, allowRedirects = false, timeout = 10)
            val loc2 = resp2.headers["location"]?.takeIf { it.isNotBlank() }
            loc2 ?: loc1
        } catch (_: Exception) {
            null
        }
    }

    data class MultiAudioItem(
        val language: String,
        val link: String
    )
}
