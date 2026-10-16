package com.projectclub.android.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Tag
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.projectclub.android.data.Message
import com.projectclub.android.data.MessagesResponse
import com.projectclub.android.data.Repository
import com.projectclub.android.data.Room
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.PcField
import com.projectclub.android.ui.common.formatTime
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.net.URLEncoder
import java.util.TimeZone

private fun roomQuery(room: Room) =
    if (room.channelId != null) "channelId=${room.channelId}" else "conversationId=${room.conversationId}"

private fun tzOffsetMinutes(): Int = -TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60_000

/** Lista de mensagens simples (fixadas / resultado da busca). */
@Composable
private fun MessageList(repo: Repository, messages: List<Message>, empty: String, trailing: (@Composable (Message) -> Unit)? = null) {
    if (messages.isEmpty()) {
        Text(empty, color = PC.Muted, modifier = Modifier.padding(24.dp).fillMaxWidth())
        return
    }
    LazyColumn(Modifier.fillMaxWidth().heightIn(max = 520.dp)) {
        items(messages, key = { it.id }) { m ->
            val author = m.author ?: repo.user(m.authorId)
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
                Avatar(author, 34.dp)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(author?.name ?: "Usuário", fontWeight = FontWeight.Bold, color = PC.Header, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                        Spacer(Modifier.width(6.dp))
                        Text(formatTime(m.createdAt), color = PC.Muted, style = MaterialTheme.typography.labelSmall)
                    }
                    Text(
                        m.content?.takeIf { it.isNotBlank() } ?: if (m.attachments.isNotEmpty()) "📎 Anexo" else "Mensagem",
                        color = PC.Text, maxLines = 4, overflow = TextOverflow.Ellipsis,
                    )
                }
                trailing?.invoke(m)
            }
        }
    }
}

/** Mensagens fixadas do canal/conversa (com "desafixar"). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PinnedSheet(repo: Repository, room: Room, onDismiss: () -> Unit) {
    var items by remember { mutableStateOf<List<Message>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    suspend fun load() {
        runCatching { repo.api.get<MessagesResponse>("/api/messages/pinned?${roomQuery(room)}").messages }
            .onSuccess { items = it }.onFailure { error = it.message ?: "Não deu pra carregar." }
    }
    LaunchedEffect(room.id) { load() }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = PC.Surface) {
        Column(Modifier.navigationBarsPadding()) {
            SheetTitle(Icons.Outlined.PushPin, "Mensagens fixadas")
            when {
                error != null -> Text(error!!, color = PC.Red, modifier = Modifier.padding(16.dp))
                items == null -> Loading()
                else -> MessageList(repo, items!!, "Nenhuma mensagem fixada ainda.") { m ->
                    TextButton(onClick = {
                        scope.launch { runCatching { repo.api.postIgnore("/api/messages/${m.id}/pin") }.onFailure { error = it.message }; load() }
                    }) { Text("Desafixar", color = PC.Muted) }
                }
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}

/** Busca de mensagens neste canal/conversa (mesma busca do PC, com de:/tem: etc). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchSheet(repo: Repository, room: Room, onDismiss: () -> Unit) {
    var q by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<Message>?>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(q) {
        if (q.trim().length < 2) { results = emptyList(); return@LaunchedEffect }
        delay(350)
        results = null; error = null
        runCatching { repo.api.get<MessagesResponse>("/api/messages/search?q=${URLEncoder.encode(q.trim(), "UTF-8")}&${roomQuery(room)}").messages }
            .onSuccess { results = it }.onFailure { error = it.message; results = emptyList() }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = PC.Surface) {
        Column(Modifier.navigationBarsPadding()) {
            SheetTitle(Icons.Outlined.Search, "Buscar mensagens")
            PcField(q, { q = it }, "Palavra, de:pessoa, tem:imagem…", icon = Icons.Outlined.Search, modifier = Modifier.padding(horizontal = 16.dp))
            Spacer(Modifier.height(6.dp))
            error?.let { Text(it, color = PC.Red, modifier = Modifier.padding(16.dp)) }
            if (results == null) Loading()
            else MessageList(repo, results!!, if (q.trim().length < 2) "Digite pelo menos 2 letras." else "Nada encontrado.")
            Spacer(Modifier.height(12.dp))
        }
    }
}

/** Encaminhar uma mensagem pra um canal de texto ou conversa. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ForwardSheet(repo: Repository, message: Message, onDismiss: () -> Unit, onDone: (String) -> Unit) {
    val community by repo.community.collectAsState()
    val conversations by repo.conversations.collectAsState()
    var q by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val channels = community?.categories.orEmpty().flatMap { it.channels }.filter { it.isChat }
    data class Target(val label: String, val sub: String, val body: JsonObject)
    val targets = (conversations.map { Target(repo.conversationTitle(it), "Conversa", buildJsonObject { put("conversationId", it.id) }) } +
        channels.map { Target(it.name, "Canal", buildJsonObject { put("channelId", it.id) }) })
        .filter { q.isBlank() || it.label.contains(q.trim(), ignoreCase = true) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = PC.Surface) {
        Column(Modifier.navigationBarsPadding()) {
            SheetTitle(Icons.Outlined.Tag, "Encaminhar para…")
            PcField(q, { q = it }, "Buscar canal ou conversa", icon = Icons.Outlined.Search, modifier = Modifier.padding(horizontal = 16.dp))
            error?.let { Text(it, color = PC.Red, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) }
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 460.dp).padding(top = 6.dp)) {
                items(targets.take(80)) { t ->
                    Row(
                        Modifier.fillMaxWidth().clickable(enabled = !busy) {
                            busy = true
                            scope.launch {
                                runCatching { repo.api.postIgnore("/api/messages/${message.id}/forward", t.body) }
                                    .onSuccess { onDone("Encaminhada para ${t.label}.") }
                                    .onFailure { error = it.message ?: "Não deu pra encaminhar."; busy = false }
                            }
                        }.padding(horizontal = 20.dp, vertical = 13.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(t.label, color = PC.Header, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(t.sub, color = PC.Muted, style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}

/**
 * Pergunta "quando?" em texto livre ("em 2h", "amanhã 9h", "18:30") e mostra a
 * prévia do horário (mesmo entendedor do servidor que o PC usa).
 */
@Composable
fun WhenDialog(
    repo: Repository, title: String, confirm: String, initialText: String? = null, textLabel: String? = null,
    onDismiss: () -> Unit, onConfirm: suspend (whenText: String, dueAtIso: String, text: String) -> String?,
) {
    var whenText by remember { mutableStateOf("em 1h") }
    var text by remember { mutableStateOf(initialText.orEmpty()) }
    var preview by remember { mutableStateOf<String?>(null) }
    var dueAt by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(whenText) {
        delay(300)
        dueAt = null; preview = null
        if (whenText.isBlank()) return@LaunchedEffect
        runCatching {
            repo.api.post<JsonObject>("/api/reminders/preview", buildJsonObject { put("when", whenText); put("tzOffset", tzOffsetMinutes()) })
        }.onSuccess { o ->
            val iso = o["dueAt"]?.jsonPrimitive?.content
            dueAt = iso
            preview = iso?.let { "Vai ser ${formatTime(it)}." } ?: "Não entendi o horário."
        }.onFailure { preview = "Não entendi o horário. Tente \"em 2h\", \"amanhã 9h\" ou \"18:30\"." }
    }
    AlertDialog(
        onDismissRequest = onDismiss, containerColor = PC.Surface2,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (textLabel != null) PcField(text, { text = it }, textLabel, singleLine = false)
                PcField(whenText, { whenText = it }, "em 2h, amanhã 9h, 18:30…", label = "Quando")
                preview?.let { Text(it, color = if (dueAt != null) PC.Green else PC.Yellow, style = MaterialTheme.typography.bodySmall) }
                error?.let { Text(it, color = PC.Red, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            TextButton(enabled = dueAt != null && !busy, onClick = {
                val at = dueAt ?: return@TextButton
                busy = true
                scope.launch { error = onConfirm(whenText, at, text); busy = false }
            }) { Text(confirm, color = PC.Brand) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancelar", color = PC.Text) } },
    )
}

/** "Lembrar-me" de uma mensagem. Devolve null se deu certo (ou a mensagem de erro). */
suspend fun createReminder(repo: Repository, message: Message, room: Room, whenText: String, text: String): String? = runCatching {
    val link = if (room.channelId != null) "/channels/${room.channelId}" else "/conversations/${room.conversationId}"
    repo.api.postIgnore("/api/reminders", buildJsonObject {
        put("text", text.ifBlank { message.content?.take(180) ?: "Mensagem" })
        put("when", whenText); put("tzOffset", tzOffsetMinutes())
        put("link", link); put("messageId", message.id)
    })
}.exceptionOrNull()?.let { it.message ?: "Não deu pra criar o lembrete." }

/** Agenda o texto do campo pra ser enviado depois. */
suspend fun scheduleMessage(repo: Repository, room: Room, content: String, dueAtIso: String): String? = runCatching {
    repo.api.postIgnore("/api/messages/scheduled", buildJsonObject {
        room.channelId?.let { put("channelId", it) }
        room.conversationId?.let { put("conversationId", it) }
        put("content", content); put("sendAt", dueAtIso)
    })
}.exceptionOrNull()?.let { it.message ?: "Não deu pra agendar." }

@Composable
private fun SheetTitle(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(34.dp).clip(RoundedCornerShape(10.dp)).background(PC.BrandSoft), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = PC.Brand, modifier = Modifier.size(19.dp))
        }
        Spacer(Modifier.width(10.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, color = PC.Header, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun Loading() {
    Box(Modifier.fillMaxWidth().padding(28.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(Modifier.size(26.dp), strokeWidth = 2.dp, color = PC.Brand)
    }
}
