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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Extension
import androidx.compose.material.icons.outlined.FiberManualRecord
import androidx.compose.material.icons.automirrored.outlined.LibraryBooks
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.SportsEsports
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.projectclub.android.data.BuildsResponse
import com.projectclub.android.data.ClipsResponse
import com.projectclub.android.data.DealsResponse
import com.projectclub.android.data.GameBuild
import com.projectclub.android.data.GameClip
import com.projectclub.android.data.GameParty
import com.projectclub.android.data.HotGame
import com.projectclub.android.data.HotlistResponse
import com.projectclub.android.data.PartiesResponse
import com.projectclub.android.data.Repository
import com.projectclub.android.gamehub.HubLogic
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.common.PillButton
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.theme.PC

/**
 * Game Hub no celular (igual ao /jogos do site): Início, Promoções, Partidas,
 * Clipes, Builds e Mods. [tab] vem do link (/jogos/partidas, /jogos/clipes...);
 * [party] abre uma partida em destaque (aviso de convite).
 */
@Composable
fun GameHubScreen(repo: Repository, nav: AppNav, tab: String? = null, party: String? = null, sub: String? = null) {
    var current by rememberSaveable { mutableStateOf(HUB_TABS.firstOrNull { it.key == tab }?.key ?: "inicio") }
    var createParty by rememberSaveable { mutableStateOf(false) }
    var phoneClips by rememberSaveable { mutableStateOf(sub == "celular") }
    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        PcTopBar(
            "Game Hub", Icons.Outlined.SportsEsports,
            navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } },
            actions = { IconButton(onClick = { nav.games("me") }) { Icon(Icons.AutoMirrored.Outlined.LibraryBooks, "Minha biblioteca", tint = PC.Text) } },
        )
        HubTabRow(current) { current = it; createParty = false }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (current) {
                "promocoes" -> DealsTab(repo, nav)
                "partidas" -> PartiesTab(repo, nav, highlight = party, startCreating = createParty)
                "clipes" -> ClipsTab(repo, nav, startOnPhone = phoneClips)
                "builds" -> BuildsTab(repo, nav)
                "mods" -> ModsTab(repo, nav)
                else -> HomeTab(repo, nav) { key, extra ->
                    if (key == "partidas") createParty = extra
                    if (key == "clipes") phoneClips = extra
                    current = key
                }
            }
        }
    }
}

@Composable
private fun HomeTab(repo: Repository, nav: AppNav, go: (String, Boolean) -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val hot = rememberLoader("hot") { repo.api.get<HotlistResponse>("/api/game-hub/hotlist") }
    val deals = rememberLoader("deals") { repo.api.get<DealsResponse>("/api/game-hub/deals") }
    val parties = rememberLoader("parties") { repo.api.get<PartiesResponse>("/api/game-hub/parties").parties }
    val clips = rememberLoader("clips") { repo.api.get<ClipsResponse>("/api/game-hub/clips").clips }
    val builds = rememberLoader("builds") { repo.api.get<BuildsResponse>("/api/game-hub/builds?sort=top").builds }
    HubHomeContent(
        hot.data, deals.data, parties.data, clips.data, builds.data,
        onGo = go,
        onOpenUrl = { nav.external(it) },
        onBuild = { nav.route("gamehub/build/${it.id}") },
        onClip = { c -> openVideo(ctx, nav, c.url) },
    )
}

/** Início do Game Hub: atalhos, mais jogados do mês, grátis, partidas, clipes e builds. */
@Composable
fun HubHomeContent(
    hot: HotlistResponse?,
    deals: DealsResponse?,
    parties: List<GameParty>?,
    clips: List<GameClip>?,
    builds: List<GameBuild>?,
    onGo: (String, Boolean) -> Unit,
    onOpenUrl: (String) -> Unit,
    onBuild: (GameBuild) -> Unit,
    onClip: (GameClip) -> Unit,
) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        item(key = "hero") {
            val shape = RoundedCornerShape(24.dp)
            Column(Modifier.fillMaxWidth().clip(shape).background(HubGradient).border(1.dp, HubViolet.copy(alpha = 0.35f), shape).padding(18.dp)) {
                Text("Bora jogar?", color = Color.White, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Black)
                Spacer(Modifier.height(4.dp))
                Text("Monte a partida, grave a jogada e ponha mods — tudo pelo celular.", color = Color.White.copy(alpha = 0.8f), style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    QuickAction("Partida", Icons.Outlined.Add, Modifier.weight(1f)) { onGo("partidas", true) }
                    QuickAction("Gravar", Icons.Outlined.FiberManualRecord, Modifier.weight(1f)) { onGo("clipes", true) }
                    QuickAction("Mods", Icons.Outlined.Extension, Modifier.weight(1f)) { onGo("mods", false) }
                }
            }
        }
        item(key = "hot") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SectionHead("Mais jogados do mês")
                val games = hot?.games.orEmpty()
                when {
                    hot == null -> Text("Carregando…", color = PC.Faint)
                    games.isEmpty() -> Text("Ninguém registrou tempo de jogo este mês ainda. O app do PC conta sozinho.", color = PC.Muted, style = MaterialTheme.typography.bodyMedium)
                    else -> games.take(5).forEach { HotRow(it) }
                }
            }
        }
        val free = deals?.free.orEmpty()
        if (free.isNotEmpty()) item(key = "free") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SectionHead("Grátis agora", action = "Promoções", onAction = { onGo("promocoes", false) })
                LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(free) { d -> FreeCard(d, Modifier.width(250.dp)) { d.url?.let(onOpenUrl) } }
                }
            }
        }
        item(key = "parties") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SectionHead("Partidas abertas", action = "Ver todas", onAction = { onGo("partidas", false) })
                val list = parties.orEmpty()
                if (parties != null && list.isEmpty()) {
                    PillButton("Abrir a primeira partida", { onGo("partidas", true) }, Modifier.fillMaxWidth(), icon = Icons.Outlined.Add, color = HubVioletDeep)
                }
                list.take(3).forEach { p -> PartyRow(p) { onGo("partidas", false) } }
            }
        }
        val clipList = clips.orEmpty()
        if (clipList.isNotEmpty()) item(key = "clips") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SectionHead("Clipes do clube", action = "Ver todos", onAction = { onGo("clipes", false) })
                LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(clipList.take(8), key = { it.id }) { c -> ClipMini(c) { onClip(c) } }
                }
            }
        }
        val topBuilds = builds.orEmpty()
        if (topBuilds.isNotEmpty()) item(key = "builds") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SectionHead("Builds em alta", action = "Ver todas", onAction = { onGo("builds", false) })
                topBuilds.take(3).forEach { b -> BuildCard(b) { onBuild(b) } }
            }
        }
    }
}

@Composable
private fun QuickAction(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier.clip(RoundedCornerShape(16.dp)).background(Color(0x1FFFFFFF)).clickable(onClick = onClick).padding(vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, null, tint = Color.White, modifier = Modifier.size(22.dp))
        Spacer(Modifier.height(4.dp))
        Text(label, color = Color.White, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
private fun HotRow(g: HotGame) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(PC.Surface).padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "${g.position}", color = if (g.position == 1) PC.Yellow else PC.Muted,
            style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Black, modifier = Modifier.width(30.dp),
        )
        GameCover(g.name, Modifier.width(92.dp).height(43.dp), g.steamAppId, image = if (g.steamAppId == null) g.iconUrl else null, shape = RoundedCornerShape(10.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(g.name, color = PC.Header, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                "${g.players} ${if (g.players == 1) "jogador" else "jogadores"} · ${HubLogic.hours(g.seconds)}",
                color = PC.Muted, style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun ClipMini(c: GameClip, onClick: () -> Unit) {
    Column(Modifier.width(220.dp).clip(RoundedCornerShape(16.dp)).background(PC.Surface).clickable(onClick = onClick)) {
        Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f)) {
            GameCover(c.game?.name ?: c.title, Modifier.matchParentSize(), c.game?.steamAppId, image = c.thumb, shape = RoundedCornerShape(0.dp))
            Box(Modifier.align(Alignment.Center).size(40.dp).clip(CircleShape).background(Color(0x99000000)), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.PlayArrow, null, tint = Color.White)
            }
        }
        Column(Modifier.padding(10.dp)) {
            Text(c.title, color = PC.Header, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(listOfNotNull(c.author?.name, c.game?.name).joinToString(" · "), color = PC.Muted, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}
