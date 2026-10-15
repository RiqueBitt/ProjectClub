package com.projectclub.android.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.projectclub.android.data.Conversation
import com.projectclub.android.data.Repository
import com.projectclub.android.data.Room
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.shortTime
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch

@Composable
fun DmsTab(repo: Repository, actions: HomeActions, modifier: Modifier) {
    val conversations by repo.conversations.collectAsState()
    val me by repo.me.collectAsState()
    val presence by repo.presence.collectAsState()
    var picking by remember { mutableStateOf(false) }

    Box(modifier.fillMaxSize()) {
        if (conversations.isEmpty()) {
            Text(
                "Nenhuma conversa ainda.\nToque em “Nova mensagem” pra falar com um amigo.",
                color = PC.Muted, textAlign = TextAlign.Center, modifier = Modifier.align(Alignment.Center).padding(32.dp),
            )
        }
        LazyColumn(Modifier.fillMaxSize()) {
            items(conversations, key = { it.id }) { conv ->
                val other = conv.members.firstOrNull { it.id != me?.id }
                ConversationRow(
                    conv, repo.conversationTitle(conv), other, if (conv.isGroup) null else presence[other?.id] ?: "OFFLINE",
                    repo.isUnread(conv), preview(repo, conv, me?.id),
                ) { actions.openRoom(Room(conversationId = conv.id)) }
            }
        }
        ExtendedFloatingActionButton(
            onClick = { picking = true },
            icon = { Icon(Icons.Filled.Edit, null) }, text = { Text("Nova mensagem") },
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
        )
    }
    if (picking) FriendPicker(repo, onDismiss = { picking = false }) { conv ->
        picking = false
        actions.openRoom(Room(conversationId = conv.id))
    }
}

private fun preview(repo: Repository, conv: Conversation, myId: String?): String {
    val lm = conv.lastMessage ?: return "Diga oi 👋"
    val who = if (lm.authorId == myId) "Você: " else if (conv.isGroup) (repo.user(lm.authorId)?.name?.let { "$it: " } ?: "") else ""
    val body = lm.content?.takeIf { it.isNotBlank() }
        ?: if (lm.attachmentCount > 0) "📎 Anexo" else if (lm.stickerUrl != null) "🏷️ Figurinha" else "Mensagem"
    return who + body.replace('\n', ' ')
}

@Composable
private fun ConversationRow(conv: Conversation, title: String, other: com.projectclub.android.data.User?, status: String?, unread: Boolean, preview: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        if (conv.isGroup) {
            Box(Modifier.size(48.dp).clip(CircleShape).background(PC.Surface2), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Groups, null, tint = PC.Muted)
            }
        } else Avatar(other, 48.dp, status)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(title, fontWeight = if (unread) FontWeight.ExtraBold else FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Text(shortTime(conv.lastMessage?.createdAt), color = PC.Muted, style = MaterialTheme.typography.labelSmall)
            }
            Text(preview, color = if (unread) PC.Text else PC.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Normal)
        }
        if (unread) { Spacer(Modifier.width(8.dp)); Box(Modifier.size(10.dp).clip(CircleShape).background(PC.Brand)) }
    }
}

/** Escolher um amigo pra conversar. */
@Composable
private fun FriendPicker(repo: Repository, onDismiss: () -> Unit, onOpened: (Conversation) -> Unit) {
    val friends by repo.friends.collectAsState()
    var query by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { runCatching { repo.loadFriends() } }
    val accepted = friends.filter { it.status == "ACCEPTED" }.map { it.user }
        .filter { query.isBlank() || "${it.displayName} ${it.username}".contains(query, ignoreCase = true) }
        .sortedBy { it.name.lowercase() }
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = onDismiss) { Text("Fechar") } },
        title = { Text("Nova mensagem") },
        text = {
            Column {
                OutlinedTextField(query, { query = it }, label = { Text("Buscar amigo") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                error?.let { Text(it, color = PC.Red, modifier = Modifier.padding(top = 8.dp)) }
                LazyColumn(Modifier.padding(top = 8.dp).fillMaxWidth().heightIn(max = 360.dp)) {
                    if (accepted.isEmpty()) item { Text("Nenhum amigo encontrado.", color = PC.Muted, modifier = Modifier.padding(8.dp)) }
                    items(accepted, key = { it.id }) { u ->
                        Row(
                            Modifier.fillMaxWidth().clip(MaterialTheme.shapes.medium).clickable {
                                scope.launch {
                                    try { onOpened(repo.openDm(u.id)) } catch (e: Exception) { error = e.message }
                                }
                            }.padding(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Avatar(u, 36.dp)
                            Spacer(Modifier.width(10.dp))
                            Column {
                                Text(u.name, fontWeight = FontWeight.SemiBold)
                                Text("@${u.username}", color = PC.Muted, style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                }
            }
        },
    )
}
