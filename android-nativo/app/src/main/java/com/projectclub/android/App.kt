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
import com.projectclub.android.voice.VoiceManager
import kotlinx.coroutines.CoroutineExceptionHandler
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
class App : Application(), coil.ImageLoaderFactory {
    /**
     * ImageLoader padrão do Coil (AsyncImage sem imageLoader): cache em disco
     * com teto (ImageCaches) e SEM revalidar pelos cabeçalhos HTTP — sem isso
     * uma imagem "velha" no cache não aparecia offline (o Coil ia na rede).
     */
    override fun newImageLoader(): coil.ImageLoader = coil.ImageLoader.Builder(this)
        .diskCache { com.projectclub.android.data.offline.ImageCaches.disk(this) }
        .respectCacheHeaders(false)
        .build()

    /**
     * Escopo do app. Um erro inesperado numa tarefa de fundo NÃO pode fechar o
     * app (sem este handler, qualquer exceção solta num launch derrubava tudo):
     * vira relato pro servidor e a tarefa morre sozinha.
     */
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default + CoroutineExceptionHandler { _, t ->
        android.util.Log.e("PCApp", "erro numa tarefa de fundo", t)
        if (::repo.isInitialized) repo.report("tarefa", t)
    })
    lateinit var api: Api
        private set
    lateinit var repo: Repository
        private set
    lateinit var voice: VoiceManager
        private set

    @Volatile private var pushToken: String? = null

    private val _isForeground = MutableStateFlow(false)
    val isForeground: StateFlow<Boolean> = _isForeground

    /** Chamadas recebendo com o app aberto (a tela mostra o aviso). */
    private val _incomingCalls = MutableSharedFlow<Alert.IncomingCall>(replay = 1, extraBufferCapacity = 4)
    val incomingCalls: SharedFlow<Alert.IncomingCall> = _incomingCalls

    override fun onCreate() {
        super.onCreate()
        CrashReporter.install(this)
        com.projectclub.android.voice.VoiceTrace.init(this)
        // Antes de tudo que possa usar o Updater (o observador do ciclo de vida chama ele).
        com.projectclub.android.data.Updater.init(this)
        api = Api(this)
        repo = Repository(this, api, appScope)
        voice = VoiceManager(this, repo, appScope)
        Notifier.createChannels(this)

        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                _isForeground.value = true; repo.realtime.connect()
                com.projectclub.android.data.Updater.refreshPermission()
                appScope.launch { com.projectclub.android.data.Updater.check() }
            }
            override fun onStop(owner: LifecycleOwner) {
                _isForeground.value = false
                com.projectclub.android.ui.theme.AppIcons.applyPending(this@App)
                // Saiu do app: instala a atualização baixada sem perguntar nada
                // (Android 12+), nunca no meio de uma chamada de voz.
                val U = com.projectclub.android.data.Updater
                if (U.state.value is com.projectclub.android.data.UpdateState.Ready && U.canInstallSilently() &&
                    voice.state.value.status == com.projectclub.android.voice.CallStatus.Idle) U.install(userAsked = false)
            }
        })

        repo.beforeLogout = { pushToken?.let { repo.unregisterPushToken(it) } }
        appScope.launch { repo.restore() }
        appScope.launch { runCatching { CrashReporter.sendPending(this@App) } }
        appScope.launch { repo.alerts.collect(::onAlert) }
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
            Alert.SessionStarted -> registerPush()
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
