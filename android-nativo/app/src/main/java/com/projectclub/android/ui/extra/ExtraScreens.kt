package com.projectclub.android.ui.extra

import android.widget.Toast
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
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.CreditCard
import androidx.compose.material.icons.outlined.MonitorHeart
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.StickyNote2
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.data.EcoWallet
import com.projectclub.android.data.Repository
import com.projectclub.android.data.User
import com.projectclub.android.net.ApiException
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.EmptyState
import com.projectclub.android.ui.common.ListSkeleton
import com.projectclub.android.ui.common.PcCard
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.common.PillButton
import com.projectclub.android.ui.economy.FlipWalletCard
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/*
 * Telas próprias para páginas que antes abriam o site dentro do app:
 * Wiki, Status, Figurinhas, Loja dos criadores e Carteira compartilhada.
 * Mesmas APIs do site.
 */

private fun errOf(e: Throwable, fallback: String) = (e as? ApiException)?.message?.takeIf { it.isNotBlank() } ?: fallback

@Composable
private fun BackBar(title: String, icon: androidx.compose.ui.graphics.vector.ImageVector, nav: AppNav) =
    PcTopBar(title, icon, navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } })

/* ======================= Wiki ======================= */

@Serializable data class WikiItem(val slug: String = "", val title: String = "", val category: String? = null, val updatedAt: String? = null, val preview: String? = null)
@Serializable data class WikiList(val pages: List<WikiItem> = emptyList())
@Serializable data class WikiFull(val slug: String = "", val title: String = "", val category: String? = null, val body: String = "", val updatedAt: String? = null, val updatedByUser: User? = null)
@Serializable data class WikiFullResponse(val page: WikiFull? = null)

@Composable
fun WikiScreen(repo: Repository, nav: AppNav) {
    var q by remember { mutableStateOf("") }
    var pages by remember { mutableStateOf<List<WikiItem>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(q) {
        kotlinx.coroutines.delay(if (q.isBlank()) 0 else 300)
        runCatching { repo.api.get<WikiList>("/api/wiki" + if (q.isBlank()) "" else "?q=" + android.net.Uri.encode(q)) }
            .onSuccess { pages = it.pages; error = null }.onFailure { error = errOf(it, "Não deu pra abrir a wiki.") }
    }
    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        BackBar("Wiki", Icons.AutoMirrored.Outlined.MenuBook, nav)
        OutlinedTextField(
            q, { q = it.take(100) }, Modifier.fillMaxWidth().padding(12.dp), singleLine = true,
            placeholder = { Text("Procurar na wiki") }, leadingIcon = { Icon(Icons.Outlined.Search, null) },
        )
        val list = pages
        when {
            list == null && error != null -> EmptyState(Icons.Outlined.CloudOff, "Não deu pra abrir", error.orEmpty(), Modifier.padding(top = 40.dp))
            list == null -> ListSkeleton(avatar = 0.dp)
            list.isEmpty() -> EmptyState(Icons.AutoMirrored.Outlined.MenuBook, "Nada encontrado", "Tente outras palavras.", Modifier.padding(top = 40.dp))
            else -> LazyColumn(contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val groups = list.groupBy { it.category?.ifBlank { null } ?: "Geral" }
                groups.forEach { (cat, items) ->
                    item(key = "h-$cat") { Text(cat.uppercase(), color = PC.Muted, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 8.dp, start = 4.dp)) }
                    items.forEach { p ->
                        item(key = p.slug) {
                            PcCard(onClick = { nav.route("wiki/${android.net.Uri.encode(p.slug)}") }, padding = PaddingValues(14.dp)) {
                                Text(p.title, color = PC.Header, fontWeight = FontWeight.Bold)
                                p.preview?.let { Text(it, color = PC.Muted, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun WikiPageScreen(repo: Repository, nav: AppNav, slug: String) {
    var page by remember(slug) { mutableStateOf<WikiFull?>(null) }
    var error by remember(slug) { mutableStateOf<String?>(null) }
    LaunchedEffect(slug) {
        runCatching { repo.api.get<WikiFullResponse>("/api/wiki/" + android.net.Uri.encode(slug)).page }
            .onSuccess { page = it; if (it == null) error = "Página não encontrada." }.onFailure { error = errOf(it, "Não deu pra abrir a página.") }
    }
    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        BackBar(page?.title ?: "Wiki", Icons.AutoMirrored.Outlined.MenuBook, nav)
        val p = page
        when {
            p == null && error != null -> EmptyState(Icons.Outlined.CloudOff, "Não deu pra abrir", error.orEmpty(), Modifier.padding(top = 40.dp))
            p == null -> ListSkeleton(avatar = 0.dp)
            else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp).navigationBarsPadding()) {
                p.category?.let { Text(it.uppercase(), color = PC.Brand, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold) }
                Text(p.title, color = PC.Header, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                p.updatedByUser?.let { Text("Editado por ${it.displayName ?: it.username}", color = PC.Faint, style = MaterialTheme.typography.labelSmall) }
                Spacer(Modifier.height(12.dp))
                MarkdownBlocks(p.body) { link -> nav.link(link) }
            }
        }
    }
}

/** Markdown simples (títulos, listas, citações, negrito, itálico, código e links) — o que a wiki usa. */
@Composable
fun MarkdownBlocks(md: String, onLink: (String) -> Unit) {
    val inlineRe = Regex("""\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|`([^`]+)`|\[([^\]]+)]\(([^)\s]+)\)""")
    fun inline(text: String) = buildAnnotatedString {
        var i = 0
        inlineRe.findAll(text).forEach { m ->
            append(text.substring(i, m.range.first))
            val g = m.groupValues
            when {
                g[1].isNotEmpty() -> withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = PC.Header)) { append(g[1]) }
                g[2].isNotEmpty() -> withStyle(SpanStyle(fontStyle = androidx.compose.ui.text.font.FontStyle.Italic)) { append(g[2]) }
                g[3].isNotEmpty() -> withStyle(SpanStyle(fontStyle = androidx.compose.ui.text.font.FontStyle.Italic)) { append(g[3]) }
                g[4].isNotEmpty() -> withStyle(SpanStyle(fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace, background = PC.Surface2)) { append(g[4]) }
                else -> {
                    val url = g[6]
                    pushLink(androidx.compose.ui.text.LinkAnnotation.Clickable(url) { onLink(url) })
                    withStyle(SpanStyle(color = PC.Brand)) { append(g[5]) }
                    pop()
                }
            }
            i = m.range.last + 1
        }
        append(text.substring(i))
    }
    var inCode = false
    val code = StringBuilder()
    md.replace("\r", "").lines().forEach { raw ->
        val line = raw.trimEnd()
        if (line.trimStart().startsWith("```")) {
            if (inCode) {
                Text(code.toString().trimEnd(), color = PC.Text, fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace, fontSize = 13.sp,
                    modifier = Modifier.padding(vertical = 6.dp).fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(PC.Surface).padding(10.dp))
                code.clear()
            }
            inCode = !inCode
            return@forEach
        }
        if (inCode) { code.append(raw).append('\n'); return@forEach }
        val t = line.trimStart()
        when {
            t.isEmpty() -> Spacer(Modifier.height(6.dp))
            t.startsWith("### ") -> Text(inline(t.removePrefix("### ")), color = PC.Header, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp))
            t.startsWith("## ") -> Text(inline(t.removePrefix("## ")), color = PC.Header, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 12.dp))
            t.startsWith("# ") -> Text(inline(t.removePrefix("# ")), color = PC.Header, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 12.dp))
            t.startsWith("> ") -> Row(Modifier.padding(vertical = 3.dp)) {
                Box(Modifier.width(3.dp).height(20.dp).background(PC.Brand))
                Spacer(Modifier.width(8.dp))
                Text(inline(t.removePrefix("> ")), color = PC.Muted)
            }
            t.startsWith("- ") || t.startsWith("* ") -> Row(Modifier.padding(start = 6.dp, top = 2.dp)) {
                Text("•  ", color = PC.Brand)
                Text(inline(t.drop(2)), color = PC.Text)
            }
            Regex("^\\d+\\. ").containsMatchIn(t) -> Row(Modifier.padding(start = 6.dp, top = 2.dp)) {
                val n = t.substringBefore(". ")
                Text("$n.  ", color = PC.Brand)
                Text(inline(t.substringAfter(". ")), color = PC.Text)
            }
            t == "---" -> Box(Modifier.padding(vertical = 8.dp).fillMaxWidth().height(1.dp).background(PC.Line))
            else -> Text(inline(t), color = PC.Text, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

/* ======================= Status ======================= */

@Serializable data class StatusComponent(val id: String = "", val label: String = "", val status: String = "ok", val latencyMs: Int? = null, val uptime30d: Double? = null)
@Serializable data class StatusIncident(val id: String = "", val component: String = "", val startedAt: String? = null, val endedAt: String? = null)
@Serializable data class PlatformStatus(val overall: String = "ok", val checkedAt: String? = null, val components: List<StatusComponent> = emptyList(), val incidents: List<StatusIncident> = emptyList())

private fun statusColor(s: String) = when (s) { "ok" -> PC.Green; "degraded" -> PC.Yellow; else -> PC.Red }
private fun statusLabel(s: String) = when (s) { "ok" -> "Funcionando"; "degraded" -> "Instável"; else -> "Fora do ar" }
private val STATUS_TIME = java.time.format.DateTimeFormatter.ofPattern("dd/MM HH:mm")
private fun fmtTime(iso: String?) = iso?.let { runCatching { STATUS_TIME.format(java.time.Instant.parse(it).atZone(java.time.ZoneId.systemDefault())) }.getOrNull() } ?: "—"

@Composable
fun StatusScreen(repo: Repository, nav: AppNav) {
    var st by remember { mutableStateOf<PlatformStatus?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        while (true) {
            runCatching { repo.api.get<PlatformStatus>("/api/platform/health-status") }.onSuccess { st = it; error = null }.onFailure { if (st == null) error = errOf(it, "Não deu pra ver o status.") }
            kotlinx.coroutines.delay(30_000)
        }
    }
    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        BackBar("Status", Icons.Outlined.MonitorHeart, nav)
        val s = st
        when {
            s == null && error != null -> EmptyState(Icons.Outlined.CloudOff, "Sem resposta", error.orEmpty(), Modifier.padding(top = 40.dp))
            s == null -> ListSkeleton(avatar = 0.dp)
            else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                PcCard(padding = PaddingValues(18.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(14.dp).clip(CircleShape).background(statusColor(s.overall)))
                        Spacer(Modifier.width(10.dp))
                        Text(
                            when (s.overall) { "ok" -> "Tudo funcionando"; "degraded" -> "Algumas partes instáveis"; else -> "Partes fora do ar" },
                            color = PC.Header, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold,
                        )
                    }
                    Text("Conferido às ${fmtTime(s.checkedAt)} · atualiza sozinho", color = PC.Faint, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 4.dp))
                }
                s.components.forEach { c ->
                    PcCard(padding = PaddingValues(14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(10.dp).clip(CircleShape).background(statusColor(c.status)))
                            Spacer(Modifier.width(10.dp))
                            Text(c.label, color = PC.Header, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                            Text(statusLabel(c.status), color = statusColor(c.status), style = MaterialTheme.typography.labelMedium)
                        }
                        Text(
                            listOfNotNull(c.uptime30d?.let { "%.2f%% em 30 dias".format(it) }, c.latencyMs?.let { "$it ms" }).joinToString(" · "),
                            color = PC.Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(start = 20.dp, top = 2.dp),
                        )
                    }
                }
                Text("Quedas recentes", color = PC.Muted, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 6.dp))
                if (s.incidents.isEmpty()) Text("Nenhuma queda nos últimos 30 dias.", color = PC.Faint)
                s.incidents.forEach { i ->
                    Text("${i.component}: ${fmtTime(i.startedAt)} → ${if (i.endedAt == null) "agora" else fmtTime(i.endedAt)}", color = PC.Text, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

/* ======================= Figurinhas (álbum e cápsulas) ======================= */

@Serializable data class StickerRarity(val id: String = "", val name: String = "", val color: String? = null)
@Serializable data class CollectibleSticker(val id: String = "", val name: String = "", val imageUrl: String? = null, val rarityId: String? = null, val quantity: Int = 0, val pasted: Boolean = false)
@Serializable data class StickerGroup(val rarity: StickerRarity = StickerRarity(), val stickers: List<CollectibleSticker> = emptyList())
@Serializable data class StickerCollection(
    val groups: List<StickerGroup> = emptyList(),
    val capsuleCount: Int = 0,
    val distinctOwned: Int = 0,
    val totalCatalog: Int = 0,
    val capsulePrices: Map<String, Int> = emptyMap(),
)
@Serializable data class CapsuleResult(val stickerId: String = "", val name: String = "", val imageUrl: String? = null, val rarityId: String? = null)
@Serializable data class OpenAllResponse(val results: List<CapsuleResult> = emptyList())

private fun hex(c: String?, fallback: Color) = c?.let { runCatching { Color(android.graphics.Color.parseColor(it)) }.getOrNull() } ?: fallback

@Composable
fun StickersScreen(repo: Repository, nav: AppNav) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var data by remember { mutableStateOf<StickerCollection?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var opened by remember { mutableStateOf<List<CapsuleResult>?>(null) }
    var buying by remember { mutableStateOf(false) }
    suspend fun load() {
        runCatching { repo.api.get<StickerCollection>("/api/stickers") }.onSuccess { data = it; error = null }.onFailure { error = errOf(it, "Não deu pra abrir o álbum.") }
    }
    LaunchedEffect(Unit) { load() }
    fun toast(t: String) = Toast.makeText(ctx, t, Toast.LENGTH_SHORT).show()
    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        BackBar("Figurinhas", Icons.Outlined.StickyNote2, nav)
        val d = data
        when {
            d == null && error != null -> EmptyState(Icons.Outlined.CloudOff, "Não deu pra abrir", error.orEmpty(), Modifier.padding(top = 40.dp))
            d == null -> ListSkeleton(avatar = 0.dp)
            else -> LazyVerticalGrid(GridCells.Adaptive(96.dp), contentPadding = PaddingValues(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    PcCard(padding = PaddingValues(16.dp)) {
                        Text("Álbum de figurinhas", color = PC.Header, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Text("${d.distinctOwned} de ${d.totalCatalog} figurinhas · ${d.capsuleCount} cápsula(s) pra abrir", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
                        Spacer(Modifier.height(10.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            PillButton("Comprar cápsulas", { buying = true }, Modifier.weight(1f))
                            PillButton(
                                if (d.capsuleCount > 0) "Abrir ${d.capsuleCount}" else "Nada pra abrir", {
                                    busy = true
                                    scope.launch {
                                        runCatching { repo.api.post<OpenAllResponse>("/api/stickers/capsules/open-all") }
                                            .onSuccess { opened = it.results; load() }.onFailure { toast(errOf(it, "Não deu pra abrir.")) }
                                        busy = false
                                    }
                                }, Modifier.weight(1f), enabled = d.capsuleCount > 0, busy = busy, color = PC.Green,
                            )
                        }
                    }
                }
                d.groups.forEach { g ->
                    item(span = { GridItemSpan(maxLineSpan) }, key = "r-" + g.rarity.id) {
                        Text(g.rarity.name, color = hex(g.rarity.color, PC.Muted), fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp, start = 4.dp))
                    }
                    g.stickers.forEach { s ->
                        item(key = "s-" + s.id) {
                            val have = s.quantity > 0 || s.pasted
                            Column(
                                Modifier.clip(RoundedCornerShape(14.dp)).background(PC.Surface).border(1.dp, hex(g.rarity.color, PC.Line).copy(alpha = if (have) 0.8f else 0.25f), RoundedCornerShape(14.dp))
                                    .clickable(enabled = s.quantity > 0 && !s.pasted) {
                                        scope.launch {
                                            runCatching { repo.api.postIgnore("/api/stickers/${s.id}/paste") }
                                                .onSuccess { toast("Colou \"${s.name}\" no álbum!"); load() }.onFailure { toast(errOf(it, "Não deu pra colar.")) }
                                        }
                                    }.padding(8.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                AsyncImage(s.imageUrl?.let(Config::media), s.name, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxWidth().aspectRatio(1f).alpha(if (have) 1f else 0.18f))
                                Text(s.name, color = if (have) PC.Header else PC.Faint, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(
                                    when { s.pasted -> "No álbum"; s.quantity > 0 -> "Tocar pra colar (${s.quantity})"; else -> "Falta" },
                                    color = if (s.quantity > 0 && !s.pasted) PC.Brand else PC.Faint, fontSize = 10.sp, maxLines = 1,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
    if (buying) {
        val prices = data?.capsulePrices.orEmpty().ifEmpty { mapOf("1" to 100, "5" to 450, "10" to 800) }
        AlertDialog(
            onDismissRequest = { if (!busy) buying = false },
            title = { Text("Máquina de cápsulas") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Cada cápsula tem uma figurinha surpresa.", color = PC.Muted)
                    prices.entries.sortedBy { it.key.toIntOrNull() ?: 0 }.forEach { (qty, price) ->
                        PcCard(onClick = {
                            if (busy) return@PcCard
                            busy = true
                            scope.launch {
                                runCatching { repo.api.postIgnore("/api/stickers/capsules/buy", buildJsonObject { put("quantity", qty.toInt()) }) }
                                    .onSuccess { toast("$qty cápsula(s) compradas!"); buying = false; load() }.onFailure { toast(errOf(it, "Não deu pra comprar.")) }
                                busy = false
                            }
                        }, padding = PaddingValues(12.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("$qty cápsula" + if (qty == "1") "" else "s", color = PC.Header, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                                Text("🪙 $price", color = PC.Text)
                            }
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { buying = false }) { Text("Fechar") } },
            containerColor = PC.Surface,
        )
    }
    opened?.let { list ->
        AlertDialog(
            onDismissRequest = { opened = null },
            title = { Text("Você ganhou!") },
            text = {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    list.forEach { r ->
                        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(84.dp)) {
                            AsyncImage(r.imageUrl?.let(Config::media), r.name, modifier = Modifier.size(72.dp))
                            Text(r.name, color = PC.Header, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { opened = null }) { Text("Legal!") } },
            containerColor = PC.Surface,
        )
    }
}

/* ======================= Loja dos criadores ======================= */

@Serializable data class CreatorItem(
    val id: String = "", val kind: String = "", val name: String = "", val description: String? = null,
    val imageUrl: String? = null, val priceCoins: Int = 0, val sales: Int = 0, val creator: User? = null,
    val owned: Boolean = false, val mine: Boolean = false,
)
@Serializable data class CreatorList(val items: List<CreatorItem> = emptyList(), val coins: Int = 0, val feePercent: Int? = null)

@Composable
fun CreatorShopScreen(repo: Repository, nav: AppNav) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var kind by remember { mutableStateOf("") }
    var sort by remember { mutableStateOf("") }
    var data by remember { mutableStateOf<CreatorList?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf<CreatorItem?>(null) }
    var busy by remember { mutableStateOf(false) }
    suspend fun load() {
        val qs = listOfNotNull(kind.ifBlank { null }?.let { "kind=$it" }, sort.ifBlank { null }?.let { "sort=$it" }).joinToString("&")
        runCatching { repo.api.get<CreatorList>("/api/creator-shop" + if (qs.isEmpty()) "" else "?$qs") }
            .onSuccess { data = it; error = null }.onFailure { error = errOf(it, "Não deu pra abrir a loja dos criadores.") }
    }
    LaunchedEffect(kind, sort) { data = null; load() }
    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        BackBar("Loja dos criadores", Icons.Outlined.Palette, nav)
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("" to "Tudo", "EMOJI" to "Emojis", "STICKER" to "Figurinhas", "FRAME" to "Molduras").forEach { (k, l) -> Pill(l, kind == k) { kind = k } }
            Spacer(Modifier.width(8.dp))
            listOf("" to "Novos", "populares" to "Populares", "preco" to "Mais baratos").forEach { (k, l) -> Pill(l, sort == k) { sort = k } }
        }
        val d = data
        when {
            d == null && error != null -> EmptyState(Icons.Outlined.CloudOff, "Não deu pra abrir", error.orEmpty(), Modifier.padding(top = 40.dp))
            d == null -> ListSkeleton(avatar = 0.dp)
            d.items.isEmpty() -> EmptyState(Icons.Outlined.Palette, "Nada aqui ainda", "Quando a equipe aprovar criações dos membros, elas aparecem aqui.", Modifier.padding(top = 40.dp))
            else -> LazyVerticalGrid(GridCells.Adaptive(150.dp), contentPadding = PaddingValues(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Text(
                        "Você tem 🪙 ${d.coins}. Quem criou recebe as moedas da venda" + (d.feePercent?.let { " (menos $it% de taxa)" } ?: "") + ". Pra enviar a sua criação, use o site.",
                        color = PC.Muted, style = MaterialTheme.typography.bodySmall,
                    )
                }
                items(d.items.size, key = { d.items[it].id }) { i ->
                    val ci = d.items[i]
                    PcCard(onClick = { if (!ci.owned && !ci.mine) confirm = ci }, padding = PaddingValues(10.dp)) {
                        Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(12.dp)).background(PC.Surface2), contentAlignment = Alignment.Center) {
                            AsyncImage(ci.imageUrl?.let(Config::media), ci.name, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize().padding(10.dp))
                        }
                        Text(ci.name, color = PC.Header, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            ci.creator?.let { u -> Avatar(u, 16.dp); Spacer(Modifier.width(4.dp)) }
                            Text(ci.creator?.displayName ?: "Alguém", color = PC.Muted, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        Text(
                            when { ci.mine -> "Sua criação"; ci.owned -> "Você já tem"; else -> "🪙 ${ci.priceCoins}" },
                            color = if (ci.owned || ci.mine) PC.Green else PC.Text, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                }
            }
        }
    }
    confirm?.let { item ->
        AlertDialog(
            onDismissRequest = { if (!busy) confirm = null },
            title = { Text("Comprar ${item.name}?") },
            text = { Text("Custa 🪙 ${item.priceCoins}. ${when (item.kind) { "EMOJI" -> "O emoji entra na sua lista de emojis."; "STICKER" -> "A figurinha aparece no seletor de figurinhas."; else -> "A moldura vai pros seus itens da Loja." }}") },
            confirmButton = {
                TextButton(enabled = !busy, onClick = {
                    busy = true
                    scope.launch {
                        runCatching { repo.api.postIgnore("/api/creator-shop/${item.id}/buy") }
                            .onSuccess { Toast.makeText(ctx, "Comprado!", Toast.LENGTH_SHORT).show(); confirm = null; load() }
                            .onFailure { Toast.makeText(ctx, errOf(it, "Não deu pra comprar."), Toast.LENGTH_SHORT).show() }
                        busy = false
                    }
                }) { Text(if (busy) "Comprando…" else "Comprar", fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Cancelar") } },
            containerColor = PC.Surface,
        )
    }
}

@Composable
private fun Pill(label: String, on: Boolean, onClick: () -> Unit) {
    Box(Modifier.clip(RoundedCornerShape(12.dp)).background(if (on) PC.Brand else PC.Surface2).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 7.dp)) {
        Text(label, color = if (on) PC.OnBrand else PC.Text, style = MaterialTheme.typography.labelMedium)
    }
}

/* ======================= Carteira compartilhada (/carteira/<id>) ======================= */

@Serializable data class SharedWalletCard(val id: String = "", val coins: Int = 0, val gems: Int = 0, val level: Int = 1, val style: String? = null, val createdAt: String? = null)
@Serializable data class SharedWalletResponse(val card: SharedWalletCard? = null, val user: User? = null)

@Composable
fun WalletCardScreen(repo: Repository, nav: AppNav, id: String) {
    var data by remember(id) { mutableStateOf<SharedWalletResponse?>(null) }
    var error by remember(id) { mutableStateOf<String?>(null) }
    LaunchedEffect(id) {
        runCatching { repo.api.get<SharedWalletResponse>("/api/economy/card/" + android.net.Uri.encode(id)) }.onSuccess { data = it }.onFailure { error = errOf(it, "Esse cartão não existe mais.") }
    }
    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        BackBar("Cartão da carteira", Icons.Outlined.CreditCard, nav)
        val c = data?.card
        when {
            c == null && error != null -> EmptyState(Icons.Outlined.CloudOff, "Não deu pra abrir", error.orEmpty(), Modifier.padding(top = 40.dp))
            c == null -> ListSkeleton(avatar = 0.dp)
            else -> Column(Modifier.fillMaxSize().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                FlipWalletCard(EcoWallet(coins = c.coins, gems = c.gems, accountLevel = c.level, cardStyle = c.style), data?.user, Modifier.fillMaxWidth())
                Spacer(Modifier.height(10.dp))
                Text("Toque no cartão pra virar", color = PC.Faint, style = MaterialTheme.typography.labelSmall)
                data?.user?.let { u ->
                    Spacer(Modifier.height(18.dp))
                    PillButton("Ver perfil de ${u.displayName ?: u.username}", { nav.fullProfile(u.id) })
                }
            }
        }
    }
}
