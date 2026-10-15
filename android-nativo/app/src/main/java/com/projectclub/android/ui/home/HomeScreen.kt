package com.projectclub.android.ui.home

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Apps
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import com.projectclub.android.data.Repository
import com.projectclub.android.data.Room
import com.projectclub.android.ui.theme.PC

/** Ações de navegação que as abas usam. */
data class HomeActions(
    val openRoom: (Room) -> Unit,
    val openWeb: (String) -> Unit,
    val joinVoice: (channelName: String, title: String) -> Unit,
    val openCall: () -> Unit,
)

private enum class Tab(val label: String, val icon: ImageVector) {
    Community("Comunidade", Icons.Filled.Forum),
    Dms("Mensagens", Icons.Filled.ChatBubble),
    Notices("Avisos", Icons.Filled.Notifications),
    More("Mais", Icons.Filled.Apps),
}

@Composable
fun HomeScreen(repo: Repository, actions: HomeActions, callBar: @Composable () -> Unit) {
    var tab by rememberSaveable { mutableTabState() }
    val conversations by repo.conversations.collectAsState()
    val me by repo.me.collectAsState()
    val unreadNotices by repo.unreadNotices.collectAsState()
    val unreadDms = conversations.count { com.projectclub.android.data.ChatLogic.isConversationUnread(it, me?.id) }

    Scaffold(
        containerColor = PC.Bg,
        topBar = callBar,
        bottomBar = {
            NavigationBar(containerColor = PC.Surface) {
                Tab.entries.forEach { t ->
                    val badge = when (t) { Tab.Dms -> unreadDms; Tab.Notices -> unreadNotices; else -> 0 }
                    NavigationBarItem(
                        selected = tab == t.ordinal,
                        onClick = { tab = t.ordinal },
                        icon = {
                            BadgedBox(badge = { if (badge > 0) Badge { Text(if (badge > 99) "99+" else badge.toString()) } }) {
                                Icon(t.icon, contentDescription = t.label)
                            }
                        },
                        label = { Text(t.label) },
                        colors = NavigationBarItemDefaults.colors(indicatorColor = PC.Surface2),
                    )
                }
            }
        },
    ) { pad ->
        val m = Modifier.padding(pad)
        when (Tab.entries[tab]) {
            Tab.Community -> ChannelsTab(repo, actions, m)
            Tab.Dms -> DmsTab(repo, actions, m)
            Tab.Notices -> NoticesTab(repo, actions, m)
            Tab.More -> MoreTab(repo, actions, m)
        }
    }
}

private fun mutableTabState() = androidx.compose.runtime.mutableIntStateOf(0)
