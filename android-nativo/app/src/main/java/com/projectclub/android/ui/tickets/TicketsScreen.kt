package com.projectclub.android.ui.tickets

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.SupportAgent
import androidx.compose.material.icons.outlined.Title
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.projectclub.android.data.Repository
import com.projectclub.android.data.Ticket
import com.projectclub.android.data.TicketMessageResponse
import com.projectclub.android.data.TicketResponse
import com.projectclub.android.data.TicketsResponse
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.Chip
import com.projectclub.android.ui.common.EmptyState
import com.projectclub.android.ui.common.GhostButton
import com.projectclub.android.ui.common.IconTile
import com.projectclub.android.ui.common.ListSkeleton
import com.projectclub.android.ui.common.PcCard
import com.projectclub.android.ui.common.PcField
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.common.formatTime
import com.projectclub.android.ui.common.shortTime
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Suporte: meus chamados e abrir chamado novo. */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun TicketsScreen(repo: Repository, nav: AppNav) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf<List<Ticket>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }
    var subject by remember { mutableStateOf("") }
    var content by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    suspend fun load() {
        try { list = repo.api.get<TicketsResponse>("/api/tickets/mine").tickets; error = null }
        catch (e: Exception) { if (list == null) error = e.message ?: "Não deu pra carregar." }
    }
    LaunchedEffect(Unit) { load() }

    Box(Modifier.fillMaxSize().background(PC.Bg)) {
        Column(Modifier.fillMaxSize()) {
            PcTopBar("Suporte", Icons.Outlined.SupportAgent, navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } })
            val l = list
            when {
                l == null && error != null -> EmptyState(Icons.Outlined.CloudOff, "Não deu pra abrir", error ?: "", Modifier.padding(top = 40.dp)) {
                    GhostButton("Tentar de novo", { scope.launch { error = null; load() } })
                }
                l == null -> ListSkeleton(5)
                else -> PullToRefreshBox(refreshing, onRefresh = { scope.launch { refreshing = true; load(); refreshing = false } }, Modifier.fillMaxSize()) {
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp, 16.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (l.isEmpty()) item {
                            EmptyState(Icons.Outlined.SupportAgent, "Nenhum chamado", "Precisa de ajuda? Abra um chamado e a equipe responde por aqui.")
                        }
                        items(l, key = { it.id }) { t ->
                            PcCard(onClick = { nav.ticket(t.id) }, padding = PaddingValues(14.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    IconTile(if (t.isOpen) Icons.Outlined.SupportAgent else Icons.Outlined.Lock, if (t.isOpen) PC.Green else PC.Muted)
                                    Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                                        Text(t.subject, color = PC.Header, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        Text(t.messages.lastOrNull()?.content ?: "", color = PC.Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    }
                                    Column(horizontalAlignment = Alignment.End) {
                                        Chip(if (t.isOpen) "Aberto" else "Fechado", if (t.isOpen) PC.Green else PC.Muted)
                                        Text(shortTime(t.updatedAt ?: t.createdAt), color = PC.Muted, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 4.dp))
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        ExtendedFloatingActionButton(
            onClick = { creating = true }, containerColor = PC.Brand, contentColor = PC.OnBrand,
            icon = { Icon(Icons.Outlined.Add, null) }, text = { Text("Novo chamado") },
            modifier = Modifier.align(Alignment.BottomEnd).navigationBarsPadding().padding(16.dp),
        )
    }

    if (creating) AlertDialog(
        onDismissRequest = { if (!busy) creating = false },
        containerColor = PC.Surface2,
        title = { Text("Novo chamado") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                PcField(subject, { subject = it.take(120) }, "Resumo do problema", label = "Assunto", icon = Icons.Outlined.Title)
                PcField(content, { content = it }, "Conte o que aconteceu", label = "Mensagem", singleLine = false, modifier = Modifier.heightIn(min = 110.dp))
            }
        },
        confirmButton = {
            TextButton(enabled = subject.isNotBlank() && content.isNotBlank() && !busy, onClick = {
                busy = true
                scope.launch {
                    try {
                        val t = repo.api.post<TicketResponse>("/api/tickets", buildJsonObject { put("subject", subject.trim()); put("content", content.trim()) }).ticket
                        creating = false; subject = ""; content = ""
                        load()
                        t?.id?.let(nav::ticket)
                    } catch (e: Exception) { Toast.makeText(ctx, e.message ?: "Não deu pra abrir o chamado.", Toast.LENGTH_SHORT).show() }
                    busy = false
                }
            }) { Text("Enviar", color = PC.Brand) }
        },
        dismissButton = { TextButton(onClick = { creating = false }) { Text("Cancelar", color = PC.Text) } },
    )
}

/** Conversa de um chamado. */
@Composable
fun TicketScreen(repo: Repository, nav: AppNav, ticketId: String) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val me by repo.me.collectAsState()
    var ticket by remember { mutableStateOf<Ticket?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var text by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()

    suspend fun load() {
        try { ticket = repo.api.get<TicketResponse>("/api/tickets/$ticketId").ticket; error = null }
        catch (e: Exception) { if (ticket == null) error = e.message ?: "Não deu pra abrir o chamado." }
    }
    LaunchedEffect(ticketId) {
        load()
        // A equipe responde por aqui: confere de tempos em tempos.
        while (true) { kotlinx.coroutines.delay(15_000); load() }
    }
    LaunchedEffect(ticket?.messages?.size) { ticket?.messages?.size?.takeIf { it > 0 }?.let { listState.animateScrollToItem(it - 1) } }

    Column(Modifier.fillMaxSize().background(PC.Bg).imePadding()) {
        val t = ticket
        PcTopBar(t?.subject ?: "Chamado", Icons.Outlined.SupportAgent, navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } })
        when {
            t == null && error != null -> EmptyState(Icons.Outlined.CloudOff, "Não deu pra abrir", error ?: "", Modifier.padding(top = 40.dp)) {
                GhostButton("Tentar de novo", { scope.launch { error = null; load() } })
            }
            t == null -> ListSkeleton(6)
            else -> {
                LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    item {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Chip(if (t.isOpen) "Aberto" else "Fechado", if (t.isOpen) PC.Green else PC.Muted)
                            t.claimedBy?.let { Text("  Atendido por ${it.name}", color = PC.Muted, style = MaterialTheme.typography.bodySmall) }
                        }
                    }
                    items(t.messages, key = { it.id }) { m ->
                        val mine = m.authorId == me?.id || m.author?.id == me?.id
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start, verticalAlignment = Alignment.Bottom) {
                            if (!mine) { Avatar(m.author, 30.dp); Box(Modifier.size(8.dp)) }
                            Column(
                                Modifier.widthIn(max = 300.dp).clip(RoundedCornerShape(18.dp)).background(if (mine) PC.BrandDark else PC.Surface2).padding(12.dp),
                            ) {
                                if (!mine) Text(m.author?.name ?: "Equipe", color = PC.Brand, style = MaterialTheme.typography.labelMedium)
                                Text(m.content, color = if (mine) PC.OnBrand else PC.Text, style = MaterialTheme.typography.bodyMedium)
                                Text(formatTime(m.createdAt), color = if (mine) Color(0xBBFFFFFF) else PC.Muted, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 4.dp))
                            }
                        }
                    }
                }
                if (t.isOpen) {
                    val shape = RoundedCornerShape(24.dp)
                    Row(
                        Modifier.fillMaxWidth().navigationBarsPadding().padding(10.dp).clip(shape).background(PC.Surface).border(1.dp, PC.Line, shape)
                            .padding(start = 16.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.weight(1f).padding(vertical = 8.dp)) {
                            if (text.isEmpty()) Text("Escreva sua mensagem...", color = PC.Faint)
                            BasicTextField(text, { text = it }, maxLines = 5, textStyle = MaterialTheme.typography.bodyLarge.copy(color = PC.Header), cursorBrush = SolidColor(PC.Brand), modifier = Modifier.fillMaxWidth())
                        }
                        IconButton(enabled = text.isNotBlank() && !sending, onClick = {
                            sending = true
                            scope.launch {
                                try {
                                    repo.api.post<TicketMessageResponse>("/api/tickets/$ticketId/messages", buildJsonObject { put("content", text.trim()) })
                                    text = ""; load()
                                } catch (e: Exception) { Toast.makeText(ctx, e.message ?: "Não deu pra enviar.", Toast.LENGTH_SHORT).show() }
                                sending = false
                            }
                        }) {
                            if (sending) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                            else Icon(Icons.AutoMirrored.Filled.Send, "Enviar", tint = if (text.isNotBlank()) PC.Brand else PC.Muted)
                        }
                    }
                } else Text(
                    "Este chamado foi fechado. Abra um novo se precisar de mais ajuda.", color = PC.Muted, style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp),
                )
            }
        }
    }
}
