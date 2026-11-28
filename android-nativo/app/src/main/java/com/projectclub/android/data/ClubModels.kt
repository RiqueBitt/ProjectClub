package com.projectclub.android.data

import kotlinx.serialization.Serializable

/** Ícone de clube (imagem pensada pra ser tingida com [Club.iconColor]). */
@Serializable
data class ClubIcon(val id: String = "", val name: String? = null, val url: String? = null)

@Serializable
data class ClubTag(val id: String = "", val tag: String = "")

/** Membro de clube. clanRole: OWNER | SUB_OWNER | ADMIN | MODERATOR | MEMBER. */
@Serializable
data class ClubMember(
    val id: String = "",
    val publicId: String? = null,
    val username: String? = null,
    val displayName: String? = null,
    val avatarUrl: String? = null,
    val avatarDecoration: String? = null,
    val clanRole: String? = null,
) {
    val name: String get() = displayName?.takeIf { it.isNotBlank() } ?: username ?: "Usuário"
    fun asUser(): User = User(id = id, publicId = publicId, username = username, displayName = displayName, avatarUrl = avatarUrl, avatarDecoration = avatarDecoration)
}

/** Clube (no servidor ainda se chama "clan"). privacyType: PUBLIC | FRIENDS_ONLY | INVITE_ONLY. */
@Serializable
data class Club(
    val id: String = "",
    val name: String = "",
    val description: String? = null,
    val isPublic: Boolean = true,
    val privacyType: String? = null,
    val icon: ClubIcon? = null,
    val iconColor: String? = null,
    val createdAt: String? = null,
    val memberCount: Int = 0,
    /** Só vem para clubes públicos ou para quem é membro. */
    val members: List<ClubMember>? = null,
    val tags: List<ClubTag>? = null,
    /** Clubes "só amigos": o amigo que já está lá dentro. */
    val friendMember: ClubMember? = null,
) {
    val privacy: String get() = privacyType ?: if (isPublic) "PUBLIC" else "INVITE_ONLY"
}

@Serializable
data class ClubJoinRequest(val id: String = "", val user: ClubMember? = null, val createdAt: String? = null)

/** GET /api/clans/mine. */
@Serializable
data class MyClubResponse(
    val clan: Club? = null,
    val myRole: String? = null,
    val myCapabilities: Map<String, Boolean> = emptyMap(),
    val pendingRequests: List<ClubJoinRequest>? = null,
) {
    fun can(cap: String): Boolean = myCapabilities[cap] == true
}

@Serializable
data class ClubsResponse(val clans: List<Club> = emptyList())

@Serializable
data class ClubResponse(val clan: Club? = null)

@Serializable
data class ClubInvite(val id: String = "", val clan: Club = Club(), val invitedBy: ClubMember? = null, val createdAt: String? = null)

@Serializable
data class ClubInvitesResponse(val invites: List<ClubInvite> = emptyList())

/** POST /api/clans/:id/join → { joined: true } ou { requested: true }. */
@Serializable
data class ClubJoinResponse(val joined: Boolean = false, val requested: Boolean = false)

@Serializable
data class ClubMessage(
    val id: String = "",
    val clanId: String? = null,
    val authorId: String? = null,
    val author: ClubMember? = null,
    val content: String = "",
    val createdAt: String? = null,
)

@Serializable
data class ClubMessagesResponse(val messages: List<ClubMessage> = emptyList())

@Serializable
data class ClubMessageResponse(val message: ClubMessage? = null)
