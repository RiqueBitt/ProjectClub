package com.projectclub.android.ui.chat

import android.net.Uri
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.MenuBook
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Tag
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.data.CommunityEventsResponse
import com.projectclub.android.data.EcoWallet
import com.projectclub.android.data.ForumPostResponse
import com.projectclub.android.data.Repository
import com.projectclub.android.data.User
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.economy.FlipWalletCard
import com.projectclub.android.ui.theme.Display
import com.projectclub.android.ui.theme.PC
import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/*
 * Links INTERNOS nas mensagens do chat (igual ao site: utils/internalLinks.js
 * + InternalLinkCard.jsx + a pasta activities). Cada link do próprio Project Club
 * vira um cartão: rolagem de dados, cartão da carteira em 3D, vídeo/música do
 * YouTube, perfil, post, evento, canal, Tema do Fórum e Wiki.
 * As "atividades" (carteira, dados, vídeo, música) somem do texto da mensagem.
 */

/** Abre um caminho interno (/perfil/..., /forum/...) — o ChatScreen liga isso no AppNav. */
val LocalOpenLink = staticCompositionLocalOf<(String) -> Unit> { {} }

data class InternalLink(val kind: String, val id: String, val path: String, val extra: String? = null)

object InternalLinks {
    private val LINK_RE = Regex("""https?://[^\s<]+[^\s<.,!?)\]]""")
    private val UUID_RE = Regex("^[0-9a-fA-F-]{36}$")
    private val YT_RE = Regex("^[A-Za-z0-9_-]{11}$")
    val ACTIVITY_KINDS = setOf("wallet", "dice", "ytvideo", "ytmusic")

    private fun ownHost(host: String?): Boolean {
        val h = host?.lowercase() ?: return false
        val base = Uri.parse(Config.baseUrl).host?.lowercase()
        return h == base || h == "projectclub.com.br" || h == "www.projectclub.com.br" ||
            h.endsWith("projectclub.shardweb.app") || h.endsWith("projectclub.squareweb.app")
    }

    fun parse(raw: String): InternalLink? {
        val u = runCatching { Uri.parse(raw) }.getOrNull() ?: return null
        if (u.scheme != "http" && u.scheme != "https") return null
        if (!ownHost(u.host)) return null
        val parts = u.pathSegments.orEmpty().filter { it.isNotBlank() }
        val path = (u.encodedPath ?: "/") + (u.encodedQuery?.let { "?$it" } ?: "")
        val id = parts.getOrNull(1)
        return when (parts.firstOrNull()) {
            "posts", "forum" -> id?.let { InternalLink("post", it, path) }
            "u", "perfil" -> id?.let { InternalLink("user", it, path) }
            "eventos", "evento" -> id?.let { InternalLink("event", it, path) }
            "comunidade" -> if (id == "eventos") u.getQueryParameter("evento")?.let { InternalLink("event", it, path) } else null
            "channels", "canal" -> id?.let { InternalLink("channel", it, path) }
            "comunidades" -> id?.let { InternalLink("club", it, path) }
            "wiki" -> id?.let { InternalLink("wiki", it, path) }
            "carteira" -> id?.takeIf { UUID_RE.matches(it) }?.let { InternalLink("wallet", it, path) }
            "atividade" -> {
                val ref = parts.getOrNull(2)
                when (id) {
                    "dados" -> ref?.takeIf { UUID_RE.matches(it) }?.let { InternalLink("dice", it, path) }
                    "video" -> ref?.takeIf { YT_RE.matches(it) }?.let { InternalLink("ytvideo", it, path) }
                    "musica" -> ref?.takeIf { YT_RE.matches(it) }?.let { InternalLink("ytmusic", it, path) }
                    else -> null
                }
            }
            else -> null
        }
    }

    fun find(text: String?, max: Int = 3): List<InternalLink> {
        if (text.isNullOrBlank() || !text.contains("http")) return emptyList()
        val seen = HashSet<String>()
        return LINK_RE.findAll(text).mapNotNull { parse(it.value) }
            .filter { seen.add(it.kind + ":" + it.id) }.take(max).toList()
    }

    /** Tira do texto os links que viram atividade (o cartão já mostra tudo). */
    fun stripActivities(text: String): String {
        if (!text.contains("http")) return text
        return text.replace(LINK_RE) { m -> if (parse(m.value)?.kind in ACTIVITY_KINDS) "" else m.value }
            .replace(Regex("[ \t]+\n"), "\n").trim()
    }
}

/* ---------------- respostas do servidor ---------------- */

@Serializable
data class DiceGroup(val sides: Int = 6, val count: Int = 1, val results: List<Int> = emptyList())

@Serializable
data class DiceRoll(
    val id: String = "",
    val groups: List<DiceGroup> = emptyList(),
    val modifier: Int = 0,
    val label: String? = null,
    val total: Int = 0,
    val notation: String? = null,
    val user: User? = null,
)

@Serializable
data class SharedCard(val id: String = "", val coins: Int = 0, val gems: Int = 0, val level: Int = 1, val style: String? = null)

@Serializable
data class SharedCardResponse(val card: SharedCard? = null, val user: User? = null)

@Serializable
data class YoutubeInfo(val videoId: String = "", val title: String? = null, val channel: String? = null, val durationSec: Int? = null, val playable: Boolean = true)

@Serializable
data class UserProfileResponse(val user: User? = null)

@Serializable
data class WikiPage(val slug: String = "", val title: String = "", val category: String? = null, val body: String? = null)

@Serializable
data class WikiPageResponse(val page: WikiPage? = null)

/** Cartão genérico (perfil, post, evento, canal, tema, wiki) — mesmo formato do site. */
private data class Preview(
    val label: String,
    val title: String,
    val text: String? = null,
    val image: String? = null,
    val wideImage: Boolean = false,
    val user: User? = null,
    val meta: List<String> = emptyList(),
    val icon: ImageVector? = null,
    val live: Boolean = false,
    val action: String = "Abrir",
    val path: String,
)

/** Cache de 5 min: a mesma mensagem recompõe muito e o mesmo link aparece várias vezes. */
private object LinkCache {
    private const val TTL = 5 * 60 * 1000L
    private val map = HashMap<String, Pair<Long, Any?>>()
    @Synchronized fun get(k: String): Any? = map[k]?.takeIf { System.currentTimeMillis() - it.first < TTL }?.second
    @Synchronized fun has(k: String): Boolean = map[k]?.let { System.currentTimeMillis() - it.first < TTL } == true
    @Synchronized fun put(k: String, v: Any?) { map[k] = System.currentTimeMillis() to v }
}

@Composable
private inline fun <reified T> rememberRemote(key: String, crossinline load: suspend () -> T?): T? {
    var value by remember(key) { mutableStateOf(LinkCache.get(key) as? T) }
    LaunchedEffect(key) {
        if (LinkCache.has(key)) { value = LinkCache.get(key) as? T; return@LaunchedEffect }
        val v = runCatching { load() }.getOrNull()
        LinkCache.put(key, v)
        value = v
    }
    return value
}

private fun clip(s: String?, n: Int = 140): String? {
    val t = s?.replace(Regex("\\s+"), " ")?.trim().orEmpty()
    if (t.isEmpty()) return null
    return if (t.length > n) t.take(n - 1) + "…" else t
}

/** Todos os cartões de link de uma mensagem (até 3). */
@Composable
fun InternalLinkCards(content: String?, repo: Repository) {
    val links = remember(content) { InternalLinks.find(content) }
    links.forEach { l ->
        Box(Modifier.padding(top = 6.dp)) {
            when (l.kind) {
                "dice" -> DiceCard(l, repo)
                "wallet" -> WalletLinkCard(l, repo)
                "ytvideo", "ytmusic" -> YoutubeCard(l, repo)
                else -> PreviewLinkCard(l, repo)
            }
        }
    }
}

/* ---------------- Dados ---------------- */

internal val DICE_COLORS = mapOf(
    2 to Color(0xFF94A3B8), 4 to Color(0xFFEF4444), 6 to Color(0xFF3B82F6), 8 to Color(0xFF22C55E), 10 to Color(0xFFA855F7),
    12 to Color(0xFFF97316), 20 to Color(0xFFEAB308), 100 to Color(0xFFEC4899),
)

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DiceCard(l: InternalLink, repo: Repository) {
    val roll = rememberRemote<DiceRoll>("dice:" + l.id) { repo.api.get<DiceRoll>("/api/activities/dice/" + l.id) }
    val shape = RoundedCornerShape(16.dp)
    Column(
        Modifier.widthIn(max = 340.dp).fillMaxWidth().clip(shape)
            .background(Brush.verticalGradient(listOf(Color(0xFF1C2A22), Color(0xFF13201A))))
            .border(1.dp, Color(0xFF2F4A3A), shape).padding(14.dp),
    ) {
        if (roll == null) {
            Text("🎲 Rolando os dados…", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
            return@Column
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(roll.label?.takeIf { it.isNotBlank() } ?: "Rolagem de dados", color = PC.Header, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    listOfNotNull(roll.user?.let { it.displayName ?: it.username }, roll.notation).joinToString(" · "),
                    color = PC.Muted, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                Text("${roll.total}", color = Color.White, fontFamily = Display, fontSize = 34.sp)
                Text("total", color = PC.Muted, style = MaterialTheme.typography.labelSmall)
            }
        }
        Spacer(Modifier.height(10.dp))
        // a "bandeja" de feltro com os dados
        FlowRow(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color(0x33000000)).padding(10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            roll.groups.forEach { g -> g.results.forEach { r -> DieFace(g.sides, r) } }
            if (roll.modifier != 0) Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) {
                Text((if (roll.modifier > 0) "+" else "") + roll.modifier, color = PC.Text, fontWeight = FontWeight.Bold, fontSize = 18.sp)
            }
        }
    }
}

/** Um dado desenhado pela forma de verdade: d4 triângulo, d6 quadrado, d8 losango, d10 pipa, d12 pentágono, d20 hexágono, d100 bola. */
@Composable
internal fun DieFace(sides: Int, value: Int, size: Dp = 44.dp) {
    val color = DICE_COLORS[sides] ?: PC.Brand
    val max = value == sides
    Box(Modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val w = this.size.width
            val h = this.size.height
            val c = Offset(w / 2, h / 2)
            val r = w * 0.48f
            fun poly(n: Int, start: Double): Path = Path().apply {
                for (i in 0 until n) {
                    val a = start + i * 2 * PI / n
                    val p = Offset(c.x + (r * cos(a)).toFloat(), c.y + (r * sin(a)).toFloat())
                    if (i == 0) moveTo(p.x, p.y) else lineTo(p.x, p.y)
                }
                close()
            }
            val fill = Brush.linearGradient(listOf(color, color.copy(red = color.red * 0.6f, green = color.green * 0.6f, blue = color.blue * 0.6f)), Offset.Zero, Offset(w, h))
            if (sides == 100 || sides == 2) {
                drawCircle(fill, r, c)
                drawCircle(Color.White.copy(alpha = 0.28f), r * 0.32f, Offset(c.x - r * 0.35f, c.y - r * 0.38f))
            } else {
                val path = when (sides) {
                    4 -> poly(3, -PI / 2)
                    6 -> Path().apply { addRoundRect(androidx.compose.ui.geometry.RoundRect(w * 0.06f, h * 0.06f, w * 0.94f, h * 0.94f, w * 0.18f, w * 0.18f)) }
                    8 -> poly(4, -PI / 2)
                    10 -> Path().apply {
                        moveTo(c.x, h * 0.02f); lineTo(w * 0.96f, h * 0.45f); lineTo(c.x, h * 0.98f); lineTo(w * 0.04f, h * 0.45f); close()
                    }
                    12 -> poly(5, -PI / 2)
                    else -> poly(6, -PI / 2)
                }
                drawPath(path, fill)
                drawPath(path, Color.White.copy(alpha = if (max) 0.9f else 0.25f), style = Stroke(width = if (max) 2.5f * density else 1.2f * density))
            }
        }
        Text(
            "$value", color = Color.White, fontWeight = FontWeight.ExtraBold,
            fontSize = if (value >= 100) 12.sp else if (value >= 10) 14.sp else 16.sp,
            modifier = Modifier.padding(top = if (sides == 4) 8.dp else 0.dp),
        )
    }
}

/* ---------------- Carteira (cartão 3D) ---------------- */

@Composable
private fun WalletLinkCard(l: InternalLink, repo: Repository) {
    val data = rememberRemote<SharedCardResponse>("wallet:" + l.id) { repo.api.get<SharedCardResponse>("/api/economy/card/" + l.id) }
    val card = data?.card
    if (card == null) {
        Box(Modifier.widthIn(max = 320.dp).fillMaxWidth().aspectRatio(1.586f).clip(RoundedCornerShape(16.dp)).background(PC.Surface))
        return
    }
    Column(Modifier.widthIn(max = 320.dp)) {
        FlipWalletCard(
            EcoWallet(coins = card.coins, gems = card.gems, accountLevel = card.level, cardStyle = card.style),
            data.user, Modifier.fillMaxWidth(),
        )
        Text("Toque pra virar o cartão", color = PC.Faint, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 4.dp, start = 4.dp))
    }
}

/* ---------------- YouTube (vídeo e música) ---------------- */

@Composable
private fun YoutubeCard(l: InternalLink, repo: Repository) {
    val music = l.kind == "ytmusic"
    val info = rememberRemote<YoutubeInfo>("yt:" + l.id) { repo.api.get<YoutubeInfo>("/api/activities/youtube/" + l.id) }
    val uri = LocalUriHandler.current
    val url = if (music) "https://music.youtube.com/watch?v=" + l.id else "https://www.youtube.com/watch?v=" + l.id
    val shape = RoundedCornerShape(14.dp)
    Column(
        Modifier.widthIn(max = 320.dp).fillMaxWidth().clip(shape).background(PC.Surface).border(1.dp, PC.Line, shape)
            .clickable { runCatching { uri.openUri(url) } },
    ) {
        if (music) {
            Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                AsyncImage(
                    "https://i.ytimg.com/vi/${l.id}/hqdefault.jpg", null, contentScale = ContentScale.Crop,
                    modifier = Modifier.size(64.dp).clip(RoundedCornerShape(10.dp)),
                )
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("Música", color = PC.Pink, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                    Text(info?.title ?: "Carregando…", color = PC.Header, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    info?.channel?.let { Text(it, color = PC.Muted, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                }
                Box(Modifier.size(38.dp).clip(CircleShape).background(PC.Pink), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.MusicNote, "Ouvir", tint = Color.White, modifier = Modifier.size(20.dp))
                }
            }
        } else {
            Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).background(Color.Black)) {
                AsyncImage("https://i.ytimg.com/vi/${l.id}/hqdefault.jpg", null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                Box(Modifier.align(Alignment.Center).size(54.dp).clip(CircleShape).background(Color(0xE6FF0033)), contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.PlayArrow, "Assistir", tint = Color.White, modifier = Modifier.size(32.dp))
                }
                info?.durationSec?.takeIf { it > 0 }?.let { d ->
                    Text(
                        "%d:%02d".format(d / 60, d % 60), color = Color.White, style = MaterialTheme.typography.labelSmall,
                        modifier = Modifier.align(Alignment.BottomEnd).padding(8.dp).clip(RoundedCornerShape(5.dp)).background(Color(0xB3000000)).padding(horizontal = 5.dp, vertical = 1.dp),
                    )
                }
            }
            Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
                Text(info?.title ?: "Vídeo do YouTube", color = PC.Header, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                info?.channel?.let { Text(it, color = PC.Muted, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
        }
    }
}

/* ---------------- Perfil, post, evento, canal, tema e wiki ---------------- */

private val WHEN_FMT: DateTimeFormatter = DateTimeFormatter.ofPattern("dd MMM, HH:mm", Locale.forLanguageTag("pt-BR"))

private suspend fun loadPreview(l: InternalLink, repo: Repository): Preview? = when (l.kind) {
    "user" -> {
        val id = if (Regex("^c[a-z0-9]{20,}$|^[0-9a-f-]{36}$").matches(l.id)) l.id
        else repo.resolveLink("/perfil/" + Uri.encode(l.id))?.let { it.userId ?: it.id } ?: l.id
        repo.api.get<UserProfileResponse>("/api/users/" + Uri.encode(id)).user?.let { u ->
            Preview(
                label = "Perfil", title = u.displayName ?: u.username ?: "Membro",
                text = clip(u.customStatus?.let { listOfNotNull(u.customStatusEmoji, it).joinToString(" ") } ?: u.bio, 110),
                user = u, meta = listOfNotNull(u.username?.let { "@$it" }, "Nível ${u.accountLevel ?: 1}"),
                action = "Ver perfil", path = "/perfil/" + Uri.encode(u.username ?: u.id),
            )
        }
    }
    "post" -> repo.api.get<ForumPostResponse>("/api/posts/" + Uri.encode(l.id)).post?.let { p ->
        Preview(
            label = "Post no Fórum", title = p.title, text = clip(p.content),
            image = if (p.type == "IMAGE") p.imageUrl else p.community?.iconUrl, wideImage = p.type == "IMAGE",
            meta = listOfNotNull(p.community?.name, "${p.score} ups", "${p.commentCount} comentário" + if (p.commentCount == 1) "" else "s"),
            icon = Icons.Outlined.Forum, path = l.path,
        )
    }
    "event" -> repo.api.get<CommunityEventsResponse>("/api/events").events
        .firstOrNull { it.id == l.id || it.slug?.equals(l.id, ignoreCase = true) == true }?.let { ev ->
            val whenTxt = ev.startsAt?.let { runCatching { WHEN_FMT.format(Instant.parse(it).atZone(ZoneId.systemDefault())) }.getOrNull() }
            val going = ev.rsvp?.counts?.GOING ?: 0
            Preview(
                label = when (ev.status) { "ACTIVE" -> "Evento · ao vivo"; "ENDED" -> "Evento · encerrado"; else -> "Evento" },
                title = ev.title, text = clip(ev.description), image = ev.bannerUrl ?: ev.iconUrl, wideImage = ev.bannerUrl != null,
                meta = listOfNotNull(whenTxt, if (going > 0) "$going vão" else null), live = ev.status == "ACTIVE",
                icon = Icons.Outlined.Event, path = l.path,
            )
        }
    "channel" -> {
        val ch = repo.channel(l.id) ?: repo.resolveLink("/canal/" + Uri.encode(l.id))?.id?.let { repo.channel(it) }
        ch?.let {
            Preview(
                label = if (it.type == "VOICE") "Canal de voz" else "Canal", title = it.name,
                text = clip(it.topic, 110), image = it.iconUrl, icon = Icons.Outlined.Tag, path = l.path,
            )
        }
    }
    "club" -> Preview(label = "Tema do Fórum", title = l.id.replace('-', ' ').replaceFirstChar { it.uppercase() }, icon = Icons.Outlined.Campaign, path = l.path)
    "wiki" -> repo.api.get<WikiPageResponse>("/api/wiki/" + Uri.encode(l.id)).page?.let { pg ->
        Preview(
            label = "Wiki" + (pg.category?.let { " · $it" } ?: ""), title = pg.title,
            text = clip(pg.body?.replace(Regex("[#*_>`-]"), " ")), icon = Icons.Outlined.MenuBook, action = "Ler", path = "/wiki/" + pg.slug,
        )
    }
    else -> null
}

@Composable
private fun PreviewLinkCard(l: InternalLink, repo: Repository) {
    val p = rememberRemote<Preview>("prev:" + l.kind + ":" + l.id) { loadPreview(l, repo) } ?: return
    val open = LocalOpenLink.current
    val openUser = com.projectclub.android.ui.profile.LocalOpenUser.current
    val accent = if (p.live) PC.Red else PC.Brand
    val shape = RoundedCornerShape(14.dp)
    val go = { if (p.user != null) openUser(p.user.id) else open(p.path) }
    Column(
        Modifier.widthIn(max = 340.dp).fillMaxWidth().clip(shape).background(PC.Surface).border(1.dp, PC.Line, shape).clickable(onClick = go),
    ) {
        if (p.wideImage && p.image != null) {
            AsyncImage(Config.media(p.image), null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth().aspectRatio(2f))
        }
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            when {
                p.user != null -> Avatar(p.user, 48.dp)
                !p.wideImage && p.image != null -> AsyncImage(Config.media(p.image), null, contentScale = ContentScale.Crop, modifier = Modifier.size(48.dp).clip(RoundedCornerShape(12.dp)))
                p.icon != null -> Box(Modifier.size(48.dp).clip(RoundedCornerShape(12.dp)).background(accent.copy(alpha = 0.16f)), contentAlignment = Alignment.Center) {
                    Icon(p.icon, null, tint = accent, modifier = Modifier.size(24.dp))
                }
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(p.label, color = accent, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                Text(p.title, color = PC.Header, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                p.text?.let { Text(it, color = PC.Muted, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                if (p.meta.isNotEmpty()) Text(p.meta.joinToString(" · "), color = PC.Faint, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Box(
            Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp).fillMaxWidth().height(36.dp).clip(RoundedCornerShape(10.dp))
                .background(accent.copy(alpha = 0.16f)).clickable(onClick = go),
            contentAlignment = Alignment.Center,
        ) { Text(p.action, color = accent, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelLarge) }
    }
}
