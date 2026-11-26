package com.projectclub.android.ui.gamehub

import android.net.Uri
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Construction
import androidx.compose.material.icons.outlined.Favorite
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.projectclub.android.data.AppJson
import com.projectclub.android.data.BuildsResponse
import com.projectclub.android.data.GameBuild
import com.projectclub.android.data.LolBuildData
import com.projectclub.android.data.Repository
import com.projectclub.android.gamehub.HubLogic
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.EmptyState
import com.projectclub.android.ui.common.GhostButton
import com.projectclub.android.ui.common.ListSkeleton
import com.projectclub.android.ui.common.PcField
import com.projectclub.android.ui.common.PillButton
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// ---------- Jogos das builds ----------

val BUILD_GAMES = listOf("lol" to "League of Legends", "deadlock" to "Deadlock", "darktide" to "Darktide", "outro" to "Outros jogos")
private val BUILD_GAME_CHIPS = listOf("lol" to "LoL", "deadlock" to "Deadlock", "darktide" to "Darktide", "outro" to "Outros")
val LOL_ROLES = listOf("top" to "Topo", "jungle" to "Selva", "mid" to "Meio", "adc" to "Atirador", "support" to "Suporte")
const val DEADLOCK_APP = 1422450L
const val DARKTIDE_APP = 1361210L

fun buildGameName(b: GameBuild): String = when (b.game) {
    "lol" -> "League of Legends"
    "deadlock" -> "Deadlock"
    "darktide" -> "Warhammer 40K: Darktide"
    else -> b.gameInfo?.name ?: "Outro jogo"
}

fun roleName(role: String?) = LOL_ROLES.firstOrNull { it.first == role }?.second

/** Arte do campeão sem precisar da versão do Data Dragon. */
fun lolSplash(champion: String?) = champion?.takeIf { it.isNotBlank() }?.let { "https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${it}_0.jpg" }

fun lolChampionOf(b: GameBuild): String? = if (b.game != "lol") null else
    runCatching { AppJson.decodeFromJsonElement(LolBuildData.serializer(), b.data).champion }.getOrNull()?.ifBlank { null } ?: b.hero

/** Capa da build: arte do campeão (LoL) ou a capa do jogo na Steam. */
@Composable
fun BuildCover(b: GameBuild, modifier: Modifier, shape: RoundedCornerShape = RoundedCornerShape(0.dp)) {
    when (b.game) {
        "lol" -> GameCover(b.heroName ?: b.title, modifier, image = lolSplash(lolChampionOf(b)), shape = shape)
        "deadlock" -> GameCover("Deadlock", modifier, DEADLOCK_APP, shape = shape)
        "darktide" -> GameCover("Darktide", modifier, DARKTIDE_APP, shape = shape)
        else -> GameCover(b.gameInfo?.name ?: b.title, modifier, b.gameInfo?.steamAppId, shape = shape, cover = b.gameInfo?.cover, coverTall = b.gameInfo?.coverTall == true)
    }
}

@Composable
fun BuildsTab(repo: Repository, nav: AppNav) {
    val scope = rememberCoroutineScope()
    var game by rememberSaveable { mutableStateOf("") }
    var sort by rememberSaveable { mutableStateOf("top") }
    var mine by rememberSaveable { mutableStateOf(false) }
    var q by rememberSaveable { mutableStateOf("") }
    val builds = remember { mutableStateListOf<GameBuild>() }
    var more by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    fun query(skip: Int) = buildList {
        add("sort=$sort")
        if (game.isNotBlank()) add("game=$game")
        if (mine) add("mine=1")
        if (q.isNotBlank()) add("q=" + Uri.encode(q.trim()))
        if (skip > 0) add("skip=$skip")
    }.joinToString("&")

    fun load(reset: Boolean) {
        scope.launch {
            loading = true
            runCatching { repo.api.get<BuildsResponse>("/api/game-hub/builds?" + query(if (reset) 0 else builds.size)) }
                .onSuccess { r ->
                    if (reset) builds.clear()
                    builds.addAll(r.builds.filter { b -> builds.none { it.id == b.id } })
                    more = r.more; error = null
                }
                .onFailure { error = it.message ?: "Não deu pra carregar." }
            loading = false
        }
    }
    LaunchedEffect(game, sort, mine, q) {
        if (q.isNotBlank()) delay(350)
        load(true)
    }
    BuildsContent(
        builds, game, sort, mine, q, more, loading, error,
        onGame = { game = it }, onSort = { sort = it }, onMine = { mine = it }, onQuery = { q = it },
        onMore = { load(false) },
        onOpen = { nav.route("gamehub/build/${it.id}") },
        onCreate = { nav.route("gamehub/build-edit?id=") },
    )
}

@Composable
fun BuildsContent(
    builds: List<GameBuild>,
    game: String,
    sort: String,
    mine: Boolean,
    q: String,
    more: Boolean,
    loading: Boolean,
    error: String?,
    onGame: (String) -> Unit,
    onSort: (String) -> Unit,
    onMine: (Boolean) -> Unit,
    onQuery: (String) -> Unit,
    onMore: () -> Unit,
    onOpen: (GameBuild) -> Unit,
    onCreate: () -> Unit,
) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item(key = "create") { PillButton("Criar build", onCreate, Modifier.fillMaxWidth(), icon = Icons.Outlined.Add, color = HubVioletDeep) }
        item(key = "filters") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                PcField(q, onQuery, "Buscar build, campeão, herói…", icon = Icons.Outlined.Search)
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    item { HubChip("Todos", game.isBlank(), { onGame("") }) }
                    items(BUILD_GAME_CHIPS, key = { it.first }) { (k, label) -> HubChip(label, game == k, { onGame(k) }) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    HubChip("Em alta", sort == "top", { onSort("top") })
                    HubChip("Novas", sort == "new", { onSort("new") })
                    HubChip("Minhas", mine, { onMine(!mine) })
                }
            }
        }
        when {
            builds.isEmpty() && loading -> item(key = "loading") { ListSkeleton(4, 56.dp) }
            builds.isEmpty() && error != null -> item(key = "err") { EmptyState(Icons.Outlined.Construction, "Não deu pra carregar", error) }
            builds.isEmpty() -> item(key = "empty") {
                EmptyState(Icons.Outlined.Construction, if (mine) "Você ainda não criou builds" else "Nenhuma build aqui", "Monte a sua com os itens e runas reais do LoL e do Deadlock, ou de qualquer jogo.")
            }
            else -> items(builds, key = { it.id }) { b -> BuildCard(b) { onOpen(b) } }
        }
        if (more) item(key = "more") { GhostButton(if (loading) "Carregando…" else "Ver mais", onMore, Modifier.fillMaxWidth()) }
    }
}

@Composable
fun BuildCard(b: GameBuild, onClick: () -> Unit) {
    val shape = RoundedCornerShape(20.dp)
    Column(Modifier.fillMaxWidth().clip(shape).background(PC.Surface).border(1.dp, PC.Line, shape).clickable(onClick = onClick)) {
        Box(Modifier.fillMaxWidth().height(110.dp)) {
            BuildCover(b, Modifier.matchParentSize())
            Box(Modifier.matchParentSize().background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xF00B0B10)))))
            Column(Modifier.align(Alignment.BottomStart).padding(12.dp)) {
                Text(buildGameName(b), color = HubViolet, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                Text(b.title, color = Color.White, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(b.author, 26.dp, decoration = false)
            Spacer(Modifier.width(8.dp))
            Text(
                listOfNotNull(b.heroName, roleName(b.role), b.author?.name, HubLogic.ago(b.createdAt).ifBlank { null }).joinToString(" · "),
                color = PC.Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
            )
            LikeCount(b.liked, b.likesCount)
        }
    }
}

@Composable
fun LikeCount(liked: Boolean, count: Int, onClick: (() -> Unit)? = null) {
    Row(
        Modifier.clip(CircleShape).then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(if (liked) Icons.Outlined.Favorite else Icons.Outlined.FavoriteBorder, "Curtir", tint = if (liked) PC.Pink else PC.Muted, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(4.dp))
        Text("$count", color = PC.Text, style = MaterialTheme.typography.labelLarge)
    }
}
