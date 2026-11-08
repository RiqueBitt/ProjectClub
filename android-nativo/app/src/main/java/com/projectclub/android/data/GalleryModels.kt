package com.projectclub.android.data

import kotlinx.serialization.Serializable

/*
 * Galeria da comunidade: fotos, GIFs e vídeos dos canais e do Fórum.
 * Lista em /api/community/gallery; curtidas e "mais curtidos" em /api/gallery.
 */

@Serializable
data class GalleryChannel(
    val id: String = "",
    val name: String = "",
    val type: String? = null,
    val iconEmoji: String? = null,
    val iconUrl: String? = null,
)

@Serializable
data class GalleryClub(val slug: String = "", val name: String = "")

@Serializable
data class GalleryItem(
    /** "a:<anexo>" (canal) ou "p:<post>" (Fórum) — também é a chave das curtidas. */
    val id: String = "",
    /** image | gif | video */
    val kind: String = "image",
    val url: String = "",
    val filename: String? = null,
    /** channel | post */
    val source: String? = null,
    val channel: GalleryChannel? = null,
    val messageId: String? = null,
    val postId: String? = null,
    val title: String? = null,
    val club: GalleryClub? = null,
    val author: User? = null,
    val createdAt: String? = null,
) {
    val isVideo: Boolean get() = kind == "video"
    val isGif: Boolean get() = kind == "gif"
}

@Serializable
data class GalleryListResponse(val items: List<GalleryItem> = emptyList(), val nextBefore: String? = null)

@Serializable
data class GalleryTopResponse(
    val items: List<GalleryItem> = emptyList(),
    val counts: Map<String, Int> = emptyMap(),
    val mine: List<String> = emptyList(),
)

@Serializable
data class GalleryLikesResponse(val counts: Map<String, Int> = emptyMap(), val mine: List<String> = emptyList())

@Serializable
data class GalleryToggleResponse(val liked: Boolean = false, val count: Int = 0)
