package com.projectclub.android.voice

import android.app.Application
import android.content.Context
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.AudioManager
import android.media.projection.MediaProjection
import android.util.Log
import android.view.Surface
import android.view.SurfaceView
import io.github.crow_misia.mediasoup.Consumer
import io.github.crow_misia.mediasoup.Device
import io.github.crow_misia.mediasoup.Producer
import io.github.crow_misia.mediasoup.RecvTransport
import io.github.crow_misia.mediasoup.SendTransport
import io.github.crow_misia.mediasoup.Transport
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.AudioTrack
import org.webrtc.CapturerObserver
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.MediaConstraints
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpParameters
import org.webrtc.SurfaceTextureHelper
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoCapturer
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import org.webrtc.audio.JavaAudioDeviceModule
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Credenciais do servidor de mídia PRÓPRIO do Project Club (media-server/). */
data class OwnMediaCreds(
    val url: String,
    val token: String,
    val iceServers: List<PeerConnection.IceServer>,
)

/**
 * Chamadas pelo servidor de mídia próprio (SFU mediasoup no VPS do Project
 * Club) — o mesmo que o site usa, então o celular entra na MESMA sala que o
 * PC. Mesmo protocolo de sinalização do engine do site
 * (client/src/voice/mediasoupEngine.js): { id, method, data } ↔ { id, ok, data }
 * e eventos { event, data }.
 *
 * Tudo do mediasoup roda numa thread só (o libmediasoupclient exige); os
 * callbacks onConnect/onProduce bloqueiam essa thread esperando a resposta
 * do servidor (é assim que a biblioteca funciona).
 */
class MediasoupEngine(private val context: Context, private val events: Events) {
    interface Events {
        fun onConnected()
        fun onFailed(message: String)
        fun onLeft()
        fun onSpeaking(userIds: Set<String>)
        fun onRemoteVideo(userIds: Set<String>)
    }

    private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "pc-mediasoup") }
    // Nada que der errado aqui pode derrubar o app: qualquer erro (inclusive
    // Error do código nativo, ex.: UnsatisfiedLinkError) vira aviso na tela.
    private val crashGuard = CoroutineExceptionHandler { _, t ->
        Log.e(TAG, "erro na chamada", t)
        if (!closed) events.onFailed("Erro na chamada: ${t.message ?: t.javaClass.simpleName}")
    }
    private val scope = CoroutineScope(SupervisorJob() + worker.asCoroutineDispatcher() + crashGuard)
    private val http = OkHttpClient.Builder().pingInterval(20, TimeUnit.SECONDS).readTimeout(0, TimeUnit.MILLISECONDS).build()

    private var ws: WebSocket? = null
    private val seq = AtomicInteger(0)
    private val pending = ConcurrentHashMap<Int, CompletableDeferred<JSONObject>>()
    private var welcome = CompletableDeferred<JSONObject>()

    private var egl: EglBase? = null
    private var adm: JavaAudioDeviceModule? = null
    private var factory: PeerConnectionFactory? = null
    private var device: Device? = null
    private var send: SendTransport? = null
    private var recv: RecvTransport? = null
    private var rtcConfig: PeerConnection.RTCConfiguration? = null

    private var micSource: org.webrtc.AudioSource? = null
    private var micTrack: AudioTrack? = null
    private var micProducer: Producer? = null
    private var screenProducer: Producer? = null
    private var screenSource: VideoSource? = null
    private var screenTrack: VideoTrack? = null
    private var screenCapturer: ProjectionCapturer? = null
    private var screenHelper: SurfaceTextureHelper? = null

    /** consumerId → consumidor (com dono e origem). */
    private class Remote(val consumer: Consumer, val peerId: String, val source: String)
    private val consumers = ConcurrentHashMap<String, Remote>()
    private val sinks = ConcurrentHashMap<String, SurfaceViewRenderer>()

    @Volatile private var closed = false
    private var myId = ""

    // ---------------- sinalização ----------------

    private fun request(method: String, data: JSONObject = JSONObject()): JSONObject = runBlocking {
        val id = seq.incrementAndGet()
        val d = CompletableDeferred<JSONObject>()
        pending[id] = d
        val sent = ws?.send(JSONObject().put("id", id).put("method", method).put("data", data).toString()) ?: false
        if (!sent) { pending.remove(id); error("sinalização desconectada") }
        try { withTimeout(15_000) { d.await() } } finally { pending.remove(id) }
    }

    private val listener = object : WebSocketListener() {
        override fun onMessage(webSocket: WebSocket, text: String) {
            val msg = runCatching { JSONObject(text) }.getOrNull() ?: return
            if (msg.has("id") && !msg.isNull("id")) {
                val d = pending.remove(msg.optInt("id")) ?: return
                if (msg.optBoolean("ok")) d.complete(msg.optJSONObject("data") ?: JSONObject())
                else d.completeExceptionally(IllegalStateException(msg.optString("error", "erro")))
                return
            }
            val event = msg.optString("event")
            val data = msg.optJSONObject("data") ?: JSONObject()
            if (event == "welcome") { welcome.complete(data); return }
            scope.launch { onEvent(event, data) }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            if (!welcome.isCompleted) welcome.completeExceptionally(t)
            failAll(t)
            if (!closed) events.onFailed("A conexão com o servidor de voz caiu.")
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (!welcome.isCompleted) welcome.completeExceptionally(IllegalStateException("recusado ($code)"))
            failAll(IllegalStateException("fechado"))
            if (!closed) events.onLeft()
        }
    }

    private fun failAll(t: Throwable) {
        pending.values.forEach { it.completeExceptionally(t) }
        pending.clear()
    }

    // ---------------- entrar ----------------

    fun join(creds: OwnMediaCreds, userId: String, startMuted: Boolean) {
        myId = userId
        closed = false
        deafened = false
        scope.launch {
            try {
                doJoin(creds, startMuted)
                events.onConnected()
            } catch (e: Throwable) {
                Log.w(TAG, "falha ao entrar", e)
                if (!closed) events.onFailed("Não deu pra entrar na chamada: ${e.message ?: "erro"}")
            }
        }
    }

    private fun doJoin(creds: OwnMediaCreds, startMuted: Boolean) {
        ensureFactory()
        val sep = if (creds.url.contains("?")) "&" else "?"
        welcome = CompletableDeferred()
        ws = http.newWebSocket(Request.Builder().url("${creds.url}${sep}token=${URLEncoder.encode(creds.token, "UTF-8")}").build(), listener)
        val w = runBlocking { withTimeout(15_000) { welcome.await() } }

        rtcConfig = PeerConnection.RTCConfiguration(creds.iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }
        val dev = Device(factory!!)
        dev.load(w.getJSONObject("routerRtpCapabilities").toString(), rtcConfig)
        device = dev

        send = createSend(dev)
        recv = createRecv(dev)

        // Microfone (se entrou mudo, publica pausado — desmutar é instantâneo).
        val src = factory!!.createAudioSource(MediaConstraints())
        micSource = src
        val track = factory!!.createAudioTrack("mic", src)
        micTrack = track
        micProducer = send!!.produce(
            object : Producer.Listener { override fun onTransportClose(producer: Producer) {} },
            track, emptyList(), "{\"opusStereo\":false,\"opusDtx\":true,\"opusFec\":true}", null, "{\"source\":\"mic\"}",
        )
        if (startMuted) setMuted(true)

        // O que os outros já publicavam.
        val producers = w.optJSONArray("producers") ?: JSONArray()
        for (i in 0 until producers.length()) runCatching { consume(producers.getJSONObject(i)) }.onFailure { Log.w(TAG, "consume", it) }
    }

    private fun createSend(dev: Device): SendTransport {
        val info = request("createTransport", JSONObject().put("direction", "send"))
        return dev.createSendTransport(
            object : SendTransport.Listener {
                override fun onConnect(transport: Transport, dtlsParameters: String) {
                    request("connectTransport", JSONObject().put("transportId", transport.id).put("dtlsParameters", JSONObject(dtlsParameters)))
                }
                override fun onConnectionStateChange(transport: Transport, newState: String) {
                    if (newState == "failed" && !closed) events.onFailed("A conexão de envio da chamada falhou.")
                }
                override fun onProduce(transport: Transport, kind: String, rtpParameters: String, appData: String?): String {
                    val r = request("produce", JSONObject().put("transportId", transport.id).put("kind", kind)
                        .put("rtpParameters", JSONObject(rtpParameters)).put("appData", appData?.let { JSONObject(it) } ?: JSONObject()))
                    return r.getString("producerId")
                }
                override fun onProduceData(transport: Transport, sctpStreamParameters: String, label: String, protocol: String, appData: String?): String = ""
            },
            info.getString("id"), info.getJSONObject("iceParameters").toString(), info.getJSONArray("iceCandidates").toString(),
            info.getJSONObject("dtlsParameters").toString(), null, rtcConfig,
        )
    }

    private fun createRecv(dev: Device): RecvTransport {
        val info = request("createTransport", JSONObject().put("direction", "recv"))
        return dev.createRecvTransport(
            object : RecvTransport.Listener {
                override fun onConnect(transport: Transport, dtlsParameters: String) {
                    request("connectTransport", JSONObject().put("transportId", transport.id).put("dtlsParameters", JSONObject(dtlsParameters)))
                }
                override fun onConnectionStateChange(transport: Transport, newState: String) {
                    if (newState == "failed" && !closed) events.onFailed("A conexão de recepção da chamada falhou.")
                }
            },
            info.getString("id"), info.getJSONObject("iceParameters").toString(), info.getJSONArray("iceCandidates").toString(),
            info.getJSONObject("dtlsParameters").toString(), null, rtcConfig,
        )
    }

    private fun consume(p: JSONObject) {
        val rt = recv ?: return
        val dev = device ?: return
        val info = request("consume", JSONObject().put("transportId", rt.id).put("producerId", p.getString("producerId"))
            .put("rtpCapabilities", JSONObject(dev.rtpCapabilities)))
        val appData = info.optJSONObject("appData") ?: p.optJSONObject("appData") ?: JSONObject()
        val kind = info.getString("kind")
        val consumer = rt.consume(
            object : Consumer.Listener { override fun onTransportClose(consumer: Consumer) {} },
            info.getString("consumerId"), info.getString("producerId"), kind,
            info.getJSONObject("rtpParameters").toString(), appData.toString(),
        )
        val peer = info.optString("peerId", p.optString("peerId"))
        val source = appData.optString("source", if (kind == "audio") "mic" else "camera")
        consumers[consumer.id] = Remote(consumer, peer, source)
        if (kind == "audio") (consumer.track as? AudioTrack)?.setEnabled(!deafened)
        else { sinks[peer]?.let { s -> (consumer.track as? VideoTrack)?.addSink(s) }; publishVideo() }
        request("resumeConsumer", JSONObject().put("consumerId", consumer.id))
    }

    private fun onEvent(event: String, data: JSONObject) {
        when (event) {
            "newProducer" -> runCatching { consume(data) }.onFailure { Log.w(TAG, "consume", it) }
            "consumerClosed", "producerClosed" -> {
                val byConsumer = data.optString("consumerId").takeIf { it.isNotEmpty() }
                val byProducer = data.optString("producerId").takeIf { it.isNotEmpty() }
                consumers.entries.filter { (id, r) -> id == byConsumer || r.consumer.producerId == byProducer }.forEach { (id, r) ->
                    runCatching { r.consumer.close() }
                    consumers.remove(id)
                }
                publishVideo()
            }
            "peerLeft" -> {
                val peer = data.optString("peerId")
                consumers.entries.filter { it.value.peerId == peer }.forEach { (id, r) -> runCatching { r.consumer.close() }; consumers.remove(id) }
                publishVideo()
            }
            "activeSpeakers" -> {
                val arr = data.optJSONArray("peerIds") ?: JSONArray()
                val ids = (0 until arr.length()).map { arr.getString(it) }.map { if (it == myId) "me" else it }.toSet()
                events.onSpeaking(ids)
            }
            "kicked" -> { closed = true; events.onLeft() }
        }
    }

    private fun publishVideo() {
        events.onRemoteVideo(consumers.values.filter { it.consumer.kind == "video" }.map { it.peerId }.toSet())
    }

    // ---------------- controles ----------------

    private var deafened = false

    fun setMuted(muted: Boolean) = scope.launch {
        val p = micProducer ?: return@launch
        runCatching {
            if (muted) { p.pause(); request("pauseProducer", JSONObject().put("producerId", p.id)) }
            else { p.resume(); request("resumeProducer", JSONObject().put("producerId", p.id)) }
        }
    }

    fun setDeafened(deaf: Boolean) = scope.launch {
        deafened = deaf
        consumers.values.filter { it.consumer.kind == "audio" }.forEach { (it.consumer.track as? AudioTrack)?.setEnabled(!deaf) }
    }

    fun setSpeaker(on: Boolean) {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        @Suppress("DEPRECATION") run { am.isSpeakerphoneOn = on }
    }

    fun startScreen(mp: MediaProjection, onError: (String) -> Unit) = scope.launch {
        try {
            val f = factory ?: error("sem chamada")
            val st = send ?: error("sem chamada")
            stopScreenNow()
            val helper = SurfaceTextureHelper.create("pc-tela", egl!!.eglBaseContext)
            val source = f.createVideoSource(true)
            val cap = ProjectionCapturer(mp)
            cap.initialize(helper, context, source.capturerObserver)
            val dm = context.resources.displayMetrics
            val scale = 1280f / maxOf(dm.widthPixels, dm.heightPixels)
            val w = (dm.widthPixels * scale).toInt() and 1.inv()
            val h = (dm.heightPixels * scale).toInt() and 1.inv()
            cap.startCapture(w, h, 15)
            val track = f.createVideoTrack("screen", source)
            val enc = RtpParameters.Encoding(null, true, 1.0).apply { maxBitrateBps = 2_500_000 }
            screenProducer = st.produce(
                object : Producer.Listener { override fun onTransportClose(producer: Producer) {} },
                track, listOf(enc), null, null, "{\"source\":\"screen\"}",
            )
            screenHelper = helper; screenSource = source; screenTrack = track; screenCapturer = cap
        } catch (e: Throwable) {
            Log.w(TAG, "tela", e)
            onError("Não deu pra compartilhar a tela: ${e.message ?: "erro"}")
        }
    }

    fun stopScreen() = scope.launch { stopScreenNow() }

    private fun stopScreenNow() {
        screenProducer?.let { p ->
            runCatching { request("closeProducer", JSONObject().put("producerId", p.id)) }
            runCatching { p.close() }
        }
        screenProducer = null
        runCatching { screenCapturer?.stopCapture() }
        runCatching { screenCapturer?.dispose() }
        runCatching { screenTrack?.dispose() }
        runCatching { screenSource?.dispose() }
        runCatching { screenHelper?.dispose() }
        screenCapturer = null; screenTrack = null; screenSource = null; screenHelper = null
    }

    // ---------------- vídeo remoto (tela de alguém) ----------------

    fun createVideoView(ctx: Context): SurfaceView = SurfaceViewRenderer(ctx).apply {
        init(ensureEgl().eglBaseContext, null)
        setScalingType(org.webrtc.RendererCommon.ScalingType.SCALE_ASPECT_FIT)
        setEnableHardwareScaler(true)
    }

    fun bindRemoteVideo(view: SurfaceView, userId: String): Boolean {
        val r = view as? SurfaceViewRenderer ?: return false
        sinks[userId] = r
        consumers.values.filter { it.peerId == userId && it.consumer.kind == "video" }
            .forEach { (it.consumer.track as? VideoTrack)?.addSink(r) }
        return true
    }

    fun unbindRemoteVideo(userId: String) {
        val r = sinks.remove(userId) ?: return
        consumers.values.filter { it.peerId == userId && it.consumer.kind == "video" }
            .forEach { runCatching { (it.consumer.track as? VideoTrack)?.removeSink(r) } }
        runCatching { r.release() }
    }

    // ---------------- sair ----------------

    fun leave() {
        closed = true
        scope.launch {
            runCatching { stopScreenNow() }
            runCatching { ws?.send(JSONObject().put("id", seq.incrementAndGet()).put("method", "leave").put("data", JSONObject()).toString()) }
            runCatching { ws?.close(1000, "leave") }
            consumers.values.forEach { runCatching { it.consumer.close() } }
            consumers.clear()
            runCatching { micProducer?.close() }
            runCatching { send?.close() }
            runCatching { recv?.close() }
            runCatching { micTrack?.dispose() }
            runCatching { micSource?.dispose() }
            runCatching { device?.dispose() }
            micProducer = null; send = null; recv = null; device = null; micTrack = null; micSource = null
            // A fábrica/EGL ficam pra próxima chamada (criar de novo é caro).
        }
    }

    // ---------------- WebRTC ----------------

    private fun ensureEgl(): EglBase = egl ?: EglBase.create().also { egl = it }

    private fun ensureFactory() {
        if (factory != null) return
        initClient(context.applicationContext as Application)
        val e = ensureEgl()
        val a = JavaAudioDeviceModule.builder(context)
            .setUseHardwareAcousticEchoCanceler(true)
            .setUseHardwareNoiseSuppressor(true)
            .createAudioDeviceModule()
        adm = a
        factory = PeerConnectionFactory.builder()
            .setAudioDeviceModule(a)
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(e.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(e.eglBaseContext))
            .createPeerConnectionFactory()
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        am.mode = AudioManager.MODE_IN_COMMUNICATION
        @Suppress("DEPRECATION") run { am.isSpeakerphoneOn = true }
    }

    companion object {
        private const val TAG = "PCMidia"
        @Volatile private var initialized = false

        @Synchronized fun initClient(app: Application) {
            if (initialized) return
            // Inicializa o WebRTC que vem DENTRO do libmediasoup (mesma versão
            // do código nativo) — sem helpers de outras versões da biblioteca.
            PeerConnectionFactory.initialize(
                PeerConnectionFactory.InitializationOptions.builder(app)
                    .setNativeLibraryName("mediasoupclient_so")
                    .createInitializationOptions(),
            )
            initialized = true
        }

        /** Converte os servidores ICE da resposta do /api/voice/join. */
        fun iceServers(json: JSONArray?): List<PeerConnection.IceServer> {
            if (json == null) return emptyList()
            return (0 until json.length()).mapNotNull { i ->
                val o = json.optJSONObject(i) ?: return@mapNotNull null
                val urls = o.optJSONArray("urls")?.let { a -> (0 until a.length()).map { a.getString(it) } }
                    ?: listOfNotNull(o.optString("urls").takeIf { it.isNotBlank() })
                if (urls.isEmpty()) return@mapNotNull null
                PeerConnection.IceServer.builder(urls).apply {
                    o.optString("username").takeIf { it.isNotBlank() }?.let { setUsername(it) }
                    o.optString("credential").takeIf { it.isNotBlank() }?.let { setPassword(it) }
                }.createIceServer()
            }
        }
    }
}

/**
 * Captura de tela a partir de um MediaProjection JÁ obtido (no Android 14+
 * ele precisa ser pego dentro do serviço em primeiro plano — ver CallService).
 */
private class ProjectionCapturer(private val projection: MediaProjection) : VideoCapturer {
    private var helper: SurfaceTextureHelper? = null
    private var observer: CapturerObserver? = null
    private var context: Context? = null
    private var display: VirtualDisplay? = null
    private var surface: Surface? = null

    override fun initialize(helper: SurfaceTextureHelper, context: Context, observer: CapturerObserver) {
        this.helper = helper; this.context = context; this.observer = observer
    }

    override fun startCapture(width: Int, height: Int, framerate: Int) {
        val h = helper ?: return
        h.setTextureSize(width, height)
        val s = Surface(h.surfaceTexture)
        surface = s
        display = projection.createVirtualDisplay(
            "pc-tela", width, height, context!!.resources.displayMetrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, s, null, null,
        )
        observer?.onCapturerStarted(true)
        h.startListening { frame -> observer?.onFrameCaptured(frame) }
    }

    override fun stopCapture() {
        helper?.stopListening()
        display?.release(); display = null
        surface?.release(); surface = null
        observer?.onCapturerStopped()
    }

    override fun changeCaptureFormat(width: Int, height: Int, framerate: Int) {}
    override fun dispose() { runCatching { stopCapture() } }
    override fun isScreencast(): Boolean = true
}
