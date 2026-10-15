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
    @Test fun voce() { val r = repo(); shot("07-voce") { com.projectclub.android.ui.home.MoreTab(r, actions, nav) } }
}
