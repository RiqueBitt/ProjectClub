package com.projectclub.android.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Casino
import androidx.compose.material.icons.outlined.CreditCard
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Remove
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SmartDisplay
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.data.Repository
import com.projectclub.android.net.ApiException
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/*
 * Botão "Atividades" do chat (igual ao ActivitiesComposerButton.jsx do site):
 * Rolar dados · YouTube · Música · Mostrar cartão. Cada uma manda um link
 * interno como mensagem, e o link vira cartão (LinkCards.kt).
 */

@Serializable
private data class IdResponse(val id: String = "")

@Serializable
data class YtVideo(
    val videoId: String = "",
    val title: String? = null,
    val channel: String? = null,
    val duration: String? = null,
    val thumbnail: String? = null,
)

@Serializable
private data class YtList(val videos: List<YtVideo> = emptyList(), val items: List<YtVideo> = emptyList()) {
    val all: List<YtVideo> get() = (videos + items).filter { it.videoId.isNotBlank() }
}

private val YT_ID = Regex("^[A-Za-z0-9_-]{11}$")

/** Aceita o id, youtu.be/…, youtube.com/watch?v=…, /shorts/…, music.youtube.com… */
private fun videoIdFrom(text: String): String? {
    val s = text.trim()
    if (YT_ID.matches(s)) return s
    val u = runCatching { android.net.Uri.parse(if (s.startsWith("http")) s else "https://$s") }.getOrNull() ?: return null
    val host = u.host?.removePrefix("www.")?.removePrefix("m.")?.removePrefix("music.") ?: return null
    val id = when {
        host == "youtu.be" -> u.pathSegments.firstOrNull()
        host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com") ->
            if (u.path == "/watch") u.getQueryParameter("v")
            else u.pathSegments.takeIf { it.size >= 2 && it[0] in setOf("shorts", "embed", "live", "v") }?.get(1)
        else -> null
    }
    return id?.takeIf { YT_ID.matches(it) }
}

private enum class ActMode { MENU, DICE, VIDEO, MUSIC }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActivitiesSheet(repo: Repository, onDismiss: () -> Unit, onSendText: (String) -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var mode by remember { mutableStateOf(ActMode.MENU) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val base = Config.baseUrl

    fun fail(e: Throwable, fallback: String) {
        error = when {
            e is ApiException && e.status == 404 -> "O servidor ainda não foi reiniciado com a versão nova. Tente de novo daqui a pouco."
            else -> e.message?.takeIf { it.isNotBlank() } ?: fallback
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = PC.Surface) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 12.dp)) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (mode != ActMode.MENU) IconButton(onClick = { mode = ActMode.MENU; error = null }) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, "Voltar", tint = PC.Muted)
                } else Spacer(Modifier.width(12.dp))
                Text(
                    when (mode) { ActMode.MENU -> "Atividades"; ActMode.DICE -> "Rolar dados"; ActMode.VIDEO -> "YouTube"; ActMode.MUSIC -> "Música" },
                    color = PC.Header, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold,
                )
            }
            error?.let { Text(it, color = PC.Red, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp)) }
            when (mode) {
                ActMode.MENU -> {
                    ActionRow(Icons.Outlined.Casino, Color(0xFFFF8A2A), "Rolar dados", "Do D2 ao D100, quantos quiser") { mode = ActMode.DICE }
                    ActionRow(Icons.Outlined.SmartDisplay, Color(0xFFFF2D2D), "YouTube", "Manda um vídeo pra assistir") { mode = ActMode.VIDEO }
                    ActionRow(Icons.Outlined.MusicNote, Color(0xFFA855F7), "Música", "Manda uma música do YouTube Music") { mode = ActMode.MUSIC }
                    ActionRow(Icons.Outlined.CreditCard, PC.Brand, if (busy) "Mostrando…" else "Mostrar cartão", "Manda o seu cartão da carteira no chat") {
                        if (busy) return@ActionRow
                        busy = true; error = null
                        scope.launch {
                            runCatching { repo.api.post<IdResponse>("/api/economy/card/share") }
                                .onSuccess { onSendText("mostrou o cartão da carteira: $base/carteira/${it.id}"); onDismiss() }
                                .onFailure { fail(it, "Não foi possível mostrar o cartão.") }
                            busy = false
                        }
                    }
                }
                ActMode.DICE -> DicePicker(busy) { groups, modifier, label ->
                    busy = true; error = null
                    scope.launch {
                        val body = buildJsonObject {
                            put("groups", JsonArray(groups.map { (sides, count) -> buildJsonObject { put("sides", sides); put("count", count) } }))
                            put("modifier", modifier)
                            if (label.isNotBlank()) put("label", JsonPrimitive(label.trim()))
                        }
                        runCatching { repo.api.post<IdResponse>("/api/activities/dice", body) }
                            .onSuccess { onSendText("$base/atividade/dados/${it.id}"); onDismiss() }
                            .onFailure { fail(it, "Não deu pra rolar os dados.") }
                        busy = false
                    }
                }
                ActMode.VIDEO, ActMode.MUSIC -> {
                    val music = mode == ActMode.MUSIC
                    YoutubePicker(repo, music) { id ->
                        onSendText("$base/atividade/${if (music) "musica" else "video"}/$id"); onDismiss()
                    }
                }
            }
        }
    }
}

@Composable
private fun ActionRow(icon: ImageVector, color: Color, title: String, desc: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 20.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(42.dp).clip(RoundedCornerShape(12.dp)).background(color), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = Color.White, modifier = Modifier.size(22.dp))
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = PC.Header, fontWeight = FontWeight.Bold)
            Text(desc, color = PC.Muted, style = MaterialTheme.typography.bodySmall)
        }
    }
}

/* ---------------- Dados ---------------- */

private val SIDES = listOf(2, 4, 6, 8, 10, 12, 20, 100)

@Composable
private fun DicePicker(busy: Boolean, onRoll: (groups: List<Pair<Int, Int>>, modifier: Int, label: String) -> Unit) {
    val counts = remember { mutableStateMapOf<Int, Int>() }
    var modifier by remember { mutableIntStateOf(0) }
    var label by remember { mutableStateOf("") }
    val total = counts.values.sum()
    Column(Modifier.padding(horizontal = 16.dp)) {
        Text("Toque num dado pra pôr na mesa (até 30).", color = PC.Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(bottom = 10.dp))
        LazyVerticalGrid(GridCells.Fixed(4), Modifier.heightIn(max = 260.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(SIDES) { s ->
                val n = counts[s] ?: 0
                val color = DICE_COLORS[s] ?: PC.Brand
                Column(
                    Modifier.clip(RoundedCornerShape(14.dp)).background(if (n > 0) color.copy(alpha = 0.16f) else PC.Surface2)
                        .border(1.dp, if (n > 0) color.copy(alpha = 0.6f) else PC.Line, RoundedCornerShape(14.dp))
                        .clickable(enabled = total < 30 && n < 20) { counts[s] = n + 1 }.padding(vertical = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    DieFace(s, s, 40.dp)
                    Text("D$s", color = PC.Header, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelMedium)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(24.dp).clip(CircleShape).clickable(enabled = n > 0) { if (n <= 1) counts.remove(s) else counts[s] = n - 1 }, contentAlignment = Alignment.Center) {
                            Icon(Icons.Outlined.Remove, "Tirar", tint = if (n > 0) PC.Text else PC.Faint, modifier = Modifier.size(16.dp))
                        }
                        Text("$n", color = if (n > 0) PC.Header else PC.Faint, fontWeight = FontWeight.Bold, modifier = Modifier.width(20.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                        Box(Modifier.size(24.dp).clip(CircleShape).clickable(enabled = total < 30 && n < 20) { counts[s] = n + 1 }, contentAlignment = Alignment.Center) {
                            Icon(Icons.Outlined.Add, "Pôr", tint = PC.Text, modifier = Modifier.size(16.dp))
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Bônus", color = PC.Text, modifier = Modifier.weight(1f))
            IconButton(onClick = { if (modifier > -999) modifier-- }) { Icon(Icons.Outlined.Remove, "Menos", tint = PC.Text) }
            Text((if (modifier > 0) "+" else "") + modifier, color = PC.Header, fontWeight = FontWeight.Bold, fontSize = 18.sp, modifier = Modifier.width(48.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            IconButton(onClick = { if (modifier < 999) modifier++ }) { Icon(Icons.Outlined.Add, "Mais", tint = PC.Text) }
        }
        OutlinedTextField(
            label, { label = it.take(60) }, Modifier.fillMaxWidth(), singleLine = true,
            placeholder = { Text("Pra quê? (ex.: Ataque) — opcional") },
        )
        Spacer(Modifier.height(12.dp))
        val can = total > 0 && !busy
        Box(
            Modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(14.dp)).background(if (can) Color(0xFFFF8A2A) else PC.Surface2)
                .clickable(enabled = can) { onRoll(counts.filterValues { it > 0 }.toSortedMap().map { (k, v) -> k to v }, modifier, label) },
            contentAlignment = Alignment.Center,
        ) {
            if (busy) CircularProgressIndicator(Modifier.size(22.dp), color = Color.White, strokeWidth = 2.dp)
            else Text(
                if (total == 0) "Escolha os dados" else "Rolar " + counts.filterValues { it > 0 }.toSortedMap().map { (k, v) -> "${v}d$k" }.joinToString(" + ") +
                    (if (modifier != 0) (if (modifier > 0) " + $modifier" else " − ${-modifier}") else ""),
                color = if (can) Color.White else PC.Muted, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/* ---------------- YouTube / Música ---------------- */

@Composable
private fun YoutubePicker(repo: Repository, music: Boolean, onPick: (String) -> Unit) {
    var q by remember { mutableStateOf("") }
    var list by remember { mutableStateOf<List<YtVideo>?>(null) }
    var token by remember { mutableIntStateOf(0) }
    var query by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(token) {
        list = null
        val path = query?.let { "/api/youtube/search?q=" + android.net.Uri.encode(if (music) "$it música" else it) }
            ?: if (music) "/api/youtube/search?q=" + android.net.Uri.encode("músicas em alta") else "/api/youtube/trending?category=now"
        list = runCatching { repo.api.get<YtList>(path).all }.getOrDefault(emptyList())
    }
    fun submit() {
        val id = videoIdFrom(q)
        if (id != null) onPick(id) else if (q.isNotBlank()) { query = q.trim(); token++ }
    }
    Column(Modifier.padding(horizontal = 16.dp)) {
        OutlinedTextField(
            q, { q = it }, Modifier.fillMaxWidth(), singleLine = true,
            placeholder = { Text(if (music) "Procurar música ou colar o link" else "Procurar vídeo ou colar o link") },
            trailingIcon = { IconButton(onClick = ::submit) { Icon(Icons.Outlined.Search, "Procurar") } },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { submit() }),
        )
        Spacer(Modifier.height(8.dp))
        val items = list
        when {
            items == null -> Box(Modifier.fillMaxWidth().height(160.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(26.dp)) }
            items.isEmpty() -> Text("Nada encontrado. Tente outra busca ou cole o link do vídeo.", color = PC.Muted, modifier = Modifier.padding(vertical = 24.dp))
            else -> LazyColumn(Modifier.heightIn(max = 420.dp)) {
                items(items, key = { it.videoId }) { v ->
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable { onPick(v.videoId) }.padding(vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.width(if (music) 56.dp else 120.dp).then(if (music) Modifier.aspectRatio(1f) else Modifier.aspectRatio(16f / 9f)).clip(RoundedCornerShape(8.dp)).background(Color.Black)) {
                            AsyncImage(v.thumbnail ?: "https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg", null, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize())
                            if (!music) v.duration?.takeIf { it.isNotBlank() }?.let {
                                Text(
                                    it, color = Color.White, fontSize = 10.sp,
                                    modifier = Modifier.align(Alignment.BottomEnd).padding(3.dp).clip(RoundedCornerShape(4.dp)).background(Color(0xB3000000)).padding(horizontal = 4.dp),
                                )
                            }
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(v.title ?: "Vídeo", color = PC.Header, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
                            v.channel?.let { Text(it, color = PC.Muted, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                        }
                    }
                }
            }
        }
    }
}
