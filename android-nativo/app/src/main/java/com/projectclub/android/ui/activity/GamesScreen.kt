package com.projectclub.android.ui.activity

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SportsEsports
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.data.Repository
import com.projectclub.android.data.User
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.EmptyState
import com.projectclub.android.ui.common.ListSkeleton
import com.projectclub.android.ui.common.PcField
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.common.formatTime
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.delay
import kotlinx.serialization.Serializable

@Serializable data class LibGame(
    val gameKey: String = "", val name: String = "", val steamAppId: Long? = null, val iconUrl: String? = null,
    val totalSeconds: Long = 0, val sessions: Int = 0, val firstPlayedAt: String? = null, val lastPlayedAt: String? = null,
    val playingNow: Boolean = false, val sessionStartedAt: String? = null,
)
@Serializable data class LibTotals(val games: Int = 0, val seconds: Long = 0)
@Serializable data class LibWeek(val start: String = "", val seconds: Long = 0, val count: Int = 0)
@Serializable data class LibWeekly(val source: String = "days", val weeks: List<LibWeek> = emptyList())
@Serializable data class GameLibrary(
    val user: User? = null, val isMe: Boolean = false, val visible: Boolean = true, val visibility: String? = null,
    val games: List<LibGame> = emptyList(), val recent: List<LibGame> = emptyList(), val totals: LibTotals? = null,
    val nowPlaying: LibGame? = null, val weekly: LibWeekly? = null, val common: List<LibGame>? = null,
)

private val SORTS = listOf("playtime" to "Mais jogados", "recent" to "Recentes", "name" to "A–Z")

fun hours(seconds: Long): String = when {
    seconds < 60 -> "menos de 1 min"
    seconds < 3600 -> "${seconds / 60} min"
    else -> { val h = seconds / 3600.0; if (h < 10) String.format(java.util.Locale("pt", "BR"), "%.1f h", h) else "${h.toLong()} h" }
}

private fun cover(g: LibGame): String? =
    g.steamAppId?.let { "https://cdn.cloudflare.steamstatic.com/steam/apps/$it/header.jpg" } ?: Config.media(g.iconUrl)

/** Biblioteca de jogos (igual à /jogos/biblioteca do PC): tempo de jogo por jogo, jogando agora e horas por semana. */
@Composable
fun GamesScreen(repo: Repository, nav: AppNav, userId: String) {
    var lib by remember { mutableStateOf<GameLibrary?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var sort by remember { mutableStateOf("playtime") }
    var q by remember { mutableStateOf("") }
    LaunchedEffect(userId, sort, q) {
        if (q.isNotEmpty()) delay(300)
        val qs = "sort=$sort" + if (q.isNotBlank()) "&q=" + java.net.URLEncoder.encode(q.trim(), "UTF-8") else ""
        runCatching { repo.api.get<GameLibrary>("/api/games/library/${userId.ifBlank { "me" }}?$qs") }
            .onSuccess { lib = it; error = null }.onFailure { error = it.message ?: "Não deu pra carregar." }
    }
    val l = lib
    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        PcTopBar(
            if (l == null || l.isMe) "Biblioteca de jogos" else "Jogos de ${l.user?.name ?: "…"}", Icons.Outlined.SportsEsports,
            navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } },
        )
        when {
            error != null && l == null -> EmptyState(Icons.Outlined.SportsEsports, "Não deu pra carregar", error!!)
            l == null -> ListSkeleton(8, 46.dp)
            !l.visible -> EmptyState(Icons.Outlined.Lock, "Biblioteca privada", "${l.user?.name ?: "Essa pessoa"} escolheu não mostrar os jogos.")
            else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item(key = "head") { Header(l) }
                l.nowPlaying?.let { g -> item(key = "now") { NowPlaying(g) } }
                l.weekly?.takeIf { it.source == "days" && it.weeks.any { w -> w.seconds > 0 } }?.let { w -> item(key = "weekly") { Weekly(w) } }
                if (!l.isMe && !l.common.isNullOrEmpty()) item(key = "common") {
                    Text("EM COMUM COM VOCÊ · ${l.common!!.size}", color = PC.Muted, style = MaterialTheme.typography.labelSmall)
                    Spacer(Modifier.height(6.dp))
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        l.common!!.forEach { g ->
                            Box(Modifier.width(150.dp).height(70.dp).clip(RoundedCornerShape(12.dp)).background(PC.Surface2)) {
                                cover(g)?.let { AsyncImage(it, g.name, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize()) }
                            }
                        }
                    }
                }
                item(key = "filters") {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        PcField(q, { q = it }, "Buscar jogo", icon = Icons.Outlined.Search)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            SORTS.forEach { (k, label) -> com.projectclub.android.ui.forum.SelectPill(label, sort == k, { sort = k }) }
                        }
                    }
                }
                if (l.games.isEmpty()) item(key = "empty") {
                    Text(
                        if (q.isNotBlank()) "Nenhum jogo com esse nome." else if (l.isMe) "Nenhum jogo ainda. O tempo de jogo é contado pelo app do PC (Windows/Linux) enquanto você joga." else "Nenhum jogo registrado ainda.",
                        color = PC.Muted, modifier = Modifier.padding(8.dp),
                    )
                }
                items(l.games, key = { it.gameKey }) { g -> GameRow(g, (l.games.maxOfOrNull { it.totalSeconds } ?: 1L).coerceAtLeast(1L)) }
            }
        }
    }
}

@Composable
private fun Header(l: GameLibrary) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(PC.Surface).border(1.dp, PC.Line, RoundedCornerShape(18.dp)).padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(l.user, 48.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(l.user?.name ?: "…", color = PC.Header, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("${l.totals?.games ?: 0} jogos · ${hours(l.totals?.seconds ?: 0)} no total", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
            if (l.isMe) Text(
                "Visível para: " + when (l.visibility) { "everyone" -> "todo mundo"; "nobody" -> "ninguém"; else -> "amigos" },
                color = PC.Faint, style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

@Composable
private fun NowPlaying(g: LibGame) {
    Box(Modifier.fillMaxWidth().height(120.dp).clip(RoundedCornerShape(18.dp)).background(PC.Surface2)) {
        cover(g)?.let { AsyncImage(it, null, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize()) }
        Box(Modifier.matchParentSize().background(Brush.horizontalGradient(listOf(Color(0xE6000000), Color(0x33000000)))))
        Column(Modifier.align(Alignment.CenterStart).padding(16.dp)) {
            Text("● JOGANDO AGORA", color = PC.Green, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
            Text(g.name, color = Color.White, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("${hours(g.totalSeconds)} no total", color = Color(0xCCFFFFFF), style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun Weekly(w: LibWeekly) {
    val max = (w.weeks.maxOfOrNull { it.seconds } ?: 1L).coerceAtLeast(1L)
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(PC.Surface).border(1.dp, PC.Line, RoundedCornerShape(18.dp)).padding(14.dp)) {
        Text("HORAS POR SEMANA", color = PC.Muted, style = MaterialTheme.typography.labelSmall)
        Spacer(Modifier.height(10.dp))
        Row(Modifier.fillMaxWidth().height(90.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Bottom) {
            w.weeks.forEachIndexed { i, wk ->
                Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.Bottom, horizontalAlignment = Alignment.CenterHorizontally) {
                    val frac = (wk.seconds.toFloat() / max).coerceIn(0.03f, 1f)
                    Box(Modifier.fillMaxWidth().height((70 * frac).dp).clip(RoundedCornerShape(6.dp)).background(if (i == w.weeks.lastIndex) PC.Brand else PC.Brand.copy(alpha = 0.45f)))
                    Spacer(Modifier.height(4.dp))
                    Text(wk.start.takeLast(5).split("-").reversed().joinToString("/"), color = PC.Faint, style = MaterialTheme.typography.labelSmall, maxLines = 1)
                }
            }
        }
    }
}

@Composable
private fun GameRow(g: LibGame, max: Long) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(PC.Surface).border(1.dp, if (g.playingNow) PC.Green.copy(alpha = 0.5f) else PC.Line, RoundedCornerShape(16.dp)).padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(width = 92.dp, height = 43.dp).clip(RoundedCornerShape(8.dp)).background(PC.Surface2), contentAlignment = Alignment.Center) {
            val c = cover(g)
            if (c != null) AsyncImage(c, null, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize())
            else Icon(Icons.Outlined.SportsEsports, null, tint = PC.Muted)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(g.name, color = PC.Header, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                if (g.playingNow) "Jogando agora" else "Última vez ${formatTime(g.lastPlayedAt)}",
                color = if (g.playingNow) PC.Green else PC.Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1,
            )
            Spacer(Modifier.height(5.dp))
            Box(Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)).background(PC.Surface3)) {
                Box(Modifier.fillMaxWidth((g.totalSeconds.toFloat() / max).coerceIn(0.02f, 1f)).height(4.dp).clip(RoundedCornerShape(2.dp)).background(PC.Brand))
            }
        }
        Spacer(Modifier.width(10.dp))
        Text(hours(g.totalSeconds), color = PC.Header, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelLarge)
    }
}
