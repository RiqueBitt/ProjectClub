package com.projectclub.android.ui.gamehub

import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Construction
import androidx.compose.material.icons.outlined.Extension
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.LocalOffer
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SportsEsports
import androidx.compose.material.icons.outlined.VideoLibrary
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.data.GameSearchResponse
import com.projectclub.android.data.HubGame
import com.projectclub.android.data.Repository
import com.projectclub.android.gamehub.HubLogic
import com.projectclub.android.net.isCancellation
import com.projectclub.android.ui.common.PcField
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Cor do Game Hub (a mesma do atalho "Jogos" e do site). */
val HubViolet = Color(0xFFA970FF)
val HubVioletDeep = Color(0xFF6D3BD6)
val HubGradient: Brush get() = Brush.linearGradient(listOf(Color(0xFF241046), Color(0xFF3B1A78), HubVioletDeep))

data class HubTab(val key: String, val label: String, val icon: ImageVector)

val HUB_TABS = listOf(
    HubTab("inicio", "Início", Icons.Outlined.Home),
    HubTab("promocoes", "Promoções", Icons.Outlined.LocalOffer),
    HubTab("partidas", "Partidas", Icons.Outlined.Groups),
    HubTab("clipes", "Clipes", Icons.Outlined.VideoLibrary),
    HubTab("builds", "Builds", Icons.Outlined.Construction),
    HubTab("mods", "Mods", Icons.Outlined.Extension),
)

/** Barra de abas do Game Hub (rola na horizontal). */
@Composable
fun HubTabRow(selected: String, onSelect: (String) -> Unit) {
    LazyRow(
        Modifier.fillMaxWidth().background(PC.Bar),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(HUB_TABS, key = { it.key }) { t ->
            HubChip(t.label, selected == t.key, { onSelect(t.key) }, t.icon)
        }
    }
}

/** Filtro em pílula: cheio (violeta) quando escolhido. */
@Composable
fun HubChip(text: String, selected: Boolean, onClick: () -> Unit, icon: ImageVector? = null, modifier: Modifier = Modifier) {
    val shape = CircleShape
    Row(
        modifier.heightIn(min = 36.dp).clip(shape)
            .background(if (selected) HubViolet else PC.Surface)
            .border(1.dp, if (selected) HubViolet else PC.LineStrong, shape)
            .clickable(onClick = onClick).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) { Icon(icon, null, tint = if (selected) Color.White else PC.Muted, modifier = Modifier.size(17.dp)); Spacer(Modifier.width(6.dp)) }
        Text(text, color = if (selected) Color.White else PC.Text, style = MaterialTheme.typography.labelLarge, maxLines = 1)
    }
}

/** Título de seção com ação opcional à direita ("Ver todas"). */
@Composable
fun SectionHead(title: String, modifier: Modifier = Modifier, action: String? = null, onAction: () -> Unit = {}) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, color = PC.Header, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        if (action != null) Text(action, color = HubViolet, style = MaterialTheme.typography.labelLarge, modifier = Modifier.clip(CircleShape).clickable(onClick = onAction).padding(horizontal = 8.dp, vertical = 4.dp))
    }
}

/** Capa do jogo: imagem da Steam, ícone salvo, ou um bloco com a inicial. */
@Composable
fun GameCover(name: String, modifier: Modifier = Modifier, steamAppId: Long? = null, image: String? = null, shape: RoundedCornerShape = RoundedCornerShape(14.dp)) {
    val url = image ?: HubLogic.steamCover(steamAppId)
    Box(modifier.clip(shape).background(Brush.linearGradient(listOf(Color(0xFF2A1A4A), Color(0xFF15151C)))), contentAlignment = Alignment.Center) {
        Text(
            name.trim().take(1).uppercase().ifBlank { "?" },
            color = HubViolet.copy(alpha = 0.75f), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Black,
        )
        if (url != null) AsyncImage(Config.media(url) ?: url, name, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize())
    }
}

/** Selo pequeno de cantinho (desconto, "Grátis", nº do ranking). */
@Composable
fun HubBadge(text: String, color: Color, modifier: Modifier = Modifier, textColor: Color = Color.White) {
    Box(modifier.clip(RoundedCornerShape(8.dp)).background(color).padding(horizontal = 7.dp, vertical = 2.dp)) {
        Text(text, color = textColor, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

fun Context.toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

/** Carrega algo da API e guarda o estado (dados, erro, carregando). */
@Stable
class Loader<T>(private val scope: CoroutineScope, private val fetch: suspend () -> T) {
    var data by mutableStateOf<T?>(null)
    var error by mutableStateOf<String?>(null)
    var loading by mutableStateOf(true)
        private set

    fun reload() {
        scope.launch {
            loading = true
            runCatching { fetch() }
                .onSuccess { data = it; error = null }
                .onFailure { if (!it.isCancellation()) error = it.message ?: "Não deu pra carregar." }
            loading = false
        }
    }
}

@Composable
fun <T> rememberLoader(vararg keys: Any?, fetch: suspend () -> T): Loader<T> {
    val scope = rememberCoroutineScope()
    val loader = remember(*keys) { Loader(scope, fetch) }
    LaunchedEffect(loader) { loader.reload() }
    return loader
}

/** Busca de jogo (catálogo da Steam via /api/games/search) ou nome livre. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GamePickerSheet(repo: Repository, onPick: (HubGame) -> Unit, onDismiss: () -> Unit) {
    var q by remember { mutableStateOf("") }
    var hits by remember { mutableStateOf<List<HubGame>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }
    LaunchedEffect(q) {
        val term = q.trim()
        if (term.length < 2) { hits = emptyList(); return@LaunchedEffect }
        delay(300)
        searching = true
        runCatching { repo.api.get<GameSearchResponse>("/api/games/search?q=" + java.net.URLEncoder.encode(term, "UTF-8")) }
            .onSuccess { r -> hits = r.games.map { it.toHubGame() } }
        searching = false
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = PC.Surface) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).navigationBarsPadding().imePadding()) {
            Text("Escolher jogo", color = PC.Header, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(12.dp))
            PcField(q, { q = it }, "Nome do jogo", icon = Icons.Outlined.Search)
            Spacer(Modifier.height(12.dp))
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 460.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (q.trim().length >= 2) item(key = "free") {
                    GameRow(HubGame(name = q.trim()), subtitle = "Usar esse nome") { onPick(HubGame(name = q.trim())) }
                }
                items(hits, key = { "${it.steamAppId}-${it.name}" }) { g -> GameRow(g, subtitle = if (searching) null else "Steam") { onPick(g) } }
                if (q.trim().length < 2) item(key = "hint") {
                    Row(Modifier.padding(vertical = 24.dp).fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                        Icon(Icons.Outlined.SportsEsports, null, tint = PC.Faint)
                        Spacer(Modifier.width(8.dp))
                        Text("Digite pelo menos 2 letras", color = PC.Muted)
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}

@Composable
private fun GameRow(g: HubGame, subtitle: String?, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(PC.Surface2).clickable(onClick = onClick).padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        GameCover(g.name, Modifier.width(92.dp).height(43.dp), g.steamAppId, shape = RoundedCornerShape(10.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(g.name, color = PC.Header, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) Text(subtitle, color = PC.Muted, style = MaterialTheme.typography.bodySmall)
        }
    }
}
