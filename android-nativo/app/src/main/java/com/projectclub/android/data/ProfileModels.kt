package com.projectclub.android.data

import kotlinx.serialization.Serializable

/*
 * Modelos do perfil (GET /api/users/:id/summary, depoimentos, recados, fãs).
 * Tudo com padrão: o servidor manda muita coisa e esconde parte dela quando
 * a privacidade do perfil não deixa ver (profileRestricted).
 */

/** Tag de clã escolhida pela pessoa (User.clanTag no servidor). */
@Serializable
data class ProfileClanTag(val tag: String? = null)

/** Usuário como vem no perfil completo (PUBLIC_USER_FIELDS + extras). */
@Serializable
data class ProfileUser(
    val id: String = "",
    val publicId: String? = null,
    val username: String? = null,
    val displayName: String? = null,
    val avatarUrl: String? = null,
    val avatarDecoration: String? = null,
    val profileEffect: String? = null,
    val bannerUrl: String? = null,
    val bio: String? = null,
    val pronouns: String? = null,
    val status: String? = null,
    val customStatus: String? = null,
    val customStatusEmoji: String? = null,
    val profileColor: String? = null,
    val levelBarColor: String? = null,
    val platformRole: String? = null,
    val accountLevel: Int? = null,
    val accountXp: Long? = null,
    val createdAt: String? = null,
    val tagEmoji: String? = null,
    val tagText: String? = null,
    val clanTag: ProfileClanTag? = null,
) {
    val name: String get() = displayName?.takeIf { it.isNotBlank() } ?: username ?: "Usuário"

    /** Versão "User" (pra reaproveitar Avatar e afins). */
    fun toUser(): User = User(
        id = id, publicId = publicId, username = username, displayName = displayName,
        avatarUrl = avatarUrl, avatarDecoration = avatarDecoration, profileEffect = profileEffect, bannerUrl = bannerUrl,
        bio = bio, pronouns = pronouns, status = status, customStatus = customStatus,
        customStatusEmoji = customStatusEmoji, profileColor = profileColor,
        platformRole = platformRole, accountLevel = accountLevel,
    )
}

/** Insígnia (Badge + awardedAt). `icon` é um emoji; `iconUrl`, quando vem, é imagem. */
@Serializable
data class ProfileBadge(
    val id: String = "",
    val key: String? = null,
    val name: String = "",
    val description: String? = null,
    val icon: String? = null,
    val iconUrl: String? = null,
    val rarity: String? = null,
    val awardedAt: String? = null,
)

/** Conquista escolhida pra aparecer no perfil. */
@Serializable
data class ProfileAchievement(
    val id: String = "",
    val key: String? = null,
    val name: String = "",
    val description: String? = null,
    val iconUrl: String? = null,
    val rarity: String? = null,
)

/** Corpo de GET /api/users/:id. */
@Serializable
data class ProfileData(
    val user: ProfileUser? = null,
    val badges: List<ProfileBadge> = emptyList(),
    val mutualFriends: List<User> = emptyList(),
    val likeCount: Int = 0,
    val dislikeCount: Int = 0,
    val myVote: Int = 0,
    val levelProgress: Int = 0,
    val totalUps: Int = 0,
    val displayedAchievements: List<ProfileAchievement> = emptyList(),
    val relationshipPartner: User? = null,
    val isBirthdayToday: Boolean = false,
    val profileRestricted: Boolean = false,
)

/** GET /api/fans/:id e POST /api/fans/:id/toggle. */
@Serializable
data class ProfileFanStatus(val count: Int = 0, val isFan: Boolean = false)

/** GET /api/users/:id/summary (perfil + fãs numa ida só). */
@Serializable
data class ProfileSummary(
    val profile: ProfileData? = null,
    val fan: ProfileFanStatus? = null,
)

/** POST /api/users/:id/vote. */
@Serializable
data class ProfileVoteResponse(val likeCount: Int = 0, val dislikeCount: Int = 0, val myVote: Int = 0)

/** Depoimento ou recado (mesmo formato nos dois). */
@Serializable
data class ProfileWallPost(
    val id: String = "",
    val text: String = "",
    val createdAt: String? = null,
    val author: User? = null,
)

@Serializable
data class ProfileTestimonialsResponse(val testimonials: List<ProfileWallPost> = emptyList(), val total: Int = 0)

@Serializable
data class ProfileScrapsResponse(val scraps: List<ProfileWallPost> = emptyList(), val total: Int = 0)
