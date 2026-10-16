package com.projectclub.android.ui.store

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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.LocalMall
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.data.Repository
import com.projectclub.android.data.StoreBuyResult
import com.projectclub.android.data.StoreCollection
import com.projectclub.android.data.StoreShop
import com.projectclub.android.net.ApiException
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.Bone
import com.projectclub.android.ui.common.Chip
import com.projectclub.android.ui.common.EmptyState
import com.projectclub.android.ui.common.GhostButton
import com.projectclub.android.ui.common.PcField
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.common.PillButton
import com.projectclub.android.ui.common.rememberShimmer
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Um item da loja (moldura ou efeito) num formato só, pra grade e detalhes. */
private data class ShopItem(
    val id: String,
    val kind: Kind,
    val name: String,
    val imageUrl: String?,
    val coins: Int?,
    val gems: Int?,
    val owned: Boolean,
    val equipped: Boolean,
    val isNew: Boolean,
    val collectionId: String?,
    val limited: Boolean = false,
    val stock: Int? = null,
    val sold: Int = 0,
    val remaining: Int? = null,
    val serial: Int? = null,
    val locked: Boolean = false,
    val description: String? = null,
    /** Fonte: JSON igual ao User.profileFont; estilo: a chave (win2000...). */
    val fontJson: String? = null,
    val styleKey: String? = null,
) {
    val soldOut: Boolean get() = limited && (remaining ?: 0) <= 0
}

private enum class Kind(val label: String, val buy: String, val equip: String) {
    Frame("Moldura", "/api/decorations/%s/buy", "/api/decorations/equip"),
    Effect("Efeito de perfil", "/api/decorations/effects/%s/buy", "/api/decorations/effects/equip"),
    Font("Fonte do nome", "/api/decorations/fonts/%s/buy", "/api/decorations/fonts/equip"),
    Style("Estilo de perfil", "/api/decorations/styles/%s/buy", "/api/decorations/styles/equip"),
}

private enum class StoreTab(val label: String) {
    All("Tudo"), Frames("Molduras"), Effects("Efeitos"), Fonts("Fontes"), Styles("Estilos"), Limited("Limitados"),
    Collections("Coleções"), Mine("Meus itens"), Trades("Trocas"),
}

/** Loja do Project Club: molduras, efeitos de perfil e coleções. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StoreScreen(repo: Repository, nav: AppNav, initialTab: String?) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val me by repo.me.collectAsState()
    var shop by remember { mutableStateOf<StoreShop?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var tab by rememberSaveable {
        mutableStateOf(when (initialTab) { "molduras" -> StoreTab.Frames; "efeitos" -> StoreTab.Effects; "fontes" -> StoreTab.Fonts; "estilos" -> StoreTab.Styles; "limitados" -> StoreTab.Limited; "colecoes" -> StoreTab.Collections; "meus" -> StoreTab.Mine; "trocas" -> StoreTab.Trades; else -> StoreTab.All })
    }
    var query by rememberSaveable { mutableStateOf("") }
    var selected by remember { mutableStateOf<ShopItem?>(null) }
    var selectedCollection by remember { mutableStateOf<StoreCollection?>(null) }
    var busy by remember { mutableStateOf(false) }

    suspend fun load() {
        try { shop = repo.api.get<StoreShop>("/api/decorations/shop"); error = null }
        catch (e: Exception) { if (shop == null) error = e.message ?: "Não deu pra abrir a Loja." }
    }
    LaunchedEffect(Unit) { load() }

    fun toast(t: String) = Toast.makeText(ctx, t, Toast.LENGTH_SHORT).show()

    fun buy(item: ShopItem, gems: Boolean) = scope.launch {
        busy = true
        try {
            val path = item.kind.buy.format(item.id)
            repo.api.post<StoreBuyResult>(path, buildJsonObject { put("currency", if (gems) "gems" else "coins") })
            toast("Comprado! Já está no seu inventário.")
            load()
            selected = null
        } catch (e: ApiException) { toast(e.message ?: "Não deu pra comprar.") } catch (_: Exception) { toast("Sem conexão. Tente de novo.") }
        busy = false
    }

    fun equip(item: ShopItem, on: Boolean) = scope.launch {
        busy = true
        try {
            val path = item.kind.equip
            repo.api.postIgnore(path, buildJsonObject { if (on) put("id", item.id) else put("id", JsonNull) })
            toast(if (on) "Equipado!" else "Removido do perfil.")
            load()
            selected = null
        } catch (e: Exception) { toast(e.message ?: "Não deu pra equipar.") }
        busy = false
    }

    fun buyCollection(c: StoreCollection, gems: Boolean) = scope.launch {
        busy = true
        try {
            repo.api.post<StoreBuyResult>("/api/decorations/collections/${c.id}/buy", buildJsonObject { put("currency", if (gems) "gems" else "coins") })
            toast("Coleção comprada!")
            load()
            selectedCollection = null
        } catch (e: Exception) { toast(e.message ?: "Não deu pra comprar.") }
        busy = false
    }

    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        PcTopBar("Loja", Icons.Outlined.LocalMall, navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } }) {
            shop?.let { s ->
                CurrencyAmount(false, s.coins, Modifier.padding(end = 10.dp))
                CurrencyAmount(true, s.gems, Modifier.padding(end = 12.dp))
            }
        }
        val s = shop
        when {
            s == null && error != null -> EmptyState(Icons.Outlined.CloudOff, "Loja indisponível", error ?: "", Modifier.padding(top = 40.dp)) {
                GhostButton("Tentar de novo", { scope.launch { error = null; load() } })
            }
            s == null -> StoreSkeleton()
            else -> {
                val newCut = System.currentTimeMillis() - 14L * 86_400_000L
                fun isNew(iso: String?) = com.projectclub.android.ui.common.instantOf(iso)?.toEpochMilli()?.let { it > newCut } == true
                val frames = s.decorations.sortedBy { it.sortOrder }.map {
                    ShopItem(it.id, Kind.Frame, it.name, it.imageUrl, it.priceCoins, it.priceGems, it.owned, it.id == s.equippedId, isNew(it.createdAt), it.collectionId,
                        it.limited, it.stock, it.sold, it.remaining, it.serial, it.locked, it.description)
                }
                val effects = s.effects.sortedBy { it.sortOrder }.map {
                    ShopItem(it.id, Kind.Effect, it.name, it.imageUrl, it.priceCoins, it.priceGems, it.owned, it.id == s.equippedEffectId, isNew(it.createdAt), it.collectionId,
                        it.limited, it.stock, it.sold, it.remaining, it.serial, it.locked, it.description)
                }
                val fonts = s.fonts.sortedBy { it.sortOrder }.map {
                    ShopItem(it.id, Kind.Font, it.name, it.previewUrl, it.priceCoins, it.priceGems, it.owned, it.id == s.equippedFontId, isNew(it.createdAt), it.collectionId,
                        it.limited, it.stock, it.sold, it.remaining, it.serial, it.locked, it.description, fontJson = it.fontJson)
                }
                val styles = s.styles.sortedBy { it.sortOrder }.map {
                    ShopItem(it.id, Kind.Style, it.name, it.previewUrl, it.priceCoins, it.priceGems, it.owned, s.equippedStyle != null && it.styleKey == s.equippedStyle, isNew(it.createdAt), it.collectionId,
                        it.limited, it.stock, it.sold, it.remaining, it.serial, it.locked, it.description, styleKey = it.styleKey)
                }
                val everything = frames + effects + fonts + styles
                val q = query.trim()
                val base = when (tab) {
                    StoreTab.All -> everything
                    StoreTab.Frames -> frames
                    StoreTab.Effects -> effects
                    StoreTab.Fonts -> fonts
                    StoreTab.Styles -> styles
                    StoreTab.Limited -> everything.filter { it.limited }
                    StoreTab.Mine -> everything.filter { it.owned }
                    StoreTab.Collections, StoreTab.Trades -> emptyList()
                }
                val items = base.filter { q.isEmpty() || it.name.contains(q, ignoreCase = true) }
                PullToRefreshBox(refreshing, onRefresh = { scope.launch { refreshing = true; load(); refreshing = false } }, Modifier.fillMaxSize()) {
                    LazyVerticalGrid(
                        GridCells.Fixed(2), Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        item(span = { GridItemSpan(2) }) {
                            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                StoreHero(s, everything.count { it.owned })
                                PcField(query, { query = it }, "Buscar na loja", icon = Icons.Outlined.Search)
                                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    StoreTab.entries.filter { t ->
                                        when (t) { StoreTab.Fonts -> fonts.isNotEmpty(); StoreTab.Styles -> styles.isNotEmpty(); StoreTab.Limited -> everything.any { it.limited }; else -> true }
                                    }.forEach { t -> TabPill(t.label, t == tab) { if (t == StoreTab.Trades) nav.trades() else tab = t } }
                                }
                            }
                        }
                        if (tab == StoreTab.Collections) {
                            if (s.collections.isEmpty()) item(span = { GridItemSpan(2) }) {
                                EmptyState(Icons.Outlined.LocalMall, "Nenhuma coleção", "As coleções da loja aparecem aqui.")
                            }
                            items(s.collections.sortedBy { it.sortOrder }, key = { "c-" + it.id }, span = { GridItemSpan(2) }) { c ->
                                CollectionCard(c) { selectedCollection = c }
                            }
                        } else {
                            if (items.isEmpty()) item(span = { GridItemSpan(2) }) {
                                EmptyState(
                                    Icons.Outlined.Inventory2,
                                    if (tab == StoreTab.Mine) "Você ainda não tem itens" else "Nada encontrado",
                                    if (tab == StoreTab.Mine) "Compre molduras e efeitos para personalizar seu perfil." else "Tente outra busca.",
                                )
                            }
                            items(items, key = { it.kind.name + it.id }) { item -> ItemCard(item, me) { selected = item } }
                        }
                        item(span = { GridItemSpan(2) }) { Spacer(Modifier.navigationBarsPadding().height(8.dp)) }
                    }
                }
            }
        }
    }

    selected?.let { item ->
        ItemSheet(repo, item, me, shop, busy, onDismiss = { selected = null }, onBuy = { gems -> buy(item, gems) }, onEquip = { on -> equip(item, on) })
    }
    selectedCollection?.let { c ->
        val s = shop
        var confirmGems by remember { mutableStateOf<Boolean?>(null) }
        AlertDialog(
            onDismissRequest = { selectedCollection = null },
            containerColor = PC.Surface2,
            title = { Text(c.name) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    c.description?.takeIf { it.isNotBlank() }?.let { Text(it, color = PC.Muted) }
                    val inCol = s?.let { it.decorations.count { d -> d.collectionId == c.id } + it.effects.count { e -> e.collectionId == c.id } } ?: 0
                    Text("$inCol itens no pacote", color = PC.Text)
                    if (c.offer?.active == true) Chip("-${c.offer.discount}% por tempo limitado", PC.Green)
                    confirmGems?.let { g -> Text("Confirmar compra por ${fmtNum(if (g) c.finalBundleGems else c.finalBundleCoins)} ${if (g) "gemas" else "moedas"}?", color = PC.Header, fontWeight = FontWeight.Bold) }
                }
            },
            confirmButton = {
                val g = confirmGems
                if (g != null) TextButton(onClick = { buyCollection(c, g) }, enabled = !busy) { Text("Comprar", color = PC.Green) }
                else Row {
                    c.finalBundleCoins?.let { TextButton(onClick = { confirmGems = false }) { CurrencyAmount(false, it) } }
                    c.finalBundleGems?.let { TextButton(onClick = { confirmGems = true }) { CurrencyAmount(true, it) } }
                }
            },
            dismissButton = { TextButton(onClick = { selectedCollection = null }) { Text("Fechar", color = PC.Text) } },
        )
    }
}

@Composable
private fun StoreHero(s: StoreShop, ownedCount: Int) {
    val shape = RoundedCornerShape(24.dp)
    Box(
        Modifier.fillMaxWidth().clip(shape)
            .background(Brush.linearGradient(listOf(Color(0xFF0E3B22), Color(0xFF16683A), Color(0xFF22C55E))))
            .border(1.dp, Color(0x3322C55E), shape).padding(20.dp),
    ) {
        Column {
            Text("Loja", style = MaterialTheme.typography.headlineMedium, color = Color.White)
            Text("Molduras e efeitos para o seu perfil · $ownedCount no inventário", color = Color(0xCCFFFFFF), style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BalancePill(false, s.coins)
                BalancePill(true, s.gems)
                if (s.subscriber) Chip("Assinante", PC.Yellow)
            }
        }
    }
}

@Composable
private fun TabPill(text: String, on: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.clip(CircleShape).background(if (on) PC.BrandSoft else PC.Surface)
            .border(1.dp, if (on) PC.Brand.copy(alpha = 0.6f) else PC.Line, CircleShape)
            .clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 9.dp),
    ) { Text(text, color = if (on) PC.Header else PC.Muted, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold) }
}

@Composable
private fun ItemPreview(item: ShopItem, me: com.projectclub.android.data.User?, modifier: Modifier) {
    val loader = rememberAnimatedImageLoader()
    val st = if (item.kind == Kind.Style) com.projectclub.android.ui.profile.profileStyleOf(item.styleKey) else null
    Box(modifier.background(st?.bg ?: Brush.radialGradient(listOf(PC.Surface3, PC.Surface))), contentAlignment = Alignment.Center) {
        if (item.kind == Kind.Font) {
            // Seu nome escrito com a fonte.
            val f = com.projectclub.android.ui.profile.rememberShopFont(item.fontJson)
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(8.dp)) {
                Text(me?.name ?: "Seu nome", color = PC.Header, fontFamily = f, fontSize = 24.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("Aa Bb Cc 123", color = PC.Muted, fontFamily = f, fontSize = 14.sp)
            }
        } else if (st != null) {
            // Mini perfil no visual do estilo.
            Column(Modifier.fillMaxSize()) {
                com.projectclub.android.ui.profile.StyleTitleBar(st)
                Box(Modifier.fillMaxWidth().weight(0.4f).background(Brush.linearGradient(listOf(st.accent, st.accent.copy(alpha = 0.4f)))))
                Column(Modifier.fillMaxWidth().weight(0.6f).padding(horizontal = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Avatar(me, 34.dp)
                        Spacer(Modifier.width(6.dp))
                        Text(me?.name ?: "Você", color = st.header, fontFamily = st.nameFont, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelLarge.copy(shadow = st.nameShadow))
                    }
                    Box(Modifier.fillMaxWidth().height(14.dp).clip(RoundedCornerShape(st.corner)).background(st.panel).border(1.dp, st.panelBorder, RoundedCornerShape(st.corner)))
                    Box(Modifier.fillMaxWidth(0.6f).height(16.dp).clip(RoundedCornerShape(st.buttonCorner)).background(st.button).border(1.dp, st.buttonBorder, RoundedCornerShape(st.buttonCorner)))
                }
            }
            com.projectclub.android.ui.profile.StyleOverlay(st, Modifier.matchParentSize())
        } else if (item.kind == Kind.Frame) {
            // Moldura em volta do seu avatar, como fica no perfil.
            Avatar(me, 64.dp)
            AsyncImage(Config.media(item.imageUrl), item.name, imageLoader = loader, contentScale = ContentScale.Fit, modifier = Modifier.size(92.dp))
        } else {
            AsyncImage(Config.media(item.imageUrl), item.name, imageLoader = loader, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
    }
}

@Composable
private fun ItemCard(item: ShopItem, me: com.projectclub.android.data.User?, onClick: () -> Unit) {
    val shape = RoundedCornerShape(20.dp)
    Column(
        Modifier.clip(shape).background(PC.Surface).border(1.dp, if (item.equipped) PC.Brand.copy(alpha = 0.6f) else PC.Line, shape).clickable(onClick = onClick),
    ) {
        Box {
            ItemPreview(item, me, Modifier.fillMaxWidth().aspectRatio(1.1f))
            Row(Modifier.align(Alignment.TopStart).padding(8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                when {
                    item.equipped -> Chip("Equipado", PC.Brand)
                    item.owned -> Chip(if (item.serial != null) "#${item.serial}" else "Você tem", PC.Green)
                    item.soldOut -> Chip("Esgotado", PC.Muted)
                    item.limited -> Chip("Limitado · ${item.remaining}", PC.Yellow)
                    item.locked -> Chip("Apoio", PC.Purple)
                    item.isNew -> Chip("Novo", PC.Pink)
                }
            }
        }
        Column(Modifier.padding(12.dp)) {
            Text(item.name, color = PC.Header, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(item.kind.label, color = PC.Muted, style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(8.dp))
            if (item.owned) Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.CheckCircle, null, tint = PC.Green, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(4.dp))
                Text("No inventário", color = PC.Green, style = MaterialTheme.typography.labelMedium)
            } else if (item.soldOut) Text("Só por troca", color = PC.Muted, style = MaterialTheme.typography.labelMedium)
            else if (item.locked) Text("Exclusivo de apoio", color = PC.Purple, style = MaterialTheme.typography.labelMedium)
            else Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                item.coins?.let { CurrencyAmount(false, it) }
                item.gems?.let { CurrencyAmount(true, it) }
            }
        }
    }
}

@Composable
private fun CollectionCard(c: StoreCollection, onClick: () -> Unit) {
    val shape = RoundedCornerShape(20.dp)
    val accent = runCatching { Color(android.graphics.Color.parseColor(c.accentColor)) }.getOrDefault(PC.Brand)
    Column(Modifier.fillMaxWidth().clip(shape).background(PC.Surface).border(1.dp, accent.copy(alpha = 0.4f), shape).clickable(onClick = onClick)) {
        Box(Modifier.fillMaxWidth().height(120.dp).background(Brush.linearGradient(listOf(accent.copy(alpha = 0.5f), PC.Surface)))) {
            Config.media(c.bannerUrl)?.let { AsyncImage(it, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
            if (c.featured) Chip("Destaque", PC.Yellow, Modifier.align(Alignment.TopStart).padding(10.dp))
            if (c.offer?.active == true) Chip("-${c.offer.discount}%", PC.Green, Modifier.align(Alignment.TopEnd).padding(10.dp))
        }
        Column(Modifier.padding(14.dp)) {
            Text(c.name, color = PC.Header, style = MaterialTheme.typography.titleMedium)
            c.description?.takeIf { it.isNotBlank() }?.let { Text(it, color = PC.Muted, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis) }
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                c.finalBundleCoins?.let { CurrencyAmount(false, it) }
                c.finalBundleGems?.let { CurrencyAmount(true, it) }
                untilText(c.offer?.endsAt)?.takeIf { c.offer?.active == true }?.let { Text("acaba em $it", color = PC.Muted, style = MaterialTheme.typography.bodySmall) }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ItemSheet(
    repo: com.projectclub.android.data.Repository,
    item: ShopItem, me: com.projectclub.android.data.User?, shop: StoreShop?, busy: Boolean,
    onDismiss: () -> Unit, onBuy: (gems: Boolean) -> Unit, onEquip: (Boolean) -> Unit,
) {
    var confirm by remember { mutableStateOf<Boolean?>(null) }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = PC.Surface) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).navigationBarsPadding().padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            ItemPreview(item, me, Modifier.fillMaxWidth().height(220.dp).clip(RoundedCornerShape(20.dp)))
            Column {
                Text(item.name, style = MaterialTheme.typography.headlineSmall, color = PC.Header)
                Text(item.kind.label + if (item.collectionId != null) " · faz parte de uma coleção" else "", color = PC.Muted)
                item.description?.takeIf { it.isNotBlank() }?.let { Spacer(Modifier.height(6.dp)); Text(it, color = PC.Text, style = MaterialTheme.typography.bodyMedium) }
            }
            if (item.limited) {
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Color(0x22F5B400)).border(1.dp, Color(0x55F5B400), RoundedCornerShape(14.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        when {
                            item.owned && item.serial != null -> "Item limitado · sua cópia é a #${item.serial}"
                            item.soldOut -> "Item limitado · esgotado"
                            else -> "Item limitado · restam ${item.remaining} de ${item.stock}"
                        },
                        color = PC.Yellow, fontWeight = FontWeight.Bold,
                    )
                    androidx.compose.material3.LinearProgressIndicator(
                        progress = { (item.sold.toFloat() / (item.stock ?: 1).coerceAtLeast(1)).coerceIn(0f, 1f) },
                        modifier = Modifier.fillMaxWidth().height(6.dp).clip(CircleShape), color = PC.Yellow, trackColor = PC.Surface3,
                    )
                    Text("Limitados podem ser trocados com outros jogadores na aba Trocas.", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
                }
            }
            if (!item.owned) WishlistButton(repo, item)
            if (item.owned) {
                if (item.equipped) PillButton("Tirar do perfil", { onEquip(false) }, Modifier.fillMaxWidth(), busy = busy, color = PC.Surface3)
                else PillButton("Equipar no perfil", { onEquip(true) }, Modifier.fillMaxWidth(), busy = busy)
            } else if (item.soldOut) {
                Text("Esgotou. Agora só dá pra conseguir trocando com quem tem.", color = PC.Muted)
            } else if (item.locked) {
                Text("Este item não é vendido: fica liberado para quem é Assinante/Super Assinante.", color = PC.Muted)
            } else {
                val c = confirm
                if (c == null) {
                    item.coins?.let { price ->
                        val can = (shop?.coins ?: 0) >= price
                        PillButton("Comprar por ${fmtNum(price)} moedas", { confirm = false }, Modifier.fillMaxWidth(), enabled = can, color = Color(0xFFB7851E))
                    }
                    item.gems?.let { price ->
                        val can = (shop?.gems ?: 0) >= price
                        PillButton("Comprar por ${fmtNum(price)} gemas", { confirm = true }, Modifier.fillMaxWidth(), enabled = can, color = Color(0xFF7C4DDB))
                    }
                    if (item.coins == null && item.gems == null) Text("Este item não está à venda agora.", color = PC.Muted)
                } else {
                    val price = if (c) item.gems else item.coins
                    val balance = if (c) shop?.gems else shop?.coins
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(PC.Surface2).padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Confirmar compra", color = PC.Header, fontWeight = FontWeight.Bold)
                        Row { Text("Preço final", color = PC.Muted, modifier = Modifier.weight(1f)); CurrencyAmount(c, price) }
                        Row { Text("Saldo depois", color = PC.Muted, modifier = Modifier.weight(1f)); CurrencyAmount(c, (balance ?: 0) - (price ?: 0)) }
                    }
                    PillButton("Confirmar", { onBuy(c) }, Modifier.fillMaxWidth(), busy = busy, color = PC.Green)
                    GhostButton("Voltar", { confirm = null }, Modifier.fillMaxWidth())
                }
            }
        }
    }
}

@Composable
private fun StoreSkeleton() {
    val b = rememberShimmer()
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Bone(b, Modifier.fillMaxWidth().height(120.dp), RoundedCornerShape(24.dp))
        Bone(b, Modifier.fillMaxWidth().height(56.dp), RoundedCornerShape(18.dp))
        repeat(3) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Bone(b, Modifier.weight(1f).height(200.dp), RoundedCornerShape(20.dp))
                Bone(b, Modifier.weight(1f).height(200.dp), RoundedCornerShape(20.dp))
            }
        }
    }
}


/** "Lista de desejos" (igual ao site): amigos veem no seu perfil e podem te dar de presente. */
@Composable
private fun WishlistButton(repo: com.projectclub.android.data.Repository, item: ShopItem) {
    val kind = when (item.kind) { Kind.Frame -> "deco"; Kind.Effect -> "effect"; Kind.Font -> "font"; Kind.Style -> "style" }
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var on by remember(item.id) { mutableStateOf<Boolean?>(null) }
    LaunchedEffect(item.id) {
        on = runCatching {
            val r = repo.api.get<kotlinx.serialization.json.JsonObject>("/api/users/me/wishlist")
            (r["wishlist"] as? kotlinx.serialization.json.JsonArray).orEmpty().any {
                val o = it as? kotlinx.serialization.json.JsonObject
                (o?.get("kind") as? kotlinx.serialization.json.JsonPrimitive)?.content == kind && (o["id"] as? kotlinx.serialization.json.JsonPrimitive)?.content == item.id
            }
        }.getOrDefault(false)
    }
    val cur = on ?: return
    GhostButton(
        if (cur) "Na sua lista de desejos" else "Adicionar à lista de desejos",
        {
            on = !cur
            scope.launch {
                runCatching {
                    repo.api.postIgnore("/api/users/me/wishlist", kotlinx.serialization.json.buildJsonObject {
                        put("kind", kotlinx.serialization.json.JsonPrimitive(kind)); put("id", kotlinx.serialization.json.JsonPrimitive(item.id)); put("on", kotlinx.serialization.json.JsonPrimitive(!cur))
                    })
                }.onFailure { on = cur; android.widget.Toast.makeText(ctx, it.message ?: "Não deu pra salvar.", android.widget.Toast.LENGTH_SHORT).show() }
            }
        },
        Modifier.fillMaxWidth(),
        icon = if (cur) androidx.compose.material.icons.Icons.Filled.Favorite else androidx.compose.material.icons.Icons.Outlined.FavoriteBorder,
        color = if (cur) PC.Pink else PC.Text,
    )
}
