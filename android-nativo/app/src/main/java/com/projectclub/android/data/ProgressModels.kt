package com.projectclub.android.data

import kotlinx.serialization.Serializable

/*
 * Modelos da tela de Progresso (nível, ranking, conquistas e recompensas).
 * Rotas: GET /api/economy/rank, GET /api/economy/leaderboard, GET /api/achievements.
 */

/** GET /api/economy/rank — o seu nível/XP e posição no ranking geral. */
@Serializable
data class ProgressRank(
    val level: Int = 1,
    val levelName: String? = null,
    val levelTitle: String? = null,
    val xp: Long = 0,
    val nextLevel: Int? = null,
    val xpInLevel: Long = 0,
    val xpNeeded: Long = 0,
    val progress: Int = 0,
    val isMaxLevel: Boolean = false,
    val position: Int? = null,
)

/** Uma pessoa do ranking (campos públicos do usuário + XP). */
@Serializable
data class ProgressLeader(
    val id: String = "",
    val username: String? = null,
    val displayName: String? = null,
    val avatarUrl: String? = null,
    val status: String? = null,
    val profileColor: String? = null,
    val platformRole: String? = null,
    val accountLevel: Int = 1,
    val accountXp: Long = 0,
    /** true = quem pediu não está no top 50 e veio no fim da lista. */
    val outsideTop50: Boolean = false,
) {
    val name: String get() = displayName?.takeIf { it.isNotBlank() } ?: username ?: "Usuário"
    fun toUser(): User = User(
        id = id, username = username, displayName = displayName, avatarUrl = avatarUrl,
        status = status, profileColor = profileColor, platformRole = platformRole, accountLevel = accountLevel,
    )
}

/** GET /api/economy/leaderboard */
@Serializable
data class ProgressLeaderboardResponse(val leaderboard: List<ProgressLeader> = emptyList())

/** Uma conquista do catálogo, com o seu progresso. */
@Serializable
data class ProgressAchievement(
    val id: String = "",
    val key: String? = null,
    val name: String = "",
    val description: String = "",
    val iconUrl: String? = null,
    /** COMMON | RARE | EPIC | LEGENDARY */
    val rarity: String = "COMMON",
    val progressType: String? = null,
    val target: Long = 1,
    val position: Int = 0,
    val unlocked: Boolean = false,
    val unlockedAt: String? = null,
    val progress: Long = 0,
) {
    /** 0..1 */
    val fraction: Float get() = if (unlocked) 1f else (progress.toFloat() / target.coerceAtLeast(1L).toFloat()).coerceIn(0f, 1f)
}

/** GET /api/achievements */
@Serializable
data class ProgressAchievementsResponse(val achievements: List<ProgressAchievement> = emptyList())

/**
 * Recompensa por nível. O catálogo é fixo no app (igual ao site,
 * client/src/utils/levelRewards.js): cada recompensa corresponde a uma trava
 * de nível no código do servidor, então não há rota de "resgatar".
 */
data class ProgressLevelReward(val level: Int, val icon: String, val title: String, val description: String)

val PROGRESS_LEVEL_REWARDS: List<ProgressLevelReward> = listOf(
    ProgressLevelReward(
        level = 10, icon = "🏛️", title = "Criar um Clube",
        description = "Ao atingir o nível 10, você pode criar e liderar o seu próprio clube dentro da comunidade.",
    ),
)
