package com.projectclub.android.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.EmojiEmotions
import androidx.compose.material.icons.outlined.Gif
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.StickyNote2
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.projectclub.android.BuildConfig
import com.projectclub.android.Config
import com.projectclub.android.data.Repository
import com.projectclub.android.ui.common.PcField
import com.projectclub.android.ui.forum.SelectPill
import com.projectclub.android.ui.store.rememberAnimatedImageLoader
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

private data class GifResult(val id: String, val preview: String, val full: String)

private val gifHttp by lazy { OkHttpClient.Builder().callTimeout(12, TimeUnit.SECONDS).build() }

/** Busca GIFs na KLIPY (a mesma do site). Só funciona com a chave configurada no build. */
private suspend fun searchGifs(term: String): List<GifResult> = withContext(Dispatchers.IO) {
    val key = BuildConfig.KLIPY_KEY
    if (key.isBlank()) return@withContext emptyList()
    val url = if (term.isBlank()) "https://api.klipy.com/v2/featured?key=$key&client_key=embercord&limit=30&media_filter=gif"
    else "https://api.klipy.com/v2/search?q=${URLEncoder.encode(term, "UTF-8")}&key=$key&client_key=embercord&limit=30&media_filter=gif"
    gifHttp.newCall(Request.Builder().url(url).build()).execute().use { r ->
        val body = r.body?.string().orEmpty()
        val root = com.projectclub.android.data.AppJson.parseToJsonElement(body).jsonObject
        root["results"]?.jsonArray.orEmpty().mapNotNull { el ->
            val o = el.jsonObject
            val formats = o["media_formats"] as? JsonObject ?: return@mapNotNull null
            fun fmt(k: String) = (formats[k] as? JsonObject)?.get("url")?.jsonPrimitive?.contentOrNull
            val full = fmt("gif") ?: return@mapNotNull null
            GifResult(o["id"]?.jsonPrimitive?.contentOrNull ?: full, fmt("tinygif") ?: full, full)
        }
    }
}

/** Seletor do chat: Emojis (padrão + da comunidade), GIFs e Figurinhas — igual ao do PC. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PickerSheet(
    repo: Repository,
    onDismiss: () -> Unit,
    onEmoji: (String) -> Unit,
    onGif: (String) -> Unit,
    onSticker: (String) -> Unit,
) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var tab by rememberSaveable { mutableStateOf(0) }
    val emojis by repo.emojis.collectAsState()
    val stickers by repo.stickers.collectAsState()
    val favorites by repo.favoriteGifs.collectAsState()
    val loader = rememberAnimatedImageLoader()
    LaunchedEffect(Unit) { if (emojis.isEmpty() && stickers.isEmpty()) repo.loadPickers() }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = PC.Surface) {
        Column(Modifier.fillMaxWidth().height(460.dp).navigationBarsPadding()) {
            Row(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SelectPill("Emojis", tab == 0, { tab = 0 }, icon = Icons.Outlined.EmojiEmotions)
                SelectPill("GIFs", tab == 1, { tab = 1 }, icon = Icons.Outlined.Gif)
                SelectPill("Figurinhas", tab == 2, { tab = 2 }, icon = Icons.Outlined.StickyNote2)
            }
            Box(Modifier.fillMaxSize().padding(top = 8.dp)) {
                when (tab) {
                    0 -> LazyVerticalGrid(GridCells.Adaptive(44.dp), contentPadding = PaddingValues(10.dp)) {
                        if (emojis.isNotEmpty()) {
                            item(span = { GridItemSpan(maxLineSpan) }) { Header("Da comunidade") }
                            items(emojis, key = { "c" + it.id }) { e ->
                                Box(Modifier.aspectRatio(1f).clip(RoundedCornerShape(10.dp)).clickable { onEmoji(":${e.name}:") }, contentAlignment = Alignment.Center) {
                                    AsyncImage(Config.media(e.url), e.name, imageLoader = loader, modifier = Modifier.size(30.dp))
                                }
                            }
                        }
                        EMOJI_CATEGORIES.forEach { (name, list) ->
                            item(span = { GridItemSpan(maxLineSpan) }) { Header(name) }
                            items(list.filter { it.isNotBlank() }) { e ->
                                Box(Modifier.aspectRatio(1f).clip(RoundedCornerShape(10.dp)).clickable { onEmoji(e) }, contentAlignment = Alignment.Center) {
                                    Text(e, fontSize = 26.sp)
                                }
                            }
                        }
                    }
                    1 -> GifTab(favorites.map { GifResult(it.gifId, it.preview ?: it.url, it.url) }, onGif)
                    else -> if (stickers.isEmpty()) Empty("A comunidade ainda não tem figurinhas.")
                    else LazyVerticalGrid(GridCells.Adaptive(96.dp), contentPadding = PaddingValues(10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(stickers, key = { it.id }) { st ->
                            Box(Modifier.aspectRatio(1f).clip(RoundedCornerShape(14.dp)).background(PC.Surface2).clickable { onSticker(st.url) }, contentAlignment = Alignment.Center) {
                                AsyncImage(Config.media(st.url), st.name, imageLoader = loader, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize().padding(8.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun GifTab(favorites: List<GifResult>, onGif: (String) -> Unit) {
    val canSearch = BuildConfig.KLIPY_KEY.isNotBlank()
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<GifResult>?>(null) }
    val loader = rememberAnimatedImageLoader()
    LaunchedEffect(query) {
        if (!canSearch) return@LaunchedEffect
        delay(350)
        results = runCatching { searchGifs(query) }.getOrDefault(emptyList())
    }
    Column(Modifier.fillMaxSize()) {
        if (canSearch) PcField(query, { query = it }, "Buscar GIFs", icon = Icons.Outlined.Search, modifier = Modifier.padding(horizontal = 12.dp))
        val list = if (canSearch && (query.isNotBlank() || favorites.isEmpty())) results.orEmpty() else favorites
        if (list.isEmpty()) Empty(if (canSearch) "Nenhum GIF encontrado." else "Seus GIFs favoritos aparecem aqui (favorite pelo PC).")
        else LazyVerticalGrid(GridCells.Fixed(2), contentPadding = PaddingValues(10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (!canSearch || query.isBlank()) item(span = { GridItemSpan(2) }) { Header(if (favorites.isNotEmpty() && list === favorites) "Favoritos" else "Em alta") }
            items(list, key = { it.id }) { g ->
                AsyncImage(
                    g.preview, null, imageLoader = loader, contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxWidth().height(120.dp).clip(RoundedCornerShape(12.dp)).background(PC.Surface2).clickable { onGif(g.full) },
                )
            }
        }
    }
}

@Composable
private fun Header(text: String) {
    Text(text.uppercase(), color = PC.Muted, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(start = 4.dp, top = 10.dp, bottom = 4.dp))
}

@Composable
private fun Empty(text: String) {
    Text(text, color = PC.Muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
}
