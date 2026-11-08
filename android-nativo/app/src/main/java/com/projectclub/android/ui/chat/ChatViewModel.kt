package com.projectclub.android.ui.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.projectclub.android.data.AppJson
import com.projectclub.android.data.ChatLogic
import com.projectclub.android.data.Message
import com.projectclub.android.data.PickedFile
import com.projectclub.android.data.Repository
import com.projectclub.android.data.Room
import com.projectclub.android.data.offline.OfflineLogic
import com.projectclub.android.data.offline.PendingMessage
import com.projectclub.android.data.offline.QueueResult
import kotlinx.coroutines.flow.combine
import com.projectclub.android.net.ApiException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import java.time.Instant
import java.util.UUID

data class ChatState(
    val messages: List<Message> = emptyList(),
    val loading: Boolean = true,
    val loadingOlder: Boolean = false,
    val reachedStart: Boolean = false,
    val error: String? = null,
    val typing: Map<String, Long> = emptyMap(),
    val replyTo: Message? = null,
    val editing: Message? = null,
    val files: List<PickedFile> = emptyList(),
    val sending: Boolean = false,
    val toast: String? = null,
    /** Nonces das mensagens desta sala que ainda estão na fila de envio (aparecem como "pendente"). */
    val queued: Set<String> = emptySet(),
)

class ChatViewModel(private val repo: Repository, val room: Room) : ViewModel() {
    // Já tinha aberto antes: mostra o que tinha na hora e atualiza por trás.
    private val _state = MutableStateFlow(
        repo.messageCache[room.id].let { cached -> if (cached.isNullOrEmpty()) ChatState() else ChatState(messages = cached, loading = false) },
    )
    val state: StateFlow<ChatState> = _state
    private var lastTypingSent = 0L
    private var stopTypingJob: Job? = null

    /** Quem chamou send() por cada nonce: se a mensagem for recusada, o texto volta pro campo. */
    private val failedCallbacks = HashMap<String, (String) -> Unit>()
    private val handledResults = HashSet<String>()

    init {
        join()
        // Nada na memória: mostra o que foi salvo no disco (modo offline) enquanto busca as novas.
        if (_state.value.messages.isEmpty()) viewModelScope.launch {
            val saved = repo.cachedRoomMessages(room)
            if (!saved.isNullOrEmpty()) _state.update { s ->
                if (s.messages.none { !it.id.startsWith(LOCAL) }) s.copy(messages = ChatLogic.merge(saved, s.messages), loading = false, error = null) else s
            }
        }
        viewModelScope.launch { loadLatest() }
        viewModelScope.launch {
            // Memória + disco (as últimas 100 confirmadas desta sala).
            _state.collect { s -> repo.cacheRoomMessages(room, s.messages) }
        }
        // Fila offline: as pendentes desta sala aparecem na lista; as que saíram viram a mensagem enviada.
        viewModelScope.launch {
            combine(repo.queue.items, repo.queueResults) { items, results -> items.filter { it.roomId == room.id } to results }
                .collect { (mine, results) -> reconcileQueue(mine, results) }
        }
        viewModelScope.launch { repo.realtime.events.collect { onEvent(it.name, it.data) } }
        viewModelScope.launch {
            var first = true
            repo.realtime.connected.collect { up ->
                // Reconectou: entra de novo no canal e busca o que chegou enquanto estava fora.
                if (up && !first) { join(); loadLatest() }
                first = false
            }
        }
        // Limpa "fulano está digitando" que ficou velho.
        viewModelScope.launch {
            while (isActive) {
                delay(2000)
                val now = System.currentTimeMillis()
                if (_state.value.typing.values.any { it < now }) _state.update { s -> s.copy(typing = s.typing.filterValues { it >= now }) }
            }
        }
    }

    private fun reconcileQueue(mine: List<PendingMessage>, results: Map<String, QueueResult>) {
        val dropped = ArrayList<QueueResult.Dropped>()
        _state.update { s ->
            var msgs = s.messages
            // Pendentes que ainda não estão na lista (ex.: escritas antes de fechar o app).
            val have = msgs.mapNotNull { it.nonce }.toSet()
            val missing = mine.filter { it.nonce !in have }.map { OfflineLogic.toMessage(it, repo.me.value) }
            if (missing.isNotEmpty()) msgs = ChatLogic.merge(msgs, missing)
            // Saíram da fila: troca pela do servidor, ou tira (recusada).
            val queuedNow = mine.map { it.nonce }.toSet()
            for (local in msgs.filter { it.id.startsWith(LOCAL) }) {
                val n: String = local.nonce ?: continue
                if (n in queuedNow) continue
                when (val r = results[n]) {
                    is QueueResult.Sent -> { msgs = ChatLogic.merge(msgs, listOf(r.message)); failedCallbacks.remove(n) }
                    is QueueResult.Dropped -> {
                        msgs = msgs.filter { it.id != local.id }
                        if (handledResults.add(n)) dropped += r
                    }
                    null -> Unit // envio direto (com anexo) em andamento: não é da fila
                }
            }
            s.copy(messages = msgs, queued = queuedNow)
        }
        dropped.forEach { r ->
            _state.update { it.copy(toast = r.reason) }
            failedCallbacks.remove(r.pending.nonce)?.invoke(r.pending.content)
        }
    }

    private fun join() {
        if (room.channelId != null) repo.realtime.joinChannel(room.channelId) else room.conversationId?.let { repo.realtime.joinConversation(it) }
    }

    private suspend fun loadLatest() {
        try {
            val page = repo.messages(room)
            _state.update {
                // Chegou mais coisa do que cabe numa página enquanto estava fora: a lista
                // guardada teria um buraco no meio, então começa da página nova.
                val confirmed = it.messages.filter { m -> !m.id.startsWith(LOCAL) }
                val gap = page.size >= PAGE && confirmed.isNotEmpty() && page.none { p -> confirmed.any { m -> m.id == p.id } }
                // (as pendentes/enviando continuam na lista)
                val base = if (gap) it.messages.filter { m -> m.id.startsWith(LOCAL) } else it.messages
                it.copy(messages = ChatLogic.merge(base, page), loading = false, error = null, reachedStart = if (gap) false else it.reachedStart || (it.messages.isEmpty() && page.size < PAGE))
            }
            repo.markRead(room)
        } catch (e: Exception) {
            _state.update { it.copy(loading = false, error = if (it.messages.isEmpty()) (e.message ?: "Não deu pra carregar as mensagens.") else null) }
        }
    }

    fun retry() { _state.update { it.copy(loading = true, error = null) }; viewModelScope.launch { loadLatest() } }

    fun loadOlder() {
        val s = _state.value
        if (s.loadingOlder || s.reachedStart || s.loading) return
        val oldest = s.messages.firstOrNull { !it.id.startsWith(LOCAL) } ?: return
        _state.update { it.copy(loadingOlder = true) }
        viewModelScope.launch {
            try {
                val page = repo.messages(room, before = oldest)
                _state.update { it.copy(messages = ChatLogic.merge(it.messages, page), loadingOlder = false, reachedStart = page.size < PAGE) }
            } catch (_: Exception) {
                _state.update { it.copy(loadingOlder = false) }
            }
        }
    }

    private fun mine(roomOf: Message) = (room.channelId != null && roomOf.channelId == room.channelId) ||
        (room.conversationId != null && roomOf.conversationId == room.conversationId)

    private fun onEvent(name: String, data: kotlinx.serialization.json.JsonElement?) {
        when (name) {
            "message:new", "message:update" -> {
                val m = runCatching { AppJson.decodeFromJsonElement<Message>(data ?: return) }.getOrNull() ?: return
                if (!mine(m)) return
                _state.update { s ->
                    // Uma reação/edição em mensagem que não está carregada não entra na lista.
                    if (name == "message:update" && s.messages.none { it.id == m.id }) s
                    else s.copy(messages = ChatLogic.merge(s.messages, listOf(m)), typing = s.typing - (m.authorId ?: ""))
                }
                if (name == "message:new" && m.authorId != repo.me.value?.id) viewModelScope.launch { repo.markRead(room) }
            }
            "message:delete" -> {
                val o = data as? JsonObject ?: return
                val id = (o["id"] as? JsonPrimitive)?.contentOrNull ?: return
                _state.update { s -> s.copy(messages = s.messages.filter { it.id != id }) }
            }
            "typing:start", "typing:stop" -> {
                val o = data as? JsonObject ?: return
                val userId = (o["userId"] as? JsonPrimitive)?.contentOrNull ?: return
                val ch = (o["channelId"] as? JsonPrimitive)?.contentOrNull
                val conv = (o["conversationId"] as? JsonPrimitive)?.contentOrNull
                if ((room.channelId == null || ch != room.channelId) && (room.conversationId == null || conv != room.conversationId)) return
                if (userId == repo.me.value?.id) return
                _state.update { s ->
                    if (name == "typing:start") s.copy(typing = s.typing + (userId to System.currentTimeMillis() + 8000)) else s.copy(typing = s.typing - userId)
                }
            }
        }
    }

    fun onTyping(text: String) {
        if (text.isBlank()) return
        val now = System.currentTimeMillis()
        if (now - lastTypingSent > 3000) {
            lastTypingSent = now
            repo.realtime.typing(true, room.channelId, room.conversationId)
        }
        stopTypingJob?.cancel()
        stopTypingJob = viewModelScope.launch {
            delay(5000)
            lastTypingSent = 0
            repo.realtime.typing(false, room.channelId, room.conversationId)
        }
    }

    fun setReply(m: Message?) = _state.update { it.copy(replyTo = m, editing = null) }
    fun setEditing(m: Message?) = _state.update { it.copy(editing = m, replyTo = null) }
    fun addFiles(list: List<PickedFile>) = _state.update { it.copy(files = (it.files + list).take(10)) }
    fun removeFile(f: PickedFile) = _state.update { it.copy(files = it.files - f) }
    fun clearToast() = _state.update { it.copy(toast = null) }

    /** Envia (ou salva a edição). Devolve false se não deu (o texto volta pro campo). */
    fun send(text: String, onFailed: (String) -> Unit) {
        val s = _state.value
        val editing = s.editing
        if (editing != null) {
            if (text.isBlank()) return
            _state.update { it.copy(editing = null) }
            viewModelScope.launch {
                try {
                    val m = repo.edit(editing.id, text.trim())
                    _state.update { st -> st.copy(messages = ChatLogic.merge(st.messages, listOf(m))) }
                } catch (e: Exception) { onFailed(text); _state.update { it.copy(toast = e.message, editing = editing) } }
            }
            return
        }
        if (text.isBlank() && s.files.isEmpty()) return
        val files = s.files
        val reply = s.replyTo
        val nonce = UUID.randomUUID().toString()
        val me = repo.me.value
        stopTypingJob?.cancel()
        if (lastTypingSent > 0) repo.realtime.typing(false, room.channelId, room.conversationId)
        lastTypingSent = 0
        if (files.isEmpty()) {
            // Só texto: vai pela fila (sai na hora com internet; sem ela fica "pendente"
            // e sai sozinha quando a conexão voltar — mesmo nonce, sem duplicar).
            val p = PendingMessage(
                nonce = nonce, channelId = room.channelId, conversationId = room.conversationId,
                content = text.trim(), replyToId = reply?.id,
                replyTo = reply?.let { com.projectclub.android.data.ReplyRef(it.id, it.content, it.author) },
                createdAt = Instant.now().toString(),
            )
            failedCallbacks[nonce] = onFailed
            _state.update { it.copy(messages = it.messages + OfflineLogic.toMessage(p, me), replyTo = null, queued = it.queued + nonce) }
            repo.enqueue(p)
            return
        }
        if (repo.offline.value) {
            onFailed(text)
            _state.update { it.copy(toast = "Sem conexão: anexos só podem ser enviados com internet.") }
            return
        }
        // Aparece na hora (versão "enviando"); a do servidor substitui pelo nonce.
        val local = Message(
            id = LOCAL + nonce, content = text.trim(), authorId = me?.id, author = me,
            channelId = room.channelId, conversationId = room.conversationId,
            createdAt = Instant.now().toString(), nonce = nonce,
            replyTo = reply?.let { com.projectclub.android.data.ReplyRef(it.id, it.content, it.author) },
        )
        _state.update { it.copy(messages = it.messages + local, replyTo = null, files = emptyList(), sending = files.isNotEmpty()) }
        viewModelScope.launch {
            try {
                val sent = repo.send(room, text.trim(), reply?.id, files, nonce)
                _state.update { it.copy(messages = ChatLogic.merge(it.messages, listOf(sent.copy(nonce = nonce))), sending = false) }
            } catch (e: Exception) {
                _state.update { it.copy(messages = it.messages.filter { m -> m.id != local.id }, sending = false, files = files, replyTo = reply, toast = (e as? ApiException)?.message ?: "Não foi enviada. Verifique a conexão.") }
                onFailed(text)
            }
        }
    }

    /** Figurinha: mensagem própria, aparece na hora e o servidor confirma. */
    fun sendSticker(url: String) {
        val nonce = UUID.randomUUID().toString()
        // Também pela fila: sem internet fica "pendente" e sai quando a conexão voltar.
        val p = PendingMessage(
            nonce = nonce, channelId = room.channelId, conversationId = room.conversationId,
            stickerUrl = url, createdAt = Instant.now().toString(),
        )
        _state.update { it.copy(messages = it.messages + OfflineLogic.toMessage(p, repo.me.value), queued = it.queued + nonce) }
        repo.enqueue(p)
    }

    /** Desiste de uma mensagem que ainda está na fila (pendente). */
    fun cancelPending(m: Message) {
        val n = m.nonce ?: return
        repo.cancelPending(n)
        failedCallbacks.remove(n)
        _state.update { it.copy(messages = it.messages.filter { x -> x.id != m.id }, queued = it.queued - n) }
    }

    fun react(m: Message, emoji: String) {
        if (m.id.startsWith(LOCAL)) return
        viewModelScope.launch {
            try {
                val updated = repo.react(m.id, emoji)
                _state.update { it.copy(messages = ChatLogic.merge(it.messages, listOf(updated))) }
            } catch (e: Exception) { _state.update { it.copy(toast = e.message) } }
        }
    }

    fun delete(m: Message) {
        viewModelScope.launch {
            try {
                repo.deleteMessage(m.id)
                _state.update { it.copy(messages = it.messages.filter { x -> x.id != m.id }) }
            } catch (e: Exception) { _state.update { it.copy(toast = e.message) } }
        }
    }

    override fun onCleared() {
        if (room.channelId != null) repo.realtime.leaveChannel(room.channelId)
        if (lastTypingSent > 0) repo.realtime.typing(false, room.channelId, room.conversationId)
    }

    class Factory(private val repo: Repository, private val room: Room) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = ChatViewModel(repo, room) as T
    }

    companion object {
        const val PAGE = 50
        const val LOCAL = "local-"
    }
}
