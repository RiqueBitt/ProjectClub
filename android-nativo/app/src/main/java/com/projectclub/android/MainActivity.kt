package com.projectclub.android

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.projectclub.android.data.Alert
import com.projectclub.android.data.Room
import com.projectclub.android.data.SessionState
import com.projectclub.android.notify.Notifier
import com.projectclub.android.ui.chat.ChatScreen
import com.projectclub.android.ui.home.HomeActions
import com.projectclub.android.ui.home.HomeScreen
import com.projectclub.android.ui.login.LoginScreen
import com.projectclub.android.ui.theme.PC
import com.projectclub.android.ui.theme.ProjectClubTheme
import com.projectclub.android.ui.voice.VoiceScreen
import com.projectclub.android.ui.nav.AppNavigator
import com.projectclub.android.ui.nav.featureScreens
import com.projectclub.android.voice.CallService
import com.projectclub.android.voice.CallStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val app get() = application as App
    /** Pedido vindo de notificação/intent, aplicado quando a navegação estiver pronta. */
    private val pending = MutableStateFlow<Intent?>(null)
    private var afterMicPermission: (() -> Unit)? = null
    private var navRef: AppNavigator? = null

    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        val next = afterMicPermission
        afterMicPermission = null
        if (ok) next?.invoke() else Toast.makeText(this, "Sem o microfone não dá pra entrar na chamada.", Toast.LENGTH_LONG).show()
    }
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }
        pending.value = intent
        com.projectclub.android.data.AppPrefs.init(this)
        com.projectclub.android.ui.theme.ThemeStore.init(this)
        setContent {
            val mobileUsers by app.repo.mobileUsers.collectAsState()
            val textScale by com.projectclub.android.data.AppPrefs.textScale.collectAsState()
            val baseDensity = androidx.compose.ui.platform.LocalDensity.current
            ProjectClubTheme {
                androidx.compose.runtime.CompositionLocalProvider(
                    com.projectclub.android.ui.common.LocalMobileUsers provides mobileUsers,
                    androidx.compose.ui.platform.LocalDensity provides androidx.compose.ui.unit.Density(baseDensity.density, baseDensity.fontScale * textScale),
                ) { Root() }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        pending.value = intent
    }

    /** Entra numa call (pede o microfone antes, se precisar). */
    private fun joinVoice(channelName: String, title: String, nav: NavHostController) {
        val go = {
            lifecycleScope.launch { app.voice.join(channelName, title) }
            nav.navigate("voice") { launchSingleTop = true }
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) go()
        else { afterMicPermission = { go() }; micPermission.launch(Manifest.permission.RECORD_AUDIO) }
    }

    @Composable
    private fun Root() {
        val session by app.repo.session.collectAsState()
        when (val s = session) {
            SessionState.Loading -> com.projectclub.android.ui.common.LoadingScreen()
            is SessionState.LoggedOut -> LoginScreen(app.repo, s.message)
            SessionState.LoggedIn -> LoggedIn()
        }
    }

    @Composable
    private fun LoggedIn() {
        val nav = rememberNavController()
        val call by app.voice.state.collectAsState()
        val backStack by nav.currentBackStackEntryAsState()
        val route = backStack?.destination?.route
        var incoming by remember { mutableStateOf<Alert.IncomingCall?>(null) }

        LaunchedEffect(Unit) {
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        LaunchedEffect(Unit) { app.incomingCalls.collect { incoming = it } }
        // Tema colorido salvo na conta (o mesmo do site/PC).
        LaunchedEffect(Unit) {
            runCatching {
                val st = app.repo.api.get<kotlinx.serialization.json.JsonElement>("/api/users/me/settings")
                    .let { (it as kotlinx.serialization.json.JsonObject)["settings"] as? kotlinx.serialization.json.JsonObject }
                com.projectclub.android.ui.theme.ThemeStore.applyServer(this@MainActivity, st?.get("extraPrefs") as? kotlinx.serialization.json.JsonObject)
            }
        }
        LaunchedEffect(Unit) {
            app.repo.alerts.collect { a -> if (a is Alert.CallEnded && incoming?.conversationId == a.conversationId) incoming = null }
        }
        // Pedidos vindos de notificações.
        LaunchedEffect(Unit) {
            pending.collect { i ->
                if (i == null) return@collect
                pending.value = null
                handleIntent(i, nav) { incoming = it }
            }
        }

        val scope = androidx.compose.runtime.rememberCoroutineScope()
        var homeTab by androidx.compose.runtime.saveable.rememberSaveable { androidx.compose.runtime.mutableIntStateOf(0) }
        var miniUser by remember { mutableStateOf<String?>(null) }
        val appNav = remember(nav) {
            AppNavigator(
                this, nav, app.repo, scope, onJoinVoice = { ch, title -> joinVoice(ch, title, nav) },
                onHome = { t ->
                    homeTab = t
                    nav.popBackStack("home", inclusive = false)
                },
                onMiniProfile = { miniUser = it },
            )
        }
        navRef = appNav
        val actions = HomeActions(
            openRoom = { r -> appNav.room(r) },
            openWeb = { p -> appNav.link(p) },
            joinVoice = { ch, title -> joinVoice(ch, title, nav) },
            openCall = { nav.navigate("voice") { launchSingleTop = true } },
        )
        val callBar: @Composable () -> Unit = {
            if (call.channelName != null && call.status != CallStatus.Idle && route != "voice") {
                Row(
                    Modifier.fillMaxWidth().background(PC.Green).statusBarsPadding().clickable { actions.openCall() }.padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.Mic, null, tint = Color.White, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(
                        (if (call.sharingScreen) "Compartilhando a tela · " else "Em chamada · ") + call.title,
                        color = Color.White, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                    )
                    Text("Voltar", color = Color.White)
                }
            }
        }

        androidx.compose.runtime.CompositionLocalProvider(com.projectclub.android.ui.profile.LocalOpenUser provides { id: String -> miniUser = id }) {
        NavHost(nav, startDestination = "home") {
            composable("home") { HomeScreen(app.repo, actions, appNav, homeTab, { homeTab = it }, callBar) }
            composable("chat/channel/{id}", arguments = listOf(navArgument("id") { type = NavType.StringType })) { e ->
                val id = e.arguments?.getString("id").orEmpty()
                ChatScreen(app.repo, Room(channelId = id), onBack = { nav.popBackStack() }, onCall = actions.joinVoice, onOpenWeb = actions.openWeb)
            }
            composable("chat/dm/{id}", arguments = listOf(navArgument("id") { type = NavType.StringType })) { e ->
                val id = e.arguments?.getString("id").orEmpty()
                ChatScreen(app.repo, Room(conversationId = id), onBack = { nav.popBackStack() }, onCall = actions.joinVoice, onOpenWeb = actions.openWeb)
            }
            composable("voice") { VoiceScreen(app.voice, app.repo, onBack = { nav.popBackStack() }, onOpenWeb = appNav::external) }
            featureScreens(app.repo, appNav)
        }
        }

        miniUser?.let { id ->
            com.projectclub.android.ui.profile.MiniProfileSheet(
                app.repo, id,
                onDismiss = { miniUser = null },
                onFullProfile = { miniUser = null; appNav.fullProfile(it) },
                onMessage = { miniUser = null; appNav.dmWith(it) },
            )
        }

        incoming?.let { c ->
            AlertDialog(
                onDismissRequest = {},
                icon = { Icon(Icons.Filled.Call, null, tint = PC.Green) },
                title = { Text("${c.callerName} está te ligando") },
                text = { Text("Chamada de voz no Project Club", color = PC.Muted, style = MaterialTheme.typography.bodyMedium) },
                confirmButton = {
                    TextButton(onClick = {
                        incoming = null
                        Notifier.cancelCall(this, c.conversationId)
                        joinVoice(c.channelName, c.callerName, nav)
                    }) { Text("Atender", color = PC.Green, fontWeight = FontWeight.Bold) }
                },
                dismissButton = {
                    TextButton(onClick = {
                        incoming = null
                        Notifier.cancelCall(this, c.conversationId)
                        app.repo.realtime.emit("dm-call:reject", org.json.JSONObject().put("conversationId", c.conversationId))
                    }) { Text("Recusar", color = PC.Red) }
                },
            )
        }
    }

    private fun handleIntent(i: Intent, nav: NavHostController, showIncoming: (Alert.IncomingCall) -> Unit) {
        val conversationId = i.getStringExtra(Notifier.EXTRA_CONVERSATION)
        val channelId = i.getStringExtra(Notifier.EXTRA_CHANNEL)
        val link = i.getStringExtra(Notifier.EXTRA_LINK)
        when (i.action) {
            Notifier.ACTION_ANSWER_CALL -> {
                val ch = i.getStringExtra(Notifier.EXTRA_CALL_CHANNEL) ?: conversationId?.let { "dm:$it" } ?: return
                conversationId?.let { Notifier.cancelCall(this, it) }
                val title = conversationId?.let { id -> app.repo.conversation(id)?.let { app.repo.conversationTitle(it) } } ?: "Chamada"
                joinVoice(ch, title, nav)
            }
            Notifier.ACTION_INCOMING_CALL -> {
                val ch = i.getStringExtra(Notifier.EXTRA_CALL_CHANNEL) ?: return
                showIncoming(Alert.IncomingCall(conversationId ?: ch.removePrefix("dm:"), ch, null, i.getStringExtra(Notifier.EXTRA_CALLER) ?: "Alguém"))
            }
            CallService.ACTION_OPEN_CALL -> nav.navigate("voice") { launchSingleTop = true }
            else -> when {
                conversationId != null -> nav.navigate("chat/dm/$conversationId")
                channelId != null -> nav.navigate("chat/channel/$channelId")
                link != null -> navRef?.link(link)
            }
        }
    }
}
