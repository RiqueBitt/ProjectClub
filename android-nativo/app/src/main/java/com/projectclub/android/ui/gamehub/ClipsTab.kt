package com.projectclub.android.ui.gamehub

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Favorite
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.FiberManualRecord
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.Smartphone
import androidx.compose.material.icons.outlined.SportsEsports
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.VideoLibrary
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
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
import androidx.core.content.ContextCompat
import com.projectclub.android.data.ClipResponse
import com.projectclub.android.data.ClipsResponse
import com.projectclub.android.data.GameClip
import com.projectclub.android.data.HubGame
import com.projectclub.android.data.LikeResponse
import com.projectclub.android.data.Repository
import com.projectclub.android.gamehub.HubLogic
import com.projectclub.android.gamehub.clips.ClipEvent
import com.projectclub.android.gamehub.clips.ClipRecorder
import com.projectclub.android.gamehub.clips.ClipSettings
import com.projectclub.android.gamehub.clips.ClipState
import com.projectclub.android.gamehub.clips.ClipStore
import com.projectclub.android.gamehub.clips.LocalClip
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.EmptyState
import com.projectclub.android.ui.common.FullscreenVideo
import com.projectclub.android.ui.common.GhostButton
import com.projectclub.android.ui.common.ListSkeleton
import com.projectclub.android.ui.common.PcField
import com.projectclub.android.ui.common.PillButton
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Composable
fun ClipsTab(repo: Repository, nav: AppNav, startOnPhone: Boolean = false) {
    var phone by rememberSaveable { mutableStateOf(startOnPhone) }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            HubChip("Do clube", !phone, { phone = false }, Icons.Outlined.VideoLibrary)
            HubChip("Neste celular", phone, { phone = true }, Icons.Outlined.Smartphone)
        }
        if (phone) PhoneClips() else ClubClips(repo, nav)
    }
}

// ---------- Do clube ----------

internal fun openVideo(ctx: android.content.Context, nav: AppNav, url: String) {
    // YouTube/Twitch abrem no app deles quando tiver; senão, no navegador.
    try { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    catch (_: ActivityNotFoundException) { nav.external(url) }
}

@Composable
private fun ClubClips(repo: Repository, nav: AppNav) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var mine by rememberSaveable { mutableStateOf(false) }
    val clips = remember(mine) { mutableStateListOf<GameClip>() }
    var more by remember(mine) { mutableStateOf(false) }
    var loading by remember(mine) { mutableStateOf(true) }
    var error by remember(mine) { mutableStateOf<String?>(null) }
    var sharing by remember { mutableStateOf(false) }

    fun load(reset: Boolean) {
        scope.launch {
            loading = true
            val before = if (reset) null else clips.lastOrNull()?.createdAt
            val qs = buildList {
                if (mine) add("mine=1")
                before?.let { add("before=" + Uri.encode(it)) }
            }.joinToString("&")
            runCatching { repo.api.get<ClipsResponse>("/api/game-hub/clips" + if (qs.isEmpty()) "" else "?$qs") }
                .onSuccess { r ->
                    if (reset) clips.clear()
                    clips.addAll(r.clips.filter { c -> clips.none { it.id == c.id } })
                    more = r.more; error = null
                }
                .onFailure { error = it.message ?: "Não deu pra carregar." }
            loading = false
        }
    }
    LaunchedEffect(mine) { load(true) }

    when {
        clips.isEmpty() && loading -> ListSkeleton(5, 72.dp)
        clips.isEmpty() && error != null -> EmptyState(Icons.Outlined.VideoLibrary, "Não deu pra carregar", error!!)
        else -> ClubClipsContent(
            clips, mine, more, loading,
            onMine = { mine = it },
            onShare = { sharing = true },
            onOpen = { openVideo(ctx, nav, it.url) },
            onMore = { load(false) },
            onLike = { c ->
                scope.launch {
                    runCatching { repo.api.post<LikeResponse>("/api/game-hub/clips/${c.id}/like") }.onSuccess { r ->
                        val i = clips.indexOfFirst { it.id == c.id }
                        if (i >= 0) clips[i] = clips[i].copy(liked = r.liked, likesCount = r.likesCount)
                    }.onFailure { ctx.toast(it.message ?: "Não deu certo.") }
                }
            },
            onDelete = { c ->
                scope.launch {
                    runCatching { repo.api.delete("/api/game-hub/clips/${c.id}") }
                        .onSuccess { clips.removeAll { it.id == c.id } }
                        .onFailure { ctx.toast(it.message ?: "Não deu pra apagar.") }
                }
            },
        )
    }
    if (sharing) ShareClipSheet(repo, onDismiss = { sharing = false }) { c ->
        sharing = false
        if (c != null) { clips.add(0, c); ctx.toast("Clipe compartilhado!") }
    }
}

@Composable
fun ClubClipsContent(
    clips: List<GameClip>,
    mine: Boolean,
    more: Boolean,
    loading: Boolean,
    onMine: (Boolean) -> Unit,
    onShare: () -> Unit,
    onOpen: (GameClip) -> Unit,
    onMore: () -> Unit,
    onLike: (GameClip) -> Unit,
    onDelete: (GameClip) -> Unit,
) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item(key = "top") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                HubChip("Todos", !mine, { onMine(false) })
                Spacer(Modifier.width(8.dp))
                HubChip("Meus", mine, { onMine(true) })
                Spacer(Modifier.weight(1f))
                PillButton("Compartilhar", onShare, icon = Icons.Outlined.Add, color = HubVioletDeep)
            }
        }
        if (clips.isEmpty()) item(key = "empty") {
            EmptyState(
                Icons.Outlined.VideoLibrary, if (mine) "Você ainda não compartilhou clipes" else "Nenhum clipe ainda",
                "Grave no celular ou no PC, mande pro YouTube, Twitch, Medal ou Streamable e cole o link aqui.",
            )
        }
        items(clips, key = { it.id }) { c -> ClipCard(c, { onOpen(c) }, { onLike(c) }, { onDelete(c) }) }
        if (more) item(key = "more") {
            GhostButton(if (loading) "Carregando…" else "Ver mais", onMore, Modifier.fillMaxWidth())
        }
    }
}

private fun providerName(p: String) = when (p) { "youtube" -> "YouTube"; "twitch" -> "Twitch"; "medal" -> "Medal"; "streamable" -> "Streamable"; else -> p }
private fun providerColor(p: String) = when (p) {
    "youtube" -> Color(0xFFFF0033); "twitch" -> Color(0xFF9146FF); "medal" -> Color(0xFFF5B400); "streamable" -> Color(0xFF0F90FA); else -> PC.Surface3
}

@Composable
fun ClipCard(c: GameClip, onOpen: () -> Unit, onLike: () -> Unit, onDelete: () -> Unit) {
    val shape = RoundedCornerShape(20.dp)
    Column(Modifier.fillMaxWidth().clip(shape).background(PC.Surface).border(1.dp, PC.Line, shape)) {
        Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).clickable(onClick = onOpen)) {
            GameCover(c.game?.name ?: c.title, Modifier.matchParentSize(), c.game?.steamAppId, image = c.thumb, shape = RoundedCornerShape(0.dp))
            Box(Modifier.align(Alignment.Center).size(54.dp).clip(CircleShape).background(Color(0x99000000)), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.PlayArrow, "Assistir", tint = Color.White, modifier = Modifier.size(34.dp))
            }
            HubBadge(providerName(c.provider), providerColor(c.provider), Modifier.align(Alignment.TopStart).padding(10.dp))
        }
        Row(Modifier.padding(start = 14.dp, end = 4.dp, top = 10.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(c.author, 34.dp, decoration = false)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(c.title, color = PC.Header, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(
                    listOfNotNull(c.author?.name, c.game?.name, HubLogic.ago(c.createdAt).ifBlank { null }).joinToString(" · "),
                    color = PC.Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            Row(Modifier.clip(CircleShape).clickable(onClick = onLike).padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(if (c.liked) Icons.Outlined.Favorite else Icons.Outlined.FavoriteBorder, "Curtir", tint = if (c.liked) PC.Pink else PC.Muted, modifier = Modifier.size(20.dp))
                if (c.likesCount > 0) { Spacer(Modifier.width(4.dp)); Text("${c.likesCount}", color = PC.Text, style = MaterialTheme.typography.labelLarge) }
            }
            if (c.mine) IconButton(onClick = onDelete) { Icon(Icons.Outlined.Delete, "Apagar", tint = PC.Muted) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShareClipSheet(repo: Repository, onDismiss: () -> Unit, onDone: (GameClip?) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var url by remember { mutableStateOf("") }
    var title by remember { mutableStateOf("") }
    var game by remember { mutableStateOf<HubGame?>(null) }
    var picking by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = PC.Surface) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).navigationBarsPadding().imePadding(),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("Compartilhar clipe", color = PC.Header, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text("O vídeo fica no site de vídeo; aqui vai só o link.", color = PC.Muted, style = MaterialTheme.typography.bodyMedium)
            PcField(url, { url = it.trim() }, "https://youtu.be/…", label = "Link do clipe", icon = Icons.Outlined.Link)
            PcField(title, { if (it.length <= 100) title = it }, "Ex.: Clutch 1v4 no B", label = "Título")
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(PC.Surface2).clickable { picking = true }.padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.SportsEsports, null, tint = PC.Muted)
                Spacer(Modifier.width(10.dp))
                Text(game?.name ?: "Jogo (opcional)", color = if (game == null) PC.Muted else PC.Header, modifier = Modifier.weight(1f))
                if (game != null) Text("Trocar", color = HubViolet, style = MaterialTheme.typography.labelLarge)
            }
            PillButton(
                "Compartilhar", {
                    saving = true
                    scope.launch {
                        val body = buildJsonObject {
                            put("url", url)
                            put("title", title.trim())
                            game?.let { g -> put("gameName", g.name); g.steamAppId?.let { put("steamAppId", it) } }
                        }
                        runCatching { repo.api.post<ClipResponse>("/api/game-hub/clips", body).clip }
                            .onSuccess { onDone(it) }
                            .onFailure { ctx.toast(it.message ?: "Não deu pra compartilhar.") }
                        saving = false
                    }
                },
                Modifier.fillMaxWidth(), enabled = url.startsWith("http") && title.trim().length >= 2, busy = saving, color = HubVioletDeep,
            )
            Spacer(Modifier.height(12.dp))
        }
    }
    if (picking) GamePickerSheet(repo, onPick = { game = it; picking = false }, onDismiss = { picking = false })
}

// ---------- Neste celular ----------

/** Ações do gravador (a tela liga a permissão e o serviço). */
class RecorderActions(
    val onSettings: (ClipSettings) -> Unit = {},
    val onStart: () -> Unit = {},
    val onSave: () -> Unit = {},
    val onStop: () -> Unit = {},
    val onPlay: (LocalClip) -> Unit = {},
    val onShare: (LocalClip) -> Unit = {},
    val onDelete: (LocalClip) -> Unit = {},
)

@Composable
private fun PhoneClips() {
    val ctx = LocalContext.current
    var settings by remember { mutableStateOf(ClipSettings.load(ctx)) }
    val state by ClipRecorder.state.collectAsState()
    val version by ClipStore.version.collectAsState()
    val clips by produceState<List<LocalClip>?>(null, version) { value = withContext(Dispatchers.IO) { ClipStore.list(ctx) } }
    var playing by remember { mutableStateOf<LocalClip?>(null) }

    LaunchedEffect(Unit) {
        ClipRecorder.events.collect { ev ->
            when (ev) {
                is ClipEvent.Saved -> ctx.toast("Clipe salvo na Galeria!")
                is ClipEvent.Failed -> ctx.toast(ev.message)
            }
        }
    }

    val capture = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val data = res.data
        if (res.resultCode == Activity.RESULT_OK && data != null) ClipRecorder.start(ctx, res.resultCode, data, settings)
        else ctx.toast("Sem a autorização do Android não dá pra gravar a tela.")
    }
    fun askCapture() {
        val mpm = ctx.getSystemService(MediaProjectionManager::class.java)
        runCatching { capture.launch(mpm.createScreenCaptureIntent()) }.onFailure { ctx.toast("Este celular não deixa gravar a tela.") }
    }
    val perms = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { askCapture() }
    val deleter = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { res ->
        if (res.resultCode == Activity.RESULT_OK) ClipStore.changed()
    }
    fun granted(p: String) = ContextCompat.checkSelfPermission(ctx, p) == PackageManager.PERMISSION_GRANTED

    val actions = RecorderActions(
        onSettings = { s -> settings = s; ClipSettings.save(ctx, s) },
        onStart = {
            val need = buildList {
                if (Build.VERSION.SDK_INT >= 33 && !granted(Manifest.permission.POST_NOTIFICATIONS)) add(Manifest.permission.POST_NOTIFICATIONS)
                if (settings.audio && Build.VERSION.SDK_INT >= 29 && !granted(Manifest.permission.RECORD_AUDIO)) add(Manifest.permission.RECORD_AUDIO)
            }
            if (need.isEmpty()) askCapture() else perms.launch(need.toTypedArray())
        },
        onSave = { ClipRecorder.saveReplay(ctx) },
        onStop = { ClipRecorder.stop(ctx) },
        onPlay = { playing = it },
        onShare = { c -> runCatching { ctx.startActivity(ClipStore.shareIntent(ctx, c)) } },
        onDelete = { c ->
            runCatching { ClipStore.delete(ctx, c) }
                .onSuccess { sender -> if (sender != null) deleter.launch(IntentSenderRequest.Builder(sender).build()) }
                .onFailure { ctx.toast("Não deu pra apagar.") }
        },
    )
    PhoneClipsContent(state, settings, clips, Build.VERSION.SDK_INT >= 29, actions)
    playing?.let { c -> FullscreenVideo(c.uri.toString()) { playing = null } }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PhoneClipsContent(state: ClipState, settings: ClipSettings, clips: List<LocalClip>?, audioSupported: Boolean, actions: RecorderActions) {
    val running = state as? ClipState.Running
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item(key = "rec") {
            val shape = RoundedCornerShape(22.dp)
            Column(Modifier.fillMaxWidth().clip(shape).background(HubGradient).border(1.dp, HubViolet.copy(alpha = 0.35f), shape).padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    RecDot(running != null)
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            when {
                                running == null -> "Gravador de clipes"
                                running.saving -> "Salvando o clipe…"
                                running.settings.mode == ClipSettings.MODE_BUFFER -> "Replay ligado"
                                else -> "Gravando a tela"
                            },
                            color = Color.White, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold,
                        )
                        Text(
                            when {
                                running == null && settings.mode == ClipSettings.MODE_BUFFER -> "Fica guardando os últimos ${settings.seconds} s. Salve quando rolar a jogada."
                                running == null -> "Grava até você parar."
                                running.settings.mode == ClipSettings.MODE_BUFFER -> "Vá pro jogo: o botão Salvar fica na notificação." + if (running.withAudio) "" else " (sem som)"
                                else -> "Pare pela notificação ou aqui." + if (running.withAudio) "" else " (sem som)"
                            },
                            color = Color.White.copy(alpha = 0.78f), style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
                Spacer(Modifier.height(14.dp))
                if (running == null) {
                    PillButton(
                        if (settings.mode == ClipSettings.MODE_BUFFER) "Ligar replay" else "Começar a gravar", actions.onStart,
                        Modifier.fillMaxWidth(), icon = Icons.Outlined.FiberManualRecord, light = true,
                    )
                } else {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (running.settings.mode == ClipSettings.MODE_BUFFER) {
                            PillButton("Salvar ${running.settings.seconds} s", actions.onSave, Modifier.weight(1f), icon = Icons.Outlined.Save, light = true, busy = running.saving)
                            PillButton("Desligar", actions.onStop, icon = Icons.Outlined.Stop, color = Color(0x33FFFFFF))
                        } else {
                            PillButton("Parar e salvar", actions.onStop, Modifier.weight(1f), icon = Icons.Outlined.Stop, light = true)
                        }
                    }
                }
            }
        }
        item(key = "settings") {
            val locked = running != null
            val shape = RoundedCornerShape(20.dp)
            Column(Modifier.fillMaxWidth().clip(shape).background(PC.Surface).border(1.dp, PC.Line, shape).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Como gravar", color = PC.Header, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    HubChip("Últimos segundos", settings.mode == ClipSettings.MODE_BUFFER, { if (!locked) actions.onSettings(settings.copy(mode = ClipSettings.MODE_BUFFER)) })
                    HubChip("Gravar e parar", settings.mode == ClipSettings.MODE_RECORD, { if (!locked) actions.onSettings(settings.copy(mode = ClipSettings.MODE_RECORD)) })
                }
                if (settings.mode == ClipSettings.MODE_BUFFER) {
                    Text("Tamanho do replay", color = PC.Muted, style = MaterialTheme.typography.labelMedium)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        ClipSettings.SECONDS.forEach { s -> HubChip("$s s", settings.seconds == s, { if (!locked) actions.onSettings(settings.copy(seconds = s)) }) }
                    }
                }
                Text("Qualidade", color = PC.Muted, style = MaterialTheme.typography.labelMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ClipSettings.QUALITIES.forEach { q -> HubChip("${q}p", settings.quality == q, { if (!locked) actions.onSettings(settings.copy(quality = q)) }) }
                }
                if (audioSupported) Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.AutoMirrored.Outlined.VolumeUp, null, tint = PC.Muted, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Som do jogo", color = PC.Header, style = MaterialTheme.typography.bodyLarge)
                        Text("Alguns jogos bloqueiam a gravação do som.", color = PC.Faint, style = MaterialTheme.typography.bodySmall)
                    }
                    Switch(
                        settings.audio, { if (!locked) actions.onSettings(settings.copy(audio = it)) }, enabled = !locked,
                        colors = SwitchDefaults.colors(checkedTrackColor = HubViolet, disabledCheckedTrackColor = HubViolet.copy(alpha = 0.45f), disabledCheckedThumbColor = Color.White.copy(alpha = 0.8f)),
                    )
                } else Text("Neste Android o clipe sai sem o som do jogo.", color = PC.Faint, style = MaterialTheme.typography.bodySmall)
                if (locked) Text("Desligue o gravador pra mudar.", color = PC.Faint, style = MaterialTheme.typography.bodySmall)
            }
        }
        item(key = "list-h") {
            SectionHead("Clipes neste celular" + (clips?.size?.takeIf { it > 0 }?.let { " · $it" } ?: ""))
            Spacer(Modifier.height(2.dp))
            Text("Ficam na Galeria (Filmes → ${ClipStore.FOLDER}). Pra mostrar no clube, mande pro YouTube e cole o link em Do clube.", color = PC.Faint, style = MaterialTheme.typography.bodySmall)
        }
        when {
            clips == null -> item(key = "loading") { ListSkeleton(2, 60.dp) }
            clips.isEmpty() -> item(key = "none") {
                EmptyState(Icons.Outlined.VideoLibrary, "Nenhum clipe ainda", "Ligue o replay, jogue e toque em Salvar quando rolar algo bom.")
            }
            else -> items(clips, key = { it.uri.toString() }) { c -> LocalClipRow(c, actions) }
        }
    }
}

@Composable
private fun RecDot(on: Boolean) {
    val pulse = rememberInfiniteTransition(label = "rec")
    val alpha by pulse.animateFloat(1f, 0.3f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "a")
    Box(
        Modifier.size(34.dp).clip(CircleShape).background(Color(0x33FFFFFF)),
        contentAlignment = Alignment.Center,
    ) { Box(Modifier.size(14.dp).clip(CircleShape).background(if (on) PC.Red.copy(alpha = alpha) else Color.White)) }
}

@Composable
private fun LocalClipRow(c: LocalClip, actions: RecorderActions) {
    val ctx = LocalContext.current
    val thumb by produceState<Bitmap?>(null, c.uri) { value = withContext(Dispatchers.IO) { ClipStore.thumbnail(ctx, c) } }
    val shape = RoundedCornerShape(18.dp)
    Row(
        Modifier.fillMaxWidth().clip(shape).background(PC.Surface).border(1.dp, PC.Line, shape).clickable { actions.onPlay(c) }.padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(128.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(12.dp)).background(Color.Black), contentAlignment = Alignment.Center) {
            thumb?.let { Image(it.asImageBitmap(), null, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize()) }
            Icon(Icons.Outlined.PlayArrow, null, tint = Color.White.copy(alpha = 0.9f))
            if (c.durationMs > 0) HubBadge(HubLogic.duration(c.durationMs), Color(0xB3000000), Modifier.align(Alignment.BottomEnd).padding(4.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(c.name.removeSuffix(".mp4"), color = PC.Header, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(HubLogic.size(c.size), color = PC.Muted, style = MaterialTheme.typography.bodySmall)
        }
        IconButton(onClick = { actions.onShare(c) }) { Icon(Icons.Outlined.Share, "Compartilhar", tint = PC.Muted) }
        IconButton(onClick = { actions.onDelete(c) }) { Icon(Icons.Outlined.Delete, "Apagar", tint = PC.Muted) }
    }
}
