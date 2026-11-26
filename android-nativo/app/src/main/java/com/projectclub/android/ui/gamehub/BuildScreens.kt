package com.projectclub.android.ui.gamehub

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Construction
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SportsEsports
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.projectclub.android.data.AppJson
import com.projectclub.android.data.BuildResponse
import com.projectclub.android.data.DarktideBuildData
import com.projectclub.android.data.DarktideData
import com.projectclub.android.data.DeadlockBuildData
import com.projectclub.android.data.DeadlockData
import com.projectclub.android.data.DeadlockHero
import com.projectclub.android.data.DeadlockItem
import com.projectclub.android.data.GameBuild
import com.projectclub.android.data.HubGame
import com.projectclub.android.data.LikeResponse
import com.projectclub.android.data.LolBuildData
import com.projectclub.android.data.LolChampionDetail
import com.projectclub.android.data.LolData
import com.projectclub.android.data.OtherBuildData
import com.projectclub.android.data.Repository
import com.projectclub.android.gamehub.HubLogic
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.EmptyState
import com.projectclub.android.ui.common.GhostButton
import com.projectclub.android.ui.common.ListSkeleton
import com.projectclub.android.ui.common.PcField
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.common.PillButton
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// ---------- dados dos jogos (cache por sessão do app) ----------

private object BuildDataCache {
    var lol: LolData? = null
    var deadlock: DeadlockData? = null
    var darktide: DarktideData? = null
    val champions = HashMap<String, LolChampionDetail>()
}

private suspend fun lolData(repo: Repository): LolData =
    BuildDataCache.lol ?: repo.api.get<LolData>("/api/game-hub/data/lol").also { BuildDataCache.lol = it }

private suspend fun deadlockData(repo: Repository): DeadlockData =
    BuildDataCache.deadlock ?: repo.api.get<DeadlockData>("/api/game-hub/data/deadlock").also { BuildDataCache.deadlock = it }

private suspend fun darktideData(repo: Repository): DarktideData =
    BuildDataCache.darktide ?: repo.api.get<DarktideData>("/api/game-hub/data/darktide").also { BuildDataCache.darktide = it }

private suspend fun lolChampion(repo: Repository, id: String): LolChampionDetail? =
    BuildDataCache.champions[id] ?: runCatching { repo.api.get<LolChampionDetail>("/api/game-hub/data/lol/champion/$id") }.getOrNull()?.also { BuildDataCache.champions[id] = it }

private fun lolOf(b: GameBuild) = runCatching { AppJson.decodeFromJsonElement(LolBuildData.serializer(), b.data) }.getOrDefault(LolBuildData())
private fun deadlockOf(b: GameBuild) = runCatching { AppJson.decodeFromJsonElement(DeadlockBuildData.serializer(), b.data) }.getOrDefault(DeadlockBuildData())
private fun darktideOf(b: GameBuild) = runCatching { AppJson.decodeFromJsonElement(DarktideBuildData.serializer(), b.data) }.getOrDefault(DarktideBuildData())
private fun otherOf(b: GameBuild) = runCatching { AppJson.decodeFromJsonElement(OtherBuildData.serializer(), b.data) }.getOrDefault(OtherBuildData())

val DL_SLOTS = listOf("weapon" to "Arma", "vitality" to "Vitalidade", "spirit" to "Espírito")
fun dlSlotColor(slot: String) = when (slot) { "weapon" -> Color(0xFFE09A3E); "vitality" -> Color(0xFF6FBF4A); "spirit" -> Color(0xFFB07CE8); else -> PC.Muted }

// ---------- Ver build ----------

@Composable
fun BuildScreen(repo: Repository, nav: AppNav, id: String) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var build by remember { mutableStateOf<GameBuild?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var lol by remember { mutableStateOf(BuildDataCache.lol) }
    var champ by remember { mutableStateOf<LolChampionDetail?>(null) }
    var deadlock by remember { mutableStateOf(BuildDataCache.deadlock) }
    var darktide by remember { mutableStateOf(BuildDataCache.darktide) }
    var confirmDelete by remember { mutableStateOf(false) }
    LaunchedEffect(id) {
        runCatching { repo.api.get<BuildResponse>("/api/game-hub/builds/$id").build }
            .onSuccess { b -> build = b }
            .onFailure { error = it.message ?: "Não deu pra abrir a build." }
        val b = build ?: return@LaunchedEffect
        if (b.game == "lol") {
            lol = runCatching { lolData(repo) }.getOrNull()
            val c = lolOf(b).champion
            if (c.isNotBlank()) champ = lolChampion(repo, c)
        }
        if (b.game == "deadlock") deadlock = runCatching { deadlockData(repo) }.getOrNull()
        if (b.game == "darktide") darktide = runCatching { darktideData(repo) }.getOrNull()
    }
    val b = build
    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        PcTopBar(
            b?.title ?: "Build", Icons.Outlined.Construction,
            navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } },
            actions = {
                if (b?.mine == true) {
                    IconButton(onClick = { nav.route("gamehub/build-edit?id=${b.id}") }) { Icon(Icons.Outlined.Edit, "Editar", tint = PC.Text) }
                    IconButton(onClick = { confirmDelete = true }) { Icon(Icons.Outlined.Delete, "Apagar", tint = PC.Text) }
                }
            },
        )
        when {
            b == null && error != null -> EmptyState(Icons.Outlined.Construction, "Não deu pra abrir", error!!)
            b == null -> ListSkeleton(6, 48.dp)
            else -> BuildContent(b, lol, champ, deadlock, darktide) {
                scope.launch {
                    runCatching { repo.api.post<LikeResponse>("/api/game-hub/builds/${b.id}/like") }
                        .onSuccess { r -> build = b.copy(liked = r.liked, likesCount = r.likesCount) }
                        .onFailure { ctx.toast(it.message ?: "Não deu certo.") }
                }
            }
        }
    }
    if (confirmDelete && b != null) AlertDialog(
        onDismissRequest = { confirmDelete = false },
        title = { Text("Apagar esta build?") },
        text = { Text("\"${b.title}\" some pra todo mundo. Não dá pra desfazer.") },
        confirmButton = {
            TextButton(onClick = {
                confirmDelete = false
                scope.launch {
                    runCatching { repo.api.delete("/api/game-hub/builds/${b.id}") }
                        .onSuccess { ctx.toast("Build apagada."); nav.back() }
                        .onFailure { ctx.toast(it.message ?: "Não deu pra apagar.") }
                }
            }) { Text("Apagar", color = PC.Red) }
        },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancelar") } },
        containerColor = PC.Surface,
    )
}

@Composable
fun BuildContent(b: GameBuild, lol: LolData?, champ: LolChampionDetail?, deadlock: DeadlockData?, darktide: DarktideData?, onLike: () -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Box(Modifier.fillMaxWidth().height(190.dp)) {
            BuildCover(b, Modifier.matchParentSize())
            Box(Modifier.matchParentSize().background(Brush.verticalGradient(listOf(Color(0x33000000), PC.Bg))))
            Column(Modifier.align(Alignment.BottomStart).padding(16.dp)) {
                Text(buildGameName(b), color = HubViolet, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                Text(b.title, color = Color.White, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                val hero = when (b.game) {
                    "deadlock" -> deadlock?.heroes?.firstOrNull { it.id.toString() == b.hero }?.name ?: b.heroName
                    "lol" -> lol?.champions?.firstOrNull { it.id == b.hero }?.name ?: b.heroName ?: b.hero
                    else -> b.heroName
                }
                listOfNotNull(hero, roleName(b.role)).joinToString(" · ").takeIf { it.isNotBlank() }?.let {
                    Text(it, color = Color.White.copy(alpha = 0.85f), style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(b.author, 32.dp, decoration = false)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(b.author?.name ?: "Alguém", color = PC.Header, style = MaterialTheme.typography.bodyLarge)
                    Text(HubLogic.ago(b.updatedAt ?: b.createdAt), color = PC.Muted, style = MaterialTheme.typography.bodySmall)
                }
                Box(Modifier.clip(CircleShape).border(1.dp, PC.LineStrong, CircleShape)) { LikeCount(b.liked, b.likesCount, onLike) }
            }
            when (b.game) {
                "lol" -> LolBody(lolOf(b), lol, champ)
                "deadlock" -> DeadlockBody(deadlockOf(b), deadlock)
                "darktide" -> {
                    val d = darktideOf(b)
                    TextRows(
                        listOf(
                            "Classe" to (darktide?.classes?.firstOrNull { it.id == d.klass }?.name ?: b.heroName ?: d.klass),
                            "Corpo a corpo" to d.melee, "À distância" to d.ranged, "Bênçãos" to d.blessings, "Talentos" to d.talents,
                            "Curios" to d.curios.filter { it.isNotBlank() }.joinToString("\n"),
                        ),
                    )
                }
                else -> {
                    val d = otherOf(b)
                    TextRows(listOf("Personagem" to d.character, "Itens" to d.items.filter { it.isNotBlank() }.joinToString("\n"), "Habilidades" to d.abilities))
                }
            }
            b.notes?.takeIf { it.isNotBlank() }?.let { notes ->
                Block("Como jogar") { Text(notes, color = PC.Text, style = MaterialTheme.typography.bodyMedium) }
            }
            Spacer(Modifier.navigationBarsPadding().height(8.dp))
        }
    }
}

@Composable
private fun Block(title: String, content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(18.dp)
    Column(Modifier.fillMaxWidth().clip(shape).background(PC.Surface).border(1.dp, PC.Line, shape).padding(14.dp)) {
        Text(title, color = PC.Header, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(10.dp))
        content()
    }
}

@Composable
private fun TextRows(rows: List<Pair<String, String>>) {
    val list = rows.filter { it.second.isNotBlank() }
    if (list.isEmpty()) return
    Block("Build") {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            list.forEach { (k, v) ->
                Column {
                    Text(k, color = PC.Muted, style = MaterialTheme.typography.labelMedium)
                    Text(v, color = PC.Header, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}

/** Ícone quadrado (item, feitiço, runa) com o nome embaixo. */
@Composable
private fun IconTileNamed(img: String?, name: String, size: Dp = 46.dp, round: Boolean = false, ring: Color? = null, caption: Boolean = true, slot: Dp? = null) {
    // [slot]: altura fixa da área do ícone (alinha ícones de tamanhos diferentes na mesma linha).
    Column(Modifier.width(maxOf(size, slot ?: size) + 18.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        val shape = if (round) CircleShape else RoundedCornerShape(10.dp)
        Box(Modifier.height(slot ?: size), contentAlignment = Alignment.Center) {
            Box(
                Modifier.size(size).clip(shape).background(PC.Surface2).then(if (ring != null) Modifier.border(2.dp, ring, shape) else Modifier),
                contentAlignment = Alignment.Center,
            ) {
                if (img != null) AsyncImage(img, name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                else Text(name.take(2), color = PC.Muted, style = MaterialTheme.typography.labelSmall)
            }
        }
        if (caption) Text(name, color = PC.Muted, fontSize = 10.sp, lineHeight = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LolBody(d: LolBuildData, data: LolData?, champ: LolChampionDetail?) {
    val primary = data?.runes?.firstOrNull { it.id == d.primaryTree }
    val secondary = data?.runes?.firstOrNull { it.id == d.secondaryTree }
    val keystone = data?.runes?.flatMap { t -> t.slots.flatten() }?.firstOrNull { it.id == d.keystone }
    if (primary != null || keystone != null || d.spells.isNotEmpty()) Block("Runas e feitiços") {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            keystone?.let { IconTileNamed(it.img, it.name, 52.dp, round = true, slot = 52.dp) }
            primary?.let { IconTileNamed(it.img, it.name, 36.dp, round = true, slot = 52.dp) }
            secondary?.let { IconTileNamed(it.img, "+ ${it.name}", 36.dp, round = true, slot = 52.dp) }
            d.spells.forEach { sid -> val s = data?.spells?.firstOrNull { it.id == sid }; IconTileNamed(s?.img, s?.name ?: sid, 40.dp, slot = 52.dp) }
        }
    }
    val items = data?.items.orEmpty().associateBy { it.id }
    listOf("Iniciais" to d.start, "Principais (em ordem)" to d.core, "Situacionais" to d.situational).forEach { (title, ids) ->
        if (ids.isNotEmpty()) Block(title) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ids.forEach { iid -> val x = items[iid]; IconTileNamed(x?.img, x?.name ?: iid) }
            }
        }
    }
    if (d.skills.isNotBlank()) Block("Ordem de habilidades") { SkillGrid(d.skills, champ) }
}

/** Grade 4 × 18 (Q W E R por nível), igual à do site. */
@Composable
fun SkillGrid(skills: String, champ: LolChampionDetail?) {
    val seq = skills.uppercase().filter { it in "QWER" }.take(18)
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        "QWER".forEach { key ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                val ab = champ?.spells?.firstOrNull { it.key == key.toString() }
                Box(Modifier.size(24.dp).clip(RoundedCornerShape(6.dp)).background(PC.Surface3), contentAlignment = Alignment.Center) {
                    if (ab != null) AsyncImage(ab.img, ab.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                    else Text(key.toString(), color = PC.Header, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.width(4.dp))
                for (lvl in 0 until 18) {
                    val on = seq.getOrNull(lvl) == key
                    Box(
                        Modifier.padding(horizontal = 1.dp).size(width = 15.dp, height = 22.dp).clip(RoundedCornerShape(4.dp))
                            .background(if (on) HubViolet else PC.Surface2),
                        contentAlignment = Alignment.Center,
                    ) { if (on) Text("${lvl + 1}", color = Color.White, fontSize = 8.sp, fontWeight = FontWeight.Bold) }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DeadlockBody(d: DeadlockBuildData, data: DeadlockData?) {
    val hero = data?.heroes?.firstOrNull { it.id == d.hero }
    if (d.abilityOrder.isNotEmpty() && hero != null) Block("Prioridade das habilidades") {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            d.abilityOrder.forEachIndexed { i, slot ->
                val a = hero.abilities.firstOrNull { it.slot == slot }
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("${i + 1}º", color = HubViolet, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                    IconTileNamed(a?.img, a?.name ?: "Habilidade $slot", 44.dp, round = true)
                }
            }
        }
    }
    val items = data?.items.orEmpty().associateBy { it.id }
    listOf("Começo da partida" to d.early, "Meio" to d.mid, "Fim" to d.late).forEach { (title, ids) ->
        if (ids.isNotEmpty()) Block(title) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ids.forEach { iid -> val x = items[iid]; IconTileNamed(x?.img, x?.name ?: "Item $iid", ring = x?.slot?.let(::dlSlotColor)) }
            }
        }
    }
    if (listOf(d.early, d.mid, d.late).any { it.isNotEmpty() }) Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        DL_SLOTS.forEach { (k, label) ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(10.dp).clip(CircleShape).background(dlSlotColor(k)))
                Spacer(Modifier.width(5.dp))
                Text(label, color = PC.Muted, style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}

// ---------- Escolher ícones (campeão, itens, feitiços, herói) ----------

class PickOption(val id: String, val name: String, val img: String?, val group: String? = null, val ring: Color? = null)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun IconPickerSheet(
    title: String,
    options: List<PickOption>,
    picked: List<String>,
    max: Int,
    onToggle: (PickOption) -> Unit,
    onDismiss: () -> Unit,
    groups: List<Pair<String, String>> = emptyList(),
) {
    var q by remember { mutableStateOf("") }
    var group by remember { mutableStateOf("") }
    val shown = remember(options, q, group) {
        options.filter { (group.isBlank() || it.group == group) && (q.isBlank() || it.name.contains(q.trim(), ignoreCase = true)) }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = PC.Surface) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).navigationBarsPadding().imePadding()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(title, color = PC.Header, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                if (max > 1) Text("${picked.size}/$max", color = PC.Muted, style = MaterialTheme.typography.labelLarge)
                IconButton(onClick = onDismiss) { Icon(Icons.Outlined.Close, "Fechar", tint = PC.Muted) }
            }
            PcField(q, { q = it }, "Buscar", icon = Icons.Outlined.Search)
            if (groups.isNotEmpty()) {
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    HubChip("Todos", group.isBlank(), { group = "" })
                    groups.forEach { (k, label) -> HubChip(label, group == k, { group = k }) }
                }
            }
            Spacer(Modifier.height(10.dp))
            LazyVerticalGrid(GridCells.Adaptive(68.dp), Modifier.fillMaxWidth().heightIn(max = 480.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(shown, key = { it.id }) { o ->
                    val on = o.id in picked
                    Box(Modifier.clip(RoundedCornerShape(12.dp)).clickable { onToggle(o) }.padding(4.dp), contentAlignment = Alignment.TopEnd) {
                        IconTileNamed(o.img, o.name, 48.dp, ring = if (on) HubViolet else o.ring)
                        if (on) Icon(Icons.Outlined.CheckCircle, null, tint = HubViolet, modifier = Modifier.size(18.dp).clip(CircleShape).background(PC.Surface))
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}

// ---------- Criar / editar ----------

/** Estado do editor (um pouco de cada jogo; só o do jogo escolhido vai pro servidor). */
private class BuildDraft {
    var game by mutableStateOf("lol")
    var title by mutableStateOf("")
    var notes by mutableStateOf("")
    // lol
    var champion by mutableStateOf("")
    var role by mutableStateOf<String?>(null)
    var primaryTree by mutableStateOf<Int?>(null)
    var keystone by mutableStateOf<Int?>(null)
    var secondaryTree by mutableStateOf<Int?>(null)
    val spells = mutableStateListOf<String>()
    val start = mutableStateListOf<String>()
    val core = mutableStateListOf<String>()
    val situational = mutableStateListOf<String>()
    var skills by mutableStateOf("")
    // deadlock
    var hero by mutableStateOf(0)
    val early = mutableStateListOf<String>()
    val mid = mutableStateListOf<String>()
    val late = mutableStateListOf<String>()
    val abilityOrder = mutableStateListOf<Int>()
    // darktide
    var klass by mutableStateOf("")
    var melee by mutableStateOf("")
    var ranged by mutableStateOf("")
    var blessings by mutableStateOf("")
    var talents by mutableStateOf("")
    val curios = mutableStateListOf("", "", "")
    // outro
    var otherGame by mutableStateOf<HubGame?>(null)
    var character by mutableStateOf("")
    var items by mutableStateOf("")
    var abilities by mutableStateOf("")

    fun fill(b: GameBuild) {
        game = b.game; title = b.title; notes = b.notes.orEmpty()
        when (b.game) {
            "lol" -> lolOf(b).also { d ->
                champion = d.champion; role = d.role; primaryTree = d.primaryTree; keystone = d.keystone; secondaryTree = d.secondaryTree
                spells.setAll(d.spells); start.setAll(d.start); core.setAll(d.core); situational.setAll(d.situational); skills = d.skills
            }
            "deadlock" -> deadlockOf(b).also { d ->
                hero = d.hero; early.setAll(d.early.map { it.toString() }); mid.setAll(d.mid.map { it.toString() }); late.setAll(d.late.map { it.toString() })
                abilityOrder.clear(); abilityOrder.addAll(d.abilityOrder)
            }
            "darktide" -> darktideOf(b).also { d ->
                klass = d.klass; melee = d.melee; ranged = d.ranged; blessings = d.blessings; talents = d.talents
                curios.setAll((d.curios + listOf("", "", "")).take(3))
            }
            else -> otherOf(b).also { d ->
                otherGame = b.gameInfo; character = d.character; items = d.items.joinToString("\n"); abilities = d.abilities
            }
        }
    }

    fun body(): JsonObject = buildJsonObject {
        put("game", game)
        put("title", title.trim())
        put("notes", notes.trim())
        if (game == "outro") otherGame?.let { g -> put("gameName", g.name); g.steamAppId?.let { put("steamAppId", it) } }
        put("data", buildJsonObject {
            when (game) {
                "lol" -> {
                    put("champion", champion)
                    role?.let { put("role", it) }
                    primaryTree?.let { put("primaryTree", it) }
                    keystone?.let { put("keystone", it) }
                    secondaryTree?.let { put("secondaryTree", it) }
                    put("spells", strings(spells)); put("start", strings(start)); put("core", strings(core)); put("situational", strings(situational))
                    put("skills", skills)
                }
                "deadlock" -> {
                    put("hero", hero)
                    put("early", ints(early)); put("mid", ints(mid)); put("late", ints(late))
                    put("abilityOrder", buildJsonArray { abilityOrder.forEach { add(JsonPrimitive(it)) } })
                }
                "darktide" -> {
                    put("klass", klass); put("melee", melee); put("ranged", ranged); put("blessings", blessings); put("talents", talents)
                    put("curios", strings(curios))
                }
                else -> {
                    put("character", character)
                    put("items", strings(items.split('\n', ',').map { it.trim() }.filter { it.isNotBlank() }))
                    put("abilities", abilities)
                }
            }
        })
    }

    private fun strings(l: List<String>) = buildJsonArray { l.forEach { add(JsonPrimitive(it)) } }
    private fun ints(l: List<String>) = buildJsonArray { l.mapNotNull { it.toIntOrNull() }.forEach { add(JsonPrimitive(it)) } }
}

private fun <T> SnapshotStateList<T>.setAll(items: List<T>) { clear(); addAll(items) }

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BuildEditorScreen(repo: Repository, nav: AppNav, id: String?) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val draft = remember { BuildDraft() }
    var loaded by remember { mutableStateOf(id.isNullOrBlank()) }
    var saving by remember { mutableStateOf(false) }
    var lol by remember { mutableStateOf(BuildDataCache.lol) }
    var champ by remember { mutableStateOf<LolChampionDetail?>(null) }
    var deadlock by remember { mutableStateOf(BuildDataCache.deadlock) }
    var darktide by remember { mutableStateOf(BuildDataCache.darktide) }
    var dataError by remember { mutableStateOf<String?>(null) }
    var picker by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(id) {
        if (!id.isNullOrBlank()) {
            runCatching { repo.api.get<BuildResponse>("/api/game-hub/builds/$id").build }
                .onSuccess { b -> if (b != null) draft.fill(b); loaded = true }
                .onFailure { ctx.toast(it.message ?: "Não deu pra abrir a build."); nav.back() }
        }
    }
    LaunchedEffect(draft.game) {
        dataError = null
        try {
            if (draft.game == "lol") lol = lolData(repo)
            if (draft.game == "deadlock") deadlock = deadlockData(repo)
            if (draft.game == "darktide") darktide = darktideData(repo)
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            dataError = e.message ?: "Os dados do jogo não carregaram."
        }
    }
    LaunchedEffect(draft.champion) {
        champ = draft.champion.takeIf { it.isNotBlank() }?.let { lolChampion(repo, it) }
    }

    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        PcTopBar(
            if (id.isNullOrBlank()) "Nova build" else "Editar build", Icons.Outlined.Construction,
            navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } },
        )
        if (!loaded) { ListSkeleton(6, 48.dp); return@Column }
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp).imePadding(),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (id.isNullOrBlank()) Column {
                Label("Jogo")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    BUILD_GAMES.forEach { (k, label) -> HubChip(label, draft.game == k, { draft.game = k }) }
                }
            }
            PcField(draft.title, { if (it.length <= 80) draft.title = it }, "Ex.: Jinx crítica pra rotas fáceis", label = "Nome da build")
            dataError?.let { Text(it, color = PC.Red, style = MaterialTheme.typography.bodySmall) }
            when (draft.game) {
                "lol" -> LolEditor(draft, lol, champ) { picker = it }
                "deadlock" -> DeadlockEditor(draft, deadlock) { picker = it }
                "darktide" -> DarktideEditor(draft, darktide)
                else -> OtherEditor(draft, repo)
            }
            PcField(draft.notes, { if (it.length <= 4000) draft.notes = it }, "Quando comprar cada item, combos, dicas de rota…", label = "Como jogar (opcional)", singleLine = false)
            PillButton(
                if (id.isNullOrBlank()) "Publicar build" else "Salvar", {
                    saving = true
                    scope.launch {
                        runCatching {
                            if (id.isNullOrBlank()) repo.api.post<BuildResponse>("/api/game-hub/builds", draft.body())
                            else repo.api.put<BuildResponse>("/api/game-hub/builds/$id", draft.body())
                        }.onSuccess { r ->
                            ctx.toast(if (id.isNullOrBlank()) "Build publicada!" else "Build salva.")
                            nav.back()
                            if (id.isNullOrBlank()) r.build?.let { nav.route("gamehub/build/${it.id}") }
                        }.onFailure { ctx.toast(it.message ?: "Não deu pra salvar.") }
                        saving = false
                    }
                },
                Modifier.fillMaxWidth(), busy = saving, enabled = draft.title.trim().length >= 3, color = HubVioletDeep,
            )
            Spacer(Modifier.navigationBarsPadding().height(12.dp))
        }
    }

    // Seletores
    val l = lol
    val dl = deadlock
    when (val p = picker) {
        null -> {}
        "champion" -> if (l != null) IconPickerSheet(
            "Campeão", l.champions.map { PickOption(it.id, it.name, it.img) }, listOf(draft.champion), 1,
            onToggle = { draft.champion = it.id; picker = null }, onDismiss = { picker = null },
        )
        "spells" -> if (l != null) IconPickerSheet(
            "Feitiços", l.spells.map { PickOption(it.id, it.name, it.img) }, draft.spells, 2,
            onToggle = { o -> toggle(draft.spells, o.id, 2) }, onDismiss = { picker = null },
        )
        "start", "core", "situational" -> if (l != null) {
            val list = when (p) { "start" -> draft.start; "core" -> draft.core; else -> draft.situational }
            val max = if (p == "start") 4 else 6
            IconPickerSheet(
                when (p) { "start" -> "Itens iniciais"; "core" -> "Itens principais"; else -> "Itens situacionais" },
                l.items.map { PickOption(it.id, it.name, it.img, group = if (it.depth >= 3 || it.into == 0) "final" else "parte") }, list, max,
                onToggle = { o -> toggle(list, o.id, max) }, onDismiss = { picker = null },
                groups = listOf("final" to "Completos", "parte" to "Componentes"),
            )
        }
        "hero" -> if (dl != null) IconPickerSheet(
            "Herói", dl.heroes.map { PickOption(it.id.toString(), it.name, it.img) }, listOf(draft.hero.toString()), 1,
            onToggle = { draft.hero = it.id.toIntOrNull() ?: 0; draft.abilityOrder.clear(); picker = null }, onDismiss = { picker = null },
        )
        "early", "mid", "late" -> if (dl != null) {
            val list = when (p) { "early" -> draft.early; "mid" -> draft.mid; else -> draft.late }
            val max = if (p == "late") 10 else 8
            IconPickerSheet(
                when (p) { "early" -> "Itens do começo"; "mid" -> "Itens do meio"; else -> "Itens do fim" },
                dl.items.map { PickOption(it.id.toString(), it.name, it.img, group = it.slot, ring = dlSlotColor(it.slot)) }, list, max,
                onToggle = { o -> toggle(list, o.id, max) }, onDismiss = { picker = null }, groups = DL_SLOTS,
            )
        }
        else -> {}
    }
}

private fun toggle(list: SnapshotStateList<String>, id: String, max: Int) {
    if (id in list) list.remove(id) else if (list.size < max) list.add(id)
}

@Composable
private fun Label(text: String) {
    Text(text.uppercase(), style = MaterialTheme.typography.labelMedium, color = PC.Text)
    Spacer(Modifier.height(8.dp))
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PickedRow(label: String, ids: List<String>, max: Int, lookup: (String) -> PickOption?, onEdit: () -> Unit) {
    Column {
        Label("$label · ${ids.size}/$max")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            ids.forEach { id -> val o = lookup(id); IconTileNamed(o?.img, o?.name ?: id, ring = o?.ring) }
            Box(
                Modifier.size(46.dp).clip(RoundedCornerShape(10.dp)).border(1.dp, PC.LineStrong, RoundedCornerShape(10.dp)).clickable(onClick = onEdit),
                contentAlignment = Alignment.Center,
            ) { Icon(if (ids.isEmpty()) Icons.Outlined.Add else Icons.Outlined.Edit, "Escolher", tint = PC.Muted) }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LolEditor(d: BuildDraft, data: LolData?, champ: LolChampionDetail?, open: (String) -> Unit) {
    if (data == null) { ListSkeleton(3, 46.dp); return }
    val c = data.champions.firstOrNull { it.id == d.champion }
    Column {
        Label("Campeão")
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(PC.Surface).border(1.dp, PC.LineStrong, RoundedCornerShape(18.dp))
                .clickable { open("champion") }.padding(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconTileNamed(c?.img, c?.name ?: "?", 44.dp, caption = false)
            Spacer(Modifier.width(8.dp))
            Text(c?.name ?: "Escolher campeão", color = if (c == null) PC.Muted else PC.Header, style = MaterialTheme.typography.bodyLarge)
        }
    }
    Column {
        Label("Rota")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            LOL_ROLES.forEach { (k, label) -> HubChip(label, d.role == k, { d.role = if (d.role == k) null else k }) }
        }
    }
    Column {
        Label("Runas · árvore principal")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            data.runes.forEach { t ->
                Box(Modifier.clip(CircleShape).clickable {
                    d.primaryTree = t.id; d.keystone = null; if (d.secondaryTree == t.id) d.secondaryTree = null
                }) { IconTileNamed(t.img, t.name, 40.dp, round = true, ring = if (d.primaryTree == t.id) HubViolet else null) }
            }
        }
        data.runes.firstOrNull { it.id == d.primaryTree }?.slots?.firstOrNull()?.let { keys ->
            Spacer(Modifier.height(10.dp))
            Label("Pedra angular")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                keys.forEach { r ->
                    Box(Modifier.clip(CircleShape).clickable { d.keystone = r.id }) { IconTileNamed(r.img, r.name, 46.dp, round = true, ring = if (d.keystone == r.id) HubViolet else null) }
                }
            }
        }
        if (d.primaryTree != null) {
            Spacer(Modifier.height(10.dp))
            Label("Árvore secundária")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                data.runes.filter { it.id != d.primaryTree }.forEach { t ->
                    Box(Modifier.clip(CircleShape).clickable { d.secondaryTree = t.id }) { IconTileNamed(t.img, t.name, 36.dp, round = true, ring = if (d.secondaryTree == t.id) HubViolet else null) }
                }
            }
        }
    }
    val spellBy = data.spells.associateBy { it.id }
    PickedRow("Feitiços", d.spells, 2, { id -> spellBy[id]?.let { PickOption(it.id, it.name, it.img) } }) { open("spells") }
    val itemBy = data.items.associateBy { it.id }
    val look: (String) -> PickOption? = { id -> itemBy[id]?.let { PickOption(it.id, it.name, it.img) } }
    PickedRow("Itens iniciais", d.start, 4, look) { open("start") }
    PickedRow("Itens principais (em ordem)", d.core, 6, look) { open("core") }
    PickedRow("Itens situacionais", d.situational, 6, look) { open("situational") }
    Column {
        Label("Ordem de habilidades · ${d.skills.length}/18")
        SkillGrid(d.skills, champ)
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            "QWER".forEach { k ->
                Box(
                    Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)).background(if (d.skills.length < 18) PC.Surface3 else PC.Surface2)
                        .clickable(enabled = d.skills.length < 18) { d.skills += k },
                    contentAlignment = Alignment.Center,
                ) { Text(k.toString(), color = PC.Header, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
            }
            Spacer(Modifier.weight(1f))
            GhostButton("Desfazer", { d.skills = d.skills.dropLast(1) })
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DeadlockEditor(d: BuildDraft, data: DeadlockData?, open: (String) -> Unit) {
    if (data == null) { ListSkeleton(3, 46.dp); return }
    val hero: DeadlockHero? = data.heroes.firstOrNull { it.id == d.hero }
    Column {
        Label("Herói")
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(PC.Surface).border(1.dp, PC.LineStrong, RoundedCornerShape(18.dp))
                .clickable { open("hero") }.padding(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconTileNamed(hero?.img, hero?.name ?: "?", 44.dp, caption = false)
            Spacer(Modifier.width(8.dp))
            Text(hero?.name ?: "Escolher herói", color = if (hero == null) PC.Muted else PC.Header, style = MaterialTheme.typography.bodyLarge)
        }
    }
    if (hero != null) Column {
        Label("Prioridade das habilidades (toque na ordem)")
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            hero.abilities.sortedBy { it.slot }.forEach { a ->
                val pos = d.abilityOrder.indexOf(a.slot)
                Column(
                    Modifier.clip(RoundedCornerShape(12.dp)).clickable {
                        if (pos >= 0) d.abilityOrder.remove(a.slot) else if (d.abilityOrder.size < 4) d.abilityOrder.add(a.slot)
                    }.padding(4.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(if (pos >= 0) "${pos + 1}º" else "–", color = if (pos >= 0) HubViolet else PC.Faint, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                    IconTileNamed(a.img, a.name, 44.dp, round = true, ring = if (pos >= 0) HubViolet else null)
                }
            }
        }
    }
    val itemsById: Map<String, DeadlockItem> = data.items.associateBy { it.id.toString() }
    val look: (String) -> PickOption? = { id -> itemsById[id]?.let { PickOption(id, it.name, it.img, ring = dlSlotColor(it.slot)) } }
    PickedRow("Começo da partida", d.early, 8, look) { open("early") }
    PickedRow("Meio", d.mid, 8, look) { open("mid") }
    PickedRow("Fim", d.late, 10, look) { open("late") }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DarktideEditor(d: BuildDraft, data: DarktideData?) {
    Column {
        Label("Classe")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            data?.classes.orEmpty().forEach { c -> HubChip(c.name, d.klass == c.id, { d.klass = c.id }) }
        }
    }
    PcField(d.melee, { if (it.length <= 80) d.melee = it }, "Ex.: Espada de energia", label = "Arma corpo a corpo")
    PcField(d.ranged, { if (it.length <= 80) d.ranged = it }, "Ex.: Fuzil laser Lucius", label = "Arma à distância")
    PcField(d.blessings, { if (it.length <= 400) d.blessings = it }, "Bênçãos das armas", label = "Bênçãos", singleLine = false)
    PcField(d.talents, { if (it.length <= 800) d.talents = it }, "Talentos escolhidos", label = "Talentos", singleLine = false)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Label("Curios")
        for (i in 0 until 3) PcField(d.curios[i], { v -> if (v.length <= 80) d.curios[i] = v }, "Curio ${i + 1}")
    }
}

@Composable
private fun OtherEditor(d: BuildDraft, repo: Repository) {
    var picking by remember { mutableStateOf(false) }
    val g = d.otherGame
    Column {
        Label("Jogo")
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(PC.Surface).border(1.dp, PC.LineStrong, RoundedCornerShape(18.dp))
                .clickable { picking = true }.padding(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (g != null) GameCover(g.name, Modifier.width(92.dp).height(43.dp), g.steamAppId, shape = RoundedCornerShape(10.dp))
            else Icon(Icons.Outlined.SportsEsports, null, tint = PC.Muted)
            Spacer(Modifier.width(10.dp))
            Text(g?.name ?: "Escolher jogo", color = if (g == null) PC.Muted else PC.Header, style = MaterialTheme.typography.bodyLarge)
        }
    }
    PcField(d.character, { if (it.length <= 80) d.character = it }, "Classe, personagem, arma principal…", label = "Personagem")
    PcField(d.items, { d.items = it }, "Um item por linha (até 12)", label = "Itens", singleLine = false)
    PcField(d.abilities, { if (it.length <= 800) d.abilities = it }, "Habilidades, talentos, árvore…", label = "Habilidades", singleLine = false)
    if (picking) GamePickerSheet(repo, onPick = { d.otherGame = it; picking = false }, onDismiss = { picking = false })
}
