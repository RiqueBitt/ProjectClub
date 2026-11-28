package com.projectclub.android

import android.app.Application
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Row
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.SportsEsports
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.github.takahirom.roborazzi.captureRoboImage
import com.projectclub.android.data.BedrockAddon
import com.projectclub.android.data.BedrockClass
import com.projectclub.android.data.BedrockFile
import com.projectclub.android.data.Deal
import com.projectclub.android.data.DealPrice
import com.projectclub.android.data.DealsResponse
import com.projectclub.android.data.GameBuild
import com.projectclub.android.data.GameClip
import com.projectclub.android.data.GameParty
import com.projectclub.android.data.HotGame
import com.projectclub.android.data.HotlistResponse
import com.projectclub.android.data.HubGame
import com.projectclub.android.data.LolAbility
import com.projectclub.android.data.LolChampion
import com.projectclub.android.data.LolChampionDetail
import com.projectclub.android.data.LolData
import com.projectclub.android.data.LolItem
import com.projectclub.android.data.LolRune
import com.projectclub.android.data.LolRuneTree
import com.projectclub.android.data.LolSpell
import com.projectclub.android.data.ModdableGame
import com.projectclub.android.data.User
import com.projectclub.android.gamehub.HubLogic
import com.projectclub.android.gamehub.clips.ClipSettings
import com.projectclub.android.gamehub.clips.ClipState
import com.projectclub.android.gamehub.clips.LocalClip
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.gamehub.BedrockContent
import com.projectclub.android.ui.gamehub.BuildContent
import com.projectclub.android.ui.gamehub.BuildsContent
import com.projectclub.android.ui.gamehub.ClubClipsContent
import com.projectclub.android.ui.gamehub.DealsContent
import com.projectclub.android.ui.gamehub.HubChip
import com.projectclub.android.ui.gamehub.HubHomeContent
import com.projectclub.android.ui.gamehub.HubBottomBar
import com.projectclub.android.ui.gamehub.hubTab
import com.projectclub.android.ui.gamehub.ModsContent
import com.projectclub.android.ui.gamehub.PartiesContent
import com.projectclub.android.ui.gamehub.PartyActions
import com.projectclub.android.ui.gamehub.PhoneClipsContent
import com.projectclub.android.ui.gamehub.RecorderActions
import com.projectclub.android.ui.theme.PC
import com.projectclub.android.ui.theme.ProjectClubTheme
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.drawable.BitmapDrawable
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.test.core.app.ApplicationProvider
import coil.Coil
import coil.ImageLoader
import coil.decode.DataSource
import coil.intercept.Interceptor
import coil.request.ErrorResult
import coil.request.ImageResult
import coil.request.SuccessResult
import kotlinx.coroutines.Dispatchers
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.Instant

/**
 * Capturas do Game Hub do celular (dados de mentira, sem rede).
 * ./gradlew recordRoborazziDebug --tests '*ScreenShots'
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w412dp-h900dp-xxhdpi", application = Application::class)
class GameHubScreenShots {
    private fun ago(min: Long) = Instant.now().minusSeconds(min * 60).toString()
    private fun ahead(min: Long) = Instant.now().plusSeconds(min * 60).toString()
    private fun u(id: String, name: String) = User(id = id, username = name.lowercase(), displayName = name, status = "ONLINE")
    private val me = u("me", "RiqueBitt")
    private val lia = u("u1", "Lia")
    private val loritta = u("u2", "Loritta")
    private val rio = u("u3", "Rio")

    private fun shot(name: String, content: @Composable () -> Unit) = captureRoboImage("screenshots/$name.png") {
        ProjectClubTheme { Box(Modifier.fillMaxSize().background(PC.Bg)) { content() } }
    }

    /**
     * Capas de verdade nas capturas: o Coil baixa cada imagem na hora (sem
     * thread, pra estar pronta antes da foto). Sem internet, fica o
     * cartão com o nome do jogo, igual ao app quando não acha capa.
     */
    private class NetImages(private val app: Application) : Interceptor {
        override suspend fun intercept(chain: Interceptor.Chain): ImageResult {
            val url = chain.request.data as? String ?: return ErrorResult(null, chain.request, IllegalStateException("sem endereço"))
            val bmp = synchronized(cache) { if (cache.containsKey(url)) cache[url] else download(url).also { cache[url] = it } }
            return if (bmp != null) SuccessResult(BitmapDrawable(app.resources, bmp), chain.request, DataSource.MEMORY_CACHE)
            else ErrorResult(null, chain.request, IllegalStateException("sem imagem: $url"))
        }

        private fun download(url: String): Bitmap? = runCatching {
            val c = java.net.URL(url).openConnection() as java.net.HttpURLConnection
            c.instanceFollowRedirects = false // Twitch redireciona pro "sem capa"
            c.connectTimeout = 8000; c.readTimeout = 8000
            c.setRequestProperty("User-Agent", "ProjectClub-Screenshots")
            try {
                if (c.responseCode != 200) null else c.inputStream.use { BitmapFactory.decodeStream(it) }
            } finally { c.disconnect() }
        }.getOrNull()

        companion object { val cache = HashMap<String, Bitmap?>() }
    }

    @Before fun images() {
        val app: Application = ApplicationProvider.getApplicationContext()
        Coil.setImageLoader(
            ImageLoader.Builder(app).components { add(NetImages(app)) }
                .dispatcher(Dispatchers.Unconfined).allowHardware(false).build(),
        )
    }

    /** Barra do topo + menu de baixo do Game Hub, igual à tela de verdade. */
    @Composable
    private fun Hub(tab: String, content: @Composable () -> Unit) {
        Column(Modifier.fillMaxSize()) {
            PcTopBar(if (tab == "inicio") "Game Hub" else hubTab(tab).label, if (tab == "inicio") Icons.Outlined.SportsEsports else hubTab(tab).icon, navigation = {
                Box(Modifier.padding(12.dp)) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, null, tint = PC.Text) }
            })
            Box(Modifier.weight(1f).fillMaxWidth()) { content() }
            HubBottomBar(tab, {}, badges = mapOf("partidas" to 2))
        }
    }

    private fun twitch(name: String) = "https://static-cdn.jtvnw.net/ttv-boxart/${java.net.URLEncoder.encode(name, "UTF-8").replace("+", "%20")}-285x380.jpg"
    private fun steam(id: Long) = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/$id/header.jpg"
    private val dd = "https://ddragon.leagueoflegends.com/cdn/14.23.1/img"

    private val hot = HotlistResponse(
        "2026-11",
        listOf(
            HotGame(1, "world-of-warcraft", "World of Warcraft", null, null, 353_000, 6, twitch("World of Warcraft"), true),
            HotGame(2, "counter-strike-2", "Counter-Strike 2", 730, null, 288_000, 14, steam(730)),
            HotGame(3, "minecraft", "Minecraft", null, null, 190_000, 9, twitch("Minecraft"), true),
            HotGame(4, "deadlock", "Deadlock", 1422450, null, 120_000, 8, steam(1422450)),
            HotGame(5, "roblox", "Roblox", null, null, 64_000, 4, twitch("Roblox"), true),
        ),
    )

    private val deals = DealsResponse(
        free = listOf(
            Deal(
                "epic", "epic:1", "Firestone Idle RPG",
                "https://cdn1.epicgames.com/spt-assets/69576a28f7154fe9a0dce97508da5163/firestone-online-idle-rpg-yus55.jpg?h=360&quality=medium&resize=1&w=640",
                "https://x", DealPrice(0.0, 0.0, "BRL", 100), true, endsAt = ahead(60 * 24 * 6),
            ),
            Deal(
                "epic", "epic:2", "Bread and Fred",
                "https://cdn1.epicgames.com/spt-assets/545b4dd8bb364c12b719268198a93ef3/bread-and-fred-3jnwn.jpg?h=360&quality=medium&resize=1&w=640",
                "https://x", DealPrice(0.0, 37.99, "BRL", 100), true, endsAt = ahead(60 * 24 * 6),
            ),
        ),
        upcoming = listOf(Deal("epic", "epic:3", "Hades", steam(1145360), "https://x", DealPrice(0.0, 47.49, "BRL", 100), true, startsAt = ahead(60 * 24 * 7), steamAppId = 1145360)),
        deals = listOf(
            Deal("steam", "steam:1", "Red Dead Redemption 2", steam(1174180), "https://x", DealPrice(74.97, 299.9, "BRL", 75), steamAppId = 1174180),
            Deal("gog", "gog:1", "Cyberpunk 2077", steam(1091500), "https://x", DealPrice(105.99, 265.0, "BRL", 60)),
            Deal("steam", "steam:2", "Baldur's Gate 3", steam(1086940), "https://x", DealPrice(149.99, 199.99, "BRL", 25), steamAppId = 1086940),
            Deal("epic", "epicdeal:1", "Alan Wake 2", twitch("Alan Wake 2"), "https://x", DealPrice(24.99, 49.99, "USD", 50), imageTall = true),
        ),
    )

    private val parties = listOf(
        GameParty(
            "p1", "Ranked até o diamante", "Precisa de microfone. Sem tóxico!", 5, HubGame("valorant", "VALORANT", null, twitch("VALORANT"), true),
            null, ago(20), ahead(160), "open", lia, hasCall = true, members = listOf(lia, me, loritta), filled = 3, myStatus = "joined",
        ),
        GameParty("p2", "Deadlock hoje à noite", null, 6, HubGame("deadlock", "Deadlock", 1422450, steam(1422450)), ahead(300), ago(60), ahead(480), "open", rio, members = listOf(rio), filled = 1),
        GameParty("p3", "Minecraft SMP", "Servidor novo, bora construir.", 4, HubGame("minecraft", "Minecraft", null, twitch("Minecraft"), true), null, ago(5), ahead(175), "open", me, members = listOf(me), filled = 1, myStatus = "host", invitedCount = 2),
    )

    private val clips = listOf(
        GameClip("c1", "Clutch 1v4 no B", "https://youtu.be/x", "youtube", "x", null, HubGame("cs2", "Counter-Strike 2", 730, steam(730)), lia, 12, true, false, ago(90)),
        GameClip("c2", "Ace de Jett", "https://twitch.tv/x", "twitch", "x", null, HubGame("valorant", "VALORANT", null, twitch("VALORANT"), true), loritta, 3, false, false, ago(60 * 26)),
    )

    private val lolBuild = GameBuild(
        "b1", "lol", "Jinx crítica pra rotas fáceis", "Jinx", "Jinx", "adc", null,
        buildJsonObject {
            put("champion", "Jinx"); put("role", "adc"); put("primaryTree", 8000); put("keystone", 8008); put("secondaryTree", 8100)
            put("spells", buildJsonArray { add(JsonPrimitive("SummonerFlash")); add(JsonPrimitive("SummonerHeal")) })
            put("start", buildJsonArray { add(JsonPrimitive("1055")); add(JsonPrimitive("2003")) })
            put("core", buildJsonArray { listOf("6672", "3031", "3094").forEach { add(JsonPrimitive(it)) } })
            put("situational", buildJsonArray { add(JsonPrimitive("3036")) })
            put("skills", "QWEQQRQWQWRWWEEREE")
        },
        "Farme até o primeiro item. Fique atrás do suporte nas lutas.", lia, 31, true, false, ago(60 * 30), ago(60 * 30),
    )
    private val dlBuild = GameBuild(
        "b2", "deadlock", "Haze no meio-campo", "13", "Haze", null, null, buildJsonObject { put("hero", 13) }, null, rio, 8, false, false, ago(60 * 50),
    )

    private val lolData = LolData(
        "14.23.1",
        listOf(LolChampion("Jinx", "Jinx", "a Bala Perdida", listOf("Marksman"), "$dd/champion/Jinx.png")),
        listOf(
            LolItem("1055", "Lâmina de Doran", 450, img = "$dd/item/1055.png"), LolItem("2003", "Poção de Vida", 50, img = "$dd/item/2003.png"),
            LolItem("6672", "Matador Kraken", 3000, img = "$dd/item/6672.png"), LolItem("3031", "Gume do Infinito", 3400, img = "$dd/item/3031.png"),
            LolItem("3094", "Canhão Fumegante", 2600, img = "$dd/item/3094.png"), LolItem("3036", "Lembranças do Lorde Dominik", 3000, img = "$dd/item/3036.png"),
        ),
        listOf(
            LolRuneTree(
                8000, "Precision", "Precisão", "https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/7201_Precision.png",
                listOf(listOf(LolRune(8008, "Ritmo Fatal", "https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/Precision/LethalTempo/LethalTempoTemp.png"))),
            ),
            LolRuneTree(8100, "Domination", "Dominação", "https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/7200_Domination.png", emptyList()),
        ),
        listOf(LolSpell("SummonerFlash", "Flash", "$dd/spell/SummonerFlash.png"), LolSpell("SummonerHeal", "Curar", "$dd/spell/SummonerHeal.png")),
    )
    private val jinx = LolChampionDetail(
        "Jinx", "Jinx", null,
        listOf(LolAbility("Q", "Troca-troca!", "$dd/spell/JinxQ.png"), LolAbility("W", "Zap!", "$dd/spell/JinxW.png"), LolAbility("E", "Mordidas Flamejantes", "$dd/spell/JinxE.png"), LolAbility("R", "Super Mega Míssil da Morte!", "$dd/spell/JinxR.png")),
    )

    @Test @Config(qualifiers = "w412dp-h1700dp-xxhdpi")
    fun inicio() = shot("gh-01-inicio") {
        Hub("inicio") { HubHomeContent(hot, deals, parties, clips, listOf(lolBuild, dlBuild), 3, "RiqueBitt", { _, _ -> }, {}, {}, {}) }
    }

    @Test fun inicioTela() = shot("gh-01b-inicio-tela") {
        Hub("inicio") { HubHomeContent(hot, deals, parties, clips, listOf(lolBuild, dlBuild), 3, "RiqueBitt", { _, _ -> }, {}, {}, {}) }
    }

    @Test fun inicioRolado() = shot("gh-01c-inicio-rolado") {
        Hub("inicio") {
            HubHomeContent(hot, deals, parties, clips, listOf(lolBuild, dlBuild), 3, "RiqueBitt", { _, _ -> }, {}, {}, {}, listState = rememberLazyListState(2))
        }
    }

    @Test fun promocoes() = shot("gh-02-promocoes") { Hub("promocoes") { DealsContent(deals) {} } }

    @Test fun partidas() = shot("gh-03-partidas") { Hub("partidas") { PartiesContent(parties, "me", null, "p1", PartyActions()) {} } }

    @Test fun clipesClube() = shot("gh-04-clipes-clube") {
        Hub("clipes") {
            Column {
                com.projectclub.android.ui.gamehub.Segmented(
                    listOf("clube" to "Do clube", "celular" to "Neste celular"), "clube", {}, Modifier.padding(start = 16.dp, top = 14.dp, end = 16.dp),
                )
                ClubClipsContent(clips, false, false, false, {}, {}, {}, {}, {}, {})
            }
        }
    }

    private val localClips = listOf(
        LocalClip(Uri.parse("content://media/external/video/media/1"), "Clipe 2026-11-26 21-03-05.mp4", 30_000, 18_400_000, System.currentTimeMillis()),
        LocalClip(Uri.parse("content://media/external/video/media/2"), "Clipe 2026-11-25 22-41-17.mp4", 92_000, 61_000_000, System.currentTimeMillis()),
    )

    @Test fun clipesCelular() = shot("gh-05-clipes-celular") {
        Hub("clipes") { PhoneClipsContent(ClipState.Idle, ClipSettings(), localClips, true, RecorderActions()) }
    }

    @Test fun clipesGravando() = shot("gh-06-clipes-gravando") {
        Hub("clipes") { PhoneClipsContent(ClipState.Running(ClipSettings(), System.currentTimeMillis(), withAudio = true), ClipSettings(), localClips, true, RecorderActions()) }
    }

    @Test fun builds() = shot("gh-07-builds") {
        Hub("builds") { BuildsContent(listOf(lolBuild, dlBuild), "", "top", false, "", false, false, null, {}, {}, {}, {}, {}, {}, {}) }
    }

    @Test fun buildLol() = shot("gh-08-build-lol") { BuildContent(lolBuild, lolData, jinx, null, null) {} }

    private val curated = listOf(
        ModdableGame("minecraft", "Minecraft", listOf("com.mojang.minecraftpe"), "install", "Addons, texturas, mapas e skins: procure aqui e o jogo importa sozinho."),
        ModdableGame("geometry-dash", "Geometry Dash", listOf("com.robtopx.geometryjump"), "loader", "Instale o Geode Launcher: ele abre o jogo com os mods do Geode.", "Geode", listOf("com.geode.launcher"), "https://geode-sdk.org/install"),
        ModdableGame("mindustry", "Mindustry", listOf("io.anuke.mindustry"), "ingame", "No jogo: Mods → Procurar. Ele baixa os mods sozinho."),
    )
    private val detected = HubLogic.matchInstalled(
        listOf(
            HubLogic.InstalledApp("com.mojang.minecraftpe", "Minecraft", true),
            HubLogic.InstalledApp("com.robtopx.geometryjump", "Geometry Dash", true),
            HubLogic.InstalledApp("io.anuke.mindustry", "Mindustry", true),
            HubLogic.InstalledApp("com.supercell.brawlstars", "Brawl Stars", true),
            HubLogic.InstalledApp("com.roblox.client", "Roblox", true),
        ),
        curated,
    )
    private val fakeIcon: @Composable (String) -> Unit = { pkg ->
        val c = when { pkg.contains("mojang") -> Color(0xFF5FA046); pkg.contains("robtop") -> Color(0xFF2F8CFF); pkg.contains("anuke") -> Color(0xFFE8A33D); else -> Color(0xFF6B6B7B) }
        Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(c, c.copy(alpha = 0.6f)))))
    }

    @Test fun mods() = shot("gh-09-mods") { Hub("mods") { ModsContent(detected, {}, {}, {}, {}, {}, fakeIcon) } }

    private val addons = listOf(
        BedrockAddon(1, "Actions & Stuff", "Animações novas para itens e mobs, sem mudar o jogo.", null, null, 2_400_000, 4984, listOf("Texturas"), listOf("Oreville"), ago(600), true, BedrockFile(1, "v1.8", "Actions.mcpack", 12_000_000, ago(600), listOf("1.21.50"), "release", "https://edge.forgecdn.net/x", true)),
        BedrockAddon(2, "Furnicraft", "Mais de 300 móveis para decorar a casa.", null, null, 980_000, 4984, listOf("Addons"), listOf("Gu"), ago(2000), true, BedrockFile(2, "2.0", "Furnicraft.mcaddon", 5_000_000, ago(2000), listOf("1.21.40"), "release", null, true)),
        BedrockAddon(3, "Ilha Perdida", "Mapa de sobrevivência numa ilha com segredos.", null, null, 54_000, 6913, listOf("Mapas"), listOf("Lia"), ago(9000), true, null),
    )
    private val classes = listOf(BedrockClass(4984, "Addons"), BedrockClass(6913, "Mapas"), BedrockClass(6929, "Texturas"), BedrockClass(6925, "Skins"))

    @Test fun bedrock() = shot("gh-10-bedrock") {
        BedrockContent(addons, classes, "", 0, "popular", false, true, false, null, true, false, {}, {}, {}, {}, {}, {}, {})
    }

    @Test fun bedrockSemChave() = shot("gh-11-bedrock-sem-chave") {
        BedrockContent(emptyList(), emptyList(), "", 0, "popular", false, false, true, null, false, false, {}, {}, {}, {}, {}, {}, {})
    }
}
