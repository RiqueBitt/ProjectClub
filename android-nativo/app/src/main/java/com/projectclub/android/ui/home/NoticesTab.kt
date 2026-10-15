package com.projectclub.android.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.unit.dp
import com.projectclub.android.data.Repository
import com.projectclub.android.ui.common.formatTime
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun NoticesTab(repo: Repository, actions: HomeActions, modifier: Modifier) {
    val notices by repo.notices.collectAsState()
    val unread by repo.unreadNotices.collectAsState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = { scope.launch { refreshing = true; runCatching { repo.loadNotices() }; refreshing = false } },
        modifier = modifier.fillMaxSize(),
    ) {
        LazyColumn(Modifier.fillMaxSize()) {
            item {
                Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Avisos", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                    if (unread > 0) TextButton(onClick = { scope.launch { repo.markAllNoticesRead() } }) { Text("Marcar tudo como lido") }
                }
            }
            if (notices.isEmpty()) item {
                Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) {
                    Text("Nada por aqui ainda. Lembretes de eventos, presentes e recados da equipe aparecem aqui.", color = PC.Muted, textAlign = TextAlign.Center)
                }
            }
            items(notices, key = { it.id }) { n ->
                Row(
                    Modifier.fillMaxWidth().clickable {
                        scope.launch { repo.markNoticeRead(n.id) }
                        n.link?.takeIf { it.isNotBlank() }?.let(actions.openWeb)
                    }.padding(horizontal = 16.dp, vertical = 12.dp),
                ) {
                    Box(Modifier.padding(top = 7.dp).size(8.dp).clip(CircleShape).background(if (n.readAt == null) PC.Brand else PC.Bg))
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(n.title ?: "Aviso", fontWeight = if (n.readAt == null) FontWeight.Bold else FontWeight.SemiBold)
                        n.body?.takeIf { it.isNotBlank() }?.let { Text(it, color = PC.Muted) }
                        Text(formatTime(n.createdAt), color = PC.Muted, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 4.dp))
                    }
                }
            }
        }
    }
}
