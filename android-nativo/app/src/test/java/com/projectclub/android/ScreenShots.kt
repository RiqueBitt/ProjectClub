package com.projectclub.android

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.github.takahirom.roborazzi.captureRoboImage
import com.projectclub.android.data.Category
import com.projectclub.android.data.Channel
import com.projectclub.android.data.CommunityInfo
import com.projectclub.android.data.CommunityResponse
import com.projectclub.android.data.Conversation
import com.projectclub.android.data.Friendship
import com.projectclub.android.data.LastMessage
import com.projectclub.android.data.Member
import com.projectclub.android.data.Notice
import com.projectclub.android.data.Repository
import com.projectclub.android.data.User
import com.projectclub.android.data.VoiceParticipant
import com.projectclub.android.net.Api
import com.projectclub.android.ui.common.LoadingScreen
import com.projectclub.android.ui.home.HomeActions
import com.projectclub.android.ui.home.HomeScreen
import com.projectclub.android.ui.login.LoginScreen
import com.projectclub.android.ui.theme.PC
import com.projectclub.android.ui.theme.ProjectClubTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.Instant

/**
 * Capturas das telas (Roborazzi) pra conferir o visual sem celular.
 * Rodam só no CI: ./gradlew recordRoborazziDebug --tests '*ScreenShots'
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w412dp-h900dp-xxhdpi", application = Application::class)
class ScreenShots {
    private val ctx: Application get() = ApplicationProvider.getApplicationContext()
    private val actions = HomeActions({}, {}, { _, _ -> }, {})
    private val nav = java.lang.reflect.Proxy.newProxyInstance(
        com.projectclub.android.ui.nav.AppNav::class.java.classLoader, arrayOf(com.projectclub.android.ui.nav.AppNav::class.java),
    ) { _, _, _ -> null } as com.projectclub.android.ui.nav.AppNav

    private fun ago(min: Long) = Instant.now().minusSeconds(min * 60).toString()
    private fun u(id: String, name: String, status: String = "ONLINE", color: String? = null) =
        User(id = id, username = name.lowercase(), displayName = name, status = status, profileColor = color)

    private val me = u("me", "RiqueBitt", color = "#7A1F1F").copy(customStatus = "Quem está marcando a call?", customStatusEmoji = "🎮", platformRole = "ADMIN")
    private val lia = u("u1", "Lia")
    private val loritta = u("u2", "Loritta")
    private val rio = u("u3", "Rio Bot", "IDLE")
    private val ana = u("u4", "Ana", "OFFLINE")

    private fun repo(): Repository {
        val r = Repository(ctx, Api(ctx), CoroutineScope(SupervisorJob() + Dispatchers.Unconfined))
        val ch = { id: String, name: String, type: String -> Channel(id = id, name = name, type = type) }
        r.seedForScreenshots(
            me = me,
            community = CommunityResponse(
                community = CommunityInfo(name = "Project Club"),
                categories = listOf(
                    Category("c1", "ℹ️ • Informações", 0, channels = listOf(ch("ch1", "📣 | Anúncios", "ANNOUNCEMENT"), ch("ch0", "📜 | regras", "RULES"))),
                    Category("c2", "🌐 Comunidade", 1, channels = listOf(ch("ch2", "🌎 | chat geral", "TEXT"), ch("ch3", "🔧 | comandos", "TEXT"), ch("ch4", "📸 | mídias", "TEXT"))),
                    Category("c3", "🔊 Canais de Voz", 2, channels = listOf(ch("v1", "☕ | Call", "VOICE"), ch("v2", "🎮 | Jogando", "VOICE"))),
                ),
                members = listOf(me, lia, loritta, rio, ana).map { Member(it) },
            ),
            conversations = listOf(
                Conversation("d1", members = listOf(me, lia), lastMessage = LastMessage("m1", "bora call hoje às 21h?", "u1", ago(3))),
                Conversation("d2", members = listOf(me, loritta), lastMessage = LastMessage("m2", "valeu pela figurinha 🎉", "me", ago(80)), lastReadAt = ago(1)),
                Conversation("d3", members = listOf(me, rio), lastMessage = LastMessage("m3", "Novo comando! /tickets", "u3", ago(600)), lastReadAt = ago(1)),
            ),
            friends = listOf(
                Friendship("f1", "ACCEPTED", user = lia), Friendship("f2", "ACCEPTED", user = loritta),
                Friendship("f3", "ACCEPTED", user = rio), Friendship("f4", "ACCEPTED", user = ana),
                Friendship("f5", "PENDING", isIncoming = true, user = u("u5", "Novo")),
            ),
            notices = listOf(
                Notice("n1", "event", "Evento de figurinhas começou", "Colete figurinhas raras conversando nos canais.", null, null, ago(20)),
                Notice("n2", "gift", "Você ganhou um presente", "Uma moldura nova chegou no seu inventário.", null, ago(5), ago(200)),
                Notice("n3", "staff", "Manutenção concluída", "O servidor de voz foi atualizado.", null, ago(5), ago(1500)),
            ),
            presence = mapOf("me" to "ONLINE", "u1" to "ONLINE", "u2" to "ONLINE", "u3" to "IDLE", "u4" to "OFFLINE"),
            rosters = mapOf("v1" to listOf(VoiceParticipant("u1"), VoiceParticipant("u2", muted = true, screenSharing = true))),
            states = mapOf("ch2" to com.projectclub.android.data.ChannelState(lastMessageAt = ago(1), myReadAt = ago(30), unreadMentions = 2)),
        )
        return r
    }

    private fun shot(name: String, content: @Composable () -> Unit) = captureRoboImage("screenshots/$name.png") {
        ProjectClubTheme { Box(Modifier.fillMaxSize().background(PC.Bg)) { content() } }
    }

    @Test fun login() { val r = repo(); shot("01-login") { LoginScreen(r, null) } }
    @Test fun loading() = shot("02-carregando") { LoadingScreen() }
    @Test fun inicio() { val r = repo(); shot("03-inicio") { HomeScreen(r, actions, nav, 0, {}, {}) } }
    @Test fun comunidade() { val r = repo(); shot("04-comunidade") { com.projectclub.android.ui.home.ChannelsTab(r, actions) } }
    @Test fun social() { val r = repo(); shot("05-social") { com.projectclub.android.ui.home.SocialTab(r, actions) } }
    @Test fun avisos() { val r = repo(); shot("06-avisos") { com.projectclub.android.ui.home.NoticesTab(r, actions) } }
    private val noop = com.projectclub.android.ui.voice.CallActions({}, {}, {}, {}, {}, {}, {})
    private val fakeScreen: @Composable (String, Modifier) -> Unit = { _, m ->
        Box(m.background(androidx.compose.ui.graphics.Brush.linearGradient(listOf(androidx.compose.ui.graphics.Color(0xFF1B2A4A), androidx.compose.ui.graphics.Color(0xFF3A1F5C)))))
    }
    private fun call(status: com.projectclub.android.voice.CallStatus = com.projectclub.android.voice.CallStatus.Connected, muted: Boolean = false, speaking: Set<String> = emptySet(), video: Set<String> = emptySet(), error: String? = null) =
        com.projectclub.android.voice.CallState(channelName = "v1", title = "☕ | Call", status = status, muted = muted, speaking = speaking, remoteVideo = video, error = error)
    private val users = mapOf("u1" to lia, "u2" to loritta, "u3" to rio, "u4" to ana)

    @Test fun chamadaSozinho() = shot("08-chamada-sozinho") {
        com.projectclub.android.ui.voice.CallLayout(call(), me, emptyList(), { users[it] }, noop, fakeScreen)
    }
    @Test fun chamadaGrupo() = shot("09-chamada-grupo") {
        com.projectclub.android.ui.voice.CallLayout(
            call(muted = true, speaking = setOf("u1")), me,
            listOf(VoiceParticipant("u1"), VoiceParticipant("u2", muted = true), VoiceParticipant("u3", deafened = true)), { users[it] }, noop, fakeScreen,
        )
    }
    @Test fun chamadaTela() = shot("10-chamada-tela") {
        com.projectclub.android.ui.voice.CallLayout(
            call(speaking = setOf("u2"), video = setOf("u2")), me,
            listOf(VoiceParticipant("u1"), VoiceParticipant("u2", screenSharing = true), VoiceParticipant("u3"), VoiceParticipant("u4", muted = true)), { users[it] }, noop, fakeScreen,
        )
    }
    @Test fun chamadaConectando() = shot("11-chamada-conectando") {
        com.projectclub.android.ui.voice.CallLayout(
            call(status = com.projectclub.android.voice.CallStatus.Connecting, error = "O serviço de voz demorou pra responder. Tentando de novo…"), me,
            listOf(VoiceParticipant("u1"), VoiceParticipant("u2")), { users[it] }, noop, fakeScreen,
        )
    }
    @Test fun voce() { val r = repo(); shot("07-voce") { com.projectclub.android.ui.home.MoreTab(r, actions, nav) } }

    // ---- Estilos de perfil e temas coloridos
    private fun profileOf(style: String?) = com.projectclub.android.data.ProfileData(
        user = com.projectclub.android.data.ProfileUser(
            id = "me", username = "riquebitt", displayName = "RiqueBitt", profileStyle = style, status = "ONLINE",
            bio = "Criador do Project Club. Bora jogar? 🎮", customStatus = "Quem está marcando a call?", customStatusEmoji = "🎮",
            platformRole = "ADMIN", accountLevel = 27, accountXp = 18450, createdAt = "2024-03-01T00:00:00Z", profileColor = "#7A1F1F",
        ),
        totalUps = 342, levelProgress = 64,
    )
    private val wall = listOf(
        com.projectclub.android.data.ProfileWallPost("w1", "Valeu pela call ontem!", ago(90), lia),
        com.projectclub.android.data.ProfileWallPost("w2", "Perfil ficou muito bom 🔥", ago(600), loritta),
    )
    private fun styleShot(key: String) = shot("perfil-$key") { com.projectclub.android.ui.profile.ProfileShowcase(profileOf(key), wall) }

    @Test fun estilosA() { listOf("win2000", "anime", "terror", "bugado", "nostalgia", "cyberpunk", "vaporwave", "pixel", "oceano").forEach(::styleShot) }
    @Test fun estilosB() { listOf("floresta", "galaxia", "sakura", "inverno", "lava", "realeza", "matrix", "caderno", "steampunk").forEach(::styleShot) }
    @Test fun estilosC() { listOf("gotico", "arcade", "sunset", "candy", "aurora", "deserto", "halloween", "natal", "lofi").forEach(::styleShot) }
    @Test fun estilosD() { listOf("holografico", "militar", "faroeste", "medieval", "cafe", "grafite", "marmore", "noir").forEach(::styleShot) }
    @Test fun perfilSemEstilo() = shot("perfil-padrao") { com.projectclub.android.ui.profile.ProfileShowcase(profileOf(null), wall) }

    private fun themed(id: String, block: () -> Unit) {
        com.projectclub.android.ui.theme.ThemeStore.set(ctx, id)
        try { block() } finally { com.projectclub.android.ui.theme.ThemeStore.set(ctx, "none") }
    }
    @Test fun temaInicio() { themed("hanami") { val r = repo(); shot("tema-hanami-inicio") { HomeScreen(r, actions, nav, 0, {}, {}) } } }
    @Test fun temaVoce() { themed("citrico") { val r = repo(); shot("tema-citrico-voce") { com.projectclub.android.ui.home.MoreTab(r, actions, nav) } } }
    @Test fun temaComunidade() { themed("aurora") { val r = repo(); shot("tema-aurora-comunidade") { com.projectclub.android.ui.home.ChannelsTab(r, actions) } } }
    @Test fun temaConfig() {
        themed("algodao") {
            val r = repo()
            shot("tema-algodao-config") {
                androidx.compose.foundation.layout.Column(Modifier.fillMaxSize().background(PC.Bg)) {
                    com.projectclub.android.ui.settings.ColorThemePicker(r, null) {}
                    com.projectclub.android.ui.settings.AppIconPicker(r, null) {}
                    com.projectclub.android.ui.common.PillButton("Botão principal", {})
                }
            }
        }
    }
}
