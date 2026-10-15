package com.projectclub.android

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.google.firebase.messaging.FirebaseMessaging
import com.projectclub.android.data.Alert
import com.projectclub.android.data.Repository
import com.projectclub.android.data.SessionState
import com.projectclub.android.net.Api
import com.projectclub.android.notify.Notifier
import com.projectclub.android.ui.web.WebHost
import com.projectclub.android.voice.VoiceManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** Dono das peças do app (servidor, tempo real, voz) e das notificações. */
class App : Application() {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    lateinit var api: Api
        private set
    lateinit var repo: Repository
        private set
    lateinit var voice: VoiceManager
        private set
    /** O site (partes não nativas), carregado uma vez e reaproveitado. */
    lateinit var web: WebHost
        private set

    @Volatile private var pushToken: String? = null

    private val _isForeground = MutableStateFlow(false)
    val isForeground: StateFlow<Boolean> = _isForeground

    /** Chamadas recebendo com o app aberto (a tela mostra o aviso). */
    private val _incomingCalls = MutableSharedFlow<Alert.IncomingCall>(replay = 1, extraBufferCapacity = 4)
    val incomingCalls: SharedFlow<Alert.IncomingCall> = _incomingCalls

    override fun onCreate() {
        super.onCreate()
        api = Api(this)
        repo = Repository(this, api, appScope)
        voice = VoiceManager(this, repo, appScope)
        web = WebHost(this, api)
        Notifier.createChannels(this)

        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) { _isForeground.value = true; repo.realtime.connect(); web.onAppForeground() }
            override fun onStop(owner: LifecycleOwner) { _isForeground.value = false; web.onAppBackground() }
        })

        repo.beforeLogout = { pushToken?.let { repo.unregisterPushToken(it) } }
        appScope.launch { repo.restore() }
        appScope.launch { com.projectclub.android.data.Updater.check() }
        appScope.launch { repo.alerts.collect(::onAlert) }
        // Saiu da conta: o site embutido sai junto.
        appScope.launch { repo.session.collect { if (it is SessionState.LoggedOut) web.reset() } }
        // "Estou mexendo no app": evita ficar Ausente sozinho enquanto usa.
        appScope.launch {
            while (isActive) {
                delay(60_000)
                if (_isForeground.value && repo.session.value == SessionState.LoggedIn) repo.realtime.emit("presence:activity")
            }
        }
    }

    private fun onAlert(a: Alert) {
        when (a) {
            Alert.SessionStarted -> {
                registerPush()
                // Deixa o site pronto em segundo plano: os menus abrem na hora.
                appScope.launch { delay(3000); web.preload() }
            }
            is Alert.DirectMessage -> {
                val m = a.message
                val conv = m.conversationId ?: return
                if (_isForeground.value && repo.openRoom.value == conv) return
                val author = m.author?.name ?: repo.user(m.authorId)?.name ?: "Mensagem"
                val conversation = repo.conversation(conv)
                val title = if (conversation?.isGroup == true) "$author · ${repo.conversationTitle(conversation)}" else author
                val text = m.content?.takeIf { it.isNotBlank() }
                    ?: if (m.attachments.isNotEmpty()) "📎 Anexo" else if (m.stickerUrl != null) "🏷️ Figurinha" else "Nova mensagem"
                Notifier.message(this, conv, title, text)
            }
            is Alert.Mention -> Notifier.mention(this, a.channelId, "${a.authorName} em #${a.channelName}", a.preview)
            is Alert.NoticeArrived -> if (!_isForeground.value) {
                Notifier.notice(this, a.notice.id, a.notice.title ?: "Project Club", a.notice.body.orEmpty(), a.notice.link)
            }
            is Alert.IncomingCall -> {
                if (voice.state.value.channelName == a.channelName) return
                Notifier.incomingCall(this, a.conversationId, a.channelName, a.callerName)
                _incomingCalls.tryEmit(a)
            }
            is Alert.CallEnded -> {
                Notifier.cancelCall(this, a.conversationId)
                _incomingCalls.resetReplayCache()
            }
        }
    }

    private fun registerPush() {
        if (!BuildConfig.HAS_FIREBASE) return
        runCatching {
            FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                pushToken = token
                appScope.launch { repo.registerPushToken(token) }
            }
        }
    }

}
