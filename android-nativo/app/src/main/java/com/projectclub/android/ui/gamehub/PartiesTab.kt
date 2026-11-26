package com.projectclub.android.ui.gamehub

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Headset
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.Remove
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.SportsEsports
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.projectclub.android.Config
import com.projectclub.android.data.GameParty
import com.projectclub.android.data.HubGame
import com.projectclub.android.data.PartiesResponse
import com.projectclub.android.data.PartyCallResponse
import com.projectclub.android.data.PartyClosed
import com.projectclub.android.data.PartyInvited
import com.projectclub.android.data.PartyResponse
import com.projectclub.android.data.Repository
import com.projectclub.android.data.User
import com.projectclub.android.gamehub.HubLogic
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.EmptyState
import com.projectclub.android.ui.common.GhostButton
import com.projectclub.android.ui.common.ListSkeleton
import com.projectclub.android.ui.common.PcField
import com.projectclub.android.ui.common.PillButton
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.LocalDateTime
import java.time.ZoneId

/** O que dá pra fazer com uma partida (a tela liga cada um à API). */
class PartyActions(
    val onJoin: (GameParty) -> Unit = {},
    val onLeave: (GameParty) -> Unit = {},
    val onCall: (GameParty) -> Unit = {},
    val onInvite: (GameParty) -> Unit = {},
    val onClose: (GameParty) -> Unit = {},
    val onShare: (GameParty) -> Unit = {},
)

@Composable
fun PartiesTab(repo: Repository, nav: AppNav, highlight: String? = null, startCreating: Boolean = false) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val parties = rememberLoader("parties") { repo.api.get<PartiesResponse>("/api/game-hub/parties").parties }
    var busy by remember { mutableStateOf<String?>(null) }
    var creating by remember { mutableStateOf(startCreating) }
    var inviting by remember { mutableStateOf<GameParty?>(null) }

    fun act(p: GameParty, block: suspend () -> Unit) {
        if (busy != null) return
        busy = p.id
        scope.launch {
            runCatching { block() }.onFailure { ctx.toast(it.message ?: "Não deu certo.") }
            busy = null
            parties.reload()
        }
    }
    val actions = PartyActions(
        onJoin = { p -> act(p) { repo.api.post<PartyResponse>("/api/game-hub/parties/${p.id}/join"); ctx.toast("Você entrou na partida.") } },
        onLeave = { p -> act(p) { repo.api.post<PartyClosed>("/api/game-hub/parties/${p.id}/leave") } },
        onClose = { p -> act(p) { repo.api.post<PartyClosed>("/api/game-hub/parties/${p.id}/close"); ctx.toast("Partida fechada.") } },
        onCall = { p ->
            act(p) {
                val ch = repo.api.post<PartyCallResponse>("/api/game-hub/parties/${p.id}/call").channel
                if (ch != null && ch.id.isNotBlank()) nav.joinVoice(ch.id, ch.name.ifBlank { "Partida · ${p.game.name}" })
            }
        },
        onInvite = { inviting = it },
        onShare = { p ->
            val link = Config.baseUrl + "/jogos/partidas?p=" + p.id
            val text = "Bora jogar ${p.game.name}? ${HubLogic.whenLabel(p.startsAt)} — $link"
            runCatching { ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), "Chamar pra partida")) }
        },
    )
    val me by repo.me.collectAsState()
    val list = parties.data
    when {
        list == null && parties.error != null -> EmptyState(Icons.Outlined.Groups, "Não deu pra carregar", parties.error!!)
        list == null -> ListSkeleton(5, 56.dp)
        else -> PartiesContent(list, me?.id, busy, highlight, actions, onCreate = { creating = true })
    }
    if (creating) CreatePartySheet(repo, onDismiss = { creating = false }) { created ->
        creating = false
        parties.reload()
        if (created != null) ctx.toast("Partida criada!")
    }
    inviting?.let { p ->
        InviteSheet(repo, p, onDismiss = { inviting = null }) { n ->
            inviting = null
            ctx.toast(if (n > 0) "Convite enviado pra $n ${if (n == 1) "pessoa" else "pessoas"}." else "Ninguém novo pra convidar.")
            parties.reload()
        }
    }
}

@Composable
fun PartiesContent(
    parties: List<GameParty>,
    meId: String?,
    busy: String?,
    highlight: String?,
    actions: PartyActions,
    onCreate: () -> Unit,
) {
    val sorted = remember(parties, highlight) { parties.sortedByDescending { it.id == highlight } }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item(key = "create") {
            PillButton("Criar partida", onCreate, Modifier.fillMaxWidth(), icon = Icons.Outlined.Add, color = HubVioletDeep)
        }
        if (sorted.isEmpty()) item(key = "empty") {
            EmptyState(Icons.Outlined.SportsEsports, "Nenhuma partida aberta", "Abra uma e chame a galera: quem entrar ganha a call da partida.")
        }
        items(sorted, key = { it.id }) { p -> PartyCard(p, meId, busy == p.id, p.id == highlight, actions) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PartyCard(p: GameParty, meId: String?, busy: Boolean, highlighted: Boolean, actions: PartyActions) {
    val shape = RoundedCornerShape(20.dp)
    val isHost = p.myStatus == "host" || (meId != null && p.host?.id == meId)
    Column(
        Modifier.fillMaxWidth().clip(shape).background(PC.Surface)
            .border(if (highlighted) 2.dp else 1.dp, if (highlighted) HubViolet else PC.Line, shape),
    ) {
        Box {
            GameCover(p.game.name, Modifier.fillMaxWidth().height(96.dp), p.game.steamAppId, shape = RoundedCornerShape(0.dp))
            Box(Modifier.matchParentSize().background(androidx.compose.ui.graphics.Brush.verticalGradient(listOf(Color.Transparent, Color(0xE60B0B10)))))
            Row(Modifier.align(Alignment.BottomStart).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                val now = p.startsAt == null || HubLogic.whenLabel(p.startsAt) == "Agora"
                HubBadge(HubLogic.whenLabel(p.startsAt), if (now) PC.Green else HubVioletDeep)
                Spacer(Modifier.width(8.dp))
                Text(p.game.name, color = Color.White, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (p.hasCall) HubBadge("Call aberta", Color(0xCC000000), Modifier.align(Alignment.TopEnd).padding(10.dp))
        }
        Column(Modifier.padding(14.dp)) {
            Text(p.title, color = PC.Header, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            p.note?.takeIf { it.isNotBlank() }?.let {
                Spacer(Modifier.height(4.dp))
                Text(it, color = PC.Text, style = MaterialTheme.typography.bodyMedium, maxLines = 3, overflow = TextOverflow.Ellipsis)
            }
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Row(horizontalArrangement = Arrangement.spacedBy((-8).dp)) {
                    p.members.take(6).forEach { u ->
                        Box(Modifier.clip(CircleShape).border(2.dp, PC.Surface, CircleShape)) { Avatar(u, 28.dp, decoration = false) }
                    }
                }
                Spacer(Modifier.width(if (p.members.isEmpty()) 0.dp else 8.dp))
                Text(
                    "${p.filled}/${p.slots} vagas" + (p.host?.let { " · por ${it.name}" } ?: ""),
                    color = PC.Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = { actions.onShare(p) }) { Icon(Icons.Outlined.Share, "Compartilhar", tint = PC.Muted) }
            }
            Spacer(Modifier.height(10.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                when {
                    p.inside -> {
                        PillButton("Ir pra call", { actions.onCall(p) }, icon = Icons.Outlined.Headset, busy = busy, color = HubVioletDeep)
                        GhostButton("Convidar", { actions.onInvite(p) }, icon = Icons.Outlined.PersonAdd)
                        if (isHost) GhostButton("Fechar", { actions.onClose(p) }, icon = Icons.Outlined.Close, color = PC.Red)
                        else GhostButton("Sair", { actions.onLeave(p) })
                    }
                    p.isFull -> GhostButton("Partida cheia", {}, icon = Icons.Outlined.CheckCircle, color = PC.Muted)
                    else -> PillButton(
                        if (p.myStatus == "invited") "Aceitar convite" else "Entrar", { actions.onJoin(p) },
                        icon = Icons.Outlined.Add, busy = busy, color = HubVioletDeep,
                    )
                }
            }
            if (isHost && (p.invitedCount ?: 0) > 0) {
                Spacer(Modifier.height(6.dp))
                Text("${p.invitedCount} convite(s) esperando resposta", color = PC.Faint, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

// ---------- Criar partida ----------

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun CreatePartySheet(repo: Repository, onDismiss: () -> Unit, onDone: (GameParty?) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var game by remember { mutableStateOf<HubGame?>(null) }
    var picking by remember { mutableStateOf(false) }
    var title by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var slots by remember { mutableStateOf(4) }
    var later by remember { mutableStateOf(false) }
    var at by remember { mutableStateOf(LocalDateTime.now().plusHours(1).withMinute(0).withSecond(0).withNano(0)) }
    val invite = remember { mutableStateListOf<String>() }
    var saving by remember { mutableStateOf(false) }
    val friends by repo.friends.collectAsState()
    val accepted = remember(friends) { friends.filter { it.status == "ACCEPTED" }.map { it.user } }

    fun pickDateTime() {
        DatePickerDialog(ctx, { _, y, m, d ->
            TimePickerDialog(ctx, { _, h, min ->
                at = LocalDateTime.of(y, m + 1, d, h, min)
            }, at.hour, at.minute, true).show()
        }, at.year, at.monthValue - 1, at.dayOfMonth).apply {
            datePicker.minDate = System.currentTimeMillis() - 1000
            datePicker.maxDate = System.currentTimeMillis() + 14L * 24 * 3600_000
        }.show()
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = PC.Surface) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).navigationBarsPadding().imePadding(),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("Criar partida", color = PC.Header, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            // Jogo
            val g = game
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(PC.Surface2).border(1.dp, PC.LineStrong, RoundedCornerShape(18.dp))
                    .clickable { picking = true }.padding(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                GameCover(g?.name ?: "?", Modifier.width(96.dp).height(45.dp), g?.steamAppId, shape = RoundedCornerShape(10.dp))
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(g?.name ?: "Escolher jogo", color = if (g == null) PC.Muted else PC.Header, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("Toque pra ${if (g == null) "escolher" else "trocar"}", color = PC.Faint, style = MaterialTheme.typography.bodySmall)
                }
            }
            PcField(title, { if (it.length <= 80) title = it }, g?.let { "${it.name} — bora?" } ?: "Ex.: Ranked até o diamante", label = "Título (opcional)")
            // Vagas
            Column {
                Text("VAGAS (CONTANDO VOCÊ)", style = MaterialTheme.typography.labelMedium, color = PC.Text)
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    StepButton(Icons.Outlined.Remove, slots > 2) { slots-- }
                    Text("$slots", color = PC.Header, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 20.dp))
                    StepButton(Icons.Outlined.Add, slots < 16) { slots++ }
                }
            }
            // Quando
            Column {
                Text("QUANDO", style = MaterialTheme.typography.labelMedium, color = PC.Text)
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    HubChip("Agora", !later, { later = false })
                    HubChip("Marcar horário", later, { later = true; pickDateTime() }, Icons.Outlined.Schedule)
                }
                if (later) {
                    Spacer(Modifier.height(8.dp))
                    val iso = at.atZone(ZoneId.systemDefault()).toInstant().toString()
                    Text(
                        HubLogic.whenLabel(iso), color = HubViolet, style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.clip(RoundedCornerShape(10.dp)).clickable { pickDateTime() }.padding(vertical = 4.dp),
                    )
                }
            }
            PcField(note, { if (it.length <= 500) note = it }, "Rank, modo, região, se precisa de microfone…", label = "Recado (opcional)", singleLine = false)
            if (accepted.isNotEmpty()) Column {
                Text("CONVIDAR AMIGOS", style = MaterialTheme.typography.labelMedium, color = PC.Text)
                Spacer(Modifier.height(8.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    accepted.take(40).forEach { u -> FriendChip(u, u.id in invite) { if (u.id in invite) invite.remove(u.id) else if (invite.size < 30) invite.add(u.id) } }
                }
            }
            PillButton(
                "Abrir partida", {
                    val chosen = game ?: run { ctx.toast("Escolha o jogo."); return@PillButton }
                    saving = true
                    scope.launch {
                        val body = buildJsonObject {
                            put("gameName", chosen.name)
                            chosen.key?.let { put("gameKey", it) }
                            chosen.steamAppId?.let { put("steamAppId", it) }
                            if (title.isNotBlank()) put("title", title.trim())
                            if (note.isNotBlank()) put("note", note.trim())
                            put("slots", slots)
                            if (later) put("startsAt", at.atZone(ZoneId.systemDefault()).toInstant().toString())
                            if (invite.isNotEmpty()) put("invite", buildJsonArray { invite.forEach { add(JsonPrimitive(it)) } })
                        }
                        runCatching { repo.api.post<PartyResponse>("/api/game-hub/parties", body).party }
                            .onSuccess { onDone(it) }
                            .onFailure { ctx.toast(it.message ?: "Não deu pra criar.") }
                        saving = false
                    }
                },
                Modifier.fillMaxWidth(), busy = saving, enabled = game != null, color = HubVioletDeep,
            )
            Spacer(Modifier.height(12.dp))
        }
    }
    if (picking) GamePickerSheet(repo, onPick = { game = it; picking = false }, onDismiss = { picking = false })
}

@Composable
private fun StepButton(icon: androidx.compose.ui.graphics.vector.ImageVector, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.size(44.dp).clip(CircleShape).background(if (enabled) PC.Surface3 else PC.Surface2).clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, null, tint = if (enabled) PC.Header else PC.Faint) }
}

@Composable
private fun FriendChip(u: User, selected: Boolean, onClick: () -> Unit) {
    val shape = CircleShape
    Row(
        Modifier.clip(shape).background(if (selected) HubViolet.copy(alpha = 0.22f) else PC.Surface2)
            .border(1.dp, if (selected) HubViolet else PC.Line, shape).clickable(onClick = onClick).padding(start = 4.dp, end = 12.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(u, 26.dp, decoration = false)
        Spacer(Modifier.width(6.dp))
        Text(u.name, color = if (selected) PC.Header else PC.Text, style = MaterialTheme.typography.labelLarge, maxLines = 1)
        if (selected) { Spacer(Modifier.width(4.dp)); Icon(Icons.Outlined.CheckCircle, null, tint = HubViolet, modifier = Modifier.size(16.dp)) }
    }
}

// ---------- Convidar ----------

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun InviteSheet(repo: Repository, party: GameParty, onDismiss: () -> Unit, onDone: (Int) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val friends by repo.friends.collectAsState()
    val inside = remember(party) { party.members.map { it.id }.toSet() }
    val accepted = remember(friends, inside) { friends.filter { it.status == "ACCEPTED" && it.user.id !in inside }.map { it.user } }
    val chosen = remember { mutableStateListOf<String>() }
    var sending by remember { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = PC.Surface) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Convidar pra ${party.game.name}", color = PC.Header, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            if (accepted.isEmpty()) Text("Seus amigos já estão na partida (ou você ainda não tem amigos no Project Club).", color = PC.Muted)
            else Column(Modifier.heightIn(max = 380.dp).verticalScroll(rememberScrollState())) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    accepted.forEach { u -> FriendChip(u, u.id in chosen) { if (u.id in chosen) chosen.remove(u.id) else if (chosen.size < 30) chosen.add(u.id) } }
                }
            }
            PillButton(
                if (chosen.isEmpty()) "Escolha quem chamar" else "Convidar ${chosen.size}", {
                    sending = true
                    scope.launch {
                        val body = buildJsonObject { put("userIds", buildJsonArray { chosen.forEach { add(JsonPrimitive(it)) } }) }
                        runCatching { repo.api.post<PartyInvited>("/api/game-hub/parties/${party.id}/invite", body) }
                            .onSuccess { onDone(it.invited) }
                            .onFailure { ctx.toast(it.message ?: "Não deu pra convidar.") }
                        sending = false
                    }
                },
                Modifier.fillMaxWidth(), enabled = chosen.isNotEmpty(), busy = sending, color = HubVioletDeep,
            )
            Spacer(Modifier.height(12.dp))
        }
    }
}

/** Partida em uma linha (Início do Game Hub). */
@Composable
fun PartyRow(p: GameParty, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(PC.Surface).border(1.dp, PC.Line, RoundedCornerShape(16.dp))
            .clickable(onClick = onClick).padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        GameCover(p.game.name, Modifier.width(84.dp).height(40.dp), p.game.steamAppId, shape = RoundedCornerShape(10.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(p.title, color = PC.Header, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("${HubLogic.whenLabel(p.startsAt)} · ${p.filled}/${p.slots} vagas", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
        }
        if (p.inside) HubBadge("Você está", HubVioletDeep)
    }
}
