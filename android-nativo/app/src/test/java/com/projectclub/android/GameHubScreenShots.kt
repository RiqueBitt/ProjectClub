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
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalInspectionMode
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
import com.projectclub.android.ui.gamehub.HubTabRow
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
        ProjectClubTheme {
            CompositionLocalProvider(LocalInspectionMode provides true) {
                Box(Modifier.fillMaxSize().background(PC.Bg)) { content() }
            }
        }
    }

    /** Barra do Game Hub + abas, igual à tela de verdade. */
    @Composable
    private fun Hub(tab: String, content: @Composable () -> Unit) {
        Column(Modifier.fillMaxSize()) {
            PcTopBar("Game Hub", Icons.Outlined.SportsEsports, navigation = {
                Box(Modifier.padding(12.dp)) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, null, tint = PC.Text) }
            })
            HubTabRow(tab) {}
            Box(Modifier.weight(1f).fillMaxWidth()) { content() }
        }
    }

    private val hot = HotlistResponse(
        "2026-11",
        listOf(
            HotGame(1, "minecraft", "Minecraft", null, null, 412_000, 23),
            HotGame(2, "counter-strike-2", "Counter-Strike 2", 730, null, 288_000, 14),
            HotGame(3, "deadlock", "Deadlock", 1422450, null, 190_000, 9),
            HotGame(4, "valorant", "VALORANT", null, null, 120_000, 8),
            HotGame(5, "stardew-valley", "Stardew Valley", 413150, null, 64_000, 4),
        ),
    )

    private val deals = DealsResponse(
        free = listOf(
            Deal("epic", "epic:1", "Hogwarts Legacy", null, "https://x", DealPrice(0.0, 249.9, "BRL", 100), true, endsAt = ahead(60 * 24 * 6)),
            Deal("epic", "epic:2", "Control", null, "https://x", DealPrice(0.0, 89.99, "BRL", 100), true, endsAt = ahead(60 * 24 * 6)),
        ),
        upcoming = listOf(Deal("epic", "epic:3", "Hades", null, "https://x", DealPrice(0.0, 47.49, "BRL", 100), true, startsAt = ahead(60 * 24 * 7))),
        deals = listOf(
            Deal("steam", "steam:1", "Red Dead Redemption 2", null, "https://x", DealPrice(74.97, 299.9, "BRL", 75)),
            Deal("gog", "gog:1", "Cyberpunk 2077", null, "https://x", DealPrice(105.99, 265.0, "BRL", 60)),
            Deal("steam", "steam:2", "Baldur's Gate 3", null, "https://x", DealPrice(149.99, 199.99, "BRL", 25)),
            Deal("epic", "epicdeal:1", "Alan Wake 2", null, "https://x", DealPrice(24.99, 49.99, "USD", 50)),
        ),
    )

    private val parties = listOf(
        GameParty(
            "p1", "Ranked até o diamante", "Precisa de microfone. Sem tóxico!", 5, HubGame("valorant", "VALORANT"),
            null, ago(20), ahead(160), "open", lia, hasCall = true, members = listOf(lia, me, loritta), filled = 3, myStatus = "joined",
        ),
        GameParty("p2", "Deadlock hoje à noite", null, 6, HubGame("deadlock", "Deadlock", 1422450), ahead(300), ago(60), ahead(480), "open", rio, members = listOf(rio), filled = 1),
        GameParty("p3", "Minecraft SMP", "Servidor novo, bora construir.", 4, HubGame("minecraft", "Minecraft"), null, ago(5), ahead(175), "open", me, members = listOf(me), filled = 1, myStatus = "host", invitedCount = 2),
    )

    private val clips = listOf(
        GameClip("c1", "Clutch 1v4 no B", "https://youtu.be/x", "youtube", "x", null, HubGame("cs2", "Counter-Strike 2", 730), lia, 12, true, false, ago(90)),
        GameClip("c2", "Ace de Jett", "https://twitch.tv/x", "twitch", "x", null, HubGame("valorant", "VALORANT"), loritta, 3, false, false, ago(60 * 26)),
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
        listOf(LolChampion("Jinx", "Jinx", "a Bala Perdida", listOf("Marksman"), "")),
        listOf(
            LolItem("1055", "Lâmina de Doran", 450), LolItem("2003", "Poção de Vida", 50), LolItem("6672", "Matador Kraken", 3000),
            LolItem("3031", "Gume do Infinito", 3400), LolItem("3094", "Canhão Fumegante", 2600), LolItem("3036", "Lembranças do Lorde Dominik", 3000),
        ),
        listOf(
            LolRuneTree(8000, "Precision", "Precisão", "", listOf(listOf(LolRune(8005, "Pressione o Ataque"), LolRune(8008, "Ritmo Fatal"), LolRune(8021, "Agilidade nos Pés")))),
            LolRuneTree(8100, "Domination", "Dominação", "", emptyList()),
        ),
        listOf(LolSpell("SummonerFlash", "Flash"), LolSpell("SummonerHeal", "Curar")),
    )
    private val jinx = LolChampionDetail("Jinx", "Jinx", null, listOf(LolAbility("Q", "Troca-troca!"), LolAbility("W", "Zap!"), LolAbility("E", "Mordidas Flamejantes"), LolAbility("R", "Super Mega Míssil da Morte!")))

    @Test fun inicio() = shot("gh-01-inicio") {
        Hub("inicio") { HubHomeContent(hot, deals, parties, clips, listOf(lolBuild, dlBuild), { _, _ -> }, {}, {}, {}) }
    }

    @Test fun promocoes() = shot("gh-02-promocoes") { Hub("promocoes") { DealsContent(deals) {} } }

    @Test fun partidas() = shot("gh-03-partidas") { Hub("partidas") { PartiesContent(parties, "me", null, "p1", PartyActions()) {} } }

    @Test fun clipesClube() = shot("gh-04-clipes-clube") {
        Hub("clipes") {
            Column {
                Row(Modifier.padding(start = 16.dp, top = 14.dp, end = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    HubChip("Do clube", true, {}); HubChip("Neste celular", false, {})
                }
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
