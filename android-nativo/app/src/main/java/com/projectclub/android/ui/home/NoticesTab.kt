package com.projectclub.android.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.CardGiftcard
import androidx.compose.material.icons.outlined.DoneAll
import androidx.compose.material.icons.outlined.EmojiEvents
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material.icons.outlined.ShoppingBag
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.projectclub.android.data.Notice
import com.projectclub.android.data.Repository
import com.projectclub.android.ui.common.EmptyState
import com.projectclub.android.ui.common.IconTile
import com.projectclub.android.ui.common.ListSkeleton
import com.projectclub.android.ui.common.PcCard
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.common.formatTime
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch

/** Aba Avisos: lembretes, presentes e recados da equipe. */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun NoticesTab(repo: Repository, actions: HomeActions) {
    val notices by repo.notices.collectAsState()
    val unread by repo.unreadNotices.collectAsState()
    val loaded by repo.loaded.collectAsState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize()) {
        PcTopBar("Avisos", Icons.Outlined.Notifications) {
            if (unread > 0) IconButton(onClick = { scope.launch { repo.markAllNoticesRead() } }) {
                Icon(Icons.Outlined.DoneAll, "Marcar tudo como lido", tint = PC.Brand)
            }
        }
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { scope.launch { refreshing = true; runCatching { repo.loadNotices() }; refreshing = false } },
            modifier = Modifier.fillMaxSize(),
        ) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (!loaded && notices.isEmpty()) item { ListSkeleton(6, 40.dp) }
                else if (notices.isEmpty()) item {
                    EmptyState(Icons.Outlined.NotificationsNone, "Tudo em dia", "Lembretes de eventos, presentes e recados da equipe aparecem aqui.")
                }
                items(notices, key = { it.id }) { n ->
                    val (icon, color) = look(n)
                    val isNew = n.readAt == null
                    PcCard(
                        onClick = {
                            scope.launch { repo.markNoticeRead(n.id) }
                            n.link?.takeIf { it.isNotBlank() }?.let(actions.openWeb)
                        },
                        padding = PaddingValues(14.dp),
                        border = if (isNew) color.copy(alpha = 0.35f) else PC.Line,
                    ) {
                        Row {
                            IconTile(icon, color, 42.dp)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(n.title ?: "Aviso", color = PC.Header, style = MaterialTheme.typography.titleSmall, fontWeight = if (isNew) FontWeight.ExtraBold else FontWeight.SemiBold, modifier = Modifier.weight(1f))
                                    if (isNew) Box(Modifier.size(9.dp).clip(CircleShape).background(PC.Brand))
                                }
                                n.body?.takeIf { it.isNotBlank() }?.let { Text(it, color = PC.Text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 2.dp)) }
                                Text(formatTime(n.createdAt), color = PC.Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun look(n: Notice): Pair<ImageVector, Color> {
    val k = (n.kind ?: "").lowercase()
    return when {
        "event" in k || "evento" in k -> Icons.Outlined.CalendarMonth to PC.Events
        "gift" in k || "present" in k -> Icons.Outlined.CardGiftcard to PC.Pink
        "shop" in k || "loja" in k || "store" in k -> Icons.Outlined.ShoppingBag to PC.Store
        "achiev" in k || "conquista" in k || "level" in k || "rank" in k -> Icons.Outlined.EmojiEvents to PC.Yellow
        "announ" in k || "anuncio" in k || "staff" in k -> Icons.Outlined.Campaign to PC.Announce
        else -> Icons.Outlined.Notifications to PC.Brand
    }
}
