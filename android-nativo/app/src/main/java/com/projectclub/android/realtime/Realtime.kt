package com.projectclub.android.realtime

import android.util.Log
import com.projectclub.android.Config
import com.projectclub.android.data.AppJson
import com.projectclub.android.net.Api
import com.projectclub.android.net.RefreshResult
import io.socket.client.Ack
import io.socket.client.IO
import io.socket.client.Socket
import io.socket.engineio.client.transports.WebSocket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import org.json.JSONArray
import org.json.JSONObject

/** Um evento do servidor (nome + dados já convertidos pra JSON do Kotlin). */
data class RtEvent(val name: String, val data: JsonElement?)

/**
 * Tempo real do Project Club (socket.io). Autentica com o access token no
 * handshake; quando o token vence ("unauthorized"), renova a sessão e
 * reconecta. A cada (re)conexão avisa por [connected] — as telas abertas
 * entram de novo no canal e buscam o que perderam.
 */
class Realtime(private val api: Api, private val scope: CoroutineScope) {
    private var socket: Socket? = null
    private val auth = HashMap<String, String>()
    private var retry = 0

    private val _events = MutableSharedFlow<RtEvent>(extraBufferCapacity = 512)
    val events: SharedFlow<RtEvent> = _events

    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected

    @Synchronized
    fun connect() {
        val token = api.accessToken ?: return
        auth["token"] = token
        if (socket != null) {
            if (socket?.connected() != true) socket?.connect()
            return
        }
        val opts = IO.Options.builder()
            .setTransports(arrayOf(WebSocket.NAME))
            .setAuth(auth)
            .setReconnection(true)
            .setReconnectionDelay(1000)
            .setReconnectionDelayMax(15000)
            .setTimeout(20000)
            .build()
        val s = IO.socket(Config.baseUrl, opts)
        s.on(Socket.EVENT_CONNECT) {
            retry = 0
            _connected.value = true
            emit("voice:rosters")
        }
        s.on(Socket.EVENT_DISCONNECT) { _connected.value = false }
        s.on(Socket.EVENT_CONNECT_ERROR) { args ->
            _connected.value = false
            val msg = (args.firstOrNull() as? Exception)?.message ?: args.firstOrNull()?.toString().orEmpty()
            if (msg.contains("unauthorized")) reauthorize()
            else if (msg.contains("banned") || msg.contains("suspended") || msg.contains("account_disabled")) {
                _events.tryEmit(RtEvent("account:blocked", null))
            }
        }
        // Atualiza o token antes de cada tentativa automática de reconexão.
        s.io().on(io.socket.client.Manager.EVENT_RECONNECT_ATTEMPT) { api.accessToken?.let { auth["token"] = it } }
        s.onAnyIncoming { args ->
            val name = args.firstOrNull() as? String ?: return@onAnyIncoming
            _events.tryEmit(RtEvent(name, toJson(args.getOrNull(1))))
        }
        socket = s
        s.connect()
    }

    /** Token venceu: renova a sessão e reconecta (com espera crescente). */
    private fun reauthorize() {
        scope.launch(Dispatchers.IO) {
            val wait = minOf(15_000L, 500L shl minOf(retry, 5))
            retry++
            delay(wait)
            when (api.refresh()) {
                is RefreshResult.Ok -> synchronized(this@Realtime) {
                    api.accessToken?.let { auth["token"] = it }
                    socket?.connect()
                }
                RefreshResult.Transient -> reauthorize()
                RefreshResult.Rejected -> Unit // a sessão acabou: o app volta pro login
            }
        }
    }

    @Synchronized
    fun disconnect() {
        socket?.off()
        socket?.io()?.off()
        socket?.disconnect()
        socket = null
        _connected.value = false
    }

    fun emit(event: String, data: JSONObject? = null) {
        val s = socket ?: return
        if (data == null) s.emit(event) else s.emit(event, data)
    }

    fun emit(event: String, value: String) { socket?.emit(event, value) }

    /** Emite e espera o "ack" do servidor ({ ok: true }). */
    fun emitWithAck(event: String, value: String, onAck: (Boolean) -> Unit = {}) {
        val s = socket ?: return onAck(false)
        s.emit(event, arrayOf<Any>(value), Ack { args ->
            val ok = (args.firstOrNull() as? JSONObject)?.optBoolean("ok") ?: false
            onAck(ok)
        })
    }

    fun joinChannel(channelId: String, onAck: (Boolean) -> Unit = {}) = emitWithAck("channel:join", channelId, onAck)
    fun leaveChannel(channelId: String) = emit("channel:leave", channelId)
    fun joinConversation(conversationId: String) = emitWithAck("conversation:join", conversationId)

    fun typing(start: Boolean, channelId: String?, conversationId: String?) {
        emit(if (start) "typing:start" else "typing:stop", JSONObject().apply {
            channelId?.let { put("channelId", it) }
            conversationId?.let { put("conversationId", it) }
        })
    }

    private fun toJson(value: Any?): JsonElement? = try {
        when (value) {
            null -> null
            is JSONObject, is JSONArray -> AppJson.parseToJsonElement(value.toString())
            is String -> AppJson.parseToJsonElement(JSONObject.quote(value))
            else -> AppJson.parseToJsonElement(value.toString())
        }
    } catch (e: Exception) {
        Log.w("PCRealtime", "evento com dados inválidos: ${e.message}")
        null
    }
}
