package com.projectclub.android.ui.home

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.People
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.projectclub.android.data.ChatLogic
import com.projectclub.android.data.Repository
import com.projectclub.android.data.Room
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.CountBadge
import com.projectclub.android.ui.theme.PC

/** Ações de navegação que as abas usam. */
data class HomeActions(
    val openRoom: (Room) -> Unit,
    val openWeb: (String) -> Unit,
    val joinVoice: (channelName: String, title: String) -> Unit,
    val openCall: () -> Unit,
)

enum class Tab(val label: String, val icon: ImageVector?) {
    Home("Início", Icons.Outlined.Home),
    Community("Comunidade", Icons.Outlined.ChatBubbleOutline),
    Social("Social", Icons.Outlined.People),
    Notices("Avisos", Icons.Outlined.Notifications),
    You("Você", null),
}

/** Tela principal: abas embaixo, igual à navegação do site no celular. */
@Composable
fun HomeScreen(
    repo: Repository, actions: HomeActions, nav: com.projectclub.android.ui.nav.AppNav,
    tab: Int, onTab: (Int) -> Unit, callBar: @Composable () -> Unit,
) {
    val conversations by repo.conversations.collectAsState()
    val friends by repo.friends.collectAsState()
    val me by repo.me.collectAsState()
    val presence by repo.presence.collectAsState()
    val unreadNotices by repo.unreadNotices.collectAsState()
    val unreadDms = conversations.count { ChatLogic.isConversationUnread(it, me?.id) }
    val pending = friends.count { it.status == "PENDING" && it.isIncoming }

    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        Column(Modifier.background(PC.Bar).statusBarsPadding()) { callBar() }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            AnimatedContent(tab, label = "tab", transitionSpec = { fadeIn(tween(160)) togetherWith fadeOut(tween(120)) }) { t ->
                when (Tab.entries[t]) {
                    Tab.Home -> HomeTab(repo, actions, nav) { onTab(it.ordinal) }
                    Tab.Community -> ChannelsTab(repo, actions)
                    Tab.Social -> SocialTab(repo, actions)
                    Tab.Notices -> NoticesTab(repo, actions)
                    Tab.You -> MoreTab(repo, actions, nav)
                }
            }
        }
        // Barra de abas
        Column(Modifier.background(PC.Bar).navigationBarsPadding()) {
            HorizontalDivider(color = PC.Line)
            Row(Modifier.fillMaxWidth().height(68.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Tab.entries.forEach { t ->
                    val badge = when (t) { Tab.Social -> unreadDms + pending; Tab.Notices -> unreadNotices; else -> 0 }
                    TabItem(
                        t, tab == t.ordinal, badge, Modifier.weight(1f),
                        icon = { tint ->
                            if (t == Tab.You) Avatar(me, 28.dp, presence[me?.id] ?: "ONLINE")
                            else Icon(t.icon!!, t.label, modifier = Modifier.size(24.dp), tint = tint)
                        },
                        onClick = { onTab(t.ordinal) },
                    )
                }
            }
        }
    }
}

@Composable
private fun TabItem(t: Tab, selected: Boolean, badge: Int, modifier: Modifier, icon: @Composable (Color) -> Unit, onClick: () -> Unit) {
    val tint by animateColorAsState(if (selected) PC.Brand else PC.Muted, label = "tint")
    val pill by animateColorAsState(if (selected) PC.BrandSoft else Color.Transparent, label = "pill")
    Column(
        modifier.clickable(remember { MutableInteractionSource() }, indication = null, onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
    ) {
        Box(contentAlignment = Alignment.Center) {
            Box(Modifier.size(width = 56.dp, height = 32.dp).clip(CircleShape).background(pill), contentAlignment = Alignment.Center) { icon(tint) }
            if (badge > 0) CountBadge(badge, Modifier.align(Alignment.TopEnd).offset(x = 4.dp, y = (-6).dp))
        }
        Spacer(Modifier.height(4.dp))
        Text(
            t.label, style = MaterialTheme.typography.labelMedium,
            color = if (selected) PC.Header else PC.Muted, fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
        )
    }
}
