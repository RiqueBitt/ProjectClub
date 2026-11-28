package com.projectclub.android.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.projectclub.android.data.AppJson
import com.projectclub.android.data.Message
import com.projectclub.android.data.Repository
import com.projectclub.android.net.ApiException
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch

/*
 * Tópicos do canal (igual ao ThreadPanel.jsx / ThreadCard do site): a raiz
 * mostra um cartão embaixo da mensagem e abre a conversa do tópico.
 */

fun threadReplyLabel(n: Int) = when (n) { 0 -> "Nenhuma resposta"; 1 -> "1 resposta"; else -> "$n respostas" }

@Composable
fun ThreadCard(m: Message, onOpen: () -> Unit) {
    val locked = m.archived
    val archived = locked || m.threadArchivedAt != null
    val last = m.threadLastReply
    Column(
        Modifier.padding(top = 6.dp).widthIn(max = 380.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(PC.Surface)
            .border(1.dp, PC.Line, RoundedCornerShape(12.dp)).clickable(onClick = onOpen).padding(horizontal = 12.dp, vertical = 9.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(if (locked) Icons.Outlined.Lock else Icons.Outlined.Forum, null, tint = PC.Brand, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(6.dp))
            Text(m.title.orEmpty(), color = PC.Header, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            Spacer(Modifier.width(8.dp))
            Text(threadReplyLabel(m.threadReplyCount), color = PC.Brand, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
            if (archived) {
                Spacer(Modifier.width(6.dp))
                Text(if (locked) "Trancado" else "Arquivado", color = PC.Muted, style = MaterialTheme.typography.labelSmall)
            }
        }
        if (last != null) Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(last.author, 18.dp)
            Spacer(Modifier.width(6.dp))
            Text(
                (last.author?.displayName ?: "Alguém") + ": " + (last.preview?.ifBlank { "…" } ?: "…"),
                color = PC.Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        } else if (m.threadReplyCount == 0) Text("Seja a primeira pessoa a responder", color = PC.Faint, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 2.dp))
    }
}

/** A conversa do tópico em tela cheia: respostas + caixa de texto. */
@Composable
fun ThreadScreen(repo: Repository, root: Message, onClose: () -> Unit) {
    val channelId = root.channelId ?: return
    var list by remember(root.id) { mutableStateOf<List<Message>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var text by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val state = rememberLazyListState()
    val locked = root.archived
    LaunchedEffect(root.id) {
        runCatching { repo.threadMessages(channelId, root.id) }
            .onSuccess { list = it.filter { m -> m.id != root.id } }
            .onFailure { error = (it as? ApiException)?.message ?: "Não deu pra abrir o tópico." }
    }
    // Respostas novas em tempo real.
    LaunchedEffect(root.id) {
        repo.realtime.events.collect { ev ->
            if (ev.name != "message:new" && ev.name != "message:update") return@collect
            val m = runCatching { AppJson.decodeFromJsonElement(Message.serializer(), ev.data ?: return@collect) }.getOrNull() ?: return@collect
            if (m.threadId != root.id) return@collect
            val cur = list.orEmpty()
            list = if (cur.any { it.id == m.id }) cur.map { if (it.id == m.id) m else it } else cur + m
        }
    }
    LaunchedEffect(list?.size) { list?.let { if (it.isNotEmpty()) state.animateScrollToItem(it.size) } }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Column(Modifier.fillMaxSize().background(PC.Bg).statusBarsPadding().navigationBarsPadding().imePadding()) {
            Row(Modifier.fillMaxWidth().background(PC.Bar).padding(horizontal = 4.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onClose) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Voltar") }
                Column(Modifier.weight(1f)) {
                    Text(root.title.orEmpty(), color = PC.Header, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("Tópico · " + threadReplyLabel(list?.size ?: root.threadReplyCount), color = PC.Muted, style = MaterialTheme.typography.labelSmall)
                }
            }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                val msgs = list
                when {
                    error != null -> Text(error!!, color = PC.Muted, modifier = Modifier.align(Alignment.Center).padding(24.dp))
                    msgs == null -> CircularProgressIndicator(Modifier.align(Alignment.Center).size(28.dp))
                    else -> LazyColumn(state = state, modifier = Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp)) {
                        item(key = "root") { ThreadBubble(root, isRoot = true) }
                        if (msgs.isEmpty()) item(key = "empty") {
                            Text("Ninguém respondeu ainda. Comece a conversa!", color = PC.Muted, modifier = Modifier.padding(16.dp))
                        }
                        items(msgs, key = { it.id }) { ThreadBubble(it) }
                    }
                }
            }
            if (locked) Text("Este tópico foi trancado pela moderação.", color = PC.Muted, modifier = Modifier.fillMaxWidth().padding(16.dp))
            else Row(
                Modifier.fillMaxWidth().padding(10.dp).clip(RoundedCornerShape(24.dp)).background(PC.Surface).border(1.dp, PC.Line, RoundedCornerShape(24.dp)).padding(horizontal = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextField(
                    text, { text = it }, Modifier.weight(1f).heightIn(min = 48.dp), maxLines = 5,
                    placeholder = { Text("Responder no tópico", maxLines = 1) },
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent,
                        focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
                    ),
                )
                val can = text.isNotBlank() && !sending
                Box(
                    Modifier.size(40.dp).clip(CircleShape).background(if (can) PC.Brand else PC.BrandSoft).clickable(enabled = can) {
                        val t = text.trim(); text = ""; sending = true
                        scope.launch {
                            runCatching { repo.sendThread(channelId, t, threadId = root.id) }
                                .onSuccess { m -> val cur = list.orEmpty(); if (cur.none { it.id == m.id }) list = cur + m }
                                .onFailure { text = t; error = null }
                            sending = false
                        }
                    },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.AutoMirrored.Filled.Send, "Enviar", tint = PC.OnBrand, modifier = Modifier.size(18.dp)) }
            }
        }
    }
}

@Composable
private fun ThreadBubble(m: Message, isRoot: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp)) {
        Avatar(m.author, 36.dp)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(m.author?.name ?: "Usuário", color = PC.Header, fontWeight = FontWeight.Bold)
            val body = m.content?.takeIf { it.isNotBlank() } ?: if (isRoot) null else when {
                m.attachments.isNotEmpty() -> "📎 Anexo"
                m.stickerUrl != null -> "🏷️ Figurinha"
                else -> null
            }
            body?.let { Text(it, color = PC.Text, style = MaterialTheme.typography.bodyMedium) }
            if (isRoot) Text("Começou o tópico “${m.title.orEmpty()}”", color = PC.Muted, style = MaterialTheme.typography.labelSmall)
        }
    }
}

/** "Criar tópico" a partir de uma mensagem do canal. */
@Composable
fun CreateThreadDialog(repo: Repository, parent: Message, onDone: (root: Message?, toast: String?) -> Unit) {
    var name by remember { mutableStateOf(parent.content?.replace(Regex("\\s+"), " ")?.trim()?.take(60).orEmpty()) }
    var first by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val channelId = parent.channelId ?: return
    AlertDialog(
        onDismissRequest = { onDone(null, null) },
        title = { Text("Criar tópico") },
        text = {
            Column {
                OutlinedTextField(name, { name = it.take(100) }, Modifier.fillMaxWidth(), singleLine = true, label = { Text("Nome do tópico") })
                OutlinedTextField(first, { first = it.take(2000) }, Modifier.fillMaxWidth().padding(top = 6.dp), maxLines = 4, label = { Text("Primeira mensagem (opcional)") })
                error?.let { Text(it, color = PC.Red, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && name.isNotBlank(), onClick = {
                busy = true; error = null
                scope.launch {
                    runCatching { repo.sendThread(channelId, null, parentId = parent.id, title = name.trim()) }
                        .onSuccess { root ->
                            if (first.isNotBlank()) runCatching { repo.sendThread(channelId, first.trim(), threadId = root.id) }
                            onDone(root, "Tópico criado.")
                        }
                        .onFailure { error = (it as? ApiException)?.message ?: "Não deu pra criar o tópico. Tente de novo." }
                    busy = false
                }
            }) { Text(if (busy) "Criando…" else "Criar tópico") }
        },
        dismissButton = { TextButton(onClick = { onDone(null, null) }) { Text("Cancelar") } },
        containerColor = PC.Surface,
    )
}
