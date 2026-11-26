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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.LibraryBooks
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.FiberManualRecord
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.SportsEsports
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.theme.PC

/**
 * Game Hub no celular (igual ao /jogos do site): Início, Promoções, Partidas,
 * Clipes, Builds e Mods, com o menu fixo embaixo. [tab] vem do link
 * (/jogos/partidas, /jogos/clipes...); [party] destaca uma partida (convite).
 */
@Composable
fun GameHubScreen(repo: Repository, nav: AppNav, tab: String? = null, party: String? = null, sub: String? = null) {
    var current by rememberSaveable { mutableStateOf(HUB_TABS.firstOrNull { it.key == tab }?.key ?: "inicio") }
    var createParty by rememberSaveable { mutableStateOf(false) }
    var phoneClips by rememberSaveable { mutableStateOf(sub == "celular") }
    // Partidas abertas: número no menu e no atalho do Início.
    val parties = rememberLoader("hub-parties") { repo.api.get<PartiesResponse>("/api/game-hub/parties").parties }
    val t = hubTab(current)
    fun go(key: String, extra: Boolean) {
        if (key == "partidas") createParty = extra
        if (key == "clipes") phoneClips = extra
        current = key
    }
    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        PcTopBar(
            if (current == "inicio") "Game Hub" else t.label, if (current == "inicio") Icons.Outlined.SportsEsports else t.icon,
            navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } },
            actions = { IconButton(onClick = { nav.games("me") }) { Icon(Icons.AutoMirrored.Outlined.LibraryBooks, "Minha biblioteca", tint = PC.Text) } },
        )
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (current) {
                "promocoes" -> DealsTab(repo, nav)
                "partidas" -> PartiesTab(repo, nav, highlight = party, startCreating = createParty, onChanged = { parties.reload() })
                "clipes" -> ClipsTab(repo, nav, startOnPhone = phoneClips)
                "builds" -> BuildsTab(repo, nav)
                "mods" -> ModsTab(repo, nav)
                else -> HomeTab(repo, nav, parties.data) { key, extra -> go(key, extra) }
            }
        }
        HubBottomBar(current, { go(it, false) }, badges = mapOf("partidas" to (parties.data?.count { !it.inside } ?: 0)))
    }
}

@Composable
private fun HomeTab(repo: Repository, nav: AppNav, parties: List<GameParty>?, go: (String, Boolean) -> Unit) {
    val ctx = LocalContext.current
    val hot = rememberLoader("hot") { repo.api.get<HotlistResponse>("/api/game-hub/hotlist") }
    val deals = rememberLoader("deals") { repo.api.get<DealsResponse>("/api/game-hub/deals") }
    val clips = rememberLoader("clips") { repo.api.get<ClipsResponse>("/api/game-hub/clips").clips }
    val builds = rememberLoader("builds") { repo.api.get<BuildsResponse>("/api/game-hub/builds?sort=top").builds }
    val detected = rememberDetectedGames(repo)
    val me by repo.me.collectAsState()
    // Já baixa as capas das promoções (a aba abre com as imagens prontas).
    LaunchedEffect(deals.data) {
        deals.data?.let { d -> prefetchCovers(ctx, (d.free + d.upcoming + d.deals).map { it.image }) }
    }
    HubHomeContent(
        hot.data, deals.data, parties, clips.data, builds.data, detected?.count { it.moddable }, me?.name,
        onGo = go,
        onOpenUrl = { nav.external(it) },
        onBuild = { nav.route("gamehub/build/${it.id}") },
        onClip = { c -> openVideo(ctx, nav, c.url) },
        onLibrary = { nav.games("me") },
    )
}

/** Atalho grande do Início pra uma seção. */
private class HubShortcut(val key: String, val title: String, val subtitle: String, val icon: ImageVector, val color: Color)

/** Início do Game Hub: atalhos pra tudo, mais jogados do mês, grátis, partidas, clipes e builds. */
@Composable
fun HubHomeContent(
    hot: HotlistResponse?,
    deals: DealsResponse?,
    parties: List<GameParty>?,
    clips: List<GameClip>?,
    builds: List<GameBuild>?,
    moddable: Int?,
    meName: String?,
    onGo: (String, Boolean) -> Unit,
    onOpenUrl: (String) -> Unit,
    onBuild: (GameBuild) -> Unit,
    onClip: (GameClip) -> Unit,
    onLibrary: () -> Unit = {},
    listState: LazyListState = rememberLazyListState(),
) {
    val free = deals?.free.orEmpty()
    val open = parties.orEmpty()
    val shortcuts = listOf(
        HubShortcut(
            "partidas", "Partidas",
            when { parties == null -> "Junte a galera"; open.isEmpty() -> "Crie a primeira"; open.size == 1 -> "1 aberta agora"; else -> "${open.size} abertas agora" },
            hubTab("partidas").icon, hubTab("partidas").color,
        ),
        HubShortcut(
            "mods", "Mods",
            when (moddable) { null -> "Jogos do celular"; 0 -> "Minecraft e outros"; 1 -> "1 jogo seu aceita"; else -> "$moddable jogos seus aceitam" },
            hubTab("mods").icon, hubTab("mods").color,
        ),
        HubShortcut("clipes", "Clipes", "Grave a jogada", hubTab("clipes").icon, hubTab("clipes").color),
        HubShortcut("builds", "Builds", "LoL, Deadlock e mais", hubTab("builds").icon, hubTab("builds").color),
        HubShortcut(
            "promocoes", "Promoções",
            if (free.isNotEmpty()) "${free.size} grátis agora" else "Steam, GOG e Epic",
            hubTab("promocoes").icon, hubTab("promocoes").color,
        ),
        HubShortcut("biblioteca", "Biblioteca", "Seu tempo de jogo", Icons.Outlined.Timer, Color(0xFFF5C518)),
    )
    LazyColumn(Modifier.fillMaxSize(), state = listState, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
        item(key = "hero") {
            val shape = RoundedCornerShape(26.dp)
            Box(Modifier.fillMaxWidth().clip(shape).background(HubGradient).border(1.dp, HubViolet.copy(alpha = 0.35f), shape)) {
                Icon(
                    Icons.Outlined.SportsEsports, null, tint = Color.White.copy(alpha = 0.07f),
                    modifier = Modifier.align(Alignment.TopEnd).offset(x = 26.dp, y = (-18).dp).size(150.dp).rotate(-14f),
                )
                Column(Modifier.padding(20.dp)) {
                    Text(meName?.let { "E aí, ${it.substringBefore(' ')}!" } ?: "E aí!", color = Color.White.copy(alpha = 0.75f), style = MaterialTheme.typography.labelLarge)
                    Text("Bora jogar?", color = Color.White, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Black)
                    Spacer(Modifier.height(14.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        HeroButton("Criar partida", Icons.Outlined.Add, filled = true, modifier = Modifier.weight(1f)) { onGo("partidas", true) }
                        HeroButton("Gravar clipe", Icons.Outlined.FiberManualRecord, filled = false, modifier = Modifier.weight(1f)) { onGo("clipes", true) }
                    }
                }
            }
        }
        item(key = "shortcuts") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                shortcuts.chunked(2).forEach { pair ->
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        pair.forEach { s ->
                            ShortcutTile(s, Modifier.weight(1f)) { if (s.key == "biblioteca") onLibrary() else onGo(s.key, false) }
                        }
                    }
                }
            }
        }
        item(key = "hot") {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SectionHead("Mais jogados do mês", color = Color(0xFFF5C518))
                val games = hot?.games.orEmpty()
                when {
                    hot == null -> Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        repeat(3) { Box(Modifier.width(124.dp).aspectRatio(2f / 3f).clip(RoundedCornerShape(16.dp)).background(PC.Surface)) }
                    }
                    games.isEmpty() -> Text("Ninguém registrou tempo de jogo este mês ainda. O app do PC conta sozinho.", color = PC.Muted, style = MaterialTheme.typography.bodyMedium)
                    else -> LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        items(games.take(5), key = { it.gameKey }) { HotPoster(it) }
                    }
                }
            }
        }
        if (free.isNotEmpty()) item(key = "free") {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SectionHead("Grátis agora", action = "Promoções", color = hubTab("promocoes").color, onAction = { onGo("promocoes", false) })
                LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(free) { d -> FreeCard(d, Modifier.width(260.dp)) { d.url?.let(onOpenUrl) } }
                }
            }
        }
        item(key = "parties") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SectionHead("Partidas abertas", action = "Ver todas", color = hubTab("partidas").color, onAction = { onGo("partidas", false) })
                if (parties != null && open.isEmpty()) EmptyHint("Nenhuma partida aberta agora.", "Criar partida") { onGo("partidas", true) }
                open.take(3).forEach { p -> PartyRow(p) { onGo("partidas", false) } }
            }
        }
        val clipList = clips.orEmpty()
        if (clipList.isNotEmpty()) item(key = "clips") {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SectionHead("Clipes do clube", action = "Ver todos", color = hubTab("clipes").color, onAction = { onGo("clipes", false) })
                LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(clipList.take(8), key = { it.id }) { c -> ClipMini(c) { onClip(c) } }
                }
            }
        }
        val topBuilds = builds.orEmpty()
        if (topBuilds.isNotEmpty()) item(key = "builds") {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SectionHead("Builds em alta", action = "Ver todas", color = hubTab("builds").color, onAction = { onGo("builds", false) })
                topBuilds.take(3).forEach { b -> BuildCard(b) { onBuild(b) } }
            }
        }
    }
}

@Composable
private fun HeroButton(text: String, icon: ImageVector, filled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Row(
        modifier.height(46.dp).clip(CircleShape)
            .background(if (filled) Color.White else Color.White.copy(alpha = 0.12f))
            .clickable(onClick = onClick).padding(horizontal = 14.dp),
        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
    ) {
        val fg = if (filled) Color(0xFF1C0D38) else Color.White
        Icon(icon, null, tint = if (filled) fg else Color(0xFFFF5C7A), modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text(text, color = fg, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

@Composable
private fun ShortcutTile(s: HubShortcut, modifier: Modifier, onClick: () -> Unit) {
    val shape = RoundedCornerShape(20.dp)
    Box(
        modifier.height(100.dp).clip(shape)
            .background(Brush.linearGradient(listOf(s.color.copy(alpha = 0.24f), PC.Surface)))
            .border(1.dp, s.color.copy(alpha = 0.30f), shape)
            .clickable(onClick = onClick),
    ) {
        Icon(s.icon, null, tint = s.color.copy(alpha = 0.12f), modifier = Modifier.align(Alignment.BottomEnd).offset(x = 14.dp, y = 14.dp).size(80.dp))
        Column(Modifier.padding(14.dp)) {
            Box(Modifier.size(34.dp).clip(RoundedCornerShape(11.dp)).background(s.color), contentAlignment = Alignment.Center) {
                Icon(s.icon, null, tint = Color(0xFF111114), modifier = Modifier.size(20.dp))
            }
            Spacer(Modifier.height(8.dp))
            Text(s.title, color = PC.Header, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, maxLines = 1)
            Text(s.subtitle, color = PC.Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun EmptyHint(text: String, action: String, onClick: () -> Unit) {
    val shape = RoundedCornerShape(18.dp)
    Row(
        Modifier.fillMaxWidth().clip(shape).background(PC.Surface).border(1.dp, PC.Line, shape).padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, color = PC.Muted, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Text(
            action, color = HubViolet, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold,
            modifier = Modifier.clip(CircleShape).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 10.dp),
        )
    }
}

/** Cartaz do "Mais jogados do mês": capa em pé com a posição grande. */
@Composable
private fun HotPoster(g: HotGame) {
    Column(Modifier.width(124.dp)) {
        Box(Modifier.fillMaxWidth().aspectRatio(2f / 3f)) {
            GamePoster(g.name, Modifier.matchParentSize(), g.steamAppId, g.cover, g.coverTall, image = if (g.steamAppId == null) g.iconUrl else null)
            Box(Modifier.matchParentSize().clip(RoundedCornerShape(16.dp)).background(Brush.verticalGradient(0.55f to Color.Transparent, 1f to Color(0xD9000000))))
            Text(
                "${g.position}",
                style = TextStyle(
                    color = if (g.position == 1) Color(0xFFF5C518) else Color.White, fontSize = 44.sp, fontWeight = FontWeight.Black,
                    shadow = Shadow(Color.Black, blurRadius = 12f),
                ),
                modifier = Modifier.align(Alignment.BottomStart).padding(start = 8.dp),
            )
        }
        Spacer(Modifier.height(8.dp))
        Text(g.name, color = PC.Header, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(
            "${g.players} ${if (g.players == 1) "jogador" else "jogadores"} · ${HubLogic.hours(g.seconds)}",
            color = PC.Muted, style = MaterialTheme.typography.labelSmall, maxLines = 1,
        )
    }
}

@Composable
private fun ClipMini(c: GameClip, onClick: () -> Unit) {
    val shape = RoundedCornerShape(18.dp)
    Column(Modifier.width(230.dp).clip(shape).background(PC.Surface).border(1.dp, PC.Line, shape).clickable(onClick = onClick)) {
        Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f)) {
            GameCover(
                c.game?.name ?: c.title, Modifier.matchParentSize(), c.game?.steamAppId, image = c.thumb, shape = RoundedCornerShape(0.dp),
                cover = c.game?.cover, coverTall = c.game?.coverTall == true,
            )
            Box(Modifier.align(Alignment.Center).size(42.dp).clip(CircleShape).background(Color(0x99000000)), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.PlayArrow, null, tint = Color.White)
            }
        }
        Column(Modifier.padding(10.dp)) {
            Text(c.title, color = PC.Header, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(listOfNotNull(c.author?.name, c.game?.name).joinToString(" · "), color = PC.Muted, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}
