package com.projectclub.android.ui.events

import android.content.Intent
import android.widget.Toast
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material.icons.outlined.EventBusy
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.QuestionMark
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.data.CommunityEvent
import com.projectclub.android.data.CommunityEventsResponse
import com.projectclub.android.data.EventRsvpCounts
import com.projectclub.android.data.EventRsvpResponse
import com.projectclub.android.data.EventRsvpSummary
import com.projectclub.android.data.Repository
import com.projectclub.android.data.User
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.Bone
import com.projectclub.android.ui.common.EmptyState
import com.projectclub.android.ui.common.GhostButton
import com.projectclub.android.ui.common.PcCard
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.common.SectionLabel
import com.projectclub.android.ui.common.instantOf
import com.projectclub.android.ui.common.rememberShimmer
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private data class RsvpOption(val key: String, val label: String, val icon: ImageVector, val color: Color)

private val OPTIONS = listOf(
    RsvpOption("GOING", "Eu vou", Icons.Outlined.Check, PC.Green),
    RsvpOption("MAYBE", "Talvez", Icons.Outlined.QuestionMark, PC.Yellow),
    RsvpOption("NO", "Não vou", Icons.Outlined.Close, PC.Red),
)

/** Detalhe de um evento: banner, datas, descrição completa, "Eu vou / Talvez / Não vou" e quem vai. */
@Composable
fun EventScreen(repo: Repository, nav: AppNav, eventId: String) {
    var event by remember { mutableStateOf<CommunityEvent?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var rsvpError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    val now = rememberNow()

    // O servidor não tem GET /events/:id: a lista (até 50, mais recentes) já traz tudo.
    suspend fun load() {
        loading = true
        try {
            // Links bonitos: chega o id ou o nome do link (/evento/<slug>).
            val found = repo.api.get<CommunityEventsResponse>("/api/events").events.let { list ->
                list.firstOrNull { it.id == eventId } ?: list.firstOrNull { it.slug?.equals(eventId, ignoreCase = true) == true }
            }
            event = found
            error = if (found == null) "Esse evento não existe mais ou foi removido." else null
        } catch (e: Exception) {
            error = e.message ?: "Não deu para carregar o evento."
        }
        loading = false
    }
    LaunchedEffect(eventId) { load() }

    fun pick(key: String) {
        val ev = event ?: return
        if (busy || ev.status == "ENDED") return
        val before = ev.rsvp ?: EventRsvpSummary()
        val next: String? = if (before.mine == key) null else key
        // Otimista: mexe na contagem na hora.
        var going = before.counts.GOING; var maybe = before.counts.MAYBE; var no = before.counts.NO
        when (before.mine) { "GOING" -> going--; "MAYBE" -> maybe--; "NO" -> no-- }
        when (next) { "GOING" -> going++; "MAYBE" -> maybe++; "NO" -> no++ }
        event = ev.copy(rsvp = before.copy(counts = EventRsvpCounts(going.coerceAtLeast(0), maybe.coerceAtLeast(0), no.coerceAtLeast(0)), mine = next))
        busy = true; rsvpError = null
        scope.launch {
            try {
                val body = buildJsonObject { if (next != null) put("status", next) else put("status", JsonNull) }
                val r = repo.api.post<EventRsvpResponse>("/api/events/$eventId/rsvp", body)
                val fresh = r.rsvp ?: before
                event = event?.copy(rsvp = fresh.copy(mine = r.mine))
            } catch (e: Exception) {
                event = event?.copy(rsvp = before)
                rsvpError = e.message ?: "Não deu pra salvar sua resposta."
            }
            busy = false
        }
    }

    fun share() {
        val ev = event ?: return
        val link = "${Config.baseUrl}/evento/" + android.net.Uri.encode(ev.slug ?: ev.id)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, ev.title)
            putExtra(Intent.EXTRA_TEXT, "${ev.title}\n$link")
        }
        runCatching { ctx.startActivity(Intent.createChooser(send, "Compartilhar evento")) }
            .onFailure { Toast.makeText(ctx, "Não deu para compartilhar.", Toast.LENGTH_SHORT).show() }
    }

    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        PcTopBar(
            event?.title ?: "Evento", Icons.Outlined.Event,
            navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } },
        ) {
            if (event != null) IconButton(onClick = { share() }) { Icon(Icons.Outlined.Share, "Compartilhar", tint = PC.Text) }
        }
        val ev = event
        when {
            ev == null && loading -> EventSkeleton()
            ev == null -> EmptyState(Icons.Outlined.EventBusy, "Evento indisponível", error ?: "") {
                GhostButton("Tentar de novo", { scope.launch { load() } }, icon = Icons.Outlined.Refresh)
            }
            else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                EventBanner(ev, 200.dp)
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Config.media(ev.iconUrl)?.let { url ->
                            AsyncImage(url, null, contentScale = ContentScale.Crop, modifier = Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)).background(PC.Surface2))
                            Spacer(Modifier.width(12.dp))
                        }
                        Text(ev.title, color = PC.Header, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
                    }

                    PcCard(padding = PaddingValues(14.dp)) {
                        eventWhen(ev, now)?.let {
                            Text(it, color = statusColor(ev.status), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                            Spacer(Modifier.height(8.dp))
                        }
                        DateLine("Começa", formatEventDate(ev.startsAt) ?: "Sem data marcada")
                        formatEventDate(ev.endsAt)?.let { Spacer(Modifier.height(6.dp)); DateLine("Termina", it) }
                        if (ev.status == "ENDED") {
                            Spacer(Modifier.height(8.dp))
                            Text("Esse evento já terminou.", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
                        }
                    }

                    val rsvp = ev.rsvp ?: EventRsvpSummary()
                    if (ev.status != "ENDED") {
                        Column {
                            SectionLabel("Você vai?", Modifier.padding(bottom = 8.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OPTIONS.forEach { o ->
                                    RsvpButton(o, rsvp.mine == o.key, rsvp.counts.of(o.key), busy, Modifier.weight(1f)) { pick(o.key) }
                                }
                            }
                            rsvpError?.let { Text(it, color = PC.Red, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp)) }
                            val startsLater = (instantOf(ev.startsAt)?.toEpochMilli() ?: 0L) > now
                            if (rsvp.mine == "GOING" && ev.status == "UPCOMING" && startsLater) {
                                Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Outlined.NotificationsActive, null, tint = PC.Brand, modifier = Modifier.size(16.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text("Você recebe um lembrete 15 minutos antes.", color = PC.Brand, style = MaterialTheme.typography.bodySmall)
                                }
                            }
                        }
                    }

                    ev.description?.takeIf { it.isNotBlank() }?.let { desc ->
                        Column {
                            SectionLabel("Sobre o evento", Modifier.padding(bottom = 8.dp))
                            Text(desc, color = PC.Text, style = MaterialTheme.typography.bodyLarge)
                        }
                    }

                    val people = (rsvp.going.map { it to "Vai" } + rsvp.maybe.map { it to "Talvez" }).distinctBy { it.first.id }
                    if (rsvp.counts.GOING > 0 || rsvp.counts.MAYBE > 0) {
                        Column {
                            SectionLabel("Participantes", Modifier.padding(bottom = 8.dp))
                            PcCard(padding = PaddingValues(12.dp)) {
                                RsvpFaces(rsvp, ev.status == "ENDED", onUser = { nav.profile(it.id) })
                                if (people.isNotEmpty()) Spacer(Modifier.height(6.dp))
                                people.forEach { (u, label) -> PersonRow(u, label) { nav.profile(u.id) } }
                                val hidden = rsvp.counts.GOING + rsvp.counts.MAYBE - people.size
                                if (hidden > 0) Text("e mais $hidden", color = PC.Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(start = 4.dp, top = 6.dp))
                            }
                        }
                    }

                    ev.createdBy?.let { by ->
                        Row(
                            Modifier.clip(RoundedCornerShape(12.dp)).clickable { nav.profile(by.id) }.padding(4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Avatar(by, 24.dp)
                            Spacer(Modifier.width(8.dp))
                            Text("Por ${by.name}", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                    Spacer(Modifier.navigationBarsPadding())
                }
            }
        }
    }
}

@Composable
private fun DateLine(label: String, value: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.Schedule, null, tint = PC.Muted, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(8.dp))
        Text("$label: ", color = PC.Muted, style = MaterialTheme.typography.bodyMedium)
        Text(value, color = PC.Header, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun RsvpButton(o: RsvpOption, on: Boolean, count: Int, busy: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val shape = RoundedCornerShape(14.dp)
    Row(
        modifier.heightIn(min = 46.dp).clip(shape)
            .background(if (on) o.color.copy(alpha = 0.18f) else PC.Surface)
            .border(1.dp, if (on) o.color else PC.LineStrong, shape)
            .clickable(enabled = !busy, onClick = onClick).padding(horizontal = 8.dp),
        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(o.icon, null, tint = if (on) o.color else PC.Muted, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(5.dp))
        Text(o.label, color = if (on) PC.Header else PC.Text, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.width(5.dp))
        Text(count.toString(), color = if (on) o.color else PC.Faint, style = MaterialTheme.typography.labelSmall)
    }
}

@Composable
private fun PersonRow(u: User, label: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(horizontal = 4.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(u, 34.dp)
        Spacer(Modifier.width(10.dp))
        Text(u.name, color = PC.Header, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Box(Modifier.clip(CircleShape).background(if (label == "Vai") PC.Green.copy(alpha = 0.16f) else PC.Yellow.copy(alpha = 0.16f)).padding(horizontal = 8.dp, vertical = 3.dp)) {
            Text(label, color = if (label == "Vai") PC.Green else PC.Yellow, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun EventSkeleton() {
    val b = rememberShimmer()
    Column {
        Bone(b, Modifier.fillMaxWidth().height(200.dp), RoundedCornerShape(0.dp))
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Bone(b, Modifier.fillMaxWidth(0.75f).height(24.dp))
            Bone(b, Modifier.fillMaxWidth().height(70.dp), RoundedCornerShape(20.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                repeat(3) { Bone(b, Modifier.weight(1f).height(46.dp), RoundedCornerShape(14.dp)) }
            }
            Bone(b, Modifier.fillMaxWidth().height(14.dp))
            Bone(b, Modifier.fillMaxWidth(0.9f).height(14.dp))
            Box(Modifier.fillMaxWidth().padding(top = 8.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = PC.Brand)
            }
        }
    }
}
