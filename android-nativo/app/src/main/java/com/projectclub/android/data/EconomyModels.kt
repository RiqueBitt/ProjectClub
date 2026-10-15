package com.projectclub.android.data

import kotlinx.serialization.Serializable

/*
 * Modelos da Economia: carteira (GET /api/economy), baú diário
 * (POST /api/economy/daily), baús possíveis, missões e extrato.
 */

@Serializable
data class EcoWallet(
    val coins: Int = 0,
    val gems: Int = 0,
    val dailyStreak: Int = 0,
    val lastDailyAt: String? = null,
    val accountLevel: Int = 1,
    val accountXp: Int = 0,
    val streakRequired: Int = 5,
    /** Quando o próximo baú libera (null = já pode resgatar). */
    val nextDailyAt: String? = null,
)

@Serializable
data class EcoBalance(
    val coins: Int? = null,
    val gems: Int? = null,
    val dailyStreak: Int? = null,
    val accountXp: Int? = null,
    val accountLevel: Int? = null,
)

@Serializable
data class EcoDailyResult(
    val chestName: String? = null,
    val chestImageClosed: String? = null,
    val chestImageOpened: String? = null,
    val coins: Int = 0,
    val tickets: Int = 0,
    val streak: Int = 0,
    val streakRequired: Int = 5,
    val megaAwarded: Boolean = false,
    val megaGems: Int = 0,
    val balance: EcoBalance? = null,
)

@Serializable
data class EcoChest(
    val id: String,
    val name: String = "",
    val imageClosed: String? = null,
    val imageOpened: String? = null,
)

@Serializable
data class EcoChestList(val chests: List<EcoChest> = emptyList())

@Serializable
data class EcoMission(
    val id: String,
    val period: String = "DAILY", // DAILY | WEEKLY
    val type: String = "",
    val title: String = "",
    val description: String? = null,
    val target: Int = 1,
    val progress: Int = 0,
    val completed: Boolean = false,
    val claimed: Boolean = false,
    val rewardCoins: Int = 0,
    val rewardGems: Int = 0,
    val rewardXp: Int = 0,
    val unit: String? = null,
)

@Serializable
data class EcoResets(val daily: String? = null, val weekly: String? = null)

@Serializable
data class EcoMissionList(
    val missions: List<EcoMission> = emptyList(),
    val resets: EcoResets? = null,
)

@Serializable
data class EcoReward(val coins: Int = 0, val gems: Int = 0, val xp: Int = 0)

@Serializable
data class EcoLevelUp(
    val levelUp: Boolean = false,
    val oldLevel: Int? = null,
    val newLevel: Int? = null,
    val newLevelName: String? = null,
    val coinsReward: Int = 0,
)

@Serializable
data class EcoMissionClaim(
    val reward: EcoReward? = null,
    val balance: EcoBalance? = null,
    val levelUp: EcoLevelUp? = null,
)

@Serializable
data class EcoTransaction(
    val id: String,
    val kind: String = "", // DAILY | MISSION | SHOP | GIFT | ADMIN | LEVEL
    val label: String = "",
    val coins: Int = 0,
    val gems: Int = 0,
    val xp: Int = 0,
    val createdAt: String? = null,
)

@Serializable
data class EcoHistory(
    val transactions: List<EcoTransaction> = emptyList(),
    val hasMore: Boolean = false,
)
