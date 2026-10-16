package com.projectclub.android.data

import kotlinx.serialization.Serializable

/** Anúncio da staff (/api/anuncios). */
@Serializable
data class StaffAnnouncement(
    val id: String = "",
    val title: String = "",
    val body: String = "",
    val bannerUrl: String? = null,
    val linkUrl: String? = null,
    val linkLabel: String? = null,
    val pinned: Boolean = false,
    val createdById: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val author: User? = null,
)

@Serializable
data class StaffAnnouncementsResponse(
    val announcements: List<StaffAnnouncement> = emptyList(),
    val canManage: Boolean = false,
)

/** Comunicado em tela cheia criado no Painel da Staff (/api/announcements/active). */
@Serializable
data class PlatformAnnouncement(
    val id: String = "",
    val title: String = "",
    val description: String? = null,
    val bannerUrl: String? = null,
    val buttonLabel: String? = null,
    val buttonUrl: String? = null,
)

@Serializable
data class ActiveAnnouncementResponse(val announcement: PlatformAnnouncement? = null)
