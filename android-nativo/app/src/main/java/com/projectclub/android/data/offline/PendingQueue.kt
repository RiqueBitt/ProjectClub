package com.projectclub.android.data.offline

import com.projectclub.android.data.AppJson
import com.projectclub.android.data.Message
import com.projectclub.android.data.ReplyRef
import com.projectclub.android.data.User
import com.projectclub.android.net.ApiException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.io.File
import java.io.IOException

/**
 * Mensagem escrita sem internet (ou ainda não confirmada pelo servidor).
 * O [nonce] é o MESMO em todas as tentativas: o servidor reconhece o reenvio
 * e devolve a mensagem já criada em vez de duplicar (services/messageIdempotency.js).
 */
@Serializable
data class PendingMessage(
    val nonce: String,
    val channelId: String? = null,
    val conversationId: String? = null,
    val content: String = "",
    val replyToId: String? = null,
    val replyTo: ReplyRef? = null,
    val stickerUrl: String? = null,
    val createdAt: String,
    val attempts: Int = 0,
    val lastError: String? = null,
) {
    val roomId: String get() = channelId ?: conversationId ?: ""
}

/** Resultado de uma mensagem que saiu da fila (a tela troca a "pendente" por ele). */
sealed interface QueueResult {
    data class Sent(val message: Message) : QueueResult
    data class Dropped(val pending: PendingMessage, val reason: String) : QueueResult
}

/**
 * Fila de envio offline, salva num arquivo (sobrevive ao app fechado).
 * Ordem de chegada; sem dono de rede — quem envia é o Repository.
 * Java puro (sem Android): testável no JVM (OfflineLogicTest).
 */
class PendingQueue(private val file: File?) {
    private val _items = MutableStateFlow(load())
    val items: StateFlow<List<PendingMessage>> = _items

    @Synchronized
    fun add(p: PendingMessage) {
        val list = (_items.value.filter { it.nonce != p.nonce } + p).takeLast(MAX_ITEMS)
        set(list)
    }

    @Synchronized
    fun remove(nonce: String) {
        if (_items.value.none { it.nonce == nonce }) return
        set(_items.value.filter { it.nonce != nonce })
    }

    @Synchronized
    fun markFailed(nonce: String, error: String?) {
        set(_items.value.map { if (it.nonce == nonce) it.copy(attempts = it.attempts + 1, lastError = error?.take(200)) else it })
    }

    @Synchronized
    fun clear() = set(emptyList())

    fun forRoom(roomId: String): List<PendingMessage> = _items.value.filter { it.roomId == roomId }

    /** Próximas a enviar, na ordem em que foram escritas. */
    fun ordered(): List<PendingMessage> = _items.value.sortedBy { it.createdAt }

    private fun set(list: List<PendingMessage>) {
        _items.value = list
        save(list)
    }

    private fun load(): List<PendingMessage> {
        val f = file ?: return emptyList()
        if (!f.isFile) return emptyList()
        return runCatching { AppJson.decodeFromString(SERIALIZER, f.readText(Charsets.UTF_8)) }.getOrDefault(emptyList())
    }

    private fun save(list: List<PendingMessage>) {
        val f = file ?: return
        runCatching {
            if (list.isEmpty()) { f.delete(); return }
            f.parentFile?.mkdirs()
            val tmp = File(f.parentFile, f.name + ".tmp")
            tmp.writeText(AppJson.encodeToString(SERIALIZER, list), Charsets.UTF_8)
            if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f) }
        }
    }

    companion object {
        const val MAX_ITEMS = 200
        private val SERIALIZER = ListSerializer(PendingMessage.serializer())
    }
}

/** Regras puras do modo offline (testáveis sem Android). */
object OfflineLogic {
    /** Mensagens guardadas por conversa no disco. */
    const val MESSAGES_PER_ROOM = 100
    /** Quantas conversas/canais visitados ficam salvos. */
    const val RECENT_ROOMS = 30
    const val LOCAL_PREFIX = "local-"

    /**
     * Vale tentar de novo depois? Queda de rede, servidor reiniciando (5xx),
     * excesso de pedidos (429) e sessão ainda não renovada (401): sim.
     * Recusa definitiva (sem permissão, conteúdo inválido, sala apagada): não.
     */
    fun isRetryable(e: Throwable): Boolean = when (e) {
        is ApiException -> e.status == 401 || e.status == 408 || e.status == 425 || e.status == 429 || e.status in 500..599
        is IOException -> true
        else -> false
    }

    /** Espera antes de tentar de novo com a internet "ligada" mas o envio falhando. */
    fun backoffMs(attempts: Int): Long = (5_000L shl attempts.coerceIn(0, 4)).coerceAtMost(60_000L)

    /** Versão "pendente" da mensagem na lista (some quando a do servidor chega com o mesmo nonce). */
    fun toMessage(p: PendingMessage, me: User?): Message = Message(
        id = LOCAL_PREFIX + p.nonce,
        content = p.content.takeIf { it.isNotEmpty() },
        authorId = me?.id, author = me,
        channelId = p.channelId, conversationId = p.conversationId,
        replyToId = p.replyToId, replyTo = p.replyTo,
        createdAt = p.createdAt, nonce = p.nonce, stickerUrl = p.stickerUrl,
    )

    /** Coloca a sala no topo da lista de recentes (sem repetir); devolve (nova lista, salas que saíram). */
    fun touchRecent(current: List<String>, roomId: String, max: Int = RECENT_ROOMS): Pair<List<String>, List<String>> {
        val next = listOf(roomId) + current.filter { it != roomId }
        return next.take(max) to next.drop(max)
    }

    /** As últimas [MESSAGES_PER_ROOM] mensagens confirmadas (sem as locais/pendentes). */
    fun forDisk(messages: List<Message>): List<Message> =
        messages.filter { !it.id.startsWith(LOCAL_PREFIX) }.takeLast(MESSAGES_PER_ROOM)
}
