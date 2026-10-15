package com.projectclub.android

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.CookieManager
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
import com.projectclub.android.ui.web.WebScreen
import com.projectclub.android.voice.CallService
import com.projectclub.android.voice.CallStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val app get() = application as App
    /** Pedido vindo de notificação/intent, aplicado quando a navegação estiver pronta. */
    private val pending = MutableStateFlow<Intent?>(null)
    private var afterMicPermission: (() -> Unit)? = null

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
        setContent { ProjectClubTheme { Root() } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        pending.value = intent
    }

    override fun onPause() {
        CookieManager.getInstance().flush()
        super.onPause()
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

        val actions = HomeActions(
            openRoom = { r -> nav.navigate(if (r.isDm) "chat/dm/${r.conversationId}" else "chat/channel/${r.channelId}") },
            openWeb = { p -> nav.navigate("web?path=${Uri.encode(p)}") },
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

        NavHost(nav, startDestination = "home") {
            composable("home") { HomeScreen(app.repo, actions, callBar) }
            composable("chat/channel/{id}", arguments = listOf(navArgument("id") { type = NavType.StringType })) { e ->
                val id = e.arguments?.getString("id").orEmpty()
                ChatScreen(app.repo, Room(channelId = id), onBack = { nav.popBackStack() }, onCall = actions.joinVoice, onOpenWeb = actions.openWeb)
            }
            composable("chat/dm/{id}", arguments = listOf(navArgument("id") { type = NavType.StringType })) { e ->
                val id = e.arguments?.getString("id").orEmpty()
                ChatScreen(app.repo, Room(conversationId = id), onBack = { nav.popBackStack() }, onCall = actions.joinVoice, onOpenWeb = actions.openWeb)
            }
            composable("voice") { VoiceScreen(app.voice, app.repo, onBack = { nav.popBackStack() }, onOpenWeb = actions.openWeb) }
            composable("web?path={path}", arguments = listOf(navArgument("path") { type = NavType.StringType; defaultValue = "/" })) { e ->
                WebScreen(app.web, e.arguments?.getString("path") ?: "/", onBack = { nav.popBackStack() })
            }
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
                link != null -> nav.navigate("web?path=${Uri.encode(link)}")
            }
        }
    }
}
