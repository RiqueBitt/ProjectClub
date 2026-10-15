package com.projectclub.android.ui.home

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.projectclub.android.data.Conversation
import com.projectclub.android.data.Repository
import com.projectclub.android.data.Room
import com.projectclub.android.data.User
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.CountBadge
import com.projectclub.android.ui.common.EmptyState
import com.projectclub.android.ui.common.GhostButton
import com.projectclub.android.ui.common.HeroBox
import com.projectclub.android.ui.common.ListSkeleton
import com.projectclub.android.ui.common.PcCard
import com.projectclub.android.ui.common.PcField
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.common.shortTime
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch

/** Aba Social: mensagens diretas e amigos, no visual da página Social do site. */
@Composable
fun SocialTab(repo: Repository, actions: HomeActions) {
    val conversations by repo.conversations.collectAsState()
    val friends by repo.friends.collectAsState()
    val me by repo.me.collectAsState()
    val presence by repo.presence.collectAsState()
    val loaded by repo.loaded.collectAsState()
    var section by rememberSaveable { mutableIntStateOf(0) }
    var query by rememberSaveable { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { runCatching { repo.loadFriends() } }

    fun statusOf(u: User?) = presence[u?.id] ?: u?.status ?: "OFFLINE"
    val accepted = friends.filter { it.status == "ACCEPTED" }.map { it.user }
    val onlineFriends = accepted.filter { statusOf(it) != "OFFLINE" && statusOf(it) != "INVISIBLE" }
    val pending = friends.count { it.status == "PENDING" && it.isIncoming }
    val unreadDms = conversations.count { repo.isUnread(it) }
    val q = query.trim()
    val convList = conversations.filter { q.isEmpty() || repo.conversationTitle(it).contains(q, ignoreCase = true) }
    val friendList = accepted
        .filter { q.isEmpty() || "${it.displayName} ${it.username}".contains(q, ignoreCase = true) }
        .sortedWith(compareBy({ if (statusOf(it) == "OFFLINE") 1 else 0 }, { it.name.lowercase() }))

    fun dm(u: User) = scope.launch {
        try { actions.openRoom(Room(conversationId = repo.openDm(u.id).id)) } catch (e: Exception) { error = e.message }
    }

    Column(Modifier.fillMaxSize()) {
        PcTopBar("Social", Icons.Outlined.People)
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item(key = "hero") {
                HeroBox(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(20.dp)) {
                        Text("Social", style = MaterialTheme.typography.headlineMedium, color = Color.White)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("${accepted.size} amigo${if (accepted.size == 1) "" else "s"} · ", color = Color(0xCCFFFFFF))
                            Box(Modifier.size(8.dp).clip(CircleShape).background(PC.Green))
                            Text(" ${onlineFriends.size} online", color = Color(0xCCFFFFFF))
                        }
                        Spacer(Modifier.height(14.dp))
                        PcField(query, { query = it }, "Enviar mensagem para...", icon = Icons.Outlined.Search)
                        Spacer(Modifier.height(12.dp))
                        Segmented(
                            listOf(Triple(Icons.Outlined.ChatBubbleOutline, "Mensagens", unreadDms), Triple(Icons.Outlined.People, "Amigos", pending)),
                            section,
                        ) { section = it }
                    }
                }
            }
            error?.let { e -> item { Text(e, color = PC.Red, modifier = Modifier.padding(4.dp)) } }

            if (onlineFriends.isNotEmpty() && q.isEmpty()) item(key = "online") {
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    onlineFriends.take(20).forEach { u ->
                        Column(Modifier.width(66.dp).clip(RoundedCornerShape(14.dp)).clickable { dm(u) }, horizontalAlignment = Alignment.CenterHorizontally) {
                            Avatar(u, 58.dp, statusOf(u))
                            Spacer(Modifier.height(6.dp))
                            Text(u.name, color = PC.Text, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }

            if (!loaded) item { ListSkeleton(6, 48.dp) }
            else if (section == 0) {
                if (convList.isEmpty()) item {
                    EmptyState(
                        Icons.Outlined.ChatBubbleOutline, if (q.isEmpty()) "Nenhuma conversa ainda" else "Nada encontrado",
                        if (q.isEmpty()) "Escolha um amigo em Amigos pra começar a conversar." else "Nenhuma conversa com \"$q\".",
                    ) { GhostButton("Ver amigos", { section = 1 }, icon = Icons.Outlined.People) }
                }
                items(convList, key = { it.id }) { conv ->
                    val other = conv.members.firstOrNull { it.id != me?.id }
                    ConversationCard(conv, repo.conversationTitle(conv), other, if (conv.isGroup) null else statusOf(other), repo.isUnread(conv), preview(repo, conv, me?.id)) {
                        actions.openRoom(Room(conversationId = conv.id))
                    }
                }
            } else {
                if (pending > 0) item {
                    PcCard(onClick = { actions.openWeb("/dms") }, padding = PaddingValues(14.dp), border = PC.Red.copy(alpha = 0.35f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.PersonAdd, null, tint = PC.Red)
                            Spacer(Modifier.width(12.dp))
                            Text("$pending pedido${if (pending == 1) "" else "s"} de amizade", color = PC.Header, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                            CountBadge(pending)
                        }
                    }
                }
                if (friendList.isEmpty()) item {
                    EmptyState(Icons.Outlined.People, "Nenhum amigo por aqui", "Adicione amigos pelo site e eles aparecem aqui.") {
                        GhostButton("Adicionar amigo", { actions.openWeb("/dms") }, icon = Icons.Outlined.PersonAdd)
                    }
                }
                items(friendList, key = { "f-" + it.id }) { u ->
                    PcCard(onClick = { dm(u) }, padding = PaddingValues(12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Avatar(u, 48.dp, statusOf(u))
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(u.name, color = PC.Header, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(u.customStatus?.takeIf { it.isNotBlank() } ?: "@${u.username}", color = PC.Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(PC.Surface2), contentAlignment = Alignment.Center) {
                                Icon(Icons.Outlined.ChatBubbleOutline, "Mensagem", tint = PC.Brand, modifier = Modifier.size(20.dp))
                            }
                        }
                    }
                }
            }
        }
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
private fun ConversationCard(conv: Conversation, title: String, other: User?, status: String?, unread: Boolean, preview: String, onClick: () -> Unit) {
    PcCard(onClick = onClick, padding = PaddingValues(12.dp), border = if (unread) PC.Brand.copy(alpha = 0.35f) else PC.Line) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (conv.isGroup) {
                Box(Modifier.size(48.dp).clip(CircleShape).background(PC.Surface2), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.Groups, null, tint = PC.Muted)
                }
            } else Avatar(other, 48.dp, status)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(title, color = PC.Header, fontWeight = if (unread) FontWeight.ExtraBold else FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Text(shortTime(conv.lastMessage?.createdAt), color = if (unread) PC.Brand else PC.Muted, style = MaterialTheme.typography.labelSmall)
                }
                Text(preview, color = if (unread) PC.Text else PC.Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Normal)
            }
            if (unread) { Spacer(Modifier.width(10.dp)); Box(Modifier.size(10.dp).clip(CircleShape).background(PC.Brand)) }
        }
    }
}

/** Abas em pílula (Mensagens | Amigos), como no site. */
@Composable
private fun Segmented(items: List<Triple<ImageVector, String, Int>>, selected: Int, onSelect: (Int) -> Unit) {
    val shape = RoundedCornerShape(18.dp)
    Row(Modifier.fillMaxWidth().clip(shape).background(Color(0x99000000)).border(1.dp, PC.Line, shape).padding(5.dp)) {
        items.forEachIndexed { i, (icon, label, badge) ->
            val on = i == selected
            val bg by animateColorAsState(if (on) PC.Surface2 else Color.Transparent, label = "seg")
            Row(
                Modifier.weight(1f).clip(RoundedCornerShape(14.dp)).background(bg).clickable { onSelect(i) }.padding(vertical = 11.dp),
                horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(icon, null, tint = if (on) PC.Brand else PC.Muted, modifier = Modifier.size(19.dp))
                Spacer(Modifier.width(8.dp))
                Text(label, color = if (on) PC.Header else PC.Muted, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                if (badge > 0) { Spacer(Modifier.width(6.dp)); CountBadge(badge) }
            }
        }
    }
}
