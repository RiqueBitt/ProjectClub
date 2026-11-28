package com.projectclub.android.ui.forum

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
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.TrendingUp
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.NewReleases
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.outlined.Sell
import androidx.compose.material.icons.outlined.Whatshot
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.data.ForumPoll
import com.projectclub.android.data.ForumPost
import com.projectclub.android.data.User
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.Bone
import com.projectclub.android.ui.common.PcCard
import com.projectclub.android.ui.common.colorFor
import com.projectclub.android.ui.common.instantOf
import com.projectclub.android.ui.common.rememberShimmer
import com.projectclub.android.ui.theme.PC
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/* Peças do Fórum usadas nas várias telas (lista, Tema, post). */

internal fun isStaff(user: User?): Boolean = user?.platformRole == "ADMIN" || user?.platformRole == "MODERATOR"

/** "agora", "5 min", "3 h", "2 d", "12 out." — igual ao timeAgo do site. */
internal fun timeAgo(iso: String?): String {
    val t = instantOf(iso) ?: return ""
    val diff = (System.currentTimeMillis() - t.toEpochMilli()) / 1000
    return when {
        diff < 60 -> "agora"
        diff < 3600 -> "${diff / 60} min"
        diff < 86400 -> "${diff / 3600} h"
        diff < 7 * 86400 -> "${diff / 86400} d"
        else -> t.atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("dd MMM", Locale("pt", "BR")))
    }
}

/** Próximo voto (toggle do Reddit): votar igual retira, oposto troca. */
internal fun nextVote(current: Int, value: Int): Int = if (current == value) 0 else value

/** Aplica o voto na hora (antes do servidor responder). */
internal fun ForumPost.withVote(value: Int): ForumPost {
    val next = nextVote(myVote, value)
    return copy(myVote = next, score = score + (next - myVote))
}

/** Ícone redondo do Tema (logo ou inicial). */
@Composable
internal fun ClubIcon(iconUrl: String?, name: String, size: Dp, modifier: Modifier = Modifier) {
    val url = Config.media(iconUrl)
    val shape = RoundedCornerShape(size * 0.3f)
    if (url != null) {
        AsyncImage(
            model = url, contentDescription = null, contentScale = ContentScale.Crop,
            modifier = modifier.size(size).clip(shape).background(PC.Surface2),
        )
    } else {
        Box(modifier.size(size).clip(shape).background(colorFor(name)), contentAlignment = Alignment.Center) {
            Text(name.take(1).uppercase(), color = Color.White, fontWeight = FontWeight.Bold, fontSize = (size.value * 0.45f).sp)
        }
    }
}

/** Pílula de voto (▲ pontos ▼). */
@Composable
internal fun VotePill(score: Int, myVote: Int, onVote: (Int) -> Unit, small: Boolean = false, enabled: Boolean = true) {
    val color = when (myVote) { 1 -> PC.Brand; -1 -> PC.Red; else -> PC.Muted }
    val iconSize = if (small) 16.dp else 19.dp
    val btn = if (small) 28.dp else 34.dp
    Row(
        Modifier.clip(CircleShape).background(PC.Surface2).border(1.dp, if (myVote != 0) color.copy(alpha = 0.4f) else PC.Line, CircleShape)
            .padding(horizontal = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(btn).clip(CircleShape).clickable(enabled = enabled) { onVote(1) },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                if (myVote == 1) Icons.Filled.ArrowUpward else Icons.Outlined.ArrowUpward, "Votar a favor",
                tint = if (myVote == 1) PC.Brand else PC.Muted, modifier = Modifier.size(iconSize),
            )
        }
        Text(
            score.toString(), color = if (myVote != 0) color else PC.Header,
            style = if (small) MaterialTheme.typography.labelMedium else MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 2.dp),
        )
        Box(
            Modifier.size(btn).clip(CircleShape).clickable(enabled = enabled) { onVote(-1) },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                if (myVote == -1) Icons.Filled.ArrowDownward else Icons.Outlined.ArrowDownward, "Votar contra",
                tint = if (myVote == -1) PC.Red else PC.Muted, modifier = Modifier.size(iconSize),
            )
        }
    }
}

/** Pílula selecionável (ordenação, tags, temas, categorias). */
@Composable
internal fun SelectPill(text: String, selected: Boolean, onClick: () -> Unit, icon: ImageVector? = null, leading: (@Composable () -> Unit)? = null) {
    val shape = CircleShape
    Row(
        Modifier.heightIn(min = 36.dp).clip(shape)
            .background(if (selected) PC.BrandSoft else PC.Surface)
            .border(1.dp, if (selected) PC.Brand.copy(alpha = 0.6f) else PC.LineStrong, shape)
            .clickable(onClick = onClick).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null) { leading(); Spacer(Modifier.width(7.dp)) }
        else if (icon != null) { Icon(icon, null, tint = if (selected) PC.Brand else PC.Muted, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)) }
        Text(text, color = if (selected) PC.Header else PC.Text, style = MaterialTheme.typography.labelLarge, fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium)
    }
}

internal data class SortOption(val key: String, val label: String, val icon: ImageVector)

internal val ForumSorts = listOf(
    SortOption("hot", "Relevantes", Icons.Outlined.Whatshot),
    SortOption("new", "Novos", Icons.Outlined.NewReleases),
    SortOption("top", "Melhores", Icons.AutoMirrored.Outlined.TrendingUp),
)

/** Linha de tags para filtrar ("Todas" + cada tag). */
@Composable
internal fun TagFilterRow(tags: List<String>, value: String, onChange: (String) -> Unit) {
    if (tags.isEmpty()) return
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        SelectPill("Todas", value.isEmpty(), { onChange("") }, icon = Icons.Outlined.Sell)
        tags.forEach { t -> SelectPill(t, value == t, { onChange(if (value == t) "" else t) }) }
    }
}

@Composable
internal fun TagChip(text: String, onClick: (() -> Unit)? = null) {
    Row(
        Modifier.clip(CircleShape).background(PC.Surface2)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 9.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.Sell, null, tint = PC.Brand, modifier = Modifier.size(12.dp))
        Spacer(Modifier.width(4.dp))
        Text(text, color = PC.Text, style = MaterialTheme.typography.labelSmall)
    }
}

/** Cabeçalho do post: Tema · categoria · autor · tempo. */
@Composable
internal fun PostHeader(post: ForumPost, onClub: (() -> Unit)?, onAuthor: (() -> Unit)?) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            val club = post.community
            if (club != null) {
                Row(
                    Modifier.clip(CircleShape).then(if (onClub != null) Modifier.clickable(onClick = onClub) else Modifier).padding(end = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    ClubIcon(club.iconUrl, club.name, 22.dp)
                    Spacer(Modifier.width(7.dp))
                    Text(club.name, color = PC.Header, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            post.category?.takeIf { it.name.isNotBlank() }?.let { cat ->
                Spacer(Modifier.width(4.dp))
                Row(
                    Modifier.clip(CircleShape).background(PC.Surface2).padding(horizontal = 8.dp, vertical = 3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Config.media(cat.iconUrl)?.let { u ->
                        AsyncImage(u, null, contentScale = ContentScale.Crop, modifier = Modifier.size(14.dp).clip(CircleShape))
                        Spacer(Modifier.width(4.dp))
                    }
                    Text(cat.name, color = PC.Muted, style = MaterialTheme.typography.labelSmall, maxLines = 1)
                }
            }
        }
        Row(
            Modifier.clip(CircleShape).then(if (onAuthor != null) Modifier.clickable(onClick = onAuthor) else Modifier),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Avatar(post.author, 20.dp)
            Spacer(Modifier.width(6.dp))
            Text(post.author?.name ?: "Alguém", color = PC.Text, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val ago = timeAgo(post.createdAt)
            if (ago.isNotEmpty()) Text(" · $ago", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
internal fun PinnedFlag() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.PushPin, null, tint = PC.Yellow, modifier = Modifier.size(14.dp))
        Spacer(Modifier.width(5.dp))
        Text("Fixado pela staff", color = PC.Yellow, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
    }
}

/** Enquete do post: antes de votar mostra as opções; depois, as barras com %. */
@Composable
internal fun ForumPollBlock(poll: ForumPoll, onVote: (String) -> Unit, busy: Boolean = false) {
    val voted = poll.myVoteOptionId != null
    val shape = RoundedCornerShape(16.dp)
    Column(
        Modifier.fillMaxWidth().clip(shape).background(PC.Bg).border(1.dp, PC.Line, shape).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        poll.options.forEach { o ->
            val mine = o.id == poll.myVoteOptionId
            val optShape = RoundedCornerShape(12.dp)
            Box(
                Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(optShape)
                    .background(PC.Surface2)
                    .border(1.dp, if (mine) PC.Brand else PC.LineStrong, optShape)
                    .clickable(enabled = !busy && !mine) { onVote(o.id) },
            ) {
                if (voted) {
                    Box(Modifier.matchParentSize()) {
                        Box(
                            Modifier.fillMaxHeight().fillMaxWidth((o.percent / 100f).coerceIn(0f, 1f))
                                .background(if (mine) PC.Brand.copy(alpha = 0.28f) else PC.Surface3),
                        )
                    }
                }
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (mine) { Icon(Icons.Outlined.CheckCircle, null, tint = PC.Brand, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)) }
                    Text(o.text, color = PC.Header, style = MaterialTheme.typography.bodyMedium, fontWeight = if (mine) FontWeight.Bold else FontWeight.Normal, modifier = Modifier.weight(1f))
                    if (voted) Text("${o.percent}%", color = if (mine) PC.Brand else PC.Muted, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                }
            }
        }
        Text(
            "${poll.totalVotes} voto${if (poll.totalVotes == 1) "" else "s"}" + if (voted) " · toque em outra opção para mudar" else "",
            color = PC.Muted, style = MaterialTheme.typography.labelSmall,
        )
    }
}

/** Cartão de post das listas (igual ao fp-card do site). */
@Composable
internal fun ForumPostCard(
    post: ForumPost,
    onOpen: () -> Unit,
    onVote: (Int) -> Unit,
    onAuthor: () -> Unit,
    onClub: (() -> Unit)? = null,
    onTag: ((String) -> Unit)? = null,
    onPollVote: ((String) -> Unit)? = null,
) {
    PcCard(
        onClick = onOpen, padding = PaddingValues(14.dp),
        border = if (post.isPinned) PC.Yellow.copy(alpha = 0.35f) else PC.Line,
    ) {
        if (post.isPinned) { PinnedFlag(); Spacer(Modifier.height(8.dp)) }
        PostHeader(post, onClub, onAuthor)
        Spacer(Modifier.height(10.dp))
        Text(post.title, color = PC.Header, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, maxLines = 3, overflow = TextOverflow.Ellipsis)
        if (post.tags.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                post.tags.forEach { t -> TagChip(t, onTag?.let { f -> { f(t) } }) }
            }
        }
        val content = post.content?.takeIf { it.isNotBlank() }
        if (content != null && post.type != "IMAGE") {
            Spacer(Modifier.height(6.dp))
            Text(content, color = PC.Text, style = MaterialTheme.typography.bodyMedium, maxLines = 4, overflow = TextOverflow.Ellipsis)
        }
        val img = Config.media(post.imageUrl)
        if (post.type == "IMAGE" && img != null) {
            Spacer(Modifier.height(10.dp))
            AsyncImage(
                model = img, contentDescription = null, contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxWidth().heightIn(max = 320.dp).clip(RoundedCornerShape(14.dp)).background(PC.Surface2),
            )
        }
        val link = post.linkUrl
        if (post.type == "LINK" && !link.isNullOrBlank()) {
            Spacer(Modifier.height(8.dp))
            Row(
                Modifier.clip(RoundedCornerShape(10.dp)).background(PC.Surface2).padding(horizontal = 10.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.Link, null, tint = PC.Brand, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text(link, color = PC.Brand, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        post.poll?.let { poll ->
            Spacer(Modifier.height(10.dp))
            ForumPollBlock(poll, onVote = { onPollVote?.invoke(it) ?: onOpen() })
        }
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            VotePill(post.score, post.myVote, onVote)
            Spacer(Modifier.width(14.dp))
            Icon(Icons.Outlined.ChatBubbleOutline, null, tint = PC.Muted, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text(
                "${post.commentCount} comentário${if (post.commentCount == 1) "" else "s"}",
                color = PC.Muted, style = MaterialTheme.typography.labelLarge,
            )
        }
    }
}

/** Esqueleto de cartões de post enquanto carrega. */
@Composable
internal fun PostSkeletons(count: Int = 3) {
    val b = rememberShimmer()
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        repeat(count) { i ->
            PcCard(Modifier.fillMaxWidth().alpha(1f - i * 0.18f), padding = PaddingValues(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Bone(b, Modifier.size(22.dp), RoundedCornerShape(7.dp))
                    Spacer(Modifier.width(8.dp))
                    Bone(b, Modifier.width(110.dp).height(12.dp))
                }
                Spacer(Modifier.height(12.dp))
                Bone(b, Modifier.fillMaxWidth(0.8f).height(16.dp))
                Spacer(Modifier.height(10.dp))
                Bone(b, Modifier.fillMaxWidth().height(11.dp))
                Spacer(Modifier.height(6.dp))
                Bone(b, Modifier.fillMaxWidth(0.6f).height(11.dp))
                Spacer(Modifier.height(14.dp))
                Bone(b, Modifier.width(110.dp).height(30.dp), CircleShape)
            }
        }
    }
}
