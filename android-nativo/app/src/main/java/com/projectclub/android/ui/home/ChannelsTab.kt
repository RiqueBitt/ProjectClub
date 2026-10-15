package com.projectclub.android.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Gavel
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.data.Channel
import com.projectclub.android.data.ChatLogic
import com.projectclub.android.data.Repository
import com.projectclub.android.data.Room
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.SectionLabel
import com.projectclub.android.ui.theme.PC

@Composable
fun ChannelsTab(repo: Repository, actions: HomeActions, modifier: Modifier) {
    val community by repo.community.collectAsState()
    val states by repo.channelStates.collectAsState()
    val rosters by repo.voiceRosters.collectAsState()
    val c = community
    if (c == null) {
        Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }
    fun open(ch: Channel) = when {
        ch.isVoice -> actions.joinVoice(ch.id, ch.name)
        ch.isChat -> actions.openRoom(Room(channelId = ch.id))
        else -> actions.openWeb("/channels/${ch.id}")
    }
    LazyColumn(modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 16.dp)) {
        item {
            Box(Modifier.fillMaxWidth().height(120.dp).background(PC.Surface)) {
                Config.media(c.community?.bannerUrl)?.let {
                    AsyncImage(it, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                }
                Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Brush.verticalGradient(listOf(androidx.compose.ui.graphics.Color.Transparent, PC.Bg))))
                Text(
                    c.community?.name ?: "Project Club", style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.align(Alignment.BottomStart).padding(16.dp),
                )
            }
        }
        items(c.channels.sortedBy { it.position }, key = { it.id }) { ch ->
            ChannelRow(ch, ChatLogic.isChannelUnread(states[ch.id]), states[ch.id]?.unreadMentions ?: 0, rosters[ch.id].orEmpty().mapNotNull { repo.user(it.userId) }) { open(ch) }
        }
        c.categories.sortedBy { it.position }.forEach { cat ->
            item(key = "cat-${cat.id}") {
                SectionLabel(listOfNotNull(cat.iconEmoji, cat.name).joinToString(" "), Modifier.padding(start = 16.dp, top = 18.dp, bottom = 6.dp))
            }
            items(cat.channels.sortedBy { it.position }, key = { it.id }) { ch ->
                ChannelRow(ch, ChatLogic.isChannelUnread(states[ch.id]), states[ch.id]?.unreadMentions ?: 0, rosters[ch.id].orEmpty().mapNotNull { repo.user(it.userId) }) { open(ch) }
            }
        }
    }
}

private fun iconFor(ch: Channel): ImageVector = when (ch.type) {
    "VOICE", "STAGE" -> Icons.AutoMirrored.Filled.VolumeUp
    "ANNOUNCEMENT" -> Icons.Filled.Campaign
    "FORUM" -> Icons.Filled.Forum
    "RULES" -> Icons.Filled.Gavel
    else -> Icons.Filled.Tag
}

@Composable
private fun ChannelRow(ch: Channel, unread: Boolean, mentions: Int, inCall: List<com.projectclub.android.data.User>, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 2.dp)) {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).padding(horizontal = 8.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (unread) Box(Modifier.size(6.dp).clip(CircleShape).background(PC.Text)) else Spacer(Modifier.width(6.dp))
            Spacer(Modifier.width(6.dp))
            if (!ch.iconEmoji.isNullOrBlank()) Text(ch.iconEmoji, modifier = Modifier.width(22.dp))
            else Icon(iconFor(ch), null, tint = PC.Muted, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(10.dp))
            Text(
                ch.name, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
                color = if (unread || mentions > 0) PC.Text else PC.Muted,
                fontWeight = if (unread || mentions > 0) FontWeight.Bold else FontWeight.Medium,
            )
            if (ch.isPrivate) Icon(Icons.Filled.Lock, null, tint = PC.Muted, modifier = Modifier.size(14.dp))
            if (mentions > 0) {
                Box(Modifier.padding(start = 6.dp).clip(CircleShape).background(PC.Red).padding(horizontal = 7.dp, vertical = 1.dp)) {
                    Text(if (mentions > 99) "99+" else mentions.toString(), color = androidx.compose.ui.graphics.Color.White, style = MaterialTheme.typography.labelSmall)
                }
            }
        }
        if (inCall.isNotEmpty()) {
            Column(Modifier.padding(start = 44.dp, bottom = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                inCall.take(8).forEach { u ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Avatar(u, 22.dp)
                        Spacer(Modifier.width(8.dp))
                        Text(u.name, color = PC.Muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
                    }
                }
                if (inCall.size > 8) Text("+${inCall.size - 8}", color = PC.Muted)
            }
        }
    }
}
