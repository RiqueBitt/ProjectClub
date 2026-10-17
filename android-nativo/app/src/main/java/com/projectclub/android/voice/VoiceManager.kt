package com.projectclub.android.voice

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.projection.MediaProjection
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.SurfaceView
import androidx.core.content.ContextCompat
import com.projectclub.android.data.Repository
import com.projectclub.android.data.VoiceJoinResponse
import com.projectclub.android.net.ApiException
import com.projectclub.android.net.isTransientServer
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.json.JSONObject

enum class CallStatus { Idle, Connecting, Connected, Reconnecting, Unsupported }

data class CallState(
    val channelName: String? = null,
    val title: String = "",
    val status: CallStatus = CallStatus.Idle,
    val muted: Boolean = false,
    val deafened: Boolean = false,
    val speakerOn: Boolean = true,
    val sharingScreen: Boolean = false,
    /** userIds falando agora ("me" = você). */
    val speaking: Set<String> = emptySet(),
    /** userIds com vídeo (tela compartilhada) chegando. */
    val remoteVideo: Set<String> = emptySet(),
    val error: String? = null,
    val provider: String? = null,
    /** Reações flutuando agora (somem sozinhas em ~3 s). */
    val reactions: List<CallReaction> = emptyList(),
    /** Entrou sem permissão de microfone: só ouve (desmutar pede a permissão). */
    val listenOnly: Boolean = false,
)

data class CallReaction(val id: Long, val userId: String, val emoji: String)

/** Os mesmos emojis rápidos do PC (o servidor só aceita estes). */
val QUICK_REACTIONS = listOf("👍", "❤️", "😂", "🎉", "😮")

/**
 * Chamadas de voz. O app usa SÓ o servidor de mídia PRÓPRIO do Project Club
 * (mediasoup no VPS, ver MediasoupEngine): /api/voice/join devolve as
 * credenciais dele (o app anuncia clientReady=projectclub).
 * - Canal = o mesmo channelName do servidor (id do canal, "dm:<id>"...).
 * - Usuário = o id do usuário (string), igual ao site.
 * - Compartilhar tela = trilha de tela publicada no mesmo usuário; o roster
 *   do servidor (voice:state { screenSharing }) diz quem está compartilhando.
 *
 * Falhas: se o servidor de mídia não conectar (ou cair e não voltar), o app
 * tenta de novo sozinho com espera crescente (credencial nova a cada vez),
 * mostrando "reconectando"; esgotadas as tentativas, sai da call com uma
 * mensagem clara. Se o servidor mandar a reserva da web (Jitsi, que não tem
 * versão no app), mostra "Chamada pelo site".
 *
 * Toda a lógica de estado roda na thread principal.
 */
class VoiceManager(context: Context, private val repo: Repository, private val scope: CoroutineScope) {
    /** Contexto da APLICAÇÃO (a call vive mais que qualquer tela). */
    private val appContext: Context = context.applicationContext ?: context

    private val _state = MutableStateFlow(CallState())
    val state: StateFlow<CallState> = _state

    /** Servidor de mídia PRÓPRIO (VPS do Project Club). */
    private var own: MediasoupEngine? = null
    private val usingOwn get() = _state.value.provider == PROVIDER_OWN
    private val audio = CallAudio(appContext) { speaker -> _state.update { it.copy(speakerOn = speaker) } }

    private var projection: MediaProjection? = null
    private var syncJob: Job? = null
    private var connectJob: Job? = null
    private var watchdog: Job? = null
    private val main = Handler(Looper.getMainLooper())

    /** Cada call (e cada saída) muda a sessão: o que chega atrasado de uma call antiga é ignorado. */
    @Volatile private var session = 0
    /** Falhas seguidas do servidor de mídia nesta call (zera quando conecta). */
    private var ownFailures = 0

    private val ownEvents = object : MediasoupEngine.Events {
        private fun on(block: (Int) -> Unit) {
            main.post { if (usingOwn && _state.value.channelName != null) block(session) }
        }
        override fun onConnected() = on { onMediaConnected(it, PROVIDER_OWN) }
        override fun onReconnecting(attempt: Int) = on { s ->
            _state.update { it.copy(status = CallStatus.Reconnecting) }
            // Rede de segurança: se a reconexão do próprio engine travar, conta como falha e recomeça.
            armWatchdog(s, PROVIDER_OWN, OWN_RECONNECT_TIMEOUT_MS)
        }
        override fun onReconnected() = on { onMediaConnected(it, PROVIDER_OWN) }
        override fun onGaveUp(message: String, providerBroken: Boolean) = on { s ->
            if (providerBroken) providerFailed(s, PROVIDER_OWN, message) else retryProvider(s)
        }
        override fun onReplaced() = on { replacedElsewhere() }
        override fun onLeft() = on { leave(notifyServer = false) }
        override fun onWarning(message: String) = on { _state.update { st -> st.copy(error = message) } }
        override fun onScreenStopped() = on { screenStoppedByEngine() }
        override fun onSpeaking(userIds: Set<String>) = on { if (userIds != _state.value.speaking) _state.update { it.copy(speaking = userIds) } }
        override fun onRemoteVideo(userIds: Set<String>) = on { _state.update { it.copy(remoteVideo = userIds) } }
    }

    init {
        // Servidor confirmou a entrada: manda o estado real (mudo, tela...).
        scope.launch {
            repo.realtime.events.collect { e ->
                val ch = _state.value.channelName ?: return@collect
                when (e.name) {
                    "voice:joined" -> if (e.data.toString().contains(ch)) sendState()
                    "voice:kicked-by-other-device" -> if (e.data.toString().contains(ch)) main.post { replacedElsewhere() }
                    // O servidor não me acha na sala (caí e a tolerância passou): entra de novo.
                    "voice:not-in-room" -> if (e.data.toString().contains(ch) && _state.value.status == CallStatus.Connected) {
                        repo.realtime.emit("voice:join", JSONObject().put("channelId", ch))
                    }
                    "voice:reaction" -> {
                        val o = e.data as? JsonObject ?: return@collect
                        fun f(k: String) = (o[k] as? JsonPrimitive)?.content
                        if (f("channelId") != ch) return@collect
                        val r = CallReaction(System.nanoTime(), f("userId") ?: return@collect, f("emoji") ?: return@collect)
                        _state.update { it.copy(reactions = (it.reactions + r).takeLast(12)) }
                        main.postDelayed({ _state.update { st -> st.copy(reactions = st.reactions.filter { it.id != r.id }) } }, 3200)
                    }
                }
            }
        }
        scope.launch {
            repo.realtime.connected.collect { up ->
                val ch = _state.value.channelName
                if (up && ch != null && _state.value.status == CallStatus.Connected) {
                    repo.realtime.emit("voice:join", JSONObject().put("channelId", ch))
                }
            }
        }
    }

    // ---------------- entrar ----------------

    /** Entra numa call (canal de voz ou "dm:<conversa>"). [listenOnly] = sem permissão de microfone. */
    fun start(channelName: String, title: String, listenOnly: Boolean = false) {
        main.post { join(channelName, title, listenOnly) }
    }

    private fun join(channelName: String, title: String, listenOnly: Boolean) {
        val cur = _state.value
        if (cur.channelName == channelName && cur.status != CallStatus.Idle) return
        if (cur.channelName != null) leave()
        val s = ++session
        ownFailures = 0
        _state.value = CallState(channelName = channelName, title = title, status = CallStatus.Connecting, listenOnly = listenOnly, muted = listenOnly)
        startService(title)
        connectJob?.cancel()
        connectJob = scope.launch(Dispatchers.Main.immediate) { connect(s) }
    }

    private fun hasMic() = ContextCompat.checkSelfPermission(appContext, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    private fun startService(title: String) {
        // Começar o serviço com o app em segundo plano pode ser recusado (Android 12+): a call segue igual.
        runCatching { CallService.start(appContext, title) }.onFailure { Log.w(TAG, "serviço da chamada", it) }
    }

    /**
     * Pergunta ao servidor as credenciais do servidor de mídia e entra.
     * - Erro de rede ou deploy (502/503/504): espera e tenta de novo, sem
     *   mensagem assustadora.
     * - O servidor de mídia não conectou: tenta de novo com espera crescente
     *   (OWN_RETRY_DELAYS_MS); esgotou, sai com uma mensagem clara.
     */
    private suspend fun connect(s: Int) {
        var netTries = 0
        while (session == s) {
            val ch = _state.value.channelName ?: return
            if (ownFailures > 0) {
                if (ownFailures > OWN_RETRY_DELAYS_MS.size) { fail(s, OWN_DOWN_MESSAGE); return }
                if (_state.value.status != CallStatus.Connecting) _state.update { it.copy(status = CallStatus.Reconnecting) }
                delay(OWN_RETRY_DELAYS_MS[ownFailures - 1])
                if (session != s) return
            }
            val res = try {
                repo.voiceJoin(ch)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (session != s) return
                if (e is ApiException && !e.isTransientServer() && e.status in 400..499 && e.status != 429) {
                    // Sem permissão, canal não existe...: não adianta insistir.
                    fail(s, e.message ?: "Não deu pra entrar na chamada."); return
                }
                netTries++
                if (netTries > JOIN_RETRY_DELAYS_MS.size) { fail(s, "Sem conexão com o servidor de voz. Tente de novo em instantes."); return }
                if (_state.value.status != CallStatus.Connecting) _state.update { it.copy(status = CallStatus.Reconnecting) }
                delay(JOIN_RETRY_DELAYS_MS[netTries - 1])
                continue
            }
            if (session != s) return
            netTries = 0
            when (startProvider(s, res)) {
                Start.Started -> return
                Start.Failed -> continue // já contou a falha: tenta de novo depois da espera
                Start.Unsupported -> {
                    if (ownFailures == 0) {
                        // O servidor mandou a reserva da web (Jitsi), que não tem versão no app: abre pelo site.
                        stopMedia()
                        _state.update { it.copy(status = CallStatus.Unsupported, provider = res.provider) }
                        runCatching { CallService.stop(appContext) }
                        return
                    }
                    // Chegou na reserva porque o servidor de mídia falhou: tenta ele de novo daqui a pouco.
                    ownFailures++
                }
            }
        }
    }

    private enum class Start { Started, Failed, Unsupported }

    private fun startProvider(s: Int, res: VoiceJoinResponse): Start {
        val st = _state.value
        val myId = repo.me.value?.id
        return when (res.provider) {
            PROVIDER_OWN -> {
                val pc = res.projectclub
                fun str(k: String) = (pc?.get(k) as? JsonPrimitive)?.content?.takeIf { it.isNotBlank() }
                val url = str("url")
                val token = str("token")
                if (pc == null || url == null || token == null || myId == null) { markFailed(PROVIDER_OWN, "credenciais incompletas"); return Start.Failed }
                stopMedia()
                _state.update { it.copy(provider = PROVIDER_OWN, status = if (it.status == CallStatus.Connected) CallStatus.Reconnecting else it.status) }
                val ice = MediasoupEngine.iceServers(runCatching { JSONObject(pc.toString()).optJSONArray("iceServers") }.getOrNull())
                audio.start(_state.value.speakerOn)
                val e = own ?: MediasoupEngine(appContext, ownEvents).also { own = it }
                e.join(OwnMediaCreds(url, token, ice), myId, startMuted = st.muted || st.deafened, listenOnly = st.listenOnly || !hasMic())
                if (st.deafened) e.setDeafened(true)
                armWatchdog(s, PROVIDER_OWN, OWN_CONNECT_TIMEOUT_MS)
                Start.Started
            }
            else -> Start.Unsupported
        }
    }

    /** A mídia conectou (primeira vez ou reconexão). */
    private fun onMediaConnected(s: Int, provider: String) {
        if (session != s || _state.value.provider != provider) return
        watchdog?.cancel()
        _state.update { it.copy(status = CallStatus.Connected) }
        ownFailures = 0
        _state.value.channelName?.let { repo.realtime.emit("voice:join", JSONObject().put("channelId", it)) }
        sendState()
        startSync()
        applyVolumes()
    }

    private fun armWatchdog(s: Int, provider: String, ms: Long) {
        watchdog?.cancel()
        watchdog = scope.launch(Dispatchers.Main.immediate) {
            delay(ms)
            val st = _state.value
            if (session == s && st.provider == provider && st.status != CallStatus.Connected) {
                providerFailed(s, provider, "não conectou em ${ms / 1000} s")
            }
        }
    }

    private fun markFailed(provider: String, why: String) {
        ownFailures++
        repo.report("voz:$provider", IllegalStateException("$provider: $why (tentativa $ownFailures, tentando de novo)"))
    }

    /** O servidor de mídia não conectou/caiu: desliga e tenta de novo (com espera). */
    private fun providerFailed(s: Int, provider: String, why: String) {
        if (session != s || _state.value.provider != provider) return
        markFailed(provider, why)
        restartConnect(s)
    }

    /** Credenciais novas, sem contar falha (ex.: token do servidor próprio venceu). */
    private fun retryProvider(s: Int) {
        if (session != s) return
        restartConnect(s)
    }

    private fun restartConnect(s: Int) {
        stopMedia()
        _state.update {
            it.copy(status = if (it.status == CallStatus.Connecting) CallStatus.Connecting else CallStatus.Reconnecting,
                provider = null, speaking = emptySet(), remoteVideo = emptySet())
        }
        connectJob?.cancel()
        connectJob = scope.launch(Dispatchers.Main.immediate) { connect(s) }
    }

    /** Desliga a mídia (a call em si continua). */
    private fun stopMedia() {
        watchdog?.cancel()
        if (_state.value.sharingScreen) {
            projection?.let { p -> runCatching { p.stop() } }
            projection = null
            _state.update { it.copy(sharingScreen = false) }
            runCatching { CallService.screenStopped(appContext) }
        }
        own?.leave()
        audio.stop()
    }

    private fun fail(s: Int, message: String) {
        if (session != s) return
        session++
        stopMedia()
        syncJob?.cancel(); watchdog?.cancel()
        _state.value.channelName?.let { repo.realtime.emit("voice:leave", JSONObject().put("channelId", it)) }
        _state.value = CallState(error = message)
        runCatching { CallService.stop(appContext) }
    }

    /** Você entrou nesta call em outro aparelho: sai deste (sem reconectar) e avisa. */
    private fun replacedElsewhere() {
        if (_state.value.channelName == null) return
        leave(notifyServer = false)
        _state.value = CallState(error = "Você entrou nesta call em outro aparelho.")
    }

    // ---------------- controles ----------------

    private fun startSync() {
        syncJob?.cancel()
        syncJob = scope.launch {
            while (isActive) {
                delay(20_000)
                val ch = _state.value.channelName ?: break
                repo.realtime.emit("voice:sync", JSONObject().put("channelId", ch))
            }
        }
    }

    private fun sendState() {
        val s = _state.value
        val ch = s.channelName ?: return
        repo.realtime.emit("voice:state", JSONObject().apply {
            put("channelId", ch); put("muted", s.muted || s.deafened); put("deafened", s.deafened)
            put("video", false); put("screenSharing", s.sharingScreen)
        })
    }

    fun toggleMute() {
        val st = _state.value
        if (st.listenOnly && st.muted) {
            // Entrou só ouvindo: pra falar precisa da permissão do microfone.
            if (!hasMic()) {
                _state.update { it.copy(error = "Para falar, permita o microfone do Project Club nas configurações do Android.") }
                return
            }
            _state.update { it.copy(listenOnly = false) }
            // Serviço volta como "microfone" (o Android exige pra gravar em segundo plano).
            startService(st.title)
            if (usingOwn) own?.enableMic()
        }
        val muted = !_state.value.muted
        if (usingOwn) own?.setMuted(muted || _state.value.deafened)
        _state.update { it.copy(muted = muted) }
        sendState()
    }

    fun toggleDeafen() {
        val deaf = !_state.value.deafened
        if (usingOwn) { own?.setDeafened(deaf); own?.setMuted(deaf || _state.value.muted) }
        _state.update { it.copy(deafened = deaf) }
        sendState()
    }

    fun toggleSpeaker() {
        val on = !_state.value.speakerOn
        audio.setSpeaker(on)
        _state.update { it.copy(speakerOn = on) }
    }

    /** Recebe a autorização de captura (pedida na tela) já dentro do serviço. */
    fun startScreenShare(mp: MediaProjection) {
        if (_state.value.status == CallStatus.Idle) { runCatching { mp.stop() }; return }
        val o = own?.takeIf { usingOwn } ?: run { runCatching { mp.stop() }; return }
        projection?.stop()
        projection = mp
        // Android 14+: precisa de um callback registrado antes de capturar.
        mp.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() { main.post { if (_state.value.sharingScreen) stopScreenShare() } }
        }, main)
        o.startScreen(mp) { msg ->
            main.post {
                _state.update { it.copy(sharingScreen = false, error = msg) }
                projection?.stop(); projection = null
                runCatching { CallService.screenStopped(appContext) }
                sendState()
            }
        }
        _state.update { it.copy(sharingScreen = true, error = null) }
        sendState()
    }

    fun stopScreenShare() {
        if (usingOwn) own?.stopScreen()
        projection?.let { runCatching { it.stop() } }
        projection = null
        _state.update { it.copy(sharingScreen = false) }
        sendState()
        runCatching { CallService.screenStopped(appContext) }
    }

    /** A transmissão de tela caiu junto com a conexão (o servidor próprio reconectou). */
    private fun screenStoppedByEngine() {
        if (!_state.value.sharingScreen) return
        projection?.let { runCatching { it.stop() } }
        projection = null
        _state.update { it.copy(sharingScreen = false) }
        runCatching { CallService.screenStopped(appContext) }
        sendState()
    }

    /** Liga a tela compartilhada de alguém num SurfaceView. */
    fun bindRemoteVideo(view: SurfaceView, userId: String): Boolean =
        if (usingOwn) own?.bindRemoteVideo(view, userId) ?: false else false

    fun unbindRemoteVideo(userId: String) {
        if (usingOwn) own?.unbindRemoteVideo(userId)
    }

    fun leave(notifyServer: Boolean = true) {
        if (Looper.myLooper() != Looper.getMainLooper()) { main.post { leave(notifyServer) }; return }
        session++
        connectJob?.cancel(); watchdog?.cancel(); syncJob?.cancel()
        val ch = _state.value.channelName
        if (_state.value.sharingScreen) runCatching { stopScreenShare() }
        if (ch != null && notifyServer) repo.realtime.emit("voice:leave", JSONObject().put("channelId", ch))
        stopMedia()
        _state.value = CallState()
        runCatching { CallService.stop(appContext) }
    }

    /** View pra mostrar a tela de alguém (o servidor próprio usa o renderizador do WebRTC). */
    fun createVideoView(ctx: Context): SurfaceView =
        if (usingOwn) own?.createVideoView(ctx) ?: SurfaceView(ctx) else SurfaceView(ctx)

    fun clearError() = _state.update { it.copy(error = null) }

    val prefs: VoicePrefs = VoicePrefs.get(appContext)

    /** Manda uma reação rápida pra todo mundo da chamada (inclusive você). */
    fun sendReaction(emoji: String) {
        val ch = _state.value.channelName ?: return
        if (emoji !in QUICK_REACTIONS) return
        repo.realtime.emit("voice:reaction", JSONObject().put("channelId", ch).put("emoji", emoji))
    }

    /** Volume de uma pessoa (0–200 %), só pra você. */
    fun setUserVolume(userId: String, percent: Int) {
        prefs.setUserVolume(userId, percent)
    }

    /** Aplica os volumes guardados no servidor de mídia (se em uso). */
    private fun applyVolumes() {
        if (usingOwn) own?.applyVolumes()
    }

    init { prefs.onChange { main.post { applyVolumes() } } }

    private companion object {
        const val TAG = "PCVoz"
        const val PROVIDER_OWN = "projectclub"
        /** Tempo pro servidor de mídia conectar (ou reconectar) antes de contar como falha. */
        const val OWN_CONNECT_TIMEOUT_MS = 20_000L
        const val OWN_RECONNECT_TIMEOUT_MS = 90_000L
        /** Espera antes de cada nova tentativa depois de uma falha do servidor de mídia. */
        val OWN_RETRY_DELAYS_MS = longArrayOf(1_000, 3_000, 6_000, 12_000, 20_000)
        const val OWN_DOWN_MESSAGE = "O servidor de voz do Project Club não está respondendo agora. Tente entrar de novo em alguns minutos."
        /** Erro de rede/deploy ao pedir as credenciais: espera e tenta de novo. */
        val JOIN_RETRY_DELAYS_MS = longArrayOf(1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 30_000, 30_000)
    }
}
