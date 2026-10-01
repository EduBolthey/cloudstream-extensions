package com.piratexplay

import com.lagradost.cloudstream3.*
import com.lagradost.cloudstream3.LoadResponse.Companion.addActors
import com.lagradost.cloudstream3.utils.*
import com.lagradost.cloudstream3.utils.AppUtils.tryParseJson
import org.jsoup.nodes.Element
import android.util.Base64

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
        val posterUrl = fixUrlNull(this.selectFirst("div.post-thumbnail img")?.let { img ->
            img.attr("data-src").ifBlank { img.attr("src") }
        })
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

        val poster = fixUrlNull(document.selectFirst("article.post.single img")?.let { img ->
            img.attr("data-src").ifBlank { img.attr("src") }
        })

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

        val seasons = document.select("div.season-swiper div.swiper-slide a.season-btn")
        val episodesList = mutableListOf<Episode>()

        if (seasons.isNotEmpty()) {
            for (seasonBtn in seasons) {
                val seasonNum = seasonBtn.attr("data-season").toIntOrNull() ?: 1
                val seasonHref = fixUrlNull(seasonBtn.attr("href")) ?: continue
                val seasonDoc = if (seasonHref == url) document else app.get(seasonHref).document

                seasonDoc.select("ul#episode_by_temp li article.episodes").forEach { epArticle ->
                    val epHref = fixUrlNull(epArticle.selectFirst("a.lnk-blk")?.attr("href")) ?: return@forEach
                    val epCode = epArticle.selectFirst("span.num-epi")?.text()?.trim()
                    val epNum = epCode?.substringAfter("x")?.toIntOrNull()
                    val epTitle = epArticle.selectFirst("h2.entry-title")?.text()?.trim() ?: "Episode $epNum"
                    val epThumb = fixUrlNull(epArticle.selectFirst("img")?.let { img ->
                        img.attr("data-src").ifBlank { img.attr("src") }
                    })

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
        } else {
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

    override suspend fun loadLinks(
        data: String,
        isCasting: Boolean,
        subtitleCallback: (SubtitleFile) -> Unit,
        callback: (ExtractorLink) -> Unit
    ): Boolean {
        val document = app.get(data).document
        val iframes = document.select("section.player div.video iframe")
        val serverLabels = document.select("aside.video-options ul.aa-tbs-video li a")

        iframes.forEachIndexed { index, iframe ->
            val rawUrl = iframe.attr("src").ifBlank { iframe.attr("data-src") }
            if (rawUrl.isBlank()) return@forEachIndexed

            val cleanUrl = fixUrl(rawUrl)
            val serverName = serverLabels.getOrNull(index)?.selectFirst("span.server")?.text()?.trim() 
                ?: "Server ${index + 1}"

            if (cleanUrl.contains("multi.php?data=")) {
                val base64Data = cleanUrl.substringAfter("multi.php?data=")
                try {
                    val decodedJson = String(Base64.decode(base64Data, Base64.DEFAULT))
                    val audioList = tryParseJson<List<MultiAudioItem>>(decodedJson)
                    audioList?.forEach { item ->
                        val langPrefix = "[${item.language}]"
                        loadExtractor(
                            url = item.link,
                            referer = "$mainUrl/",
                            subtitleCallback = subtitleCallback
                        ) { link ->
                            callback(
                                link.copy(
                                    name = "$langPrefix ${link.name}"
                                )
                            )
                        }
                    }
                } catch (e: Exception) {
                    // Ignore decode failure
                }
            } else {
                loadExtractor(
                    url = cleanUrl,
                    referer = "$mainUrl/",
                    subtitleCallback = subtitleCallback
                ) { link ->
                    callback(
                        link.copy(
                            name = "[$serverName] ${link.name}"
                        )
                    )
                }
            }
        }

        return true
    }

    data class MultiAudioItem(
        val language: String,
        val link: String
    )
}
