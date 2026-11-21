package com.projectclub.android.ui.clubs

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Mail
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.data.Club
import com.projectclub.android.data.ClubInvitesResponse
import com.projectclub.android.data.ClubJoinResponse
import com.projectclub.android.data.ClubMessage
import com.projectclub.android.data.ClubMessageResponse
import com.projectclub.android.data.ClubMessagesResponse
import com.projectclub.android.data.ClubResponse
import com.projectclub.android.data.ClubsResponse
import com.projectclub.android.data.MyClubResponse
import com.projectclub.android.data.Repository
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.Chip
import com.projectclub.android.ui.common.EmptyState
import com.projectclub.android.ui.common.GhostButton
import com.projectclub.android.ui.common.HeroBox
import com.projectclub.android.ui.common.ListSkeleton
import com.projectclub.android.ui.common.PcCard
import com.projectclub.android.ui.common.PcField
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.common.PillButton
import com.projectclub.android.ui.common.shortTime
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private fun Club.color(): Color = runCatching { Color(android.graphics.Color.parseColor(iconColor)) }.getOrDefault(PC.Brand)

@Composable
internal fun ClubBadge(club: Club, size: Dp) {
    val c = club.color()
    Box(Modifier.size(size).clip(RoundedCornerShape(size * 0.3f)).background(c.copy(alpha = 0.18f)), contentAlignment = Alignment.Center) {
        val url = Config.media(club.icon?.url)
        if (url != null) AsyncImage(url, club.name, colorFilter = ColorFilter.tint(c), modifier = Modifier.size(size * 0.62f))
        else Text(club.name.take(1).uppercase(), color = c, fontWeight = FontWeight.ExtraBold)
    }
}

private fun privacyLabel(p: String) = when (p) { "PUBLIC" -> "Aberto"; "FRIENDS_ONLY" -> "Só amigos"; else -> "Só convite" }

/** Clubes: meu clube, convites e clubes para entrar. */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun ClubsScreen(repo: Repository, nav: AppNav) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var mine by remember { mutableStateOf<MyClubResponse?>(null) }
    var clubs by remember { mutableStateOf<List<Club>?>(null) }
    var invites by remember { mutableStateOf<ClubInvitesResponse?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }

    suspend fun load() {
        try {
            mine = runCatching { repo.api.get<MyClubResponse>("/api/clans/mine") }.getOrNull()
            invites = runCatching { repo.api.get<ClubInvitesResponse>("/api/clans/invites/mine") }.getOrNull()
            clubs = repo.api.get<ClubsResponse>("/api/clans").clans
            error = null
        } catch (e: Exception) { if (clubs == null) error = e.message ?: "Não deu pra carregar os clubes." }
    }
    LaunchedEffect(Unit) { load() }
    fun toast(t: String) = Toast.makeText(ctx, t, Toast.LENGTH_SHORT).show()

    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        PcTopBar("Clubes", Icons.Outlined.Groups, navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } })
        val list = clubs
        when {
            list == null && error != null -> EmptyState(Icons.Outlined.CloudOff, "Não deu pra abrir", error ?: "", Modifier.padding(top = 40.dp)) {
                GhostButton("Tentar de novo", { scope.launch { error = null; load() } })
            }
            list == null -> ListSkeleton(6)
            else -> PullToRefreshBox(refreshing, onRefresh = { scope.launch { refreshing = true; load(); refreshing = false } }, Modifier.fillMaxSize()) {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    val my = mine?.clan
                    item(key = "hero") {
                        HeroBox(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(20.dp)) {
                                Text("Clubes", style = MaterialTheme.typography.headlineMedium, color = Color.White)
                                Text(if (my != null) "Você está no ${my.name}" else "Entre num clube e jogue com a galera", color = Color(0xCCFFFFFF))
                            }
                        }
                    }
                    if (my != null) item(key = "mine") {
                        PcCard(onClick = { nav.club(my.id) }, border = my.color().copy(alpha = 0.5f), padding = PaddingValues(14.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                ClubBadge(my, 52.dp)
                                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                                    Text("Meu clube", color = PC.Muted, style = MaterialTheme.typography.labelMedium)
                                    Text(my.name, color = PC.Header, style = MaterialTheme.typography.titleMedium)
                                    Text("${my.memberCount} membros", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
                                }
                                mine?.pendingRequests?.size?.takeIf { it > 0 }?.let { Chip("$it pedidos", PC.Red) }
                            }
                        }
                    }
                    invites?.invites?.takeIf { it.isNotEmpty() }?.let { inv ->
                        item(key = "inv-t") { Text("Convites", style = MaterialTheme.typography.titleLarge, color = PC.Header) }
                        items(inv, key = { "i-" + it.id }) { i ->
                            PcCard(padding = PaddingValues(14.dp), border = PC.Brand.copy(alpha = 0.4f)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Outlined.Mail, null, tint = PC.Brand)
                                    Text(
                                        "  ${i.invitedBy?.name ?: "Alguém"} te convidou para ${i.clan.name}", color = PC.Text,
                                        modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium,
                                    )
                                }
                                Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    listOf(true to "Aceitar", false to "Recusar").forEach { (accept, label) ->
                                        GhostButton(label, {
                                            scope.launch {
                                                try { repo.api.patch<kotlinx.serialization.json.JsonObject>("/api/clans/invites/${i.id}", buildJsonObject { put("accept", accept) }); load() }
                                                catch (e: Exception) { toast(e.message ?: "Não deu certo.") }
                                            }
                                        }, color = if (accept) PC.Green else PC.Muted)
                                    }
                                }
                            }
                        }
                    }
                    item(key = "search") {
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("Encontrar clubes", style = MaterialTheme.typography.titleLarge, color = PC.Header)
                            PcField(query, { query = it }, "Buscar por nome", icon = Icons.Outlined.Search)
                        }
                    }
                    val filtered = list.filter { it.id != my?.id && (query.isBlank() || it.name.contains(query.trim(), ignoreCase = true) || it.tags.orEmpty().any { t -> t.tag.contains(query.trim(), true) }) }
                    if (filtered.isEmpty()) item { EmptyState(Icons.Outlined.Groups, "Nenhum clube", "Nada encontrado com essa busca.") }
                    items(filtered, key = { it.id }) { c ->
                        PcCard(onClick = { nav.club(c.id) }, padding = PaddingValues(14.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                ClubBadge(c, 46.dp)
                                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                                    Text(c.name, color = PC.Header, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    c.description?.takeIf { it.isNotBlank() }?.let { Text(it, color = PC.Muted, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                                    Text("${c.memberCount} membros · ${privacyLabel(c.privacy)}", color = PC.Faint, style = MaterialTheme.typography.labelSmall)
                                }
                                if (c.privacy != "PUBLIC") Icon(Icons.Outlined.Lock, null, tint = PC.Muted, modifier = Modifier.size(18.dp))
                            }
                        }
                    }
                    item { Spacer(Modifier.navigationBarsPadding()) }
                }
            }
        }
    }
}

/** Página de um clube: membros, entrar/sair e o chat do clube (para membros). */
@Composable
fun ClubScreen(repo: Repository, nav: AppNav, clubId: String) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val me by repo.me.collectAsState()
    var club by remember { mutableStateOf<Club?>(null) }
    var mine by remember { mutableStateOf<MyClubResponse?>(null) }
    var messages by remember { mutableStateOf<List<ClubMessage>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var confirmLeave by remember { mutableStateOf(false) }
    var tab by rememberSaveable { mutableStateOf(0) }
    var text by remember { mutableStateOf("") }
    val chatState = rememberLazyListState()
    fun toast(t: String) = Toast.makeText(ctx, t, Toast.LENGTH_SHORT).show()

    suspend fun load() {
        try {
            club = repo.api.get<ClubResponse>("/api/clans/$clubId").clan
            mine = runCatching { repo.api.get<MyClubResponse>("/api/clans/mine") }.getOrNull()
            error = null
        } catch (e: Exception) { if (club == null) error = e.message ?: "Não deu pra abrir o clube." }
    }
    val isMember = mine?.clan?.id == clubId
    LaunchedEffect(clubId) { load() }
    LaunchedEffect(isMember) {
        while (isMember) {
            runCatching { messages = repo.api.get<ClubMessagesResponse>("/api/clans/$clubId/messages").messages }
            kotlinx.coroutines.delay(10_000)
        }
    }
    LaunchedEffect(messages.size, tab) { if (tab == 1 && messages.isNotEmpty()) chatState.scrollToItem(messages.lastIndex) }

    Column(Modifier.fillMaxSize().background(PC.Bg).imePadding()) {
        val c = club
        PcTopBar(c?.name ?: "Clube", Icons.Outlined.Groups, navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } }) {
            if (isMember) IconButton(onClick = { confirmLeave = true }) { Icon(Icons.AutoMirrored.Outlined.Logout, "Sair do clube", tint = PC.Red) }
        }
        when {
            c == null && error != null -> EmptyState(Icons.Outlined.CloudOff, "Não deu pra abrir", error ?: "", Modifier.padding(top = 40.dp)) {
                GhostButton("Tentar de novo", { scope.launch { error = null; load() } })
            }
            c == null -> ListSkeleton(6)
            else -> {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        ClubBadge(c, 64.dp)
                        Column(Modifier.padding(start = 14.dp)) {
                            Text(c.name, style = MaterialTheme.typography.headlineSmall, color = PC.Header)
                            Text("${c.memberCount} membros · ${privacyLabel(c.privacy)}", color = PC.Muted)
                        }
                    }
                    c.description?.takeIf { it.isNotBlank() }?.let { Text(it, color = PC.Text, modifier = Modifier.padding(top = 10.dp)) }
                    if (!c.tags.isNullOrEmpty()) Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) { c.tags.take(5).forEach { Chip(it.tag, c.color()) } }
                    if (!isMember && mine?.clan == null) {
                        Spacer(Modifier.height(14.dp))
                        PillButton(if (c.privacy == "PUBLIC") "Entrar no clube" else "Pedir para entrar", {
                            busy = true
                            scope.launch {
                                try {
                                    val r = repo.api.post<ClubJoinResponse>("/api/clans/$clubId/join")
                                    toast(if (r.joined) "Bem-vindo ao clube!" else "Pedido enviado. Aguarde a aprovação.")
                                    load()
                                } catch (e: Exception) { toast(e.message ?: "Não deu para entrar.") }
                                busy = false
                            }
                        }, Modifier.fillMaxWidth(), busy = busy)
                    } else if (!isMember) Text("Você já está em outro clube.", color = PC.Muted, modifier = Modifier.padding(top = 10.dp))
                    if (isMember) Row(Modifier.padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        com.projectclub.android.ui.forum.SelectPill("Membros", tab == 0, { tab = 0 })
                        com.projectclub.android.ui.forum.SelectPill("Chat do clube", tab == 1, { tab = 1 })
                    }
                }
                if (isMember && tab == 1) {
                    LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = chatState, contentPadding = PaddingValues(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (messages.isEmpty()) item { Text("Ninguém falou nada ainda. Diga oi!", color = PC.Muted) }
                        items(messages, key = { it.id }) { m ->
                            Row(verticalAlignment = Alignment.Top) {
                                Avatar(m.author?.asUser(), 34.dp)
                                Column(Modifier.padding(start = 10.dp).widthIn(max = 320.dp)) {
                                    Row { Text(m.author?.name ?: "", color = PC.Header, fontWeight = FontWeight.Bold); Text("  " + shortTime(m.createdAt), color = PC.Muted, style = MaterialTheme.typography.bodySmall) }
                                    Text(m.content, color = PC.Text)
                                }
                            }
                        }
                    }
                    val shape = RoundedCornerShape(24.dp)
                    Row(
                        Modifier.fillMaxWidth().navigationBarsPadding().padding(10.dp).clip(shape).background(PC.Surface).border(1.dp, PC.Line, shape).padding(start = 16.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.weight(1f).padding(vertical = 8.dp)) {
                            if (text.isEmpty()) Text("Mensagem para o clube", color = PC.Faint)
                            BasicTextField(text, { text = it }, maxLines = 4, textStyle = MaterialTheme.typography.bodyLarge.copy(color = PC.Header), cursorBrush = SolidColor(PC.Brand), modifier = Modifier.fillMaxWidth())
                        }
                        IconButton(enabled = text.isNotBlank(), onClick = {
                            val t = text.trim(); text = ""
                            scope.launch {
                                try {
                                    repo.api.post<ClubMessageResponse>("/api/clans/$clubId/messages", buildJsonObject { put("content", t) }).message?.let { messages = messages + it }
                                } catch (e: Exception) { text = t; toast(e.message ?: "Não deu pra enviar.") }
                            }
                        }) { Icon(Icons.AutoMirrored.Filled.Send, "Enviar", tint = if (text.isNotBlank()) PC.Brand else PC.Muted) }
                    }
                } else {
                    LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(16.dp, 0.dp, 16.dp, 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        val requests = if (isMember && mine?.can("MANAGE_JOIN_REQUESTS") == true) mine?.pendingRequests.orEmpty() else emptyList()
                        if (requests.isNotEmpty()) {
                            item { Text("Pedidos para entrar", style = MaterialTheme.typography.titleMedium, color = PC.Header) }
                            items(requests, key = { "r-" + it.id }) { r ->
                                PcCard(padding = PaddingValues(12.dp)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Avatar(r.user?.asUser(), 36.dp)
                                        Text("  " + (r.user?.name ?: ""), color = PC.Header, modifier = Modifier.weight(1f))
                                        listOf(true to "Aceitar", false to "Recusar").forEach { (ok, label) ->
                                            TextButton(onClick = {
                                                scope.launch {
                                                    try { repo.api.patch<kotlinx.serialization.json.JsonObject>("/api/clans/$clubId/requests/${r.id}", buildJsonObject { put("approve", ok) }); load() }
                                                    catch (e: Exception) { toast(e.message ?: "Não deu certo.") }
                                                }
                                            }) { Text(label, color = if (ok) PC.Green else PC.Muted) }
                                        }
                                    }
                                }
                            }
                        }
                        val members = c.members.orEmpty()
                        item { Text(if (members.isEmpty()) "A lista de membros é só para quem está no clube." else "Membros", style = MaterialTheme.typography.titleMedium, color = if (members.isEmpty()) PC.Muted else PC.Header) }
                        items(members.sortedBy { roleOrder(it.clanRole) }, key = { it.id }) { m ->
                            Row(
                                Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(PC.Surface).padding(10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Avatar(m.asUser(), 38.dp)
                                Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                                    Text(m.name + if (m.id == me?.id) " (você)" else "", color = PC.Header, style = MaterialTheme.typography.titleSmall)
                                    m.username?.let { Text("@$it", color = PC.Muted, style = MaterialTheme.typography.bodySmall) }
                                }
                                roleLabel(m.clanRole)?.let { Chip(it, c.color()) }
                                IconButton(onClick = { nav.profile(m.id) }) { Icon(Icons.Outlined.Groups, "Ver perfil", tint = PC.Muted, modifier = Modifier.size(18.dp)) }
                            }
                        }
                        item { Spacer(Modifier.navigationBarsPadding()) }
                    }
                }
            }
        }
    }

    if (confirmLeave) AlertDialog(
        onDismissRequest = { confirmLeave = false },
        containerColor = PC.Surface2,
        title = { Text("Sair do clube?") },
        text = { Text("Você pode pedir para voltar depois.", color = PC.Muted) },
        confirmButton = {
            TextButton(onClick = {
                confirmLeave = false
                scope.launch {
                    try { repo.api.postIgnore("/api/clans/leave"); toast("Você saiu do clube."); load() } catch (e: Exception) { toast(e.message ?: "Não deu para sair.") }
                }
            }) { Text("Sair", color = PC.Red) }
        },
        dismissButton = { TextButton(onClick = { confirmLeave = false }) { Text("Cancelar", color = PC.Text) } },
    )
}

private fun roleOrder(r: String?) = when (r) { "OWNER" -> 0; "SUB_OWNER" -> 1; "ADMIN" -> 2; "MODERATOR" -> 3; else -> 4 }
private fun roleLabel(r: String?) = when (r) { "OWNER" -> "Dono"; "SUB_OWNER" -> "Vice"; "ADMIN" -> "Admin"; "MODERATOR" -> "Moderador"; else -> null }
