package com.projectclub.android.ui.progress

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.CardGiftcard
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.EmojiEvents
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.MilitaryTech
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.data.ProgressAchievement
import com.projectclub.android.data.ProgressAchievementsResponse
import com.projectclub.android.data.PROGRESS_LEVEL_REWARDS
import com.projectclub.android.data.ProgressLeader
import com.projectclub.android.data.ProgressLeaderboardResponse
import com.projectclub.android.data.ProgressLevelReward
import com.projectclub.android.data.ProgressRank
import com.projectclub.android.data.Repository
import com.projectclub.android.data.User
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.Bone
import com.projectclub.android.ui.common.Chip
import com.projectclub.android.ui.common.EmptyState
import com.projectclub.android.ui.common.GhostButton
import com.projectclub.android.ui.common.HeroBox
import com.projectclub.android.ui.common.ListSkeleton
import com.projectclub.android.ui.common.PcCard
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.common.instantOf
import com.projectclub.android.ui.common.rememberShimmer
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.theme.Display
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.net.URLEncoder
import java.text.NumberFormat
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/*
 * Progresso (igual à ProgressPage do site): cartão com o seu nível/XP sempre
 * no topo e três abas — Ranking, Conquistas e Recompensas.
 *
 * Rotas: GET /api/economy/rank, GET /api/economy/leaderboard, GET /api/achievements.
 * As recompensas por nível são um catálogo fixo (sem rota de resgate), como no site.
 */

private const val TAB_RANKS = 0
private const val TAB_ACHIEVEMENTS = 1
private const val TAB_REWARDS = 2

private val ptBR: Locale = Locale.forLanguageTag("pt-BR")
private fun fmt(n: Number?): String = NumberFormat.getIntegerInstance(ptBR).format(n ?: 0)
private val dateFmt: DateTimeFormatter = DateTimeFormatter.ofPattern("dd/MM/yyyy", ptBR)
private fun formatDate(iso: String?): String? =
    instantOf(iso)?.atZone(ZoneId.systemDefault())?.format(dateFmt)

private val RARITIES = listOf("COMMON", "RARE", "EPIC", "LEGENDARY")
private fun rarityLabel(r: String?): String = when (r) {
    "RARE" -> "Rara"; "EPIC" -> "Épica"; "LEGENDARY" -> "Lendária"; else -> "Comum"
}
private fun rarityColor(r: String?): Color = when (r) {
    "RARE" -> Color(0xFF4C9FFF); "EPIC" -> Color(0xFFB463FF); "LEGENDARY" -> Color(0xFFFFB02E); else -> Color(0xFF9AA0A6)
}

private val GOLD = Color(0xFFFFC94D)
private val SILVER = Color(0xFFC9D1DB)
private val BRONZE = Color(0xFFD08A52)
private fun placeColor(place: Int): Color = when (place) { 1 -> GOLD; 2 -> SILVER; else -> BRONZE }

/** Categoria amigável por progressType (mesma do site, achievementCategory.js). */
private fun categoryFor(type: String?): String = when (type) {
    "POSTS_CREATED", "POST_UPS_RECEIVED", "COMMENTS_CREATED", "COMMENT_UPS_RECEIVED" -> "Fórum"
    "PROFILE_UPS_RECEIVED", "TESTIMONIALS_RECEIVED", "SCRAPS_RECEIVED", "FANS_COUNT", "PHOTOS_UPLOADED" -> "Perfil"
    "FRIENDS_COUNT" -> "Amizades"
    "ACCOUNT_LEVEL", "DAILY_STREAK" -> "Progresso"
    "MESSAGES_SENT", "REACTIONS_GIVEN", "EMOJIS_CREATED" -> "Comunicação"
    else -> if (type != null && type.startsWith("CARDS_")) "Guerra das Cartas" else "Outras"
}
private val CATEGORY_ORDER = listOf("Fórum", "Perfil", "Amizades", "Comunicação", "Guerra das Cartas", "Progresso", "Outras")

/** Imagens do bucket/CDNs externos passam pelo proxy do servidor (igual ao proxyImage do site). */
private val PROXIED_HOSTS = Regex(
    "^https://([a-z0-9-]+\\.)*(backblazeb2\\.com|modcdn\\.io|mod\\.io|gamebanana\\.com|thunderstore\\.io|nexusmods\\.com|nexus-cdn\\.com|steamstatic\\.com|steamusercontent\\.com|akamaihd\\.net)/",
    RegexOption.IGNORE_CASE,
)
private fun imageUrl(url: String?): String? {
    val u = Config.media(url) ?: return null
    return if (PROXIED_HOSTS.containsMatchIn(u)) Config.baseUrl + "/api/proxy/image?url=" + URLEncoder.encode(u, "UTF-8") else u
}

private fun tabFrom(initial: String?): Int = when (initial?.lowercase()) {
    "conquistas", "achievements" -> TAB_ACHIEVEMENTS
    "recompensas", "rewards" -> TAB_REWARDS
    else -> TAB_RANKS
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProgressScreen(repo: Repository, nav: AppNav, initialTab: String?) {
    val me by repo.me.collectAsState()
    val scope = rememberCoroutineScope()
    var tab by rememberSaveable { mutableIntStateOf(tabFrom(initialTab)) }

    var rank by remember { mutableStateOf<ProgressRank?>(null) }
    var rankError by remember { mutableStateOf<String?>(null) }
    var leaderboard by remember { mutableStateOf<List<ProgressLeader>?>(null) }
    var leaderboardError by remember { mutableStateOf<String?>(null) }
    var achievements by remember { mutableStateOf<List<ProgressAchievement>?>(null) }
    var achievementsError by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    // Cada parte carrega sozinha; uma falha não apaga o que já estava na tela.
    suspend fun loadRank() {
        try { rank = repo.api.get<ProgressRank>("/api/economy/rank"); rankError = null }
        catch (e: Exception) { if (rank == null) rankError = e.message ?: "Não deu para carregar." }
    }
    suspend fun loadLeaderboard() {
        try { leaderboard = repo.api.get<ProgressLeaderboardResponse>("/api/economy/leaderboard").leaderboard; leaderboardError = null }
        catch (e: Exception) { if (leaderboard == null) leaderboardError = e.message ?: "Não deu para carregar." }
    }
    suspend fun loadAchievements() {
        try { achievements = repo.api.get<ProgressAchievementsResponse>("/api/achievements").achievements; achievementsError = null }
        catch (e: Exception) { if (achievements == null) achievementsError = e.message ?: "Não deu para carregar." }
    }
    suspend fun loadAll() {
        val a = scope.async { loadRank() }
        val b = scope.async { loadLeaderboard() }
        val c = scope.async { loadAchievements() }
        a.await(); b.await(); c.await()
    }

    LaunchedEffect(Unit) {
        loadAll()
        // Atualização leve enquanto a tela está aberta (o site faz o mesmo).
        var tick = 0
        while (true) {
            delay(15_000)
            tick++
            loadRank()
            loadLeaderboard()
            if (tick % 2 == 0) loadAchievements()
        }
    }

    val level = me?.accountLevel ?: rank?.level ?: 1
    val unlockedCount = achievements?.count { it.unlocked } ?: 0
    val rewardsUnlocked = PROGRESS_LEVEL_REWARDS.count { level >= it.level }
    val achievementsCount = achievements?.let { "$unlockedCount/${it.size}" }
    val rewardsCount = "$rewardsUnlocked/${PROGRESS_LEVEL_REWARDS.size}"

    // Filtros das conquistas ficam aqui para sobreviver à troca de aba.
    var statusFilter by rememberSaveable { mutableStateOf("ALL") }
    var rarityFilter by rememberSaveable { mutableStateOf("ALL") }
    var openAchievement by remember { mutableStateOf<ProgressAchievement?>(null) }

    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        PcTopBar(
            "Progresso", Icons.Outlined.EmojiEvents,
            navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } },
        )
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { scope.launch { refreshing = true; loadAll(); refreshing = false } },
            modifier = Modifier.fillMaxSize(),
        ) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item(key = "hero") {
                    ProgressHero(me, rank, rankError, level, unlockedCount, achievements?.size)
                }
                item(key = "tabs") {
                    Column {
                        Spacer(Modifier.height(4.dp))
                        ProgressTabs(
                            listOf(
                                Triple(Icons.Outlined.EmojiEvents, "Ranking", null),
                                Triple(Icons.Outlined.MilitaryTech, "Conquistas", achievementsCount),
                                Triple(Icons.Outlined.CardGiftcard, "Recompensas", rewardsCount),
                            ),
                            tab,
                        ) { tab = it }
                        Spacer(Modifier.height(4.dp))
                    }
                }

                when (tab) {
                    TAB_RANKS -> {
                        val list = leaderboard
                        when {
                            list == null && leaderboardError != null -> item(key = "lb-err") {
                                ErrorBox(leaderboardError!!) { scope.launch { loadLeaderboard() } }
                            }
                            list == null -> item(key = "lb-load") { ListSkeleton(6, 40.dp) }
                            list.isEmpty() -> item(key = "lb-empty") {
                                EmptyState(Icons.Outlined.EmojiEvents, "Ninguém no ranking ainda", "Converse e participe da comunidade para aparecer aqui.")
                            }
                            else -> {
                                val top = list.filter { !it.outsideTop50 }
                                val podium = top.take(3)
                                val rest = top.drop(3)
                                val meOutside = list.firstOrNull { it.outsideTop50 }
                                item(key = "podium") { Podium(podium, me?.id) { nav.profile(it) } }
                                itemsIndexed(rest, key = { _, u -> "r-" + u.id }) { i, u ->
                                    RankRow(u, i + 4, u.id == me?.id) { nav.profile(u.id) }
                                }
                                if (meOutside != null) {
                                    item(key = "gap") {
                                        Text("•••", color = PC.Faint, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp))
                                    }
                                    item(key = "me-out") {
                                        RankRow(meOutside, rank?.position, true) { nav.profile(meOutside.id) }
                                    }
                                }
                            }
                        }
                    }

                    TAB_ACHIEVEMENTS -> {
                        val list = achievements
                        when {
                            list == null && achievementsError != null -> item(key = "ach-err") {
                                ErrorBox(achievementsError!!) { scope.launch { loadAchievements() } }
                            }
                            list == null -> item(key = "ach-load") { GridSkeleton() }
                            list.isEmpty() -> item(key = "ach-empty") {
                                EmptyState(Icons.Outlined.MilitaryTech, "Nenhuma conquista cadastrada", "Assim que a equipe criar conquistas, elas aparecem aqui.")
                            }
                            else -> {
                                item(key = "rarity") {
                                    RaritySummary(list, rarityFilter) { r -> rarityFilter = if (rarityFilter == r) "ALL" else r }
                                }
                                item(key = "filters") {
                                    StatusFilters(statusFilter, rarityFilter, { statusFilter = it }, { rarityFilter = "ALL" })
                                }
                                val grouped = groupAchievements(list, statusFilter, rarityFilter)
                                if (grouped.isEmpty()) item(key = "ach-none") {
                                    EmptyState(Icons.Outlined.SearchOff, "Nada com esses filtros", "Tente outra combinação de filtros.")
                                }
                                grouped.forEach { (category, group) ->
                                    item(key = "cat-$category") {
                                        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                            Text(category, color = PC.Header, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                                            Text("${group.count { it.unlocked }}/${group.size}", color = PC.Muted, style = MaterialTheme.typography.labelLarge)
                                        }
                                    }
                                    items(group.chunked(2), key = { row -> "ach-" + row.joinToString("|") { it.id } }) { row ->
                                        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                            row.forEach { a ->
                                                AchievementCard(a, Modifier.weight(1f)) { openAchievement = a }
                                            }
                                            if (row.size == 1) Spacer(Modifier.weight(1f))
                                        }
                                    }
                                }
                            }
                        }
                    }

                    else -> {
                        item(key = "rewards") { Rewards(level, rank) }
                    }
                }

                item(key = "bottom") { Spacer(Modifier.navigationBarsPadding().height(8.dp)) }
            }
        }
    }

    openAchievement?.let { a ->
        AchievementDialog(a) { openAchievement = null }
    }
}

private fun groupAchievements(list: List<ProgressAchievement>, status: String, rarity: String): List<Pair<String, List<ProgressAchievement>>> {
    val filtered = list.filter { a ->
        (status != "UNLOCKED" || a.unlocked) && (status != "LOCKED" || !a.unlocked) && (rarity == "ALL" || a.rarity == rarity)
    }
    // Mais perto de completar primeiro; desbloqueadas no fim.
    fun score(a: ProgressAchievement): Float = if (a.unlocked) 2f else 1f - a.fraction
    val by = filtered.groupBy { categoryFor(it.progressType) }
    return CATEGORY_ORDER.mapNotNull { c -> by[c]?.takeIf { it.isNotEmpty() }?.let { c to it.sortedBy { a -> score(a) } } }
}

/* ---------------- Cabeçalho com o seu nível ---------------- */

@Composable
private fun ProgressHero(me: User?, rank: ProgressRank?, rankError: String?, level: Int, unlocked: Int, totalAchievements: Int?) {
    val target = if (rank?.isMaxLevel == true) 1f else ((rank?.progress ?: 0) / 100f).coerceIn(0f, 1f)
    val pct by animateFloatAsState(target, tween(700), label = "xp")
    HeroBox(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(84.dp)) {
                    Avatar(me, 78.dp, modifier = Modifier.align(Alignment.TopStart))
                    Box(
                        Modifier.align(Alignment.BottomEnd).heightIn(min = 30.dp).widthIn(min = 30.dp)
                            .clip(CircleShape).background(PC.Brand).border(3.dp, PC.BrandDark, CircleShape)
                            .padding(horizontal = 6.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("$level", color = PC.OnBrand, fontWeight = FontWeight.ExtraBold, fontSize = 14.sp)
                    }
                }
                Spacer(Modifier.width(16.dp))
                Column(Modifier.weight(1f)) {
                    Text("SEU PROGRESSO", color = Color(0xB3FFFFFF), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                    Text(
                        me?.name ?: "Você", color = Color.White, fontFamily = Display, fontSize = 32.sp,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        rank?.levelTitle?.takeIf { it.isNotBlank() }?.let { HeroChip(it, Icons.Outlined.Star, highlight = true) }
                        rank?.levelName?.takeIf { it.isNotBlank() }?.let { HeroChip(it, null, highlight = false) }
                    }
                }
            }

            Spacer(Modifier.height(18.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    when {
                        rank == null -> if (rankError != null) "Nível $level" else "Carregando…"
                        rank.isMaxLevel -> "Nível máximo!"
                        else -> "Nível $level → ${rank.nextLevel ?: level + 1}"
                    },
                    color = Color.White, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f),
                )
                if (rank != null && !rank.isMaxLevel) {
                    Text("${fmt(rank.xpInLevel)} / ${fmt(rank.xpNeeded)} XP", color = Color(0xCCFFFFFF), style = MaterialTheme.typography.labelLarge)
                }
            }
            Spacer(Modifier.height(8.dp))
            Box(Modifier.fillMaxWidth().height(12.dp).clip(CircleShape).background(Color(0x55000000))) {
                Box(
                    Modifier.fillMaxHeight().fillMaxWidth(pct).clip(CircleShape)
                        .background(Brush.horizontalGradient(listOf(Color(0xFF7FC0FF), Color.White))),
                )
            }
            if (rank != null && !rank.isMaxLevel) {
                Spacer(Modifier.height(8.dp))
                Text(
                    "Faltam ${fmt((rank.xpNeeded - rank.xpInLevel).coerceAtLeast(0L))} XP para o próximo nível. Conversar, postar e participar de eventos rende XP.",
                    color = Color(0xCCFFFFFF), style = MaterialTheme.typography.bodySmall,
                )
            } else if (rank == null && rankError != null) {
                Spacer(Modifier.height(8.dp))
                Text(rankError, color = Color(0xCCFFFFFF), style = MaterialTheme.typography.bodySmall)
            }

            Spacer(Modifier.height(16.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                HeroStat(Icons.Outlined.EmojiEvents, "Posição", rank?.position?.let { "#${fmt(it)}" } ?: "—", Modifier.weight(1f))
                HeroStat(Icons.Outlined.Bolt, "XP total", rank?.let { fmt(it.xp) } ?: "—", Modifier.weight(1f))
                HeroStat(Icons.Outlined.MilitaryTech, "Conquistas", totalAchievements?.let { "$unlocked/$it" } ?: "—", Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun HeroChip(text: String, icon: ImageVector?, highlight: Boolean) {
    Row(
        Modifier.clip(CircleShape).background(if (highlight) Color(0x33FFFFFF) else Color(0x22000000))
            .padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) { Icon(icon, null, tint = Color.White, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(4.dp)) }
        Text(text, color = Color.White, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

@Composable
private fun HeroStat(icon: ImageVector, label: String, value: String, modifier: Modifier) {
    Column(modifier.clip(RoundedCornerShape(14.dp)).background(Color(0x33000000)).padding(horizontal = 10.dp, vertical = 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, tint = Color(0xB3FFFFFF), modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(4.dp))
            Text(label, color = Color(0xB3FFFFFF), style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.height(2.dp))
        Text(value, color = Color.White, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/* ---------------- Abas ---------------- */

@Composable
private fun ProgressTabs(items: List<Triple<ImageVector, String, String?>>, selected: Int, onSelect: (Int) -> Unit) {
    val shape = RoundedCornerShape(18.dp)
    Row(Modifier.fillMaxWidth().clip(shape).background(PC.Surface).border(1.dp, PC.Line, shape).padding(5.dp)) {
        items.forEachIndexed { i, (icon, label, count) ->
            val on = i == selected
            val bg by animateColorAsState(if (on) PC.Surface3 else Color.Transparent, label = "tab")
            Column(
                Modifier.weight(1f).clip(RoundedCornerShape(14.dp)).background(bg).clickable { onSelect(i) }.padding(vertical = 9.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(icon, null, tint = if (on) PC.Brand else PC.Muted, modifier = Modifier.size(18.dp))
                    if (count != null) {
                        Spacer(Modifier.width(5.dp))
                        Text(count, color = if (on) PC.Brand else PC.Faint, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                    }
                }
                Spacer(Modifier.height(3.dp))
                Text(label, color = if (on) PC.Header else PC.Muted, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/* ---------------- Ranking ---------------- */

@Composable
private fun Podium(podium: List<ProgressLeader>, myId: String?, onOpen: (String) -> Unit) {
    // Ordem visual 2º · 1º · 3º.
    val order = listOfNotNull(podium.getOrNull(1)?.let { it to 2 }, podium.getOrNull(0)?.let { it to 1 }, podium.getOrNull(2)?.let { it to 3 })
    PcCard(Modifier.fillMaxWidth(), padding = PaddingValues(start = 10.dp, end = 10.dp, top = 18.dp, bottom = 0.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
            order.forEach { (u, place) ->
                PodiumSpot(u, place, u.id == myId, Modifier.weight(1f)) { onOpen(u.id) }
            }
        }
    }
}

@Composable
private fun PodiumSpot(u: ProgressLeader, place: Int, isMe: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val color = placeColor(place)
    val avatar: Dp = if (place == 1) 72.dp else 58.dp
    val block: Dp = when (place) { 1 -> 74.dp; 2 -> 54.dp; else -> 40.dp }
    Column(modifier.clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)).clickable(onClick = onClick), horizontalAlignment = Alignment.CenterHorizontally) {
        if (place == 1) Icon(Icons.Outlined.EmojiEvents, null, tint = GOLD, modifier = Modifier.size(22.dp))
        Box(Modifier.size(avatar + 6.dp)) {
            Box(Modifier.size(avatar + 6.dp).clip(CircleShape).border(3.dp, color, CircleShape))
            Avatar(u.toUser(), avatar, modifier = Modifier.align(Alignment.Center))
            Box(
                Modifier.align(Alignment.BottomCenter).offset(y = 8.dp).size(24.dp).clip(CircleShape).background(color).border(2.dp, PC.Surface, CircleShape),
                contentAlignment = Alignment.Center,
            ) { Text("$place", color = Color(0xFF111214), fontWeight = FontWeight.ExtraBold, fontSize = 12.sp) }
        }
        Spacer(Modifier.height(12.dp))
        Text(
            u.name, color = if (isMe) PC.Brand else PC.Header, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold,
            maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
        )
        Text("Nv. ${u.accountLevel} · ${fmt(u.accountXp)} XP", color = PC.Muted, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.height(8.dp))
        Box(
            Modifier.fillMaxWidth().height(block).clip(RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp))
                .background(Brush.verticalGradient(listOf(color.copy(alpha = 0.35f), color.copy(alpha = 0.06f)))),
            contentAlignment = Alignment.TopCenter,
        ) {
            Text("$place", color = color, fontFamily = Display, fontSize = 28.sp, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

@Composable
private fun RankRow(u: ProgressLeader, pos: Int?, isMe: Boolean, onClick: () -> Unit) {
    PcCard(
        Modifier.fillMaxWidth(), onClick = onClick, padding = PaddingValues(horizontal = 14.dp, vertical = 10.dp),
        border = if (isMe) PC.Brand.copy(alpha = 0.55f) else PC.Line,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                pos?.let { "#${fmt(it)}" } ?: "—", color = if (isMe) PC.Brand else PC.Muted,
                fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.labelLarge, modifier = Modifier.widthIn(min = 40.dp),
            )
            Avatar(u.toUser(), 36.dp)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(u.name, color = PC.Header, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    if (isMe) { Spacer(Modifier.width(6.dp)); Chip("você", PC.Brand) }
                }
                Text("Nível ${u.accountLevel}", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
            }
            Text("${fmt(u.accountXp)} XP", color = PC.Text, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelLarge)
        }
    }
}

/* ---------------- Conquistas ---------------- */

@Composable
private fun RaritySummary(list: List<ProgressAchievement>, selected: String, onToggle: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        RARITIES.forEach { r ->
            val ofRarity = list.filter { it.rarity == r }
            if (ofRarity.isEmpty()) return@forEach
            val done = ofRarity.count { it.unlocked }
            val color = rarityColor(r)
            val on = selected == r
            val shape = RoundedCornerShape(16.dp)
            Column(
                Modifier.width(118.dp).clip(shape).background(if (on) color.copy(alpha = 0.14f) else PC.Surface)
                    .border(1.dp, if (on) color else PC.Line, shape).clickable { onToggle(r) }.padding(12.dp),
            ) {
                Text(rarityLabel(r), color = color, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                Row(verticalAlignment = Alignment.Bottom) {
                    Text("$done", color = PC.Header, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                    Text("/${ofRarity.size}", color = PC.Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(bottom = 3.dp))
                }
                Spacer(Modifier.height(6.dp))
                MiniBar(done.toFloat() / ofRarity.size, color)
            }
        }
    }
}

@Composable
private fun StatusFilters(status: String, rarity: String, onStatus: (String) -> Unit, onClearRarity: () -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("ALL" to "Todas", "UNLOCKED" to "Desbloqueadas", "LOCKED" to "Em andamento").forEach { (key, label) ->
            FilterPill(label, status == key, PC.Brand) { onStatus(key) }
        }
        if (rarity != "ALL") {
            val c = rarityColor(rarity)
            Row(
                Modifier.heightIn(min = 36.dp).clip(CircleShape).background(c.copy(alpha = 0.16f)).clickable(onClick = onClearRarity).padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(rarityLabel(rarity), color = c, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.width(4.dp))
                Icon(Icons.Outlined.Close, "Limpar raridade", tint = c, modifier = Modifier.size(16.dp))
            }
        }
    }
}

@Composable
private fun FilterPill(text: String, on: Boolean, color: Color, onClick: () -> Unit) {
    Box(
        Modifier.heightIn(min = 36.dp).clip(CircleShape)
            .background(if (on) color else PC.Surface)
            .border(1.dp, if (on) color else PC.LineStrong, CircleShape)
            .clickable(onClick = onClick).padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = if (on) Color.White else PC.Text, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun MiniBar(fraction: Float, color: Color, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(6.dp).clip(CircleShape).background(PC.Surface3)) {
        Box(Modifier.fillMaxHeight().fillMaxWidth(fraction.coerceIn(0f, 1f)).clip(CircleShape).background(color))
    }
}

@Composable
private fun AchievementIcon(a: ProgressAchievement, size: Dp) {
    val color = rarityColor(a.rarity)
    val url = imageUrl(a.iconUrl)
    var loaded by remember(url) { mutableStateOf(false) }
    val gray = remember { ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(0f) }) }
    Box(Modifier.size(size)) {
        Box(
            Modifier.fillMaxSize().clip(RoundedCornerShape(size * 0.28f))
                .background(Brush.linearGradient(listOf(color.copy(alpha = if (a.unlocked) 0.30f else 0.12f), PC.Surface2)))
                .border(1.dp, color.copy(alpha = if (a.unlocked) 0.6f else 0.25f), RoundedCornerShape(size * 0.28f)),
            contentAlignment = Alignment.Center,
        ) {
            val spec = com.projectclub.android.ui.common.StrokeIcons.achievement(a.key, a.progressType, a.rarity, a.iconUrl)
            if (spec != null) {
                // Ícone de traço da conquista (mesmo estilo do site).
                com.projectclub.android.ui.common.StrokeIconTile(spec.first, if (a.unlocked) spec.second else PC.Faint, size * 0.58f, tile = false)
            } else if (!loaded) {
                Icon(Icons.Outlined.MilitaryTech, null, tint = if (a.unlocked) color else PC.Faint, modifier = Modifier.size(size * 0.55f))
            }
            if (url != null) {
                AsyncImage(
                    model = url, contentDescription = null, contentScale = ContentScale.Fit,
                    colorFilter = if (a.unlocked) null else gray,
                    onSuccess = { loaded = true }, onError = { loaded = false },
                    modifier = Modifier.size(size * 0.72f).alpha(if (a.unlocked) 1f else 0.5f),
                )
            }
        }
        if (!a.unlocked) {
            Box(
                Modifier.align(Alignment.BottomEnd).offset(x = 4.dp, y = 4.dp).size(20.dp).clip(CircleShape)
                    .background(PC.Surface3).border(2.dp, PC.Surface, CircleShape),
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Outlined.Lock, null, tint = PC.Muted, modifier = Modifier.size(11.dp)) }
        }
    }
}

@Composable
private fun AchievementCard(a: ProgressAchievement, modifier: Modifier, onClick: () -> Unit) {
    val color = rarityColor(a.rarity)
    PcCard(
        modifier.fillMaxHeight(), onClick = onClick, padding = PaddingValues(12.dp),
        border = if (a.unlocked) color.copy(alpha = 0.45f) else PC.Line,
    ) {
        Row(verticalAlignment = Alignment.Top) {
            AchievementIcon(a, 48.dp)
            Spacer(Modifier.weight(1f))
            Text(
                rarityLabel(a.rarity), color = color, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold,
                modifier = Modifier.clip(CircleShape).background(color.copy(alpha = 0.14f)).padding(horizontal = 8.dp, vertical = 3.dp),
            )
        }
        Spacer(Modifier.height(10.dp))
        Text(a.name, color = if (a.unlocked) PC.Header else PC.Text, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.height(2.dp))
        Text(a.description, color = PC.Muted, style = MaterialTheme.typography.bodySmall, maxLines = 3, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.height(10.dp))
        if (a.unlocked) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Check, null, tint = PC.Green, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(4.dp))
                Text(formatDate(a.unlockedAt) ?: "Desbloqueada", color = PC.Green, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, maxLines = 1)
            }
        } else {
            MiniBar(a.fraction, color)
            Spacer(Modifier.height(4.dp))
            Text("${fmt(a.progress)}/${fmt(a.target)}", color = PC.Muted, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun AchievementDialog(a: ProgressAchievement, onDismiss: () -> Unit) {
    val color = rarityColor(a.rarity)
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = PC.Surface2,
        icon = { AchievementIcon(a, 72.dp) },
        title = { Text(a.name, color = PC.Header, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) },
        text = {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                Chip(rarityLabel(a.rarity), color)
                Spacer(Modifier.height(4.dp))
                Text(categoryFor(a.progressType), color = PC.Faint, style = MaterialTheme.typography.labelSmall)
                Spacer(Modifier.height(10.dp))
                Text(a.description, color = PC.Text, textAlign = TextAlign.Center)
                Spacer(Modifier.height(14.dp))
                if (a.unlocked) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Check, null, tint = PC.Green, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(
                            formatDate(a.unlockedAt)?.let { "Desbloqueada em $it" } ?: "Desbloqueada",
                            color = PC.Green, fontWeight = FontWeight.SemiBold,
                        )
                    }
                } else {
                    MiniBar(a.fraction, color)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "${fmt(a.progress)} de ${fmt(a.target)} · ${(a.fraction * 100).toInt()}%",
                        color = PC.Muted, style = MaterialTheme.typography.labelMedium,
                    )
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Fechar", color = PC.Brand) } },
    )
}

@Composable
private fun GridSkeleton() {
    val b = rememberShimmer()
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            repeat(3) { Bone(b, Modifier.width(118.dp).height(78.dp), RoundedCornerShape(16.dp)) }
        }
        repeat(3) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Bone(b, Modifier.weight(1f).height(170.dp), RoundedCornerShape(20.dp))
                Bone(b, Modifier.weight(1f).height(170.dp), RoundedCornerShape(20.dp))
            }
        }
    }
}

/* ---------------- Recompensas (trilha por nível) ---------------- */

@Composable
private fun Rewards(level: Int, rank: ProgressRank?) {
    val sorted = PROGRESS_LEVEL_REWARDS.sortedBy { it.level }
    val next = sorted.firstOrNull { level < it.level }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (next != null) {
            PcCard(Modifier.fillMaxWidth(), border = PC.Brand.copy(alpha = 0.4f), background = Brush.linearGradient(listOf(PC.BrandSoft, PC.Surface))) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(46.dp).clip(RoundedCornerShape(14.dp)).background(PC.Brand.copy(alpha = 0.2f)), contentAlignment = Alignment.Center) {
                        Icon(Icons.Outlined.CardGiftcard, null, tint = PC.Brand, modifier = Modifier.size(24.dp))
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text("PRÓXIMA RECOMPENSA", color = PC.Muted, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                        Text(next.title, color = PC.Header, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        val left = next.level - level
                        Text(
                            "Faltam $left ${if (left == 1) "nível" else "níveis"} (nível ${next.level})" +
                                (if (rank != null && !rank.isMaxLevel) " · ${rank.progress}% do nível atual" else "") + ".",
                            color = PC.Muted, style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }
        }

        sorted.forEachIndexed { i, r ->
            RewardItem(r, level >= r.level, r == next, isLast = i == sorted.lastIndex)
        }

        Text(
            "Novas recompensas são adicionadas conforme a comunidade cresce.",
            color = PC.Faint, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
        )
    }
}

@Composable
private fun RewardItem(r: ProgressLevelReward, done: Boolean, isNext: Boolean, isLast: Boolean) {
    val accent = when { done -> PC.Green; isNext -> PC.Brand; else -> PC.Faint }
    Row(Modifier.fillMaxWidth()) {
        // Trilha: bolinha + linha vertical.
        Column(Modifier.width(34.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                Modifier.size(30.dp).clip(CircleShape).background(if (done) PC.Green else PC.Surface2).border(2.dp, accent, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(if (done) Icons.Outlined.Check else Icons.Outlined.Lock, null, tint = if (done) Color.White else accent, modifier = Modifier.size(15.dp))
            }
            if (!isLast) Box(Modifier.width(2.dp).height(40.dp).background(PC.Line))
        }
        Spacer(Modifier.width(10.dp))
        PcCard(Modifier.weight(1f), border = if (isNext) PC.Brand.copy(alpha = 0.5f) else if (done) PC.Green.copy(alpha = 0.35f) else PC.Line) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(r.icon, fontSize = 22.sp)
                Spacer(Modifier.width(10.dp))
                Text(r.title, color = PC.Header, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                Chip("Nível ${r.level}", PC.Muted)
            }
            Spacer(Modifier.height(6.dp))
            Text(r.description, color = PC.Muted, style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(8.dp))
            Text(
                if (done) "Liberada" else "Libera no nível ${r.level}",
                color = if (done) PC.Green else PC.Muted, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold,
            )
        }
    }
}

/* ---------------- Erro ---------------- */

@Composable
private fun ErrorBox(message: String, onRetry: () -> Unit) {
    EmptyState(Icons.Outlined.CloudOff, "Não deu para carregar", message) {
        GhostButton("Tentar de novo", onRetry, icon = Icons.Outlined.Refresh)
    }
}
