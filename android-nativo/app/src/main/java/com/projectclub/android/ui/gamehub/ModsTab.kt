package com.projectclub.android.ui.gamehub

import android.graphics.Bitmap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Extension
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SportsEsports
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.projectclub.android.data.BedrockAddon
import com.projectclub.android.data.BedrockClass
import com.projectclub.android.data.BedrockClassesResponse
import com.projectclub.android.data.BedrockFile
import com.projectclub.android.data.BedrockFilesResponse
import com.projectclub.android.data.BedrockSearchResponse
import com.projectclub.android.data.ModdableGame
import com.projectclub.android.data.ModdableGamesResponse
import com.projectclub.android.data.Repository
import com.projectclub.android.gamehub.BedrockInstaller
import com.projectclub.android.gamehub.HubLogic
import com.projectclub.android.gamehub.InstalledGames
import com.projectclub.android.net.ApiException
import com.projectclub.android.ui.common.EmptyState
import com.projectclub.android.ui.common.GhostButton
import com.projectclub.android.ui.common.ListSkeleton
import com.projectclub.android.ui.common.PcField
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.common.PillButton
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// ---------- Aba Mods: jogos do celular ----------

/** Lista do servidor guardada pela sessão (muda pouco). */
private object ModsCache { var games: List<ModdableGame>? = null }

/** Jogos deste celular casados com a lista do servidor (null = carregando). */
@Composable
fun rememberDetectedGames(repo: Repository, refresh: Int = 0): List<HubLogic.DetectedGame>? {
    val ctx = LocalContext.current
    val detected by produceState<List<HubLogic.DetectedGame>?>(null, refresh) {
        val curated = ModsCache.games ?: runCatching { repo.api.get<ModdableGamesResponse>("/api/game-hub/android/games").games }
            .getOrNull()?.also { ModsCache.games = it }.orEmpty()
        value = withContext(Dispatchers.IO) { HubLogic.matchInstalled(InstalledGames.scan(ctx), curated, ctx.packageName) }
    }
    return detected
}

@Composable
fun ModsTab(repo: Repository, nav: AppNav) {
    val ctx = LocalContext.current
    var refresh by remember { mutableStateOf(0) }
    val detected = rememberDetectedGames(repo, refresh)
    ModsContent(
        detected,
        onLaunch = { g -> if (!InstalledGames.launch(ctx, g.app.packageName)) ctx.toast("Não deu pra abrir o jogo.") },
        onBedrock = { nav.route("gamehub/bedrock") },
        onLoader = { g ->
            val mod = g.mod ?: return@ModsContent
            val pkg = mod.loaderPackages.firstOrNull { InstalledGames.isInstalled(ctx, it) }
            when {
                pkg != null -> InstalledGames.launch(ctx, pkg)
                mod.url != null -> nav.external(mod.url)
                else -> mod.loaderPackages.firstOrNull()?.let { InstalledGames.openStore(ctx, it) }
            }
        },
        onPcMods = { nav.site("/jogos/mods") },
        onRefresh = { refresh++ },
    )
}

@Composable
fun ModsContent(
    detected: List<HubLogic.DetectedGame>?,
    onLaunch: (HubLogic.DetectedGame) -> Unit,
    onBedrock: () -> Unit,
    onLoader: (HubLogic.DetectedGame) -> Unit,
    onPcMods: () -> Unit,
    onRefresh: () -> Unit,
    icon: @Composable (String) -> Unit = { AppIcon(it) },
) {
    var showAll by rememberSaveable { mutableStateOf(false) }
    val moddable = detected?.filter { it.moddable }.orEmpty()
    val others = detected?.filter { !it.moddable }.orEmpty()
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item(key = "bedrock") { BedrockBanner(onBedrock) }
        item(key = "h") { SectionHead("Seus jogos com mods", action = "Atualizar", color = hubTab("mods").color, onAction = onRefresh) }
        when {
            detected == null -> item(key = "loading") { ListSkeleton(3, 48.dp) }
            moddable.isEmpty() -> item(key = "none") {
                Text(
                    "Nenhum jogo com mods conhecido neste celular. Minecraft, Mindustry, Geometry Dash (com Geode) e outros aparecem aqui quando instalados.",
                    color = PC.Muted, style = MaterialTheme.typography.bodyMedium,
                )
            }
            else -> items(moddable, key = { it.app.packageName }) { g -> DetectedCard(g, icon, onLaunch, onBedrock, onLoader) }
        }
        if (others.isNotEmpty()) {
            item(key = "others-h") {
                SectionHead("Outros jogos instalados · ${others.size}", action = if (showAll) "Esconder" else "Mostrar", onAction = { showAll = !showAll })
            }
            if (showAll) items(others, key = { "o-" + it.app.packageName }) { g ->
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(PC.Surface).clickable { onLaunch(g) }.padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(36.dp).clip(RoundedCornerShape(10.dp))) { icon(g.app.packageName) }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(g.app.label, color = PC.Header, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("Sem um jeito conhecido de pôr mods", color = PC.Faint, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        item(key = "pc") {
            val shape = RoundedCornerShape(20.dp)
            Row(
                Modifier.fillMaxWidth().clip(shape).background(PC.Surface).border(1.dp, PC.Line, shape).clickable(onClick = onPcMods).padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)).background(PC.Surface3), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.Computer, null, tint = PC.Header)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("Mods do PC", color = PC.Header, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                    Text("Mod Manager: Nexus, Workshop, Modrinth e mais (instala pelo app do PC).", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
                }
                Icon(Icons.AutoMirrored.Outlined.OpenInNew, null, tint = PC.Muted)
            }
        }
    }
}

@Composable
private fun BedrockBanner(onClick: () -> Unit) {
    val shape = RoundedCornerShape(22.dp)
    Column(
        Modifier.fillMaxWidth().clip(shape).background(androidx.compose.ui.graphics.Brush.linearGradient(listOf(Color(0xFF1B3A1A), Color(0xFF2E6B2A), Color(0xFF5FA046))))
            .border(1.dp, Color(0x4D8BD46E), shape).clickable(onClick = onClick).padding(16.dp),
    ) {
        Text("Minecraft Bedrock", color = Color.White, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Black)
        Spacer(Modifier.height(4.dp))
        Text("Addons, texturas, mapas e skins da CurseForge. O jogo importa sozinho.", color = Color.White.copy(alpha = 0.85f), style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(12.dp))
        PillButton("Procurar addons", onClick, icon = Icons.Outlined.Search, light = true)
    }
}

/** Ícone do app instalado (do próprio Android). */
@Composable
fun AppIcon(pkg: String) {
    val ctx = LocalContext.current
    val bmp by produceState<Bitmap?>(null, pkg) { value = withContext(Dispatchers.IO) { InstalledGames.icon(ctx, pkg, 128) } }
    val b = bmp
    if (b != null) Image(b.asImageBitmap(), null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
    else Box(Modifier.fillMaxSize().background(PC.Surface3), contentAlignment = Alignment.Center) { Icon(Icons.Outlined.SportsEsports, null, tint = PC.Muted) }
}

private fun supportLabel(g: HubLogic.DetectedGame): Pair<String, Color> = when (g.mod?.support) {
    "install" -> "Instala por aqui" to PC.Green
    "loader" -> (if (g.loaderInstalled) "${g.mod?.loaderName ?: "Carregador"} instalado" else "Precisa do ${g.mod?.loaderName ?: "carregador"}") to PC.Yellow
    "ingame" -> "Mods dentro do jogo" to HubViolet
    else -> "Sem mods conhecidos" to PC.Muted
}

@Composable
private fun DetectedCard(
    g: HubLogic.DetectedGame,
    icon: @Composable (String) -> Unit,
    onLaunch: (HubLogic.DetectedGame) -> Unit,
    onBedrock: () -> Unit,
    onLoader: (HubLogic.DetectedGame) -> Unit,
) {
    val shape = RoundedCornerShape(20.dp)
    val (label, color) = supportLabel(g)
    Column(Modifier.fillMaxWidth().clip(shape).background(PC.Surface).border(1.dp, PC.Line, shape).padding(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(52.dp).clip(RoundedCornerShape(14.dp))) { icon(g.app.packageName) }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(g.mod?.name ?: g.app.label, color = PC.Header, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(4.dp))
                Row(Modifier.clip(CircleShape).background(color.copy(alpha = 0.16f)).padding(horizontal = 9.dp, vertical = 3.dp)) {
                    Text(label, color = color, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                }
            }
        }
        g.mod?.tip?.takeIf { it.isNotBlank() }?.let {
            Spacer(Modifier.height(10.dp))
            Text(it, color = PC.Text, style = MaterialTheme.typography.bodyMedium)
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            when (g.mod?.support) {
                "install" -> PillButton("Procurar addons", onBedrock, icon = Icons.Outlined.Extension, color = HubVioletDeep)
                "loader" -> PillButton(
                    if (g.loaderInstalled) "Abrir ${g.mod?.loaderName ?: "carregador"}" else "Instalar ${g.mod?.loaderName ?: "carregador"}",
                    { onLoader(g) }, icon = if (g.loaderInstalled) Icons.Outlined.PlayArrow else Icons.Outlined.Download, color = HubVioletDeep,
                )
                else -> {}
            }
            GhostButton("Abrir jogo", { onLaunch(g) }, icon = Icons.Outlined.PlayArrow)
        }
    }
}

// ---------- Tela: addons do Minecraft Bedrock ----------

private const val SORT_POPULAR = "popular"

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BedrockScreen(repo: Repository, nav: AppNav) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var q by rememberSaveable { mutableStateOf("") }
    var cls by rememberSaveable { mutableStateOf(0) }
    var sort by rememberSaveable { mutableStateOf(SORT_POPULAR) }
    var classes by remember { mutableStateOf<List<BedrockClass>>(emptyList()) }
    val mods = remember { mutableStateListOf<BedrockAddon>() }
    var page by remember { mutableStateOf(0) }
    var more by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var noKey by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var open by remember { mutableStateOf<BedrockAddon?>(null) }
    var importing by remember { mutableStateOf(false) }
    val hasMinecraft = remember { InstalledGames.isInstalled(ctx, BedrockInstaller.MINECRAFT) }

    fun failOf(e: Throwable) {
        if (e is ApiException && e.code == "no_key") noKey = true else error = e.message ?: "Não deu pra carregar."
    }

    fun load(reset: Boolean) {
        scope.launch {
            loading = true
            val p = if (reset) 0 else page + 1
            val qs = buildList {
                add("sort=$sort"); add("page=$p")
                if (q.isNotBlank()) add("q=" + android.net.Uri.encode(q.trim()))
                if (cls > 0) add("class=$cls")
            }.joinToString("&")
            runCatching { repo.api.get<BedrockSearchResponse>("/api/game-hub/bedrock/search?$qs") }
                .onSuccess { r ->
                    if (reset) mods.clear()
                    mods.addAll(r.mods.filter { m -> mods.none { it.id == m.id } })
                    page = r.page; more = r.hasMore; error = null; noKey = false
                }
                .onFailure(::failOf)
            loading = false
        }
    }
    LaunchedEffect(Unit) {
        runCatching { repo.api.get<BedrockClassesResponse>("/api/game-hub/bedrock/classes").classes }.onSuccess { classes = it }
    }
    LaunchedEffect(q, cls, sort) {
        if (q.isNotBlank()) delay(400)
        load(true)
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        importing = true
        scope.launch {
            runCatching { BedrockInstaller.importLocal(ctx, uri) }
                .onSuccess { f -> if (!BedrockInstaller.openInMinecraft(ctx, f)) ctx.toast("Instale o Minecraft pra importar.") }
                .onFailure { ctx.toast(it.message ?: "Não deu pra abrir o arquivo.") }
            importing = false
        }
    }

    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        PcTopBar(
            "Addons do Minecraft", Icons.Outlined.Extension,
            navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } },
            actions = {
                IconButton(onClick = { picker.launch(arrayOf("*/*")) }) { Icon(Icons.Outlined.FolderOpen, "Instalar arquivo do celular", tint = PC.Text) }
            },
        )
        BedrockContent(
            mods, classes, q, cls, sort, loading, more, noKey, error, hasMinecraft, importing,
            onQuery = { q = it }, onClass = { cls = it }, onSort = { sort = it },
            onMore = { load(false) }, onOpen = { open = it },
            onImport = { picker.launch(arrayOf("*/*")) },
            onGetMinecraft = { InstalledGames.openStore(ctx, BedrockInstaller.MINECRAFT) },
        )
    }
    open?.let { a -> AddonSheet(repo, nav, a, hasMinecraft) { open = null } }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BedrockContent(
    mods: List<BedrockAddon>,
    classes: List<BedrockClass>,
    q: String,
    cls: Int,
    sort: String,
    loading: Boolean,
    more: Boolean,
    noKey: Boolean,
    error: String?,
    hasMinecraft: Boolean,
    importing: Boolean,
    onQuery: (String) -> Unit,
    onClass: (Int) -> Unit,
    onSort: (String) -> Unit,
    onMore: () -> Unit,
    onOpen: (BedrockAddon) -> Unit,
    onImport: () -> Unit,
    onGetMinecraft: () -> Unit,
) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (!hasMinecraft) item(key = "nomc") {
            val shape = RoundedCornerShape(18.dp)
            Row(Modifier.fillMaxWidth().clip(shape).background(PC.Yellow.copy(alpha = 0.12f)).border(1.dp, PC.Yellow.copy(alpha = 0.35f), shape).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("O Minecraft não está instalado neste celular.", color = PC.Header, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                GhostButton("Instalar", onGetMinecraft)
            }
        }
        item(key = "import") {
            val shape = RoundedCornerShape(18.dp)
            Row(
                Modifier.fillMaxWidth().clip(shape).background(PC.Surface).border(1.dp, PC.Line, shape).clickable(enabled = !importing, onClick = onImport).padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.FolderOpen, null, tint = HubViolet)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(if (importing) "Abrindo o arquivo…" else "Instalar arquivo do celular", color = PC.Header, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                    Text(".mcpack, .mcaddon, .mcworld ou .mctemplate que você já baixou", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        if (noKey) {
            item(key = "nokey") {
                EmptyState(Icons.Outlined.Extension, "Catálogo ainda desligado", "A busca de addons da CurseForge ainda não foi ligada no servidor. Dá pra instalar arquivos que já estão no celular aqui em cima.")
            }
            return@LazyColumn
        }
        item(key = "filters") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                PcField(q, onQuery, "Buscar addon, textura, mapa…", icon = Icons.Outlined.Search)
                if (classes.isNotEmpty()) LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    item { HubChip("Tudo", cls == 0, { onClass(0) }) }
                    items(classes, key = { it.id }) { c -> HubChip(c.name, cls == c.id, { onClass(c.id) }) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    HubChip("Populares", sort == SORT_POPULAR, { onSort(SORT_POPULAR) })
                    HubChip("Atualizados", sort == "updated", { onSort("updated") })
                    HubChip("Mais baixados", sort == "downloads", { onSort("downloads") })
                }
            }
        }
        when {
            mods.isEmpty() && loading -> item(key = "loading") { ListSkeleton(5, 56.dp) }
            mods.isEmpty() && error != null -> item(key = "err") { EmptyState(Icons.Outlined.Extension, "Não deu pra carregar", error) }
            mods.isEmpty() -> item(key = "empty") { EmptyState(Icons.Outlined.Search, "Nada encontrado", "Tente outro nome ou outro tipo.") }
            else -> items(mods, key = { it.id }) { m -> AddonRow(m) { onOpen(m) } }
        }
        if (more && mods.isNotEmpty()) item(key = "more") { GhostButton(if (loading) "Carregando…" else "Ver mais", onMore, Modifier.fillMaxWidth()) }
        item(key = "credit") { Text("Catálogo da CurseForge. Os arquivos vêm direto do site deles.", color = PC.Faint, style = MaterialTheme.typography.bodySmall) }
    }
}

@Composable
private fun AddonRow(m: BedrockAddon, onClick: () -> Unit) {
    val shape = RoundedCornerShape(18.dp)
    Row(
        Modifier.fillMaxWidth().clip(shape).background(PC.Surface).border(1.dp, PC.Line, shape).clickable(onClick = onClick).padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(58.dp).clip(RoundedCornerShape(14.dp)).background(PC.Surface2), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.Extension, null, tint = PC.Faint)
            if (m.icon != null) AsyncImage(m.icon, m.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(m.name, color = PC.Header, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(m.summary, color = PC.Muted, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(
                listOfNotNull("${HubLogic.count(m.downloads)} downloads", m.authors.firstOrNull(), m.mainFile?.versions?.firstOrNull()).joinToString(" · "),
                color = PC.Faint, style = MaterialTheme.typography.labelSmall, maxLines = 1,
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun AddonSheet(repo: Repository, nav: AppNav, addon: BedrockAddon, hasMinecraft: Boolean, onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var files by remember { mutableStateOf<List<BedrockFile>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf<Long?>(null) }
    var progress by remember { mutableStateOf(0f) }
    LaunchedEffect(addon.id) {
        runCatching { repo.api.get<BedrockFilesResponse>("/api/game-hub/bedrock/mods/${addon.id}/files").files }
            .onSuccess { files = it }.onFailure { error = it.message ?: "Não deu pra ver os arquivos." }
    }
    fun install(f: BedrockFile) {
        val url = f.downloadUrl
        if (url == null || !addon.canDownload) { addon.url?.let(nav::external); return }
        busy = f.id; progress = 0f
        scope.launch {
            runCatching { BedrockInstaller.download(ctx, url, f.fileName.ifBlank { "${addon.name}.mcpack" }) { p -> progress = p } }
                .onSuccess { file ->
                    if (!f.installable) ctx.toast("Esse arquivo não é um pacote do Minecraft: abra pelo gerenciador de arquivos.")
                    if (!BedrockInstaller.openInMinecraft(ctx, file)) ctx.toast("Nenhum app abriu o arquivo.")
                }
                .onFailure { ctx.toast(it.message ?: "O download falhou.") }
            busy = null
        }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = PC.Surface) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(64.dp).clip(RoundedCornerShape(16.dp)).background(PC.Surface2)) {
                    if (addon.icon != null) AsyncImage(addon.icon, addon.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(addon.name, color = PC.Header, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text(listOfNotNull(addon.authors.firstOrNull(), "${HubLogic.count(addon.downloads)} downloads").joinToString(" · "), color = PC.Muted, style = MaterialTheme.typography.bodySmall)
                }
            }
            if (addon.summary.isNotBlank()) Text(addon.summary, color = PC.Text, style = MaterialTheme.typography.bodyMedium)
            if (addon.categories.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                addon.categories.forEach { HubBadge(it, PC.Surface3, textColor = PC.Text) }
            }
            if (!addon.canDownload) Text("O autor só deixa baixar pelo site da CurseForge.", color = PC.Yellow, style = MaterialTheme.typography.bodySmall)
            if (!hasMinecraft) Text("Instale o Minecraft antes: o arquivo é entregue ao jogo.", color = PC.Yellow, style = MaterialTheme.typography.bodySmall)
            SectionHead("Arquivos")
            val list = files
            when {
                list == null && error != null -> Text(error!!, color = PC.Red)
                list == null -> ListSkeleton(3, 36.dp)
                list.isEmpty() -> Text("Sem arquivos pra baixar.", color = PC.Muted)
                else -> list.take(12).forEach { f ->
                    val shape = RoundedCornerShape(16.dp)
                    Column(Modifier.fillMaxWidth().clip(shape).background(PC.Surface2).padding(12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(f.name, color = PC.Header, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Text(
                                    listOfNotNull(
                                        HubLogic.size(f.size).takeIf { f.size > 0 }, f.versions.firstOrNull(),
                                        when (f.channel) { "beta" -> "beta"; "alpha" -> "alfa"; else -> null }, HubLogic.ago(f.date).ifBlank { null },
                                    ).joinToString(" · "),
                                    color = PC.Muted, style = MaterialTheme.typography.labelSmall,
                                )
                            }
                            Spacer(Modifier.width(8.dp))
                            if (f.downloadUrl == null || !addon.canDownload) GhostButton("Site", { install(f) }, icon = Icons.AutoMirrored.Outlined.OpenInNew)
                            else PillButton(if (f.installable) "Instalar" else "Baixar", { install(f) }, icon = Icons.Outlined.Download, busy = busy == f.id, enabled = busy == null, color = HubVioletDeep)
                        }
                        if (busy == f.id) {
                            Spacer(Modifier.height(8.dp))
                            if (progress >= 0f) LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth(), color = HubViolet, trackColor = PC.Surface3)
                            else LinearProgressIndicator(Modifier.fillMaxWidth(), color = HubViolet, trackColor = PC.Surface3)
                        }
                    }
                }
            }
            addon.url?.let { u -> GhostButton("Ver na CurseForge", { nav.external(u) }, Modifier.fillMaxWidth(), icon = Icons.AutoMirrored.Outlined.OpenInNew) }
            Spacer(Modifier.height(16.dp))
        }
    }
}
