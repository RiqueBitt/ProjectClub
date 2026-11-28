package com.projectclub.android.ui.events

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.data.CommunityEvent
import com.projectclub.android.data.CommunityEventsResponse
import com.projectclub.android.data.EventRsvpSummary
import com.projectclub.android.data.Repository
import com.projectclub.android.data.User
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.Bone
import com.projectclub.android.ui.common.Chip
import com.projectclub.android.ui.common.EmptyState
import com.projectclub.android.ui.common.GhostButton
import com.projectclub.android.ui.common.HeroBox
import com.projectclub.android.ui.common.PcCard
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.common.instantOf
import com.projectclub.android.ui.common.rememberShimmer
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val TABS = listOf("ACTIVE" to "Acontecendo", "UPCOMING" to "Em breve", "ENDED" to "Encerrados")

/** Lista de eventos da comunidade (como a página Eventos do site): Acontecendo / Em breve / Encerrados. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EventsScreen(repo: Repository, nav: AppNav) {
    var events by remember { mutableStateOf<List<CommunityEvent>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var tab by rememberSaveable { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val now = rememberNow()

    suspend fun load() {
        try {
            events = repo.api.get<CommunityEventsResponse>("/api/events").events
            error = null
        } catch (e: Exception) {
            error = e.message ?: "Não deu para carregar os eventos."
        }
    }
    LaunchedEffect(Unit) { load() }

    val list = events
    val groups = remember(list) {
        val by: Map<String, MutableList<CommunityEvent>> = mapOf(
            "ACTIVE" to mutableListOf<CommunityEvent>(),
            "UPCOMING" to mutableListOf<CommunityEvent>(),
            "ENDED" to mutableListOf<CommunityEvent>(),
        )
        list?.forEach { ev -> (by[ev.status] ?: by.getValue("UPCOMING")).add(ev) }
        by.getValue("UPCOMING").sortBy { instantOf(it.startsAt ?: it.createdAt)?.toEpochMilli() ?: Long.MAX_VALUE }
        by.mapValues { it.value.toList() }
    }
    val activeTab = tab ?: TABS.firstOrNull { groups[it.first].orEmpty().isNotEmpty() }?.first ?: "UPCOMING"
    val shown = groups[activeTab].orEmpty()

    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        PcTopBar(
            "Eventos", Icons.Outlined.Event,
            navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } },
        )
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { scope.launch { refreshing = true; load(); refreshing = false } },
            modifier = Modifier.fillMaxSize(),
        ) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item(key = "hero") {
                    HeroBox(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(20.dp)) {
                            Text("CANAL EM DESTAQUE", color = Color(0xB3FFFFFF), style = MaterialTheme.typography.labelSmall)
                            Text("Eventos", style = MaterialTheme.typography.headlineMedium, color = Color.White)
                            Spacer(Modifier.height(4.dp))
                            Text(
                                "Campeonatos, encontros e novidades da comunidade. Fique de olho para não perder nada.",
                                color = Color(0xCCFFFFFF), style = MaterialTheme.typography.bodyMedium,
                            )
                            Spacer(Modifier.height(14.dp))
                            EventTabs(activeTab, { key -> groups[key]?.size ?: 0 }, list != null) { tab = it }
                        }
                    }
                }
                when {
                    list == null && error != null -> item(key = "error") {
                        EmptyState(Icons.Outlined.Event, "Não deu para carregar", error ?: "") {
                            GhostButton("Tentar de novo", { scope.launch { error = null; load() } }, icon = Icons.Outlined.Refresh)
                        }
                    }
                    list == null -> items(3, key = { "sk$it" }) { EventCardSkeleton() }
                    shown.isEmpty() -> item(key = "empty") {
                        EmptyState(
                            Icons.Outlined.CalendarMonth,
                            when (activeTab) { "ACTIVE" -> "Nada acontecendo agora"; "UPCOMING" -> "Nenhum evento marcado"; else -> "Nenhum evento encerrado" },
                            "Quando a equipe marcar um evento, ele aparece aqui.",
                        )
                    }
                    else -> items(shown, key = { it.id }) { ev ->
                        EventCard(ev, now, onClick = { nav.event(ev.id) })
                    }
                }
                item(key = "end") { Spacer(Modifier.navigationBarsPadding()) }
            }
        }
    }
}

@Composable
private fun EventTabs(selected: String, count: (String) -> Int, loaded: Boolean, onSelect: (String) -> Unit) {
    val shape = RoundedCornerShape(18.dp)
    Row(Modifier.fillMaxWidth().clip(shape).background(Color(0x99000000)).border(1.dp, PC.Line, shape).padding(5.dp)) {
        TABS.forEach { (key, label) ->
            val on = key == selected
            val bg by animateColorAsState(if (on) PC.Surface2 else Color.Transparent, label = "evtab")
            Row(
                Modifier.weight(1f).clip(RoundedCornerShape(14.dp)).background(bg).clickable { onSelect(key) }.padding(vertical = 10.dp),
                horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
            ) {
                if (key == "ACTIVE") { Box(Modifier.size(7.dp).clip(CircleShape).background(PC.Red)); Spacer(Modifier.width(6.dp)) }
                Text(label, color = if (on) PC.Header else PC.Muted, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, maxLines = 1)
                Spacer(Modifier.width(5.dp))
                Text(if (loaded) count(key).toString() else "–", color = if (on) PC.Brand else PC.Faint, style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}

/** Cartão de evento na lista: banner, status, título, quando, datas, prévia e quem vai. */
@Composable
private fun EventCard(ev: CommunityEvent, now: Long, onClick: () -> Unit) {
    PcCard(onClick = onClick, padding = PaddingValues(0.dp), border = if (ev.status == "ACTIVE") PC.Red.copy(alpha = 0.35f) else PC.Line) {
        EventBanner(ev, 150.dp)
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Config.media(ev.iconUrl)?.let { url ->
                    AsyncImage(url, null, contentScale = ContentScale.Crop, modifier = Modifier.size(28.dp).clip(RoundedCornerShape(8.dp)).background(PC.Surface2))
                    Spacer(Modifier.width(10.dp))
                }
                Text(ev.title, color = PC.Header, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            }
            eventWhen(ev, now)?.let { Text(it, color = statusColor(ev.status), style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 6.dp)) }
            eventDates(ev)?.let { dates ->
                Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Schedule, null, tint = PC.Muted, modifier = Modifier.size(15.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(dates, color = PC.Muted, style = MaterialTheme.typography.bodySmall)
                }
            }
            ev.description?.takeIf { it.isNotBlank() }?.let {
                Text(it, color = PC.Text, style = MaterialTheme.typography.bodyMedium, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 10.dp))
            }
            val rsvp = ev.rsvp
            if (rsvp != null && (rsvp.counts.GOING > 0 || rsvp.counts.MAYBE > 0 || rsvp.mine != null)) {
                Spacer(Modifier.height(12.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    RsvpFaces(rsvp, ev.status == "ENDED", Modifier.weight(1f))
                    if (rsvp.mine == "GOING") Chip("Você vai", PC.Green, dot = true)
                    else if (rsvp.mine == "MAYBE") Chip("Talvez", PC.Yellow, dot = true)
                }
            }
        }
    }
}

@Composable
private fun EventCardSkeleton() {
    val b = rememberShimmer()
    PcCard(padding = PaddingValues(0.dp)) {
        Bone(b, Modifier.fillMaxWidth().height(150.dp), RoundedCornerShape(0.dp))
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Bone(b, Modifier.fillMaxWidth(0.7f).height(18.dp))
            Bone(b, Modifier.fillMaxWidth(0.4f).height(12.dp))
            Bone(b, Modifier.fillMaxWidth().height(12.dp))
        }
    }
}

// ---------- Peças compartilhadas com EventScreen ----------

/** "Agora" que avança a cada minuto (pra "Começa em 2 horas" se atualizar sozinho). */
@Composable
internal fun rememberNow(): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(60_000)
            now = System.currentTimeMillis()
        }
    }
    return now
}

internal fun statusLabel(status: String): String = when (status) {
    "ACTIVE" -> "Ao vivo"
    "UPCOMING" -> "Em breve"
    "ENDED" -> "Encerrado"
    else -> status
}

internal fun statusColor(status: String): Color = when (status) {
    "ACTIVE" -> PC.Red
    "UPCOMING" -> PC.Events
    else -> PC.Muted
}

private val dateFmt = DateTimeFormatter.ofPattern("dd 'de' MMM, HH:mm", Locale("pt", "BR"))

internal fun formatEventDate(iso: String?): String? =
    instantOf(iso)?.atZone(ZoneId.systemDefault())?.format(dateFmt)

internal fun eventDates(ev: CommunityEvent): String? {
    val s = formatEventDate(ev.startsAt)
    val e = formatEventDate(ev.endsAt)
    if (s == null && e == null) return null
    return (s ?: "—") + (if (e != null) " até $e" else "")
}

private fun relative(iso: String?, now: Long): String? {
    val t = instantOf(iso)?.toEpochMilli() ?: return null
    val abs = kotlin.math.abs(t - now)
    val units = listOf(Triple(86_400_000L, "dia", "dias"), Triple(3_600_000L, "hora", "horas"), Triple(60_000L, "minuto", "minutos"))
    for ((ms, one, many) in units) {
        if (abs >= ms) {
            val n = abs / ms
            return "$n ${if (n == 1L) one else many}"
        }
    }
    return "instantes"
}

/** "Começa em 3 horas" / "Termina em 20 minutos" (igual ao site). */
internal fun eventWhen(ev: CommunityEvent, now: Long): String? {
    val starts = instantOf(ev.startsAt)?.toEpochMilli()
    val ends = instantOf(ev.endsAt)?.toEpochMilli()
    return when {
        ev.status == "UPCOMING" && starts != null && starts > now -> "Começa em ${relative(ev.startsAt, now)}"
        ev.status == "ACTIVE" && ends != null && ends > now -> "Termina em ${relative(ev.endsAt, now)}"
        else -> null
    }
}

/** Banner do evento com o selo de status por cima. */
@Composable
internal fun EventBanner(ev: CommunityEvent, height: Dp) {
    Box(Modifier.fillMaxWidth().height(height).background(PC.BannerGradient)) {
        val url = Config.media(ev.bannerUrl)
        if (url != null) {
            AsyncImage(url, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        } else {
            Icon(Icons.Outlined.CalendarMonth, null, tint = Color(0xCCFFFFFF), modifier = Modifier.size(40.dp).align(Alignment.Center))
        }
        StatusBadge(ev.status, Modifier.align(Alignment.TopStart).padding(12.dp))
    }
}

@Composable
internal fun StatusBadge(status: String, modifier: Modifier = Modifier) {
    val color = statusColor(status)
    Row(
        modifier.clip(CircleShape).background(Color(0xCC000000)).border(1.dp, color.copy(alpha = 0.6f), CircleShape)
            .padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (status == "ACTIVE") { Box(Modifier.size(7.dp).clip(CircleShape).background(PC.Red)); Spacer(Modifier.width(6.dp)) }
        else if (status == "ENDED") { Icon(Icons.Outlined.CheckCircle, null, tint = color, modifier = Modifier.size(13.dp)); Spacer(Modifier.width(5.dp)) }
        Text(statusLabel(status), color = if (status == "ENDED") PC.Text else color, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
    }
}

/** Rostinhos de quem vai/talvez + "5 vão · 2 talvez". */
@Composable
internal fun RsvpFaces(rsvp: EventRsvpSummary, ended: Boolean, modifier: Modifier = Modifier, onUser: ((User) -> Unit)? = null) {
    val going = rsvp.counts.GOING
    val maybe = rsvp.counts.MAYBE
    if (going == 0 && maybe == 0) { Spacer(modifier); return }
    val faces = (rsvp.going + rsvp.maybe).distinctBy { it.id }.take(6)
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width((22 + (faces.size - 1).coerceAtLeast(0) * 15).dp).height(24.dp)) {
            faces.forEachIndexed { i, u ->
                Box(
                    Modifier.offset(x = (i * 15).dp).size(24.dp).clip(CircleShape).background(PC.Surface).padding(1.5.dp)
                        .then(if (onUser != null) Modifier.clickable { onUser(u) } else Modifier),
                ) { Avatar(u, 21.dp) }
            }
        }
        Spacer(Modifier.width(8.dp))
        val parts = buildList {
            if (going > 0) add("$going " + if (ended) (if (going == 1) "foi" else "foram") else (if (going == 1) "vai" else "vão"))
            if (maybe > 0) add("$maybe talvez")
        }
        Text(parts.joinToString(" · "), color = PC.Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
