package com.projectclub.android.voice

import android.app.Application
import android.content.Context
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
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
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.delay
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

/** A sinalização fechou com um código (4401 = token recusado, 4409 = outro aparelho...). */
private class SignalClosed(val code: Int) : IllegalStateException("conexão com o servidor de voz recusada ($code)")

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
 *
 * Quedas (igual ao site, ver RECONNECT_DELAYS_MS):
 *  - transporte "disconnected" costuma voltar sozinho: espera um pouco;
 *  - continuou caído ou "failed": tenta um ICE restart (se o servidor
 *    suportar) e, se não voltar, refaz a sessão inteira com espera crescente;
 *  - sinalização caiu: refaz a sessão inteira com espera crescente;
 *  - 4409 (você entrou em outro aparelho): para e avisa, sem reconectar;
 *  - 4401 (token venceu) ou tentativas esgotadas: devolve pro VoiceManager,
 *    que pede credenciais novas / o próximo provedor ao servidor.
 */
class MediasoupEngine(private val context: Context, private val events: Events) {
    interface Events {
        fun onConnected()
        /** Caiu e está tentando voltar sozinho. */
        fun onReconnecting(attempt: Int)
        fun onReconnected()
        /**
         * Desistiu desta sessão. [providerBroken] = o servidor próprio não está
         * servindo agora (conta como falha e tenta de novo com espera); false = só precisa de
         * credenciais novas (token venceu).
         */
        fun onGaveUp(message: String, providerBroken: Boolean)
        /** Você entrou nesta call em outro aparelho (fechou com 4409). */
        fun onReplaced()
        /** O servidor tirou você da sala. */
        fun onLeft()
        /** Aviso que não derruba a chamada (ex.: tela não compartilhou). */
        fun onWarning(message: String)
        /** A transmissão de tela parou sozinha (queda/reconexão). */
        fun onScreenStopped()
        fun onSpeaking(userIds: Set<String>)
        fun onRemoteVideo(userIds: Set<String>)
    }

    private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "pc-mediasoup") }
    // Nada que der errado aqui pode derrubar o app: qualquer erro (inclusive
    // Error do código nativo, ex.: UnsatisfiedLinkError) vira aviso na tela.
    private val crashGuard = CoroutineExceptionHandler { _, t ->
        Log.e(TAG, "erro na chamada", t)
        if (!closed) events.onWarning("Erro na chamada: ${t.message ?: t.javaClass.simpleName}")
    }
    private val scope = CoroutineScope(SupervisorJob() + worker.asCoroutineDispatcher() + crashGuard)
    private val http = OkHttpClient.Builder()
        .pingInterval(15, TimeUnit.SECONDS)
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    @Volatile private var ws: WebSocket? = null
    private val seq = AtomicInteger(0)
    private val pending = ConcurrentHashMap<Int, CompletableDeferred<JSONObject>>()

    private var egl: EglBase? = null
    private var adm: JavaAudioDeviceModule? = null
    private var factory: PeerConnectionFactory? = null
    private var device: Device? = null
    @Volatile private var send: SendTransport? = null
    @Volatile private var recv: RecvTransport? = null
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
    private class Remote(val consumer: Consumer, val producerId: String, val peerId: String, val source: String, val kind: String)
    private val consumers = ConcurrentHashMap<String, Remote>()
    private val sinks = ConcurrentHashMap<String, SurfaceViewRenderer>()

    /** Cada join/leave muda a geração: callbacks de sessões antigas são ignorados. */
    @Volatile private var gen = 0
    @Volatile private var closed = true
    /** A sessão atual está de pé (transportes criados, mídia publicada). */
    @Volatile private var sessionUp = false
    private var creds: OwnMediaCreds? = null
    private var myId = ""
    @Volatile private var micMuted = false
    @Volatile private var listenOnly = false
    @Volatile private var deafened = false

    // Reconexão (só mexidos na thread do worker).
    /** Já passou mídia nesta chamada (algum transporte conectou). */
    @Volatile private var mediaUp = false
    private var reconnectAttempt = 0
    private var reconnectJob: Job? = null
    private var disconnectedJob: Job? = null
    private var iceRestarts = 0
    /** O servidor de mídia sabe fazer "restartIce"? (o atual ainda não: cai na reconexão completa). */
    private var iceRestartSupported = true

    // ---------------- sinalização ----------------

    private fun request(method: String, data: JSONObject = JSONObject()): JSONObject = runBlocking {
        val id = seq.incrementAndGet()
        val d = CompletableDeferred<JSONObject>()
        pending[id] = d
        val sent = ws?.send(JSONObject().put("id", id).put("method", method).put("data", data).toString()) ?: false
        if (!sent) { pending.remove(id); throw IllegalStateException("sinalização desconectada") }
        try {
            withTimeout(15_000) { d.await() }
        } catch (e: TimeoutCancellationException) {
            // Vira erro comum: um CancellationException aqui sumiria em silêncio.
            throw IllegalStateException("o servidor de voz não respondeu ($method)")
        } finally { pending.remove(id) }
    }

    /** Um ouvinte por conexão: só a conexão ATUAL mexe na chamada. */
    private inner class SignalListener(private val g: Int, private val welcome: CompletableDeferred<JSONObject>) : WebSocketListener() {
        @Volatile private var done = false

        override fun onMessage(webSocket: WebSocket, text: String) {
            val msg = runCatching { JSONObject(text) }.getOrNull() ?: return
            // O "welcome" pode chegar antes mesmo de `ws` ser atribuído.
            if (msg.optString("event") == "welcome") { welcome.complete(msg.optJSONObject("data") ?: JSONObject()); return }
            if (webSocket !== ws) return
            if (msg.has("id") && !msg.isNull("id")) {
                val d = pending.remove(msg.optInt("id")) ?: return
                if (msg.optBoolean("ok")) d.complete(msg.optJSONObject("data") ?: JSONObject())
                else d.completeExceptionally(IllegalStateException(msg.optString("error", "erro")))
                return
            }
            val event = msg.optString("event")
            val data = msg.optJSONObject("data") ?: JSONObject()
            scope.launch { if (g == gen && !closed) onEvent(g, event, data) }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            runCatching { webSocket.close(1000, null) }
            ended(webSocket, code)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = ended(webSocket, code)

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = ended(webSocket, response?.code ?: -1, t)

        private fun ended(webSocket: WebSocket, code: Int, t: Throwable? = null) {
            if (done) return
            done = true
            if (!welcome.isCompleted) welcome.completeExceptionally(if (code >= 4000) SignalClosed(code) else (t ?: SignalClosed(code)))
            if (webSocket !== ws) return // conexão antiga, já trocada
            failAll(t ?: IllegalStateException("sinalização fechada ($code)"))
            scope.launch { onSignalLost(g, code) }
        }
    }

    private fun failAll(t: Throwable) {
        pending.values.forEach { it.completeExceptionally(t) }
        pending.clear()
    }

    private fun onSignalLost(g: Int, code: Int) {
        if (g != gen || closed) return
        when (code) {
            4409 -> replaced()
            4401 -> giveUp("A sessão de voz expirou.", providerBroken = false)
            // Durante a entrada/reconexão quem trata é quem está tentando.
            else -> if (sessionUp) scheduleReconnect("sinalização caiu ($code)")
        }
    }

    // ---------------- entrar ----------------

    fun join(creds: OwnMediaCreds, userId: String, startMuted: Boolean, listenOnly: Boolean) {
        val g = ++gen
        closed = false
        this.creds = creds
        myId = userId
        micMuted = startMuted
        this.listenOnly = listenOnly
        deafened = false
        scope.launch {
            if (g != gen) return@launch
            reconnectAttempt = 0
            iceRestarts = 0
            mediaUp = false
            reconnectJob?.cancel(); reconnectJob = null
            try {
                doSession(g)
                if (g == gen && !closed) { events.onConnected(); watchMedia(g) }
            } catch (e: Throwable) {
                Log.w(TAG, "falha ao entrar", e)
                if (g != gen || closed) return@launch
                teardownSession()
                val code = (e as? SignalClosed)?.code
                if (code == 4409) replaced()
                else giveUp("Não deu pra entrar na chamada: ${e.message ?: "erro"}", providerBroken = code != 4401)
            }
        }
    }

    /** Uma sessão completa: sinalização → Device → transportes → microfone → mídia dos outros. */
    private fun doSession(g: Int) {
        val c = creds ?: error("sem credenciais")
        ensureFactory()
        val f = factory ?: error("WebRTC não iniciou")
        val sep = if (c.url.contains("?")) "&" else "?"
        val welcome = CompletableDeferred<JSONObject>()
        ws = http.newWebSocket(
            Request.Builder().url("${c.url}${sep}token=${URLEncoder.encode(c.token, "UTF-8")}").build(),
            SignalListener(g, welcome),
        )
        val w = try {
            runBlocking { withTimeout(15_000) { welcome.await() } }
        } catch (e: TimeoutCancellationException) {
            throw IllegalStateException("o servidor de voz não respondeu")
        }
        check(g == gen && !closed) { "chamada encerrada" }

        rtcConfig = PeerConnection.RTCConfiguration(c.iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }
        val dev = Device(f)
        device = dev
        dev.load(w.getJSONObject("routerRtpCapabilities").toString(), rtcConfig)

        send = createSend(g, dev)
        recv = createRecv(g, dev)
        check(g == gen && !closed) { "chamada encerrada" }

        // Microfone (se está mudo, publica pausado — desmutar é instantâneo).
        // Sem permissão de microfone: só ouve (não publica nada).
        if (!listenOnly) runCatching { publishMic() }.onFailure {
            Log.w(TAG, "microfone", it)
            events.onWarning("Não deu pra ligar o seu microfone — você continua ouvindo a chamada.")
        }

        // O que os outros já publicavam.
        val producers = w.optJSONArray("producers") ?: JSONArray()
        for (i in 0 until producers.length()) {
            val p = producers.optJSONObject(i) ?: continue
            runCatching { consume(g, p) }.onFailure { Log.w(TAG, "consume", it) }
        }
        iceRestarts = 0
        sessionUp = true
    }

    private fun publishMic() {
        val f = factory ?: return
        val st = send ?: return
        if (micProducer != null) return
        val track = micTrack ?: run {
            val prefs = VoicePrefs.get(context)
            val src = f.createAudioSource(MediaConstraints().apply {
                fun opt(k: String, v: Boolean) = mandatory.add(MediaConstraints.KeyValuePair(k, v.toString()))
                opt("googEchoCancellation", prefs.echoCancellation)
                opt("googNoiseSuppression", prefs.noiseSuppression)
                opt("googHighpassFilter", prefs.noiseSuppression)
                opt("googAutoGainControl", prefs.automaticGain)
            })
            micSource = src
            f.createAudioTrack("mic", src).also { micTrack = it }
        }
        track.setEnabled(true)
        val p = st.produce(
            object : Producer.Listener { override fun onTransportClose(producer: Producer) {} },
            track, emptyList(), "{\"opusStereo\":false,\"opusDtx\":true,\"opusFec\":true}", null, "{\"source\":\"mic\"}",
        )
        micProducer = p
        if (micMuted) {
            p.pause()
            runCatching { request("pauseProducer", JSONObject().put("producerId", p.id)) }
        }
    }

    private fun createSend(g: Int, dev: Device): SendTransport {
        val info = request("createTransport", JSONObject().put("direction", "send"))
        return dev.createSendTransport(
            object : SendTransport.Listener {
                override fun onConnect(transport: Transport, dtlsParameters: String) {
                    request("connectTransport", JSONObject().put("transportId", transport.id).put("dtlsParameters", JSONObject(dtlsParameters)))
                }
                override fun onConnectionStateChange(transport: Transport, newState: String) {
                    scope.launch { onTransportState(g, transport, "envio", newState) }
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

    private fun createRecv(g: Int, dev: Device): RecvTransport {
        val info = request("createTransport", JSONObject().put("direction", "recv"))
        return dev.createRecvTransport(
            object : RecvTransport.Listener {
                override fun onConnect(transport: Transport, dtlsParameters: String) {
                    request("connectTransport", JSONObject().put("transportId", transport.id).put("dtlsParameters", JSONObject(dtlsParameters)))
                }
                override fun onConnectionStateChange(transport: Transport, newState: String) {
                    scope.launch { onTransportState(g, transport, "recepção", newState) }
                }
            },
            info.getString("id"), info.getJSONObject("iceParameters").toString(), info.getJSONArray("iceCandidates").toString(),
            info.getJSONObject("dtlsParameters").toString(), null, rtcConfig,
        )
    }

    private fun consume(g: Int, p: JSONObject) {
        val producerId = p.optString("producerId").takeIf { it.isNotEmpty() } ?: return
        if (consumers.values.any { it.producerId == producerId }) return // já está tocando
        val rt = recv ?: return
        val dev = device ?: return
        val info = request("consume", JSONObject().put("transportId", rt.id).put("producerId", producerId)
            .put("rtpCapabilities", JSONObject(dev.rtpCapabilities)))
        if (g != gen || recv !== rt) return // a sessão mudou enquanto esperava
        val appData = info.optJSONObject("appData") ?: p.optJSONObject("appData") ?: JSONObject()
        val kind = info.getString("kind")
        val consumer = rt.consume(
            object : Consumer.Listener { override fun onTransportClose(consumer: Consumer) {} },
            info.getString("consumerId"), info.getString("producerId"), kind,
            info.getJSONObject("rtpParameters").toString(), appData.toString(),
        )
        val peer = info.optString("peerId", p.optString("peerId"))
        val source = appData.optString("source", if (kind == "audio") "mic" else "camera")
        consumers[consumer.id] = Remote(consumer, producerId, peer, source, kind)
        if (kind == "audio") (consumer.track as? AudioTrack)?.let { t ->
            t.setEnabled(!deafened)
            runCatching { t.setVolume(VoicePrefs.get(context).gainFor(peer)) }
        }
        else { sinks[peer]?.let { s -> (consumer.track as? VideoTrack)?.addSink(s) }; publishVideo() }
        // O servidor cria o consumidor PAUSADO (recomendação do mediasoup):
        // sem este resume ninguém é ouvido — tenta de novo uma vez se falhar.
        val resume = JSONObject().put("consumerId", consumer.id)
        runCatching { request("resumeConsumer", resume) }
            .recoverCatching { request("resumeConsumer", resume) }
            .onFailure { Log.w(TAG, "resumeConsumer", it) }
    }

    private fun dropConsumer(id: String, r: Remote) {
        consumers.remove(id)
        if (r.kind == "video") sinks[r.peerId]?.let { s -> runCatching { (r.consumer.track as? VideoTrack)?.removeSink(s) } }
        runCatching { r.consumer.close() }
        runCatching { r.consumer.dispose() }
    }

    private fun onEvent(g: Int, event: String, data: JSONObject) {
        when (event) {
            "newProducer" -> if (sessionUp) runCatching { consume(g, data) }.onFailure { Log.w(TAG, "consume", it) }
            "consumerClosed", "producerClosed" -> {
                val byConsumer = data.optString("consumerId").takeIf { it.isNotEmpty() }
                val byProducer = data.optString("producerId").takeIf { it.isNotEmpty() }
                consumers.entries.filter { (id, r) -> id == byConsumer || r.producerId == byProducer }.forEach { (id, r) -> dropConsumer(id, r) }
                publishVideo()
            }
            "peerLeft" -> {
                val peer = data.optString("peerId")
                consumers.entries.filter { it.value.peerId == peer }.forEach { (id, r) -> dropConsumer(id, r) }
                publishVideo()
            }
            "activeSpeakers" -> {
                val arr = data.optJSONArray("peerIds") ?: JSONArray()
                val ids = (0 until arr.length()).mapNotNull { arr.optString(it).takeIf { s -> s.isNotEmpty() } }
                    .map { if (it == myId) "me" else it }.toSet()
                events.onSpeaking(ids)
            }
            "kicked" -> if (data.optString("reason") == "replaced") replaced() else {
                closed = true
                teardownSession()
                events.onLeft()
            }
        }
    }

    private fun publishVideo() {
        events.onRemoteVideo(consumers.values.filter { it.kind == "video" }.map { it.peerId }.toSet())
    }

    // ---------------- quedas e reconexão ----------------

    private fun isUp(t: Transport): Boolean = runCatching {
        val s = t.connectionState
        s == PeerConnection.IceConnectionState.CONNECTED || s == PeerConnection.IceConnectionState.COMPLETED
    }.getOrDefault(false)

    private fun onTransportState(g: Int, t: Transport, dir: String, state: String) {
        if (g != gen || closed || !sessionUp) return
        if (t !== send && t !== recv) return // de uma sessão antiga
        when (state) {
            "connected", "completed" -> { iceRestarts = 0; reconnectAttempt = 0; mediaUp = true }
            "disconnected" -> if (disconnectedJob == null) {
                // Costuma voltar sozinho (troca de wifi/4G): só age se continuar assim.
                disconnectedJob = scope.launch {
                    delay(DISCONNECTED_GRACE_MS)
                    disconnectedJob = null
                    if (g != gen || closed || !sessionUp) return@launch
                    val s = send
                    val r = recv
                    when {
                        s != null && inUse(s) && !isUp(s) -> recoverTransport(g, s, "envio")
                        r != null && inUse(r) && !isUp(r) -> recoverTransport(g, r, "recepção")
                        else -> Unit
                    }
                }
            }
            "failed" -> recoverTransport(g, t, dir)
            "closed" -> scheduleReconnect("transporte de $dir fechou")
        }
    }

    /**
     * Transporte que tem mídia de verdade passando. O de envio sem nada
     * publicado (só ouvindo) e o de recepção sem ninguém falando nunca
     * conectam — e não contam como "caídos".
     */
    private fun inUse(t: Transport): Boolean =
        if (t === send) micProducer != null || screenProducer != null else consumers.isNotEmpty()

    /**
     * Logo depois de (re)entrar: a mídia tem que abrir. Se nunca abriu nesta
     * chamada (rede bloqueando UDP/TURN), devolve pro VoiceManager trocar de
     * provedor rápido; se já tinha funcionado, tenta reconectar.
     */
    private fun watchMedia(g: Int) {
        val sessionSend = send
        val sessionRecv = recv
        scope.launch {
            delay(MEDIA_OPEN_TIMEOUT_MS)
            if (g != gen || closed || !sessionUp || send !== sessionSend || recv !== sessionRecv) return@launch
            val stuck = listOfNotNull(sessionSend, sessionRecv).any { inUse(it) && !isUp(it) }
            if (!stuck) { reconnectAttempt = 0; return@launch }
            if (!mediaUp) giveUp("A conexão de mídia da chamada não abriu.", providerBroken = true)
            else scheduleReconnect("a mídia não voltou")
        }
    }

    /** Primeiro um ICE restart (barato, não derruba nada); se não der, reconexão completa. */
    private fun recoverTransport(g: Int, t: Transport, dir: String) {
        if (!mediaUp) {
            // Nunca chegou a passar mídia nesta chamada (ex.: UDP bloqueado):
            // insistir no mesmo servidor só atrasa — deixa o VoiceManager trocar.
            giveUp("A conexão de $dir da chamada falhou.", providerBroken = true)
            return
        }
        if (iceRestartSupported && iceRestarts < 2) {
            iceRestarts++
            val r = runCatching {
                val res = request("restartIce", JSONObject().put("transportId", t.id))
                val ice = res.optJSONObject("iceParameters") ?: error("sem iceParameters")
                t.restartIce(ice.toString())
            }
            if (r.isSuccess) {
                Log.i(TAG, "ICE restart no transporte de $dir")
                scope.launch {
                    delay(ICE_RESTART_GRACE_MS)
                    val same = t === send || t === recv // (ainda é desta sessão)
                    if (g == gen && !closed && sessionUp && same && !isUp(t)) scheduleReconnect("ICE restart não resolveu ($dir)")
                }
                return
            }
            // Servidor ainda não tem o método: não tenta mais nesta chamada.
            if (r.exceptionOrNull()?.message?.contains("desconhecido") == true) iceRestartSupported = false
        }
        scheduleReconnect("transporte de $dir caiu")
    }

    private fun scheduleReconnect(reason: String) {
        if (closed || reconnectJob?.isActive == true) return
        val g = gen
        val attempt = reconnectAttempt
        if (attempt >= RECONNECT_DELAYS_MS.size) {
            giveUp("A conexão com o servidor de voz caiu.", providerBroken = true)
            return
        }
        Log.w(TAG, "reconectando ($reason), tentativa ${attempt + 1}")
        teardownSession()
        events.onReconnecting(attempt + 1)
        reconnectJob = scope.launch {
            delay(RECONNECT_DELAYS_MS[attempt])
            if (g != gen || closed) return@launch
            reconnectAttempt = attempt + 1
            try {
                doSession(g)
                if (g != gen || closed) return@launch
                // (a contagem de tentativas só zera quando a MÍDIA volta — ver onTransportState)
                reconnectJob = null
                events.onReconnected()
                watchMedia(g)
            } catch (e: Throwable) {
                Log.w(TAG, "reconexão ${attempt + 1} falhou", e)
                if (g != gen || closed) return@launch
                reconnectJob = null
                teardownSession()
                when ((e as? SignalClosed)?.code) {
                    4409 -> replaced()
                    4401 -> giveUp("A sessão de voz expirou.", providerBroken = false)
                    else -> scheduleReconnect("tentativa ${attempt + 1} falhou")
                }
            }
        }
    }

    private fun giveUp(message: String, providerBroken: Boolean) {
        if (closed) return
        closed = true
        reconnectJob?.cancel(); reconnectJob = null
        teardownSession()
        events.onGaveUp(message, providerBroken)
    }

    private fun replaced() {
        if (closed) return
        closed = true
        reconnectJob?.cancel(); reconnectJob = null
        teardownSession()
        events.onReplaced()
    }

    /**
     * Derruba a sessão atual (sinalização, transportes, consumidores,
     * producers) mas GUARDA o microfone e a fábrica pra próxima.
     */
    private fun teardownSession() {
        sessionUp = false
        disconnectedJob?.cancel(); disconnectedJob = null
        val socket = ws
        ws = null
        runCatching { socket?.close(1000, "reconnect") }
        failAll(IllegalStateException("reconectando"))
        consumers.entries.toList().forEach { (id, r) -> dropConsumer(id, r) }
        consumers.clear()
        publishVideo()
        if (screenProducer != null) {
            stopScreenLocal()
            events.onScreenStopped()
        }
        micProducer?.let { p -> runCatching { p.close() }; runCatching { p.dispose() } }
        micProducer = null
        send?.let { t -> runCatching { t.close() }; runCatching { t.dispose() } }
        recv?.let { t -> runCatching { t.close() }; runCatching { t.dispose() } }
        send = null; recv = null
        device?.let { d -> runCatching { d.dispose() } }
        device = null
        events.onSpeaking(emptySet())
    }

    // ---------------- controles ----------------

    fun setMuted(muted: Boolean) = scope.launch {
        micMuted = muted
        if (!sessionUp) return@launch // aplica na próxima sessão
        val p = micProducer
        if (p == null) {
            if (!muted && !listenOnly) runCatching { publishMic() }.onFailure { Log.w(TAG, "microfone", it) }
            return@launch
        }
        runCatching {
            if (muted) { p.pause(); request("pauseProducer", JSONObject().put("producerId", p.id)) }
            else { p.resume(); request("resumeProducer", JSONObject().put("producerId", p.id)) }
        }
    }

    /** Saiu do modo "só ouvindo" (a permissão do microfone foi dada agora). */
    fun enableMic() = scope.launch {
        listenOnly = false
        if (sessionUp && micProducer == null) runCatching { publishMic() }.onFailure {
            Log.w(TAG, "microfone", it)
            events.onWarning("Não deu pra ligar o seu microfone.")
        }
    }

    /** Reaplica os volumes (geral e de cada pessoa) nas trilhas que estão tocando. */
    fun applyVolumes() = scope.launch {
        val prefs = VoicePrefs.get(context)
        consumers.values.filter { it.kind == "audio" }.forEach { r ->
            runCatching { (r.consumer.track as? AudioTrack)?.setVolume(prefs.gainFor(r.peerId)) }
        }
    }

    fun setDeafened(deaf: Boolean) = scope.launch {
        deafened = deaf
        consumers.values.filter { it.kind == "audio" }.forEach { runCatching { (it.consumer.track as? AudioTrack)?.setEnabled(!deaf) } }
    }

    fun startScreen(mp: MediaProjection, onError: (String) -> Unit) = scope.launch {
        try {
            val f = factory ?: error("sem chamada")
            val st = send ?: error("sem chamada")
            stopScreenNow()
            val helper = SurfaceTextureHelper.create("pc-tela", ensureEgl().eglBaseContext)
            val source = f.createVideoSource(true)
            val cap = ProjectionCapturer(mp)
            cap.initialize(helper, context, source.capturerObserver)
            val dm = context.resources.displayMetrics
            val scale = 1280f / maxOf(dm.widthPixels, dm.heightPixels)
            val w = (dm.widthPixels * scale).toInt() and 1.inv()
            val h = (dm.heightPixels * scale).toInt() and 1.inv()
            cap.startCapture(w, h, 15)
            val track = f.createVideoTrack("screen", source)
            screenHelper = helper; screenSource = source; screenTrack = track; screenCapturer = cap
            val enc = RtpParameters.Encoding(null, true, 1.0).apply { maxBitrateBps = 2_500_000 }
            screenProducer = st.produce(
                object : Producer.Listener { override fun onTransportClose(producer: Producer) {} },
                track, listOf(enc), null, null, "{\"source\":\"screen\"}",
            )
        } catch (e: Throwable) {
            Log.w(TAG, "tela", e)
            stopScreenLocal()
            onError("Não deu pra compartilhar a tela: ${e.message ?: "erro"}")
        }
    }

    fun stopScreen() = scope.launch { stopScreenNow() }

    private fun stopScreenNow() {
        screenProducer?.let { p ->
            if (sessionUp) runCatching { request("closeProducer", JSONObject().put("producerId", p.id)) }
        }
        stopScreenLocal()
    }

    /** Para a captura e solta tudo da tela sem falar com o servidor. */
    private fun stopScreenLocal() {
        screenProducer?.let { p -> runCatching { p.close() }; runCatching { p.dispose() } }
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
        consumers.values.filter { it.peerId == userId && it.kind == "video" }
            .forEach { runCatching { (it.consumer.track as? VideoTrack)?.addSink(r) } }
        return true
    }

    fun unbindRemoteVideo(userId: String) {
        val r = sinks.remove(userId) ?: return
        consumers.values.filter { it.peerId == userId && it.kind == "video" }
            .forEach { runCatching { (it.consumer.track as? VideoTrack)?.removeSink(r) } }
        runCatching { r.release() }
    }

    // ---------------- sair ----------------

    fun leave() {
        gen++
        closed = true
        scope.launch {
            reconnectJob?.cancel(); reconnectJob = null
            runCatching { stopScreenNow() }
            runCatching { ws?.send(JSONObject().put("id", seq.incrementAndGet()).put("method", "leave").put("data", JSONObject()).toString()) }
            teardownSession()
            runCatching { micTrack?.dispose() }
            runCatching { micSource?.dispose() }
            micTrack = null; micSource = null
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
        // Modo de comunicação, foco e rota do áudio: ver CallAudio (por chamada).
    }

    companion object {
        private const val TAG = "PCMidia"
        /** Esperas entre tentativas de reconexão (as mesmas do site; ≈ 31 s antes de desistir). */
        private val RECONNECT_DELAYS_MS = longArrayOf(1000, 2000, 4000, 8000, 8000, 8000)
        private const val DISCONNECTED_GRACE_MS = 4000L
        private const val ICE_RESTART_GRACE_MS = 8000L
        private const val MEDIA_OPEN_TIMEOUT_MS = 15_000L
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
                val urls = o.optJSONArray("urls")?.let { a -> (0 until a.length()).mapNotNull { a.optString(it).takeIf { u -> u.isNotBlank() } } }
                    ?: listOfNotNull(o.optString("urls").takeIf { it.isNotBlank() })
                if (urls.isEmpty()) return@mapNotNull null
                runCatching {
                    PeerConnection.IceServer.builder(urls).apply {
                        o.optString("username").takeIf { it.isNotBlank() }?.let { setUsername(it) }
                        o.optString("credential").takeIf { it.isNotBlank() }?.let { setPassword(it) }
                    }.createIceServer()
                }.getOrNull()
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
        val ctx = context ?: return
        h.setTextureSize(width, height)
        val s = Surface(h.surfaceTexture)
        surface = s
        display = projection.createVirtualDisplay(
            "pc-tela", width, height, ctx.resources.displayMetrics.densityDpi,
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
