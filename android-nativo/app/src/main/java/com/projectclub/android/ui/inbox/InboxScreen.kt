package com.projectclub.android.ui.inbox

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.AlternateEmail
import androidx.compose.material.icons.outlined.Bookmark
import androidx.compose.material.icons.outlined.BookmarkRemove
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.TabRowDefaults
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.projectclub.android.data.Repository
import com.projectclub.android.data.Room
import com.projectclub.android.data.User
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.EmptyState
import com.projectclub.android.ui.common.GhostButton
import com.projectclub.android.ui.common.ListSkeleton
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.common.formatTime
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Serializable
data class InboxMessage(
    val id: String = "",
    val content: String? = null,
    val channelId: String? = null,
    val conversationId: String? = null,
    val createdAt: String? = null,
    val author: User? = null,
    val channelName: String? = null,
    val attachments: List<kotlinx.serialization.json.JsonElement> = emptyList(),
)

@Serializable
data class InboxResponse(val messages: List<InboxMessage> = emptyList(), val hasMore: Boolean = false)

/** Caixa de Entrada (igual ao site): menções e respostas pra você + mensagens favoritas. */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun InboxScreen(repo: Repository, nav: AppNav, startTab: Int = 0) {
    val scope = rememberCoroutineScope()
    var tab by remember { mutableIntStateOf(startTab) }
    var lists by remember { mutableStateOf<Map<Int, List<InboxMessage>>>(emptyMap()) }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    suspend fun load(t: Int) {
        try {
            val path = if (t == 0) "/api/messages/mentions" else "/api/messages/saved"
            lists = lists + (t to repo.api.get<InboxResponse>(path).messages); error = null
        } catch (e: Exception) { if (lists[t] == null) error = e.message ?: "Não deu pra carregar." }
    }
    LaunchedEffect(tab) { load(tab) }

    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        PcTopBar("Caixa de entrada", Icons.Outlined.Inbox, navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } })
        TabRow(
            selectedTabIndex = tab, containerColor = PC.Bg, contentColor = PC.Header,
            indicator = { pos -> TabRowDefaults.SecondaryIndicator(Modifier.tabIndicatorOffset(pos[tab]), color = PC.Brand) },
        ) {
            Tab(tab == 0, { tab = 0 }, text = { Text("Menções") }, icon = { Icon(Icons.Outlined.AlternateEmail, null) })
            Tab(tab == 1, { tab = 1 }, text = { Text("Favoritos") }, icon = { Icon(Icons.Outlined.Bookmark, null) })
        }
        val l = lists[tab]
        when {
            l == null && error != null -> EmptyState(Icons.Outlined.CloudOff, "Não deu pra abrir", error ?: "", Modifier.padding(top = 40.dp)) {
                GhostButton("Tentar de novo", { scope.launch { error = null; load(tab) } })
            }
            l == null -> ListSkeleton(6)
            else -> PullToRefreshBox(refreshing, onRefresh = { scope.launch { refreshing = true; load(tab); refreshing = false } }, Modifier.fillMaxSize()) {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (l.isEmpty()) item {
                        if (tab == 0) EmptyState(Icons.Outlined.AlternateEmail, "Nenhuma menção", "Quando alguém te marcar ou responder sua mensagem num canal, aparece aqui.")
                        else EmptyState(Icons.Outlined.Bookmark, "Nenhum favorito", "Segure uma mensagem no chat e toque em \"Favoritar\" pra guardar aqui.")
                    }
                    items(l, key = { it.id }) { m ->
                        InboxItem(m, onOpen = {
                            nav.room(if (m.channelId != null) Room(channelId = m.channelId) else Room(conversationId = m.conversationId))
                        }, onUnsave = if (tab == 1) ({
                            lists = lists + (1 to l.filter { it.id != m.id })
                            scope.launch { runCatching { repo.api.postIgnore("/api/messages/${m.id}/save", buildJsonObject { put("on", false) }) } }
                        }) else null)
                    }
                    item { Spacer(Modifier.navigationBarsPadding()) }
                }
            }
        }
    }
}

@Composable
private fun InboxItem(m: InboxMessage, onOpen: () -> Unit, onUnsave: (() -> Unit)?) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(PC.Surface).clickable(onClick = onOpen).padding(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Avatar(m.author, 38.dp)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(m.author?.name ?: "Alguém", color = PC.Header, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                Spacer(Modifier.width(8.dp))
                Text(formatTime(m.createdAt), color = PC.Faint, style = MaterialTheme.typography.labelSmall)
            }
            Text(
                m.channelName?.let { "# $it" } ?: if (m.conversationId != null) "Mensagem direta" else "",
                color = PC.Muted, style = MaterialTheme.typography.labelSmall, maxLines = 1,
            )
            Spacer(Modifier.height(4.dp))
            val text = m.content?.takeIf { it.isNotBlank() } ?: if (m.attachments.isNotEmpty()) "📎 Anexo" else ""
            Text(text, color = PC.Text, style = MaterialTheme.typography.bodyMedium, maxLines = 4, overflow = TextOverflow.Ellipsis)
        }
        if (onUnsave != null) {
            IconButton(onClick = onUnsave, modifier = Modifier.size(36.dp)) { Icon(Icons.Outlined.BookmarkRemove, "Tirar dos favoritos", tint = PC.Muted) }
        }
    }
}
