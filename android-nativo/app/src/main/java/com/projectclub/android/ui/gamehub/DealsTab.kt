package com.projectclub.android.ui.gamehub

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.LocalOffer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.projectclub.android.data.Deal
import com.projectclub.android.data.DealsResponse
import com.projectclub.android.data.Repository
import com.projectclub.android.gamehub.HubLogic
import com.projectclub.android.ui.common.EmptyState
import com.projectclub.android.ui.common.ListSkeleton
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.theme.PC

private val STORES = listOf("todas" to "Todas", "steam" to "Steam", "gog" to "GOG", "epic" to "Epic")

fun storeName(store: String) = when (store) { "steam" -> "Steam"; "gog" -> "GOG"; "epic" -> "Epic"; else -> store }

fun storeColor(store: String) = when (store) {
    "steam" -> Color(0xFF66C0F4)
    "gog" -> Color(0xFFB45CFF)
    "epic" -> Color(0xFFE7E7E7)
    else -> PC.Muted
}

@Composable
fun DealsTab(repo: Repository, nav: AppNav) {
    val deals = rememberLoader("deals") { repo.api.get<DealsResponse>("/api/game-hub/deals") }
    val d = deals.data
    when {
        d == null && deals.error != null -> EmptyState(Icons.Outlined.LocalOffer, "Promoções fora do ar", deals.error!!)
        d == null -> ListSkeleton(6, 64.dp)
        else -> DealsContent(d, onOpen = { url -> nav.external(url) })
    }
}

/** Grátis agora, grátis em breve e as promoções (Steam e GOG em reais; Epic em dólar). */
@Composable
fun DealsContent(data: DealsResponse, onOpen: (String) -> Unit) {
    var store by rememberSaveable { mutableStateOf("todas") }
    val list = data.deals.filter { store == "todas" || it.store == store }
    LazyVerticalGrid(
        GridCells.Fixed(2), Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (data.free.isNotEmpty()) {
            item(span = { GridItemSpan(2) }, key = "free-h") { SectionHead("Grátis agora") }
            item(span = { GridItemSpan(2) }, key = "free") {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(data.free) { FreeCard(it, Modifier.width(270.dp)) { it.url?.let(onOpen) } }
                }
            }
        }
        if (data.upcoming.isNotEmpty()) {
            item(span = { GridItemSpan(2) }, key = "up-h") { SectionHead("Grátis em breve") }
            item(span = { GridItemSpan(2) }, key = "up") {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(data.upcoming) { FreeCard(it, Modifier.width(220.dp), upcoming = true) { it.url?.let(onOpen) } }
                }
            }
        }
        item(span = { GridItemSpan(2) }, key = "deals-h") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SectionHead("Promoções")
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(STORES, key = { it.first }) { (k, label) -> HubChip(label, store == k, { store = k }) }
                }
            }
        }
        if (list.isEmpty()) item(span = { GridItemSpan(2) }, key = "none") {
            Text(
                if (store == "todas") "Nenhuma promoção carregou agora." else "Sem promoções da ${storeName(store)} agora.",
                color = PC.Muted, modifier = Modifier.padding(vertical = 24.dp),
            )
        }
        items(list) { DealCard(it) { it.url?.let(onOpen) } }
        if (data.deals.any { it.store == "epic" }) item(span = { GridItemSpan(2) }, key = "note") {
            Text("Preços da Epic em dólar (CheapShark). Steam e GOG em reais.", color = PC.Faint, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
fun FreeCard(d: Deal, modifier: Modifier = Modifier, upcoming: Boolean = false, onClick: () -> Unit) {
    val shape = RoundedCornerShape(18.dp)
    Column(modifier.clip(shape).background(PC.Surface).border(1.dp, PC.Line, shape).clickable(onClick = onClick)) {
        Box {
            GameCover(d.title, Modifier.fillMaxWidth().aspectRatio(16f / 9f), image = d.image, shape = RoundedCornerShape(0.dp))
            HubBadge(if (upcoming) "Em breve" else "Grátis", if (upcoming) PC.Surface3 else PC.Green, Modifier.align(Alignment.TopStart).padding(8.dp))
        }
        Column(Modifier.padding(12.dp)) {
            Text(d.title, color = PC.Header, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(2.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(storeName(d.store), color = storeColor(d.store), style = MaterialTheme.typography.labelMedium)
                Text(
                    " · " + if (upcoming) HubLogic.fromLabel(d.startsAt) else HubLogic.untilLabel(d.endsAt),
                    color = PC.Muted, style = MaterialTheme.typography.labelMedium, maxLines = 1,
                )
            }
            d.price.base?.takeIf { it > 0 }?.let {
                Text(HubLogic.money(it, d.price.currency), color = PC.Faint, style = MaterialTheme.typography.bodySmall, textDecoration = TextDecoration.LineThrough)
            }
        }
    }
}

@Composable
fun DealCard(d: Deal, onClick: () -> Unit) {
    val shape = RoundedCornerShape(18.dp)
    Column(Modifier.fillMaxWidth().clip(shape).background(PC.Surface).border(1.dp, PC.Line, shape).clickable(onClick = onClick)) {
        Box {
            GameCover(d.title, Modifier.fillMaxWidth().aspectRatio(460f / 215f), image = d.image, shape = RoundedCornerShape(0.dp))
            HubBadge("-${d.price.discount}%", PC.Green, Modifier.align(Alignment.TopEnd).padding(6.dp))
        }
        Column(Modifier.padding(10.dp)) {
            Text(d.title, color = PC.Header, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, minLines = 2)
            Spacer(Modifier.height(6.dp))
            Text(HubLogic.money(d.price.finalPrice, d.price.currency), color = PC.Header, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            Row(verticalAlignment = Alignment.CenterVertically) {
                d.price.base?.let {
                    Text(HubLogic.money(it, d.price.currency), color = PC.Faint, style = MaterialTheme.typography.labelSmall, textDecoration = TextDecoration.LineThrough)
                    Spacer(Modifier.width(6.dp))
                }
                Text(storeName(d.store), color = storeColor(d.store), style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}
