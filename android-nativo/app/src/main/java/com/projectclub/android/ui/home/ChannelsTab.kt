package com.projectclub.android.ui.home

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.Gavel
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.LocalMall
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.MicOff
import androidx.compose.material.icons.outlined.ScreenShare
import androidx.compose.material.icons.outlined.Tag
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.data.Channel
import com.projectclub.android.data.ChatLogic
import com.projectclub.android.data.Repository
import com.projectclub.android.data.Room
import com.projectclub.android.data.User
import com.projectclub.android.data.VoiceParticipant
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.Bone
import com.projectclub.android.ui.common.CountBadge
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.common.rememberShimmer
import com.projectclub.android.ui.theme.Display
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch

/** Aba Comunidade: igual à lista de canais do site (banner, destaques, categorias com emoji). */
@Composable
fun ChannelsTab(repo: Repository, actions: HomeActions) {
    val community by repo.community.collectAsState()
    val states by repo.channelStates.collectAsState()
    val rosters by repo.voiceRosters.collectAsState()
    val collapsed = remember { mutableStateMapOf<String, Boolean>() }

    Column(Modifier.fillMaxSize()) {
        PcTopBar("Comunidade", Icons.Outlined.ChatBubbleOutline)
        val c = community
        val loadError by repo.communityError.collectAsState()
        if (c == null) {
            val err = loadError
            if (err != null) {
                val scope = androidx.compose.runtime.rememberCoroutineScope()
                com.projectclub.android.ui.common.EmptyState(
                    Icons.Outlined.ChatBubbleOutline, "Não deu pra carregar os canais", err, Modifier.padding(top = 40.dp),
                ) {
                    com.projectclub.android.ui.common.GhostButton("Tentar de novo", { scope.launch { runCatching { repo.loadCommunity() }.onFailure { repo.report("community-retry", it) } } })
                }
            } else ChannelsSkeleton()
            return@Column
        }

        fun open(ch: Channel) = when {
            ch.isVoice -> actions.joinVoice(ch.id, ch.name)
            ch.isChat -> actions.openRoom(Room(channelId = ch.id))
            else -> actions.openWeb("/canal/" + android.net.Uri.encode(ch.slug ?: ch.id))
        }
        @Composable
        fun row(ch: Channel) = ChannelRow(
            ch, ChatLogic.isChannelUnread(states[ch.id]), states[ch.id]?.unreadMentions ?: 0,
            rosters[ch.id].orEmpty(), repo::user,
        ) { open(ch) }

        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
            item(key = "banner") { Banner(c.community?.name ?: "Project Club", c.community?.bannerUrl, c.community?.iconUrl) }
            item(key = "featured") {
                Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Featured(Icons.Outlined.Campaign, "Anúncios", PC.Announce) { actions.openWeb("/anuncios") }
                    Featured(Icons.Outlined.CalendarMonth, "Eventos", PC.Events) { actions.openWeb("/comunidade/eventos") }
                    Featured(Icons.AutoMirrored.Outlined.Article, "Fórum", PC.Forum) { actions.openWeb("/comunidades") }
                    Featured(Icons.Outlined.LocalMall, "Loja", PC.Store) { actions.openWeb("/loja") }
                }
                Box(Modifier.padding(horizontal = 14.dp).fillMaxWidth().height(1.dp).background(PC.Line))
            }
            items(c.channels.sortedBy { it.position }, key = { it.id }) { row(it) }
            c.categories.sortedBy { it.position }.forEach { cat ->
                val isCollapsed = collapsed[cat.id] == true
                item(key = "cat-${cat.id}") {
                    CategoryHeader(cat.name, cat.iconEmoji, cat.iconUrl, isCollapsed) { collapsed[cat.id] = !isCollapsed }
                }
                val list = cat.channels.sortedBy { it.position }
                // Recolhida: continua mostrando os canais com novidade ou com gente na call (igual ao site).
                val visible = if (isCollapsed) list.filter { ChatLogic.isChannelUnread(states[it.id]) || rosters[it.id].orEmpty().isNotEmpty() } else list
                items(visible, key = { it.id }) { row(it) }
            }
        }
    }
}

@Composable
private fun Banner(name: String, bannerUrl: String?, iconUrl: String?) {
    Box(Modifier.fillMaxWidth().height(150.dp).background(PC.BannerGradient)) {
        val banner = Config.media(bannerUrl)
        if (banner != null) AsyncImage(banner, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        else Text(
            name.uppercase(), fontFamily = Display, fontSize = 64.sp, color = Color.White, maxLines = 1,
            modifier = Modifier.align(Alignment.Center).padding(horizontal = 12.dp),
        )
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0f to Color(0x66000000), 0.35f to Color.Transparent, 0.75f to Color.Transparent, 1f to PC.Bg)))
        Row(Modifier.align(Alignment.TopStart).padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Config.media(iconUrl)?.let {
                AsyncImage(it, null, contentScale = ContentScale.Crop, modifier = Modifier.size(28.dp).clip(RoundedCornerShape(8.dp)))
                Spacer(Modifier.width(10.dp))
            }
            Text(name, color = Color.White, style = MaterialTheme.typography.titleLarge)
        }
    }
}

@Composable
private fun Featured(icon: ImageVector, label: String, color: Color, onClick: () -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    Row(
        Modifier.fillMaxWidth().height(52.dp).clip(shape)
            .background(Brush.horizontalGradient(listOf(color.copy(alpha = 0.16f), color.copy(alpha = 0.06f))))
            .border(1.dp, color.copy(alpha = 0.28f), shape).clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(3.dp).fillMaxHeight().background(color))
        Spacer(Modifier.width(10.dp))
        Box(Modifier.size(32.dp).clip(RoundedCornerShape(10.dp)).background(color.copy(alpha = 0.2f)), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = color, modifier = Modifier.size(19.dp))
        }
        Spacer(Modifier.width(12.dp))
        Text(label, color = PC.Header, style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun CategoryHeader(title: String, emoji: String?, iconUrl: String?, collapsed: Boolean, onToggle: () -> Unit) {
    val angle by animateFloatAsState(if (collapsed) -90f else 0f, label = "chev")
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onToggle).padding(start = 18.dp, end = 14.dp, top = 20.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val url = Config.media(iconUrl)
        when {
            url != null -> { AsyncImage(url, null, contentScale = ContentScale.Crop, modifier = Modifier.size(18.dp).clip(RoundedCornerShape(5.dp))); Spacer(Modifier.width(8.dp)) }
            !emoji.isNullOrBlank() -> { Text(emoji, fontSize = 15.sp); Spacer(Modifier.width(6.dp)) }
        }
        Text(title, style = MaterialTheme.typography.titleSmall, color = PC.Muted, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        Icon(Icons.Outlined.KeyboardArrowDown, if (collapsed) "Abrir" else "Recolher", tint = PC.Muted, modifier = Modifier.size(20.dp).rotate(angle))
    }
}

private fun iconFor(ch: Channel): ImageVector = when (ch.type) {
    "VOICE", "STAGE" -> Icons.AutoMirrored.Outlined.VolumeUp
    "ANNOUNCEMENT" -> Icons.Outlined.Campaign
    "FORUM" -> Icons.Outlined.Forum
    "RULES" -> Icons.Outlined.Gavel
    else -> Icons.Outlined.Tag
}

@Composable
private fun ChannelRow(ch: Channel, unread: Boolean, mentions: Int, inCall: List<VoiceParticipant>, user: (String?) -> User?, onClick: () -> Unit) {
    val strong = unread || mentions > 0
    Column(Modifier.fillMaxWidth().padding(horizontal = 10.dp)) {
        Box {
            if (unread) Box(Modifier.align(Alignment.CenterStart).size(width = 4.dp, height = 10.dp).clip(RoundedCornerShape(topEnd = 4.dp, bottomEnd = 4.dp)).background(PC.Header))
            Row(
                Modifier.padding(start = 6.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick)
                    .padding(horizontal = 10.dp, vertical = 11.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val icon = Config.media(ch.iconUrl)
                when {
                    icon != null -> AsyncImage(icon, null, contentScale = ContentScale.Crop, modifier = Modifier.size(22.dp).clip(RoundedCornerShape(6.dp)))
                    !ch.iconEmoji.isNullOrBlank() -> Text(ch.iconEmoji, fontSize = 18.sp, modifier = Modifier.width(26.dp))
                    else -> Icon(iconFor(ch), null, tint = PC.Faint, modifier = Modifier.size(22.dp))
                }
                Spacer(Modifier.width(12.dp))
                Text(
                    ch.name, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodyLarge,
                    color = if (strong) PC.Header else PC.Muted,
                    fontWeight = if (strong) FontWeight.Bold else FontWeight.Medium,
                )
                if (ch.isPrivate) Icon(Icons.Outlined.Lock, "Privado", tint = PC.Faint, modifier = Modifier.padding(start = 6.dp).size(15.dp))
                if (ch.isVoice && inCall.isNotEmpty()) Text("${inCall.size}", color = PC.Green, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(start = 6.dp))
                if (mentions > 0) CountBadge(mentions, Modifier.padding(start = 6.dp))
            }
        }
        if (inCall.isNotEmpty()) {
            Column(Modifier.padding(start = 54.dp, bottom = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                inCall.take(10).forEach { p ->
                    val u = user(p.userId)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Avatar(u, 24.dp)
                        Spacer(Modifier.width(9.dp))
                        Text(u?.name ?: "…", color = PC.Text, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                        if (p.screenSharing) Icon(Icons.Outlined.ScreenShare, "Compartilhando a tela", tint = PC.Red, modifier = Modifier.padding(start = 6.dp).size(16.dp))
                        if (p.muted) Icon(Icons.Outlined.MicOff, "Mudo", tint = PC.Faint, modifier = Modifier.padding(start = 6.dp).size(15.dp))
                    }
                }
                if (inCall.size > 10) Text("+${inCall.size - 10}", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

/** Esqueleto da lista de canais (banner, destaques e linhas). */
@Composable
private fun ChannelsSkeleton() {
    val b = rememberShimmer()
    Column {
        Bone(b, Modifier.fillMaxWidth().height(150.dp), RoundedCornerShape(0.dp))
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            repeat(4) { Bone(b, Modifier.fillMaxWidth().height(52.dp), RoundedCornerShape(16.dp)) }
            Spacer(Modifier.height(10.dp))
            repeat(3) { g ->
                Bone(b, Modifier.padding(top = 10.dp).size(width = 120.dp, height = 12.dp))
                repeat(3 - g % 2) { i ->
                    Row(Modifier.padding(start = 6.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Bone(b, Modifier.size(20.dp), CircleShape)
                        Spacer(Modifier.width(12.dp))
                        Bone(b, Modifier.size(width = (110 + i * 35).dp, height = 14.dp))
                    }
                }
            }
        }
    }
}
