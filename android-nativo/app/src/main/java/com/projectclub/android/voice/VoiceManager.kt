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
import com.projectclub.android.data.AgoraCreds
import com.projectclub.android.data.Repository
import com.projectclub.android.data.VoiceJoinResponse
import com.projectclub.android.net.ApiException
import com.projectclub.android.net.isTransientServer
import io.agora.rtc2.ChannelMediaOptions
import io.agora.rtc2.Constants
import io.agora.rtc2.IRtcEngineEventHandler
import io.agora.rtc2.RtcEngine
import io.agora.rtc2.RtcEngineConfig
import io.agora.rtc2.ScreenCaptureParameters
import io.agora.rtc2.UserInfo
import io.agora.rtc2.video.VideoCanvas
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
import java.util.concurrent.ConcurrentHashMap

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
 * Chamadas de voz. O servidor (/api/voice/join) escolhe o provedor da cadeia
 * — servidor de mídia PRÓPRIO (mediasoup, ver MediasoupEngine) ou o SDK
 * nativo da Agora — e todo mundo da mesma call fica no mesmo provedor.
 * - Canal = o mesmo channelName do servidor (id do canal, "dm:<id>"...).
 * - Usuário = o id do usuário (string), igual ao site.
 * - Compartilhar tela = trilha de tela publicada no mesmo usuário; o roster
 *   do servidor (voice:state { screenSharing }) diz quem está compartilhando.
 *
 * Failover (igual ao site, VoiceContext.jsx): se o provedor escolhido não
 * conectar em alguns segundos (ex.: Agora com CAN_NOT_GET_GATEWAY_SERVER,
 * servidor próprio fora), pede ao servidor o PRÓXIMO da cadeia sem ele
 * (clientReady sem o que falhou) — a call nunca fica morta. Enquanto está
 * conectado, confere a cada minuto (e no aviso voice:provider-changed) se a
 * sala mudou de provedor, pra todo mundo terminar no mesmo.
 *
 * Toda a lógica de estado roda na thread principal.
 */
class VoiceManager(context: Context, private val repo: Repository, private val scope: CoroutineScope) {
    /**
     * Contexto da APLICAÇÃO, resolvido aqui fora. (Bug antigo: dentro de
     * `RtcEngineConfig().apply { mContext = context.applicationContext }` o
     * `context` era o getContext() DO PRÓPRIO CONFIG — ainda nulo — e não o
     * nosso: NullPointerException toda vez que a call ia pela Agora.)
     */
    private val appContext: Context = context.applicationContext ?: context

    private val _state = MutableStateFlow(CallState())
    val state: StateFlow<CallState> = _state

    private var engine: RtcEngine? = null
    private var engineAppId: String? = null
    /** Servidor de mídia PRÓPRIO (VPS do Project Club) — quando a cadeia escolhe "projectclub". */
    private var own: MediasoupEngine? = null
    private val usingOwn get() = _state.value.provider == PROVIDER_OWN
    private val audio = CallAudio(appContext) { speaker -> _state.update { it.copy(speakerOn = speaker) } }

    private var projection: MediaProjection? = null
    private var syncJob: Job? = null
    private var connectJob: Job? = null
    private var watchdog: Job? = null
    private var swapJob: Job? = null
    private var swapping = false
    private val uidToUser = ConcurrentHashMap<Int, String>()
    private val main = Handler(Looper.getMainLooper())

    /** Cada call (e cada saída) muda a sessão: o que chega atrasado de uma call antiga é ignorado. */
    @Volatile private var session = 0
    /** Sessão em que a Agora entrou por último (os callbacks dela checam). */
    @Volatile private var agoraSession = -1
    /** Provedores que falharam NESTA call → quando (fica de fora por um tempo). */
    private val failedAt = HashMap<String, Long>()
    /** Algum provedor já falhou nesta call (aí "reserva sem versão no app" não é a resposta final). */
    private var anyFailed = false

    private val ownEvents = object : MediasoupEngine.Events {
        private fun on(block: (Int) -> Unit) {
            main.post { if (usingOwn && _state.value.channelName != null) block(session) }
        }
        override fun onConnected() = on { onMediaConnected(it, PROVIDER_OWN) }
        override fun onReconnecting(attempt: Int) = on { s ->
            _state.update { it.copy(status = CallStatus.Reconnecting) }
            // Rede de segurança: se a reconexão do próprio engine travar, troca de provedor.
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
                    // A equipe mexeu na cadeia: confere o provedor na hora.
                    "voice:provider-changed" -> main.post { scope.launch(Dispatchers.Main.immediate) { swapCheck(session) } }
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

    fun userIdOf(uid: Int): String? = uidToUser[uid]
    fun uidOf(userId: String): Int? = uidToUser.entries.firstOrNull { it.value == userId }?.key

    // ---------------- Agora ----------------

    private val handler = object : IRtcEngineEventHandler() {
        private fun on(block: (Int) -> Unit) {
            val s = agoraSession
            main.post { if (session == s && _state.value.provider == PROVIDER_AGORA) block(s) }
        }

        override fun onJoinChannelSuccess(channel: String?, uid: Int, elapsed: Int) = on { onMediaConnected(it, PROVIDER_AGORA) }

        override fun onRejoinChannelSuccess(channel: String?, uid: Int, elapsed: Int) = on {
            watchdog?.cancel()
            _state.update { st -> st.copy(status = CallStatus.Connected) }
        }

        override fun onConnectionStateChanged(state: Int, reason: Int) = on { s ->
            when (state) {
                Constants.CONNECTION_STATE_RECONNECTING -> {
                    _state.update { it.copy(status = CallStatus.Reconnecting) }
                    // A Agora tenta sozinha por muito tempo; passou disto, troca de provedor.
                    armWatchdog(s, PROVIDER_AGORA, AGORA_RECONNECT_TIMEOUT_MS)
                }
                Constants.CONNECTION_STATE_CONNECTED -> {
                    watchdog?.cancel()
                    if (_state.value.status != CallStatus.Connecting) _state.update { it.copy(status = CallStatus.Connected) }
                }
                // Motivo vem da Agora (ex.: 8 = token inválido, 6 = App ID inválido,
                // 3 = recusado pelo servidor): pede o próximo provedor ao servidor.
                Constants.CONNECTION_STATE_FAILED -> providerFailed(s, PROVIDER_AGORA, "conexão falhou (motivo $reason)")
                else -> Unit
            }
        }

        override fun onUserJoined(uid: Int, elapsed: Int) {
            val info = UserInfo()
            if (engine?.getUserInfoByUid(uid, info) == 0 && !info.userAccount.isNullOrEmpty()) uidToUser[uid] = info.userAccount
        }

        override fun onUserInfoUpdated(uid: Int, userInfo: UserInfo?) {
            userInfo?.userAccount?.takeIf { it.isNotEmpty() }?.let { uidToUser[uid] = it }
            main.post { applyVolumes() }
        }

        override fun onUserOffline(uid: Int, reason: Int) {
            val user = uidToUser[uid] ?: return
            _state.update { it.copy(remoteVideo = it.remoteVideo - user, speaking = it.speaking - user) }
        }

        override fun onRemoteVideoStateChanged(uid: Int, state: Int, reason: Int, elapsed: Int) {
            val user = uidToUser[uid] ?: run {
                val info = UserInfo()
                if (engine?.getUserInfoByUid(uid, info) == 0 && !info.userAccount.isNullOrEmpty()) { uidToUser[uid] = info.userAccount; info.userAccount } else null
            } ?: return
            val on = state == Constants.REMOTE_VIDEO_STATE_DECODING || state == Constants.REMOTE_VIDEO_STATE_STARTING
            val off = state == Constants.REMOTE_VIDEO_STATE_STOPPED || state == Constants.REMOTE_VIDEO_STATE_FAILED
            if (on) _state.update { it.copy(remoteVideo = it.remoteVideo + user) }
            if (off) _state.update { it.copy(remoteVideo = it.remoteVideo - user) }
        }

        override fun onAudioVolumeIndication(speakers: Array<out IRtcEngineEventHandler.AudioVolumeInfo>?, totalVolume: Int) {
            val now = speakers.orEmpty().filter { it.volume > 12 }.mapNotNull { s -> if (s.uid == 0) "me" else uidToUser[s.uid] }.toSet()
            if (now != _state.value.speaking) _state.update { it.copy(speaking = now) }
        }

        override fun onTokenPrivilegeWillExpire(token: String?) {
            val ch = _state.value.channelName ?: return
            scope.launch {
                runCatching { repo.voiceJoin(ch, listOf(PROVIDER_AGORA)).agora?.token }.getOrNull()?.let { t -> runCatching { engine?.renewToken(t) } }
            }
        }

        override fun onError(err: Int) {
            Log.w(TAG, "erro da Agora: $err")
            if (err == Constants.ERR_INVALID_TOKEN || err == Constants.ERR_TOKEN_EXPIRED || err == Constants.ERR_INVALID_APP_ID) {
                on { s -> providerFailed(s, PROVIDER_AGORA, "erro $err") }
            }
        }
    }

    private fun ensureEngine(appId: String): RtcEngine {
        engine?.let { if (engineAppId == appId) return it else { runCatching { RtcEngine.destroy() }; engine = null } }
        // NADA de `context` dentro de um apply {} do RtcEngineConfig: ver appContext.
        val cfg = RtcEngineConfig()
        cfg.mContext = appContext
        cfg.mAppId = appId
        cfg.mEventHandler = handler
        cfg.mChannelProfile = Constants.CHANNEL_PROFILE_COMMUNICATION
        cfg.mAudioScenario = Constants.AUDIO_SCENARIO_CHATROOM
        val e = RtcEngine.create(cfg) ?: error("a Agora não iniciou")
        e.enableAudio()
        e.enableVideo() // só pra RECEBER telas compartilhadas; a câmera não é publicada
        e.setDefaultAudioRoutetoSpeakerphone(true)
        e.enableAudioVolumeIndication(400, 3, true)
        engine = e
        engineAppId = appId
        return e
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
        failedAt.clear()
        anyFailed = false
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

    /** Provedores que este aparelho sabe usar e que não falharam há pouco nesta call. */
    private fun readyProviders(): List<String> {
        val now = System.currentTimeMillis()
        return SUPPORTED.filter { p -> failedAt[p]?.let { now - it < FAIL_COOLDOWN_MS } != true }
    }

    /**
     * Pergunta ao servidor qual provedor usar e entra nele. Erro de rede ou
     * deploy (502/503/504): espera e tenta de novo, sem mensagem assustadora.
     */
    private suspend fun connect(s: Int) {
        var netTries = 0
        var rounds = 0
        while (session == s) {
            val ch = _state.value.channelName ?: return
            val ready = readyProviders()
            if (ready.isEmpty()) {
                // Todos falharam: espera um pouco e recomeça a cadeia inteira.
                rounds++
                if (rounds > MAX_ROUNDS) { fail(s, "Não deu pra conectar na chamada agora. Tente de novo em instantes."); return }
                failedAt.clear()
                delay(3_000L * rounds)
                continue
            }
            val res = try {
                repo.voiceJoin(ch, ready + "jitsi")
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
            when (startProvider(s, ch, res)) {
                Start.Started -> return
                Start.Failed -> continue // já marcou o que falhou: pede o próximo
                Start.Unsupported -> {
                    if (!anyFailed) {
                        // Provedor reserva (Jitsi) ainda não tem versão nativa: abre pelo site.
                        stopMedia()
                        _state.update { it.copy(status = CallStatus.Unsupported, provider = res.provider) }
                        runCatching { CallService.stop(appContext) }
                        return
                    }
                    // Chegou na reserva porque os outros falharam: recomeça a cadeia daqui a pouco.
                    rounds++
                    if (rounds > MAX_ROUNDS) { fail(s, "Não deu pra conectar na chamada agora. Tente de novo em instantes."); return }
                    failedAt.clear()
                    delay(3_000L * rounds)
                }
            }
        }
    }

    private enum class Start { Started, Failed, Unsupported }

    private fun startProvider(s: Int, ch: String, res: VoiceJoinResponse): Start {
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
            PROVIDER_AGORA -> {
                val creds = res.agora ?: if (res.token != null && res.appId != null) AgoraCreds(res.token, res.appId) else null
                if (creds == null || myId == null) { markFailed(PROVIDER_AGORA, "credenciais incompletas"); return Start.Failed }
                stopMedia()
                _state.update { it.copy(provider = PROVIDER_AGORA, status = if (it.status == CallStatus.Connected) CallStatus.Reconnecting else it.status) }
                val e = try { ensureEngine(creds.appId) } catch (t: Throwable) {
                    Log.w(TAG, "Agora não iniciou", t)
                    markFailed(PROVIDER_AGORA, "motor não iniciou: ${t.message ?: t.javaClass.simpleName}")
                    return Start.Failed
                }
                val speak = !st.listenOnly && hasMic()
                agoraSession = s
                val code = runCatching {
                    e.enableLocalAudio(speak)
                    e.muteLocalAudioStream(st.muted || st.deafened)
                    e.muteAllRemoteAudioStreams(st.deafened)
                    e.joinChannelWithUserAccount(creds.token, ch, myId, ChannelMediaOptions().apply {
                        channelProfile = Constants.CHANNEL_PROFILE_COMMUNICATION
                        clientRoleType = Constants.CLIENT_ROLE_BROADCASTER
                        publishMicrophoneTrack = speak
                        publishCameraTrack = false
                        autoSubscribeAudio = true
                        autoSubscribeVideo = true
                    })
                }.getOrElse { -1 }
                if (code < 0) { markFailed(PROVIDER_AGORA, "join devolveu $code"); return Start.Failed }
                armWatchdog(s, PROVIDER_AGORA, AGORA_CONNECT_TIMEOUT_MS)
                Start.Started
            }
            else -> Start.Unsupported
        }
    }

    /** A mídia conectou (primeira vez, reconexão ou troca de provedor). */
    private fun onMediaConnected(s: Int, provider: String) {
        if (session != s || _state.value.provider != provider) return
        watchdog?.cancel()
        _state.update { it.copy(status = CallStatus.Connected) }
        _state.value.channelName?.let { repo.realtime.emit("voice:join", JSONObject().put("channelId", it)) }
        if (provider == PROVIDER_AGORA) runCatching { engine?.setEnableSpeakerphone(_state.value.speakerOn) }
        sendState()
        startSync()
        startSwapCheck(s)
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
        failedAt[provider] = System.currentTimeMillis()
        anyFailed = true
        repo.report(if (provider == PROVIDER_AGORA) "voz:agora" else "voz:$provider", IllegalStateException("$provider: $why (trocando de provedor)"))
    }

    /** O provedor atual não serve: desliga ele e pede o próximo ao servidor. */
    private fun providerFailed(s: Int, provider: String, why: String) {
        if (session != s || _state.value.provider != provider) return
        markFailed(provider, why)
        restartConnect(s)
    }

    /** Mesmo provedor, credenciais novas (ex.: token do servidor próprio venceu). */
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

    /** Desliga a mídia de qualquer provedor (a call em si continua). */
    private fun stopMedia() {
        watchdog?.cancel()
        if (_state.value.sharingScreen) {
            projection?.let { p -> runCatching { p.stop() } }
            projection = null
            _state.update { it.copy(sharingScreen = false) }
            runCatching { CallService.screenStopped(appContext) }
        }
        own?.leave()
        engine?.let { e -> runCatching { e.stopScreenCapture() }; runCatching { e.leaveChannel() } }
        audio.stop()
        uidToUser.clear()
    }

    private fun fail(s: Int, message: String) {
        if (session != s) return
        session++
        stopMedia()
        syncJob?.cancel(); swapJob?.cancel(); watchdog?.cancel()
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

    // ---------------- troca de provedor no meio da call ----------------

    private var swapSession = -1

    private fun startSwapCheck(s: Int) {
        if (swapJob?.isActive == true && swapSession == s) return
        swapJob?.cancel()
        swapSession = s
        swapJob = scope.launch(Dispatchers.Main.immediate) {
            while (isActive && session == s) {
                delay(SWAP_POLL_MS)
                swapCheck(s)
            }
        }
    }

    /**
     * A sala mudou de provedor (a equipe trocou a cadeia ou alguém entrou por
     * outro após uma falha)? Então este aparelho também troca — pra todo
     * mundo da call terminar no MESMO provedor (igual ao site).
     */
    private suspend fun swapCheck(s: Int) {
        val st = _state.value
        val ch = st.channelName ?: return
        val current = st.provider ?: return
        if (session != s || st.status != CallStatus.Connected || swapping) return
        val res = try { repo.voiceJoin(ch, readyProviders() + "jitsi") } catch (e: CancellationException) { throw e } catch (_: Exception) { return }
        val now = _state.value
        if (session != s || now.provider != current || now.status != CallStatus.Connected) return
        if (res.provider == current || res.provider !in SUPPORTED) return
        Log.i(TAG, "a sala trocou de provedor: $current → ${res.provider}")
        swapping = true
        try {
            if (startProvider(s, ch, res) != Start.Started) restartConnect(s)
        } finally { swapping = false }
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
            else engine?.let { e ->
                runCatching {
                    e.enableLocalAudio(true)
                    e.updateChannelMediaOptions(ChannelMediaOptions().apply { publishMicrophoneTrack = true })
                }
            }
        }
        val muted = !_state.value.muted
        if (usingOwn) own?.setMuted(muted || _state.value.deafened)
        else engine?.let { e -> runCatching { e.muteLocalAudioStream(muted || _state.value.deafened) } }
        _state.update { it.copy(muted = muted) }
        sendState()
    }

    fun toggleDeafen() {
        val deaf = !_state.value.deafened
        if (usingOwn) { own?.setDeafened(deaf); own?.setMuted(deaf || _state.value.muted) }
        else engine?.let { e ->
            runCatching {
                e.muteAllRemoteAudioStreams(deaf)
                e.muteLocalAudioStream(deaf || _state.value.muted)
            }
        }
        _state.update { it.copy(deafened = deaf) }
        sendState()
    }

    fun toggleSpeaker() {
        val on = !_state.value.speakerOn
        if (usingOwn) audio.setSpeaker(on) else engine?.let { e -> runCatching { e.setEnableSpeakerphone(on) } }
        _state.update { it.copy(speakerOn = on) }
    }

    /** Recebe a autorização de captura (pedida na tela) já dentro do serviço. */
    fun startScreenShare(mp: MediaProjection) {
        if (_state.value.status == CallStatus.Idle) { runCatching { mp.stop() }; return }
        if (usingOwn) {
            val o = own ?: run { mp.stop(); return }
            projection?.stop()
            projection = mp
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
            return
        }
        val e = engine ?: run { mp.stop(); return }
        projection?.stop()
        projection = mp
        // Android 14+: precisa de um callback registrado antes de capturar.
        mp.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() { main.post { if (_state.value.sharingScreen) stopScreenShare() } }
        }, main)
        val code = runCatching {
            e.setExternalMediaProjection(mp)
            val params = ScreenCaptureParameters().apply {
                captureVideo = true
                captureAudio = false
                videoCaptureParameters.width = 720
                videoCaptureParameters.height = 1280
                videoCaptureParameters.framerate = 15
                videoCaptureParameters.bitrate = 1600
            }
            e.startScreenCapture(params)
        }.getOrElse { -1 }
        if (code < 0) {
            _state.update { it.copy(error = "Não deu pra compartilhar a tela (código $code).") }
            runCatching { mp.stop() }; projection = null
            runCatching { CallService.screenStopped(appContext) }
            return
        }
        runCatching {
            e.updateChannelMediaOptions(ChannelMediaOptions().apply {
                publishScreenCaptureVideo = true
                publishScreenCaptureAudio = false
                publishCameraTrack = false
                publishMicrophoneTrack = !_state.value.listenOnly && hasMic()
            })
        }
        _state.update { it.copy(sharingScreen = true, error = null) }
        sendState()
    }

    fun stopScreenShare() {
        if (usingOwn) own?.stopScreen()
        else engine?.let { e ->
            runCatching {
                e.stopScreenCapture()
                e.updateChannelMediaOptions(ChannelMediaOptions().apply { publishScreenCaptureVideo = false })
            }
        }
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
    fun bindRemoteVideo(view: SurfaceView, userId: String): Boolean {
        if (usingOwn) return own?.bindRemoteVideo(view, userId) ?: false
        val uid = uidOf(userId) ?: return false
        engine?.setupRemoteVideo(VideoCanvas(view, VideoCanvas.RENDER_MODE_FIT, uid)) ?: return false
        return true
    }

    fun unbindRemoteVideo(userId: String) {
        if (usingOwn) { own?.unbindRemoteVideo(userId); return }
        val uid = uidOf(userId) ?: return
        runCatching { engine?.setupRemoteVideo(VideoCanvas(null, VideoCanvas.RENDER_MODE_FIT, uid)) }
    }

    fun leave(notifyServer: Boolean = true) {
        if (Looper.myLooper() != Looper.getMainLooper()) { main.post { leave(notifyServer) }; return }
        session++
        connectJob?.cancel(); swapJob?.cancel(); watchdog?.cancel(); syncJob?.cancel()
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

    /** Aplica os volumes guardados no motor que estiver em uso. */
    private fun applyVolumes() {
        if (usingOwn) { own?.applyVolumes(); return }
        val e = engine ?: return
        runCatching { e.adjustPlaybackSignalVolume(prefs.outputVolume.coerceIn(0, 400)) }
        uidToUser.forEach { (uid, userId) -> runCatching { e.adjustUserPlaybackSignalVolume(uid, prefs.userVolume(userId).coerceIn(0, 100)) } }
    }

    init { prefs.onChange { main.post { applyVolumes() } } }

    private companion object {
        const val TAG = "PCVoz"
        const val PROVIDER_OWN = "projectclub"
        const val PROVIDER_AGORA = "agora"
        /** Provedores com versão nativa no app, na ordem da cadeia do servidor. */
        val SUPPORTED = listOf(PROVIDER_OWN, PROVIDER_AGORA)
        /** Tempo pra cada provedor conectar antes de pedir o próximo. */
        const val OWN_CONNECT_TIMEOUT_MS = 20_000L
        const val AGORA_CONNECT_TIMEOUT_MS = 15_000L
        const val AGORA_RECONNECT_TIMEOUT_MS = 30_000L
        const val OWN_RECONNECT_TIMEOUT_MS = 90_000L
        /** Um provedor que falhou fica de fora por este tempo (depois pode voltar). */
        const val FAIL_COOLDOWN_MS = 5 * 60_000L
        /** Voltas completas na cadeia antes de desistir. */
        const val MAX_ROUNDS = 3
        val JOIN_RETRY_DELAYS_MS = longArrayOf(1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 30_000, 30_000)
        const val SWAP_POLL_MS = 60_000L
    }
}
