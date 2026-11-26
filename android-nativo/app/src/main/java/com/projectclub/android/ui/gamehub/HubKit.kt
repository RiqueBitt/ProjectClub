package com.projectclub.android.ui.gamehub

import android.content.Context
import android.widget.Toast
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import coil.imageLoader
import coil.request.CachePolicy
import coil.request.ImageRequest
import com.projectclub.android.Config
import com.projectclub.android.data.GameSearchResponse
import com.projectclub.android.data.HubGame
import com.projectclub.android.data.Repository
import com.projectclub.android.gamehub.HubLogic
import com.projectclub.android.net.isCancellation
import com.projectclub.android.ui.common.PcField
import com.projectclub.android.ui.common.rememberShimmer
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Cor do Game Hub (a mesma do atalho "Game Hub" e do site). */
val HubViolet = Color(0xFFA970FF)
val HubVioletDeep = Color(0xFF6D3BD6)
val HubGradient: Brush get() = Brush.linearGradient(listOf(Color(0xFF1C0D38), Color(0xFF341670), HubVioletDeep))

/** Seção do Game Hub: nome, ícone e cor (a mesma no menu de baixo e nos atalhos do Início). */
data class HubTab(val key: String, val label: String, val icon: ImageVector, val color: Color)

val HUB_TABS = listOf(
    HubTab("inicio", "Início", Icons.Outlined.Home, HubViolet),
    HubTab("promocoes", "Promoções", Icons.Outlined.LocalOffer, Color(0xFF38BDF8)),
    HubTab("partidas", "Partidas", Icons.Outlined.Groups, Color(0xFFC08BFF)),
    HubTab("clipes", "Clipes", Icons.Outlined.VideoLibrary, Color(0xFFFF5C7A)),
    HubTab("builds", "Builds", Icons.Outlined.Construction, Color(0xFFFF9F43)),
    HubTab("mods", "Mods", Icons.Outlined.Extension, Color(0xFF4ADE80)),
)

fun hubTab(key: String?) = HUB_TABS.firstOrNull { it.key == key } ?: HUB_TABS.first()

/**
 * Menu do Game Hub, fixo embaixo: as seis seções sempre à vista (nada
 * escondido rolando pro lado). [badges] = número em cima do ícone.
 */
@Composable
fun HubBottomBar(selected: String, onSelect: (String) -> Unit, badges: Map<String, Int> = emptyMap()) {
    Column(Modifier.fillMaxWidth().background(PC.Bar)) {
        HorizontalDivider(color = PC.Line)
        Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 4.dp, vertical = 6.dp)) {
            HUB_TABS.forEach { t ->
                val on = selected == t.key
                val tint by animateColorAsState(if (on) t.color else PC.Muted, label = "tint")
                Column(
                    Modifier.weight(1f).clip(RoundedCornerShape(14.dp)).clickable { onSelect(t.key) }.padding(vertical = 4.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Box(
                            Modifier.size(width = 52.dp, height = 30.dp).clip(CircleShape)
                                .background(if (on) t.color.copy(alpha = 0.18f) else Color.Transparent),
                            contentAlignment = Alignment.Center,
                        ) { Icon(t.icon, null, tint = tint, modifier = Modifier.size(22.dp)) }
                        val n = badges[t.key] ?: 0
                        if (n > 0) Box(
                            Modifier.align(Alignment.TopEnd).heightIn(min = 16.dp).clip(CircleShape).background(t.color).padding(horizontal = 5.dp),
                            contentAlignment = Alignment.Center,
                        ) { Text(if (n > 9) "9+" else "$n", color = Color.Black, fontSize = 10.sp, fontWeight = FontWeight.Bold) }
                    }
                    Spacer(Modifier.height(3.dp))
                    Text(
                        t.label, color = if (on) PC.Header else PC.Muted, fontSize = 11.sp, maxLines = 1,
                        fontWeight = if (on) FontWeight.Bold else FontWeight.Medium, overflow = TextOverflow.Clip,
                    )
                }
            }
        }
    }
}

/** Filtro em pílula: cheio (cor da seção) quando escolhido. */
@Composable
fun HubChip(text: String, selected: Boolean, onClick: () -> Unit, icon: ImageVector? = null, modifier: Modifier = Modifier, color: Color = HubVioletDeep) {
    val shape = CircleShape
    Row(
        modifier.heightIn(min = 36.dp).clip(shape)
            .background(if (selected) color else PC.Surface)
            .border(1.dp, if (selected) color else PC.LineStrong, shape)
            .clickable(onClick = onClick).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) { Icon(icon, null, tint = if (selected) Color.White else PC.Muted, modifier = Modifier.size(17.dp)); Spacer(Modifier.width(6.dp)) }
        Text(text, color = if (selected) Color.White else PC.Text, style = MaterialTheme.typography.labelLarge, maxLines = 1)
    }
}

/** Dois a quatro botões grudados (ex.: "Do clube | Neste celular"). */
@Composable
fun Segmented(options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier, icons: List<ImageVector?> = emptyList()) {
    Row(modifier.fillMaxWidth().clip(CircleShape).background(PC.Surface).border(1.dp, PC.Line, CircleShape).padding(4.dp)) {
        options.forEachIndexed { i, (k, label) ->
            val on = k == selected
            Row(
                Modifier.weight(1f).height(40.dp).clip(CircleShape).background(if (on) HubVioletDeep else Color.Transparent).clickable { onSelect(k) },
                horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
            ) {
                icons.getOrNull(i)?.let { Icon(it, null, tint = if (on) Color.White else PC.Muted, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)) }
                Text(label, color = if (on) Color.White else PC.Text, style = MaterialTheme.typography.labelLarge, fontWeight = if (on) FontWeight.Bold else FontWeight.Medium, maxLines = 1)
            }
        }
    }
}

/** Título de seção com um tracinho da cor e ação opcional à direita ("Ver todas"). */
@Composable
fun SectionHead(title: String, modifier: Modifier = Modifier, action: String? = null, color: Color = HubViolet, onAction: () -> Unit = {}) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(width = 4.dp, height = 18.dp).clip(CircleShape).background(color))
        Spacer(Modifier.width(10.dp))
        Text(title, color = PC.Header, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        if (action != null) Text(
            action, color = color, style = MaterialTheme.typography.labelLarge,
            modifier = Modifier.clip(CircleShape).clickable(onClick = onAction).padding(horizontal = 8.dp, vertical = 4.dp),
        )
    }
}

// ---------- Capas ----------

private fun fallbackBrush(name: String): Brush {
    val palette = listOf(
        Color(0xFF3B1F73) to Color(0xFF16112A), Color(0xFF1F4E73) to Color(0xFF0F1A2A), Color(0xFF6B2340) to Color(0xFF1E0F17),
        Color(0xFF1F6B4A) to Color(0xFF0E1E17), Color(0xFF7A4A12) to Color(0xFF22160A),
    )
    val (a, b) = palette[(name.hashCode() and 0x7fffffff) % palette.size]
    return Brush.linearGradient(listOf(a, b))
}

/**
 * Capa de jogo: tenta cada imagem de [arts] (se uma falhar, vai pra próxima)
 * com um brilho enquanto carrega. Imagem vertical num espaço largo aparece
 * inteira, com a própria imagem desfocada no fundo. Sem nenhuma imagem: um
 * cartão com o nome do jogo.
 */
@Composable
fun GameArt(arts: List<HubLogic.Art>, name: String, modifier: Modifier = Modifier, shape: Shape = RoundedCornerShape(14.dp), wide: Boolean = true, showName: Boolean = true) {
    val ctx = LocalContext.current
    val list = remember(arts) { arts.distinctBy { it.url } }
    var index by remember(list) { mutableIntStateOf(0) }
    var loaded by remember(list, index) { mutableStateOf(false) }
    val art = list.getOrNull(index)
    Box(modifier.clip(shape).background(fallbackBrush(name)), contentAlignment = Alignment.Center) {
        if (art == null) {
            if (showName) Text(
                name.trim().ifBlank { "?" }, color = Color.White.copy(alpha = 0.92f), textAlign = TextAlign.Center,
                style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Black, maxLines = 3, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(10.dp),
            )
        } else {
            if (!loaded) Box(Modifier.matchParentSize().background(rememberShimmer()))
            val url = Config.media(art.url) ?: art.url
            val req = remember(url) { ImageRequest.Builder(ctx).data(url).crossfade(160).build() }
            if (art.tall && wide) {
                // Fundo desfocado: a mesma imagem bem pequena, esticada (funciona em qualquer Android).
                val bg = remember(url) { ImageRequest.Builder(ctx).data(url).size(28).build() }
                AsyncImage(
                    bg, null, contentScale = ContentScale.Crop, filterQuality = FilterQuality.High,
                    modifier = Modifier.matchParentSize().alpha(if (loaded) 0.5f else 0f),
                )
                AsyncImage(
                    req, name, contentScale = ContentScale.Fit, modifier = Modifier.matchParentSize(),
                    onSuccess = { loaded = true }, onError = { index++ },
                )
            } else {
                AsyncImage(
                    req, name, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize(),
                    onSuccess = { loaded = true }, onError = { index++ },
                )
            }
        }
    }
}

/** Capa larga de um jogo (Steam, imagem da loja ou a que o servidor achou). [small] = lista (imagem menor, carrega mais rápido). */
@Composable
fun GameCover(
    name: String,
    modifier: Modifier = Modifier,
    steamAppId: Long? = null,
    image: String? = null,
    shape: Shape = RoundedCornerShape(14.dp),
    imageTall: Boolean = false,
    cover: String? = null,
    coverTall: Boolean = false,
    small: Boolean = false,
) {
    val arts = remember(steamAppId, image, imageTall, cover, coverTall, small) {
        HubLogic.coverCandidates(steamAppId, image, imageTall, cover, coverTall, small = small)
    }
    GameArt(arts, name, modifier, shape, wide = true, showName = !small)
}

/** Cartaz em pé (Mais jogados do mês): começa pelas capas verticais. */
@Composable
fun GamePoster(name: String, modifier: Modifier = Modifier, steamAppId: Long? = null, cover: String? = null, coverTall: Boolean = false, image: String? = null) {
    val arts = remember(steamAppId, cover, coverTall, image) { HubLogic.coverCandidates(steamAppId, image, false, cover, coverTall, poster = true) }
    GameArt(arts, name, modifier, RoundedCornerShape(16.dp), wide = false)
}

/** Já baixa as capas pro cache do disco (trocar de aba e rolar fica instantâneo). */
fun prefetchCovers(ctx: Context, urls: List<String?>) {
    val loader = ctx.imageLoader
    urls.filterNotNull().filter { it.startsWith("http") }.distinct().take(48).forEach { u ->
        loader.enqueue(ImageRequest.Builder(ctx).data(u).memoryCachePolicy(CachePolicy.DISABLED).build())
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
        GameCover(g.name, Modifier.width(92.dp).height(43.dp), g.steamAppId, shape = RoundedCornerShape(10.dp), cover = g.cover, coverTall = g.coverTall, small = true)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(g.name, color = PC.Header, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) Text(subtitle, color = PC.Muted, style = MaterialTheme.typography.bodySmall)
        }
    }
}
