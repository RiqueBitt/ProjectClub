package com.projectclub.android.ui.store

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.SwapHoriz
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.data.LimitedsResponse
import com.projectclub.android.data.Repository
import com.projectclub.android.data.Trade
import com.projectclub.android.data.TradeItem
import com.projectclub.android.data.TradeSide
import com.projectclub.android.data.TradesResponse
import com.projectclub.android.data.User
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.EmptyState
import com.projectclub.android.ui.common.GhostButton
import com.projectclub.android.ui.common.PcField
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.common.PillButton
import com.projectclub.android.ui.common.formatTime
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private val KIND_LABEL = mapOf("deco" to "Moldura", "effect" to "Efeito", "font" to "Fonte", "style" to "Estilo")
private val STATUS_LABEL = mapOf("PENDING" to "Esperando", "ACCEPTED" to "Aceita", "DECLINED" to "Recusada", "CANCELLED" to "Cancelada", "FAILED" to "Não deu certo")
private fun key(i: TradeItem) = "${i.kind}:${i.id}"

/** Trocas de itens limitados (igual à aba Trocas da Loja no PC). */
@Composable
fun TradesScreen(repo: Repository, nav: AppNav) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val me by repo.me.collectAsState()
    var data by remember { mutableStateOf<TradesResponse?>(null) }
    var tab by remember { mutableStateOf("incoming") }
    var busy by remember { mutableStateOf(false) }
    fun toast(t: String) = Toast.makeText(ctx, t, Toast.LENGTH_SHORT).show()
    suspend fun load() { runCatching { data = repo.api.get<TradesResponse>("/api/decorations/trades") }.onFailure { if (data == null) data = TradesResponse() } }
    LaunchedEffect(Unit) { load() }
    LaunchedEffect(Unit) { repo.realtime.events.collect { if (it.name == "trade:update") load() } }

    fun act(what: String, t: Trade) { scope.launch {
        busy = true
        try {
            repo.api.post<JsonElement>("/api/decorations/trades/${t.id}/$what", JsonObject(emptyMap()))
            toast(when (what) { "accept" -> "Troca feita! Os itens já estão com você."; "decline" -> "Proposta recusada."; else -> "Proposta cancelada." })
        } catch (e: Exception) { toast(e.message ?: "Não deu certo.") }
        load(); busy = false
    } }

    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        PcTopBar("Trocas", Icons.Outlined.SwapHoriz, navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } })
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("incoming" to "Recebidas", "outgoing" to "Enviadas", "history" to "Histórico", "new" to "Nova troca").forEach { (id, label) ->
                val n = when (id) { "incoming" -> data?.incoming?.size; "outgoing" -> data?.outgoing?.size; else -> null }
                com.projectclub.android.ui.forum.SelectPill(if (n != null && n > 0) "$label ($n)" else label, tab == id, { tab = id })
            }
        }
        if (tab == "new") {
            NewTrade(repo) { tab = "outgoing"; scope.launch { load() } }
            return@Column
        }
        val list = when (tab) { "incoming" -> data?.incoming; "outgoing" -> data?.outgoing; else -> data?.history }
        when {
            list == null -> Text("Carregando…", color = PC.Muted, modifier = Modifier.padding(16.dp))
            list.isEmpty() -> EmptyState(Icons.Outlined.SwapHoriz, "Nada por aqui", when (tab) { "incoming" -> "Nenhuma proposta esperando você."; "outgoing" -> "Você não tem propostas abertas."; else -> "Nenhuma troca ainda." })
            else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(list, key = { it.id }) { t -> TradeCard(t, me?.id, busy, ::act) }
            }
        }
    }
}

@Composable
private fun TradeCard(t: Trade, me: String?, busy: Boolean, act: (String, Trade) -> Unit) {
    val mine = t.from?.id == me
    val other = if (mine) t.to else t.from
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(PC.Surface).border(1.dp, PC.Line, RoundedCornerShape(18.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(other, 34.dp)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(if (mine) "Para ${other?.name ?: "…"}" else "De ${other?.name ?: "…"}", color = PC.Header, fontWeight = FontWeight.Bold)
                Text(formatTime(t.createdAt), color = PC.Muted, style = MaterialTheme.typography.bodySmall)
            }
            Text(STATUS_LABEL[t.status] ?: t.status, color = when (t.status) { "ACCEPTED" -> PC.Green; "PENDING" -> PC.Muted; else -> PC.Red }, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
        }
        t.message?.takeIf { it.isNotBlank() }?.let { Text("“$it”", color = PC.Text, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(PC.Surface2).padding(10.dp)) }
        SideBox(if (mine) "Você dá" else "${t.from?.name ?: "Ela"} dá", t.offer)
        Icon(Icons.Outlined.SwapHoriz, null, tint = PC.Muted, modifier = Modifier.align(Alignment.CenterHorizontally))
        SideBox(if (mine) "Você recebe" else "Você dá", t.request)
        if (t.status == "PENDING") Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (mine) GhostButton("Cancelar proposta", { act("cancel", t) }, Modifier.fillMaxWidth())
            else {
                GhostButton("Recusar", { act("decline", t) }, Modifier.weight(1f))
                PillButton("Aceitar", { act("accept", t) }, Modifier.weight(1f), icon = Icons.Outlined.Check, busy = busy, color = PC.Green)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SideBox(title: String, side: TradeSide) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(PC.Surface2).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title.uppercase(), color = PC.Muted, style = MaterialTheme.typography.labelSmall)
        if (side.items.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            side.items.forEach { TradeTile(it, false, null) }
        }
        if (side.coins > 0 || side.gems > 0) Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (side.coins > 0) CurrencyAmount(false, side.coins)
            if (side.gems > 0) CurrencyAmount(true, side.gems)
        }
        if (side.items.isEmpty() && side.coins == 0 && side.gems == 0) Text("Nada", color = PC.Muted)
    }
}

@Composable
private fun TradeTile(i: TradeItem, on: Boolean, onClick: (() -> Unit)?) {
    val shape = RoundedCornerShape(12.dp)
    Column(
        Modifier.width(86.dp).clip(shape).background(PC.Surface).border(if (on) 2.dp else 1.dp, if (on) PC.Brand else PC.Line, shape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(Modifier.size(52.dp).clip(RoundedCornerShape(10.dp)).background(PC.Surface3), contentAlignment = Alignment.Center) {
            when {
                i.kind == "font" -> {
                    val f = com.projectclub.android.ui.profile.rememberShopFont(i.data?.family?.let { org.json.JSONObject().put("id", i.id).put("family", it).put("url", i.data.url ?: "").toString() })
                    Text("Aa", color = PC.Header, fontFamily = f, fontSize = 20.sp)
                }
                i.kind == "style" -> Icon(Icons.Outlined.Palette, null, tint = PC.Pink)
                i.imageUrl != null -> AsyncImage(Config.media(i.imageUrl), null, imageLoader = rememberAnimatedImageLoader(), contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
                else -> Icon(Icons.Outlined.Star, null, tint = PC.Yellow)
            }
            if (on) Box(Modifier.align(Alignment.TopEnd).size(16.dp).clip(CircleShape).background(PC.Brand), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.Check, null, tint = PC.OnBrand, modifier = Modifier.size(11.dp))
            }
        }
        Text(i.name, color = PC.Header, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(listOfNotNull(KIND_LABEL[i.kind], i.serial?.let { "#$it" }).joinToString(" · "), color = PC.Yellow, fontSize = 10.sp)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NewTrade(repo: Repository, onSent: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val friends by repo.friends.collectAsState()
    val people = remember(friends) { friends.filter { it.status == "ACCEPTED" }.map { it.user }.sortedBy { it.name.lowercase() } }
    var target by remember { mutableStateOf<User?>(null) }
    var mine by remember { mutableStateOf<List<TradeItem>?>(null) }
    var theirs by remember { mutableStateOf<List<TradeItem>?>(null) }
    var give by remember { mutableStateOf(setOf<String>()) }
    var want by remember { mutableStateOf(setOf<String>()) }
    var giveCoins by remember { mutableStateOf("") }
    var giveGems by remember { mutableStateOf("") }
    var wantCoins by remember { mutableStateOf("") }
    var wantGems by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { mine = runCatching { repo.api.get<LimitedsResponse>("/api/decorations/limiteds/me").items }.getOrDefault(emptyList()) }
    LaunchedEffect(target) {
        theirs = null; want = emptySet()
        target?.let { t -> theirs = runCatching { repo.api.get<LimitedsResponse>("/api/decorations/limiteds/${t.id}").items }.getOrDefault(emptyList()) }
    }
    fun num(s: String) = s.toIntOrNull()?.coerceAtLeast(0) ?: 0
    fun side(list: List<TradeItem>?, set: Set<String>, c: String, g: String) = buildJsonObject {
        put("items", buildJsonArray { list.orEmpty().filter { set.contains(key(it)) }.forEach { add(buildJsonObject { put("kind", it.kind); put("id", it.id) }) } })
        put("coins", num(c)); put("gems", num(g))
    }
    val hasGive = give.isNotEmpty() || num(giveCoins) > 0 || num(giveGems) > 0
    val hasWant = want.isNotEmpty() || num(wantCoins) > 0 || num(wantGems) > 0
    val valid = target != null && hasGive && hasWant && (give.size + want.size) > 0

    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item {
            Text("Com quem trocar", color = PC.Muted, style = MaterialTheme.typography.labelSmall)
            Spacer(Modifier.height(8.dp))
            if (people.isEmpty()) Text("Adicione amigos pra poder trocar.", color = PC.Muted)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                people.forEach { u ->
                    Column(
                        Modifier.width(70.dp).clip(RoundedCornerShape(12.dp)).border(if (target?.id == u.id) 2.dp else 0.dp, if (target?.id == u.id) PC.Brand else PC.Bg, RoundedCornerShape(12.dp))
                            .clickable { target = u }.padding(6.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Avatar(u, 44.dp)
                        Text(u.name, color = PC.Text, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
        val t = target
        if (t != null) {
            item {
                Picker("Você dá", mine, give, { give = if (give.contains(it)) give - it else if (give.size < 8) give + it else give }, "Você não tem itens limitados.")
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PcField(giveCoins, { giveCoins = it.filter(Char::isDigit) }, "Moedas", Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                    PcField(giveGems, { giveGems = it.filter(Char::isDigit) }, "Gemas", Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                }
            }
            item {
                Picker("Você pede de ${t.name}", theirs, want, { want = if (want.contains(it)) want - it else if (want.size < 8) want + it else want }, "${t.name} não tem itens limitados.")
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PcField(wantCoins, { wantCoins = it.filter(Char::isDigit) }, "Moedas", Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                    PcField(wantGems, { wantGems = it.filter(Char::isDigit) }, "Gemas", Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                }
            }
            item {
                PcField(message, { message = it.take(300) }, "Mensagem (opcional)")
                Spacer(Modifier.height(6.dp))
                Text("Só itens limitados podem ser trocados. Os dois lados precisam ter alguma coisa.", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(10.dp))
                PillButton("Enviar proposta", {
                    busy = true
                    scope.launch {
                        try {
                            repo.api.post<JsonElement>("/api/decorations/trades", buildJsonObject {
                                put("toUserId", t.id)
                                put("offer", side(mine, give, giveCoins, giveGems))
                                put("request", side(theirs, want, wantCoins, wantGems))
                                if (message.isNotBlank()) put("message", message)
                            })
                            Toast.makeText(ctx, "Proposta enviada para ${t.name}.", Toast.LENGTH_SHORT).show()
                            onSent()
                        } catch (e: Exception) { Toast.makeText(ctx, e.message ?: "Não deu certo.", Toast.LENGTH_SHORT).show() }
                        busy = false
                    }
                }, Modifier.fillMaxWidth(), icon = Icons.Outlined.SwapHoriz, enabled = valid, busy = busy)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Picker(title: String, list: List<TradeItem>?, selected: Set<String>, toggle: (String) -> Unit, empty: String) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(PC.Surface).border(1.dp, PC.Line, RoundedCornerShape(14.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title.uppercase(), color = PC.Muted, style = MaterialTheme.typography.labelSmall)
        when {
            list == null -> Text("Carregando…", color = PC.Muted)
            list.isEmpty() -> Text(empty, color = PC.Muted)
            else -> FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                list.forEach { i -> TradeTile(i, selected.contains(key(i))) { toggle(key(i)) } }
            }
        }
    }
}
