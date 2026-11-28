package com.projectclub.android.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

// Game Hub (/api/game-hub): promoções, hotlist, partidas, clipes, builds e,
// só no celular, os jogos com mods e o catálogo de addons do Bedrock.

// ---------- Promoções ----------
@Serializable
data class DealPrice(@kotlinx.serialization.SerialName("final") val finalPrice: Double? = null, val base: Double? = null, val currency: String = "BRL", val discount: Int = 0)

@Serializable
data class Deal(
    val store: String = "",
    val id: String = "",
    val title: String = "",
    val image: String? = null,
    val url: String? = null,
    val price: DealPrice = DealPrice(),
    val free: Boolean = false,
    val startsAt: String? = null,
    val endsAt: String? = null,
    val steamAppId: Long? = null,
    /** A imagem é vertical (capa de caixa): aparece inteira, com fundo desfocado. */
    val imageTall: Boolean = false,
)

@Serializable
data class DealStores(val steam: Boolean = false, val gog: Boolean = false, val epic: Boolean = false)

@Serializable
data class DealsResponse(
    val free: List<Deal> = emptyList(),
    val upcoming: List<Deal> = emptyList(),
    val deals: List<Deal> = emptyList(),
    val stores: DealStores = DealStores(),
    val updatedAt: String? = null,
)

// ---------- Hotlist ----------
@Serializable
data class HotGame(
    val position: Int = 0,
    val gameKey: String = "",
    val name: String = "",
    val steamAppId: Long? = null,
    val iconUrl: String? = null,
    val seconds: Long = 0,
    val players: Int = 0,
    /** Capa achada pelo servidor (Steam conferida, ou arte da Twitch pros jogos fora da Steam). */
    val cover: String? = null,
    val coverTall: Boolean = false,
)

@Serializable
data class HotlistResponse(val month: String = "", val games: List<HotGame> = emptyList())

// ---------- Jogo (partidas, clipes, builds) ----------
@Serializable
data class HubGame(
    val key: String? = null,
    val name: String = "",
    val steamAppId: Long? = null,
    /** Capa achada pelo servidor (WoW, Roblox, Minecraft… pela arte da Twitch). */
    val cover: String? = null,
    val coverTall: Boolean = false,
)

/** GET /api/game-hub/cover?name=&appId= */
@Serializable
data class CoverResponse(val url: String? = null, val tall: Boolean = false)

/** Resultado de GET /api/games/search (steamAppId vem como texto). */
@Serializable
data class GameSearchHit(val gameKey: String = "", val name: String = "", val steamAppId: String? = null) {
    fun toHubGame() = HubGame(key = gameKey, name = name, steamAppId = steamAppId?.toLongOrNull())
}

@Serializable
data class GameSearchResponse(val games: List<GameSearchHit> = emptyList())

// ---------- Partidas ----------
@Serializable
data class GameParty(
    val id: String = "",
    val title: String = "",
    val note: String? = null,
    val slots: Int = 4,
    val game: HubGame = HubGame(),
    val startsAt: String? = null,
    val createdAt: String? = null,
    val expiresAt: String? = null,
    val status: String = "open",
    val host: User? = null,
    val hasCall: Boolean = false,
    val members: List<User> = emptyList(),
    val filled: Int = 0,
    /** host | joined | invited | null */
    val myStatus: String? = null,
    val invitedCount: Int? = null,
) {
    val isFull: Boolean get() = filled >= slots
    val inside: Boolean get() = myStatus == "host" || myStatus == "joined"
}

@Serializable
data class PartiesResponse(val parties: List<GameParty> = emptyList())

@Serializable
data class PartyResponse(val party: GameParty? = null)

@Serializable
data class PartyClosed(val closed: Boolean = false)

@Serializable
data class PartyInvited(val invited: Int = 0)

@Serializable
data class PartyChannel(val id: String = "", val name: String = "")

@Serializable
data class PartyCallResponse(val channel: PartyChannel? = null)

// ---------- Clipes ----------
@Serializable
data class GameClip(
    val id: String = "",
    val title: String = "",
    val url: String = "",
    val provider: String = "",
    val embedId: String? = null,
    val thumb: String? = null,
    val game: HubGame? = null,
    val author: User? = null,
    val likesCount: Int = 0,
    val liked: Boolean = false,
    val mine: Boolean = false,
    val createdAt: String? = null,
)

@Serializable
data class ClipsResponse(val clips: List<GameClip> = emptyList(), val more: Boolean = false)

@Serializable
data class ClipResponse(val clip: GameClip? = null)

@Serializable
data class LikeResponse(val liked: Boolean = false, val likesCount: Int = 0)

// ---------- Builds ----------
@Serializable
data class GameBuild(
    val id: String = "",
    /** lol | deadlock | darktide | outro */
    val game: String = "outro",
    val title: String = "",
    val hero: String? = null,
    val heroName: String? = null,
    val role: String? = null,
    val gameInfo: HubGame? = null,
    /** Formato depende do jogo (ver BuildData*). */
    val data: JsonObject = JsonObject(emptyMap()),
    val notes: String? = null,
    val author: User? = null,
    val likesCount: Int = 0,
    val liked: Boolean = false,
    val mine: Boolean = false,
    val createdAt: String? = null,
    val updatedAt: String? = null,
)

@Serializable
data class BuildsResponse(val builds: List<GameBuild> = emptyList(), val more: Boolean = false)

@Serializable
data class BuildResponse(val build: GameBuild? = null)

@Serializable
data class LolBuildData(
    val champion: String = "",
    val role: String? = null,
    val primaryTree: Int? = null,
    val keystone: Int? = null,
    val secondaryTree: Int? = null,
    val spells: List<String> = emptyList(),
    val start: List<String> = emptyList(),
    val core: List<String> = emptyList(),
    val situational: List<String> = emptyList(),
    val skills: String = "",
)

@Serializable
data class DeadlockBuildData(
    val hero: Int = 0,
    val early: List<Int> = emptyList(),
    val mid: List<Int> = emptyList(),
    val late: List<Int> = emptyList(),
    val abilityOrder: List<Int> = emptyList(),
)

@Serializable
data class DarktideBuildData(
    val klass: String = "",
    val melee: String = "",
    val ranged: String = "",
    val blessings: String = "",
    val talents: String = "",
    val curios: List<String> = emptyList(),
)

@Serializable
data class OtherBuildData(val character: String = "", val items: List<String> = emptyList(), val abilities: String = "")

// Dados dos jogos (GET /api/game-hub/data/<jogo>).
@Serializable
data class LolChampion(val id: String = "", val name: String = "", val title: String = "", val tags: List<String> = emptyList(), val img: String = "")

@Serializable
data class LolItem(val id: String = "", val name: String = "", val gold: Int = 0, val tags: List<String> = emptyList(), val depth: Int = 1, val into: Int = 0, val img: String = "")

@Serializable
data class LolRune(val id: Int = 0, val name: String = "", val img: String = "")

@Serializable
data class LolRuneTree(val id: Int = 0, val key: String = "", val name: String = "", val img: String = "", val slots: List<List<LolRune>> = emptyList())

@Serializable
data class LolSpell(val id: String = "", val name: String = "", val img: String = "")

@Serializable
data class LolData(
    val version: String = "",
    val champions: List<LolChampion> = emptyList(),
    val items: List<LolItem> = emptyList(),
    val runes: List<LolRuneTree> = emptyList(),
    val spells: List<LolSpell> = emptyList(),
)

@Serializable
data class LolAbility(val key: String = "", val name: String = "", val img: String = "")

@Serializable
data class LolPassive(val name: String = "", val img: String = "")

@Serializable
data class LolChampionDetail(val id: String = "", val name: String = "", val passive: LolPassive? = null, val spells: List<LolAbility> = emptyList())

@Serializable
data class DeadlockAbility(val slot: Int = 0, val name: String = "", val img: String? = null)

@Serializable
data class DeadlockHero(val id: Int = 0, val name: String = "", val img: String? = null, val abilities: List<DeadlockAbility> = emptyList())

@Serializable
data class DeadlockItem(
    val id: Int = 0,
    val name: String = "",
    /** weapon | vitality | spirit */
    val slot: String = "weapon",
    val tier: Int = 1,
    val cost: Int = 0,
    val active: Boolean = false,
    val img: String? = null,
)

@Serializable
data class DeadlockData(val heroes: List<DeadlockHero> = emptyList(), val items: List<DeadlockItem> = emptyList())

@Serializable
data class DarktideClass(val id: String = "", val name: String = "")

@Serializable
data class DarktideData(val classes: List<DarktideClass> = emptyList())

// ---------- Mods no celular ----------
/** Jogo de Android que aceita mods (lista do servidor). support: install | ingame | loader. */
@Serializable
data class ModdableGame(
    val id: String = "",
    val name: String = "",
    val packages: List<String> = emptyList(),
    val support: String = "ingame",
    val tip: String = "",
    val loaderName: String? = null,
    val loaderPackages: List<String> = emptyList(),
    val url: String? = null,
)

@Serializable
data class ModdableGamesResponse(val games: List<ModdableGame> = emptyList())

@Serializable
data class BedrockClass(val id: Int = 0, val name: String = "", val slug: String = "", val icon: String? = null)

@Serializable
data class BedrockClassesResponse(val classes: List<BedrockClass> = emptyList())

@Serializable
data class BedrockFile(
    val id: Long = 0,
    val name: String = "",
    val fileName: String = "",
    val size: Long = 0,
    val date: String? = null,
    val versions: List<String> = emptyList(),
    /** release | beta | alpha */
    val channel: String = "release",
    val downloadUrl: String? = null,
    val installable: Boolean = false,
)

@Serializable
data class BedrockAddon(
    val id: Long = 0,
    val name: String = "",
    val summary: String = "",
    val icon: String? = null,
    val url: String? = null,
    val downloads: Long = 0,
    val classId: Int? = null,
    val categories: List<String> = emptyList(),
    val authors: List<String> = emptyList(),
    val updatedAt: String? = null,
    val canDownload: Boolean = true,
    val mainFile: BedrockFile? = null,
)

@Serializable
data class BedrockSearchResponse(val mods: List<BedrockAddon> = emptyList(), val page: Int = 0, val hasMore: Boolean = false)

@Serializable
data class BedrockFilesResponse(val mod: BedrockAddon? = null, val files: List<BedrockFile> = emptyList())
