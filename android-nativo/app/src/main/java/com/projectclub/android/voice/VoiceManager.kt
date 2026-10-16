package com.projectclub.android.voice

import android.content.Context
import android.media.projection.MediaProjection
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.SurfaceView
import com.projectclub.android.data.Repository
import io.agora.rtc2.ChannelMediaOptions
import io.agora.rtc2.Constants
import io.agora.rtc2.IRtcEngineEventHandler
import io.agora.rtc2.RtcEngine
import io.agora.rtc2.RtcEngineConfig
import io.agora.rtc2.ScreenCaptureParameters
import io.agora.rtc2.UserInfo
import io.agora.rtc2.video.VideoCanvas
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
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
)

data class CallReaction(val id: Long, val userId: String, val emoji: String)

/** Os mesmos emojis rápidos do PC (o servidor só aceita estes). */
val QUICK_REACTIONS = listOf("👍", "❤️", "😂", "🎉", "😮")

/**
 * Chamadas de voz com o SDK NATIVO da Agora (o mesmo provedor que o site
 * usa em produção — então o celular entra na mesma call que o PC/site).
 * - Canal Agora = o mesmo channelName do servidor (id do canal, "dm:<id>"...).
 * - Usuário Agora = o id do usuário (string), igual ao site.
 * - Compartilhar tela = trilha de tela publicada no mesmo usuário; o roster
 *   do servidor (voice:state { screenSharing }) diz quem está compartilhando.
 */
class VoiceManager(private val context: Context, private val repo: Repository, private val scope: CoroutineScope) {
    private val _state = MutableStateFlow(CallState())
    val state: StateFlow<CallState> = _state

    private var engine: RtcEngine? = null
    /** Servidor de mídia PRÓPRIO (VPS do Project Club) — quando a cadeia escolhe "projectclub". */
    private var own: MediasoupEngine? = null
    private val usingOwn get() = _state.value.provider == "projectclub"
    private val ownEvents = object : MediasoupEngine.Events {
        override fun onConnected() {
            main.post {
                _state.update { it.copy(status = CallStatus.Connected, error = null) }
                _state.value.channelName?.let { repo.realtime.emit("voice:join", JSONObject().put("channelId", it)) }
                startSync()
            }
        }
        override fun onFailed(message: String) {
            main.post {
                reportFailure("próprio: $message")
                // Ainda entrando: tenta o próximo provedor da cadeia em vez de ficar mudo.
                if (_state.value.status == CallStatus.Connecting && failover("projectclub")) return@post
                _state.update { it.copy(error = message) }
            }
        }
        override fun onLeft() { main.post { if (usingOwn && _state.value.channelName != null) leave() } }
        override fun onSpeaking(userIds: Set<String>) { main.post { if (userIds != _state.value.speaking) _state.update { it.copy(speaking = userIds) } } }
        override fun onRemoteVideo(userIds: Set<String>) { main.post { _state.update { it.copy(remoteVideo = userIds) } } }
    }
    private var engineAppId: String? = null
    private var projection: MediaProjection? = null
    private var syncJob: Job? = null
    private val uidToUser = ConcurrentHashMap<Int, String>()
    private val main = Handler(Looper.getMainLooper())

    init {
        // Servidor confirmou a entrada: manda o estado real (mudo, tela...).
        scope.launch {
            repo.realtime.events.collect { e ->
                val ch = _state.value.channelName ?: return@collect
                when (e.name) {
                    "voice:joined" -> if (e.data.toString().contains(ch)) sendState()
                    "voice:kicked-by-other-device" -> if (e.data.toString().contains(ch)) leave(notifyServer = false)
                    "voice:reaction" -> {
                        val o = e.data as? kotlinx.serialization.json.JsonObject ?: return@collect
                        fun f(k: String) = (o[k] as? kotlinx.serialization.json.JsonPrimitive)?.content
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

    private val handler = object : IRtcEngineEventHandler() {
        override fun onJoinChannelSuccess(channel: String?, uid: Int, elapsed: Int) {
            _state.update { it.copy(status = CallStatus.Connected, error = null) }
            repo.realtime.emit("voice:join", JSONObject().put("channelId", channel))
            startSync()
        }

        override fun onRejoinChannelSuccess(channel: String?, uid: Int, elapsed: Int) {
            _state.update { it.copy(status = CallStatus.Connected) }
        }

        override fun onConnectionStateChanged(state: Int, reason: Int) {
            if (state == Constants.CONNECTION_STATE_RECONNECTING) _state.update { it.copy(status = CallStatus.Reconnecting) }
            if (state == Constants.CONNECTION_STATE_CONNECTED) _state.update { it.copy(status = CallStatus.Connected) }
            if (state == Constants.CONNECTION_STATE_FAILED) {
                // Motivo vem do Agora (ex.: 8 = token inválido, 6 = App ID inválido,
                // 3 = recusado pelo servidor). Manda pro log do servidor também.
                val credencial = reason == Constants.CONNECTION_CHANGED_INVALID_TOKEN ||
                    reason == Constants.CONNECTION_CHANGED_INVALID_APP_ID ||
                    reason == Constants.CONNECTION_CHANGED_TOKEN_EXPIRED ||
                    reason == Constants.CONNECTION_CHANGED_BANNED_BY_SERVER
                reportFailure("conexão falhou (motivo $reason)")
                if (_state.value.status != CallStatus.Connected && _state.value.provider == "agora") { main.post { failover("agora") }; return }
                _state.update {
                    it.copy(error = if (credencial) "O serviço de voz recusou a conexão (configuração do servidor de chamadas). A equipe já foi avisada."
                    else "A conexão da chamada caiu.")
                }
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
            scope.launch { runCatching { repo.voiceJoin(ch, listOf("agora")).agora?.token }.getOrNull()?.let { engine?.renewToken(it) } }
        }

        override fun onError(err: Int) {
            Log.w(TAG, "erro da Agora: $err")
            if (err == Constants.ERR_INVALID_TOKEN || err == Constants.ERR_TOKEN_EXPIRED || err == Constants.ERR_INVALID_APP_ID) {
                reportFailure("erro $err")
                if (_state.value.status == CallStatus.Connecting) { main.post { failover("agora") }; return }
                _state.update { it.copy(error = "O serviço de voz recusou a conexão (configuração do servidor de chamadas). A equipe já foi avisada.") }
            }
        }
    }

    private fun reportFailure(what: String) {
        repo.report("voz:agora", IllegalStateException("Agora: $what"))
    }

    private fun ensureEngine(appId: String): RtcEngine {
        engine?.let { if (engineAppId == appId) return it else { RtcEngine.destroy(); engine = null } }
        val cfg = RtcEngineConfig().apply {
            mContext = context.applicationContext
            mAppId = appId
            mEventHandler = handler
            mChannelProfile = Constants.CHANNEL_PROFILE_COMMUNICATION
            mAudioScenario = Constants.AUDIO_SCENARIO_CHATROOM
        }
        val e = RtcEngine.create(cfg)
        e.enableAudio()
        e.enableVideo() // só pra RECEBER telas compartilhadas; a câmera não é publicada
        e.setDefaultAudioRoutetoSpeakerphone(true)
        e.enableAudioVolumeIndication(400, 3, true)
        engine = e
        engineAppId = appId
        return e
    }

    /** Provedores que já falharam nesta entrada (não tenta de novo). */
    private val failedProviders = mutableSetOf<String>()

    /**
     * O provedor [failed] não conectou: tenta o próximo da cadeia (servidor
     * próprio ↔ Agora). Devolve false quando não sobrou nenhum pra tentar.
     */
    private fun failover(failed: String): Boolean {
        val s = _state.value
        val ch = s.channelName ?: return false
        failedProviders += failed
        val left = listOf("projectclub", "agora").filter { it !in failedProviders }
        if (left.isEmpty()) return false
        if (failed == "projectclub") own?.leave() else engine?.leaveChannel()
        scope.launch { connect(ch, s.title, left) }
        return true
    }

    /** Entra numa call (canal de voz ou "dm:<conversa>"). */
    suspend fun join(channelName: String, title: String) {
        val cur = _state.value
        if (cur.channelName == channelName && cur.status != CallStatus.Idle) return
        if (cur.channelName != null) leave()
        failedProviders.clear()
        connect(channelName, title, listOf("projectclub", "agora"))
    }

    private suspend fun connect(channelName: String, title: String, ready: List<String>) {
        _state.value = CallState(channelName = channelName, title = title, status = CallStatus.Connecting)
        val res = try { repo.voiceJoin(channelName, ready) } catch (e: Exception) {
            _state.value = CallState(error = e.message ?: "Não deu pra entrar na chamada."); return
        }
        if (res.provider == "projectclub" && res.projectclub != null) {
            val pc = res.projectclub
            val url = pc["url"]?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }
            val token = pc["token"]?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }
            val myId = repo.me.value?.id
            if (url != null && token != null && myId != null) {
                _state.update { it.copy(provider = "projectclub") }
                CallService.start(context, title)
                val ice = MediasoupEngine.iceServers(runCatching { org.json.JSONObject(pc.toString()).optJSONArray("iceServers") }.getOrNull())
                val e = own ?: MediasoupEngine(context, ownEvents).also { own = it }
                e.join(OwnMediaCreds(url, token, ice), myId, startMuted = false)
                return
            }
        }
        val creds = res.agora ?: if (res.provider == "agora" && res.token != null && res.appId != null)
            com.projectclub.android.data.AgoraCreds(res.token, res.appId) else null
        if (res.provider != "agora" || creds == null) {
            // Provedor reserva (Jitsi) ainda não tem versão nativa: abre pelo site.
            _state.value = CallState(channelName = channelName, title = title, status = CallStatus.Unsupported, provider = res.provider)
            return
        }
        val myId = repo.me.value?.id ?: return
        _state.update { it.copy(provider = "agora") }
        val e = ensureEngine(creds.appId)
        CallService.start(context, title)
        val opts = ChannelMediaOptions().apply {
            channelProfile = Constants.CHANNEL_PROFILE_COMMUNICATION
            clientRoleType = Constants.CLIENT_ROLE_BROADCASTER
            publishMicrophoneTrack = true
            publishCameraTrack = false
            autoSubscribeAudio = true
            autoSubscribeVideo = true
        }
        val code = e.joinChannelWithUserAccount(creds.token, channelName, myId, opts)
        if (code < 0) {
            reportFailure("join devolveu $code")
            if (failover("agora")) return
            CallService.stop(context)
            _state.value = CallState(error = "Não deu pra entrar na chamada (código $code).")
        }
    }

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
        val muted = !_state.value.muted
        if (usingOwn) own?.setMuted(muted || _state.value.deafened)
        else engine?.muteLocalAudioStream(muted || _state.value.deafened)
        _state.update { it.copy(muted = muted) }
        sendState()
    }

    fun toggleDeafen() {
        val deaf = !_state.value.deafened
        if (usingOwn) { own?.setDeafened(deaf); own?.setMuted(deaf || _state.value.muted) }
        else {
            engine?.muteAllRemoteAudioStreams(deaf)
            engine?.muteLocalAudioStream(deaf || _state.value.muted)
        }
        _state.update { it.copy(deafened = deaf) }
        sendState()
    }

    fun toggleSpeaker() {
        val on = !_state.value.speakerOn
        if (usingOwn) own?.setSpeaker(on) else engine?.setEnableSpeakerphone(on)
        _state.update { it.copy(speakerOn = on) }
    }

    /** Recebe a autorização de captura (pedida na tela) já dentro do serviço. */
    fun startScreenShare(mp: MediaProjection) {
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
                    CallService.screenStopped(context)
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
        e.setExternalMediaProjection(mp)
        val params = ScreenCaptureParameters().apply {
            captureVideo = true
            captureAudio = false
            videoCaptureParameters.width = 720
            videoCaptureParameters.height = 1280
            videoCaptureParameters.framerate = 15
            videoCaptureParameters.bitrate = 1600
        }
        val code = e.startScreenCapture(params)
        if (code < 0) {
            _state.update { it.copy(error = "Não deu pra compartilhar a tela (código $code).") }
            mp.stop(); projection = null
            CallService.screenStopped(context)
            return
        }
        e.updateChannelMediaOptions(ChannelMediaOptions().apply {
            publishScreenCaptureVideo = true
            publishScreenCaptureAudio = false
            publishCameraTrack = false
            publishMicrophoneTrack = true
        })
        _state.update { it.copy(sharingScreen = true, error = null) }
        sendState()
    }

    fun stopScreenShare() {
        if (usingOwn) own?.stopScreen()
        else engine?.let { e ->
            e.stopScreenCapture()
            e.updateChannelMediaOptions(ChannelMediaOptions().apply { publishScreenCaptureVideo = false })
        }
        projection?.stop()
        projection = null
        _state.update { it.copy(sharingScreen = false) }
        sendState()
        CallService.screenStopped(context)
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
        engine?.setupRemoteVideo(VideoCanvas(null, VideoCanvas.RENDER_MODE_FIT, uid))
    }

    fun leave(notifyServer: Boolean = true) {
        val ch = _state.value.channelName
        syncJob?.cancel()
        if (_state.value.sharingScreen) runCatching { stopScreenShare() }
        if (ch != null && notifyServer) repo.realtime.emit("voice:leave", JSONObject().put("channelId", ch))
        if (usingOwn) own?.leave() else engine?.leaveChannel()
        uidToUser.clear()
        _state.value = CallState()
        CallService.stop(context)
    }

    /** View pra mostrar a tela de alguém (o servidor próprio usa o renderizador do WebRTC). */
    fun createVideoView(ctx: Context): SurfaceView =
        if (usingOwn) own?.createVideoView(ctx) ?: SurfaceView(ctx) else SurfaceView(ctx)

    fun clearError() = _state.update { it.copy(error = null) }

    val prefs: VoicePrefs = VoicePrefs.get(context)

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

    private companion object { const val TAG = "PCVoz" }
}
