package com.projectclub.android.ui.gallery

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Favorite
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.data.GalleryItem
import com.projectclub.android.data.GalleryLikesResponse
import com.projectclub.android.data.GalleryListResponse
import com.projectclub.android.data.GalleryToggleResponse
import com.projectclub.android.data.Repository
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.Bone
import com.projectclub.android.ui.common.EmptyState
import com.projectclub.android.ui.common.GhostButton
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.common.formatTime
import com.projectclub.android.ui.common.rememberShimmer
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.store.rememberAnimatedImageLoader
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.net.URLEncoder

/** Galeria: fotos, GIFs e vídeos postados nos canais e no Fórum. */
@Composable
fun GalleryScreen(repo: Repository, nav: AppNav) {
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<GalleryItem>?>(null) }
    var next by remember { mutableStateOf<String?>(null) }
    var loadingMore by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var source by rememberSaveable { mutableStateOf("all") }
    var likes by remember { mutableStateOf(mapOf<String, Int>()) }
    var mine by remember { mutableStateOf(setOf<String>()) }
    var viewing by remember { mutableStateOf<GalleryItem?>(null) }
    val grid = rememberLazyGridState()

    suspend fun lookup(list: List<GalleryItem>) {
        if (list.isEmpty()) return
        runCatching {
            val r = repo.api.post<GalleryLikesResponse>("/api/gallery/likes/lookup", buildJsonObject { put("keys", buildJsonArray { list.forEach { add(JsonPrimitive(it.id)) } }) })
            likes = likes + r.counts; mine = mine + r.mine
        }
    }

    suspend fun load(more: Boolean) {
        try {
            val q = StringBuilder("/api/community/gallery?limit=48&source=").append(source)
            if (more && next != null) q.append("&before=").append(URLEncoder.encode(next, "UTF-8"))
            val r = repo.api.get<GalleryListResponse>(q.toString())
            items = if (more) items.orEmpty() + r.items else r.items
            next = r.nextBefore
            error = null
            lookup(r.items)
        } catch (e: Exception) { if (items == null) error = e.message ?: "Não deu pra abrir a Galeria." }
    }
    LaunchedEffect(source) { items = null; next = null; load(false) }
    val nearEnd by remember { derivedStateOf { (grid.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= (items?.size ?: 0) - 6 } }
    LaunchedEffect(nearEnd, next) {
        if (nearEnd && next != null && !loadingMore && items != null) { loadingMore = true; load(true); loadingMore = false }
    }

    fun toggle(item: GalleryItem) = scope.launch {
        runCatching {
            val r = repo.api.post<GalleryToggleResponse>("/api/gallery/likes/toggle", buildJsonObject { put("key", item.id) })
            likes = likes + (item.id to r.count); mine = if (r.liked) mine + item.id else mine - item.id
        }
    }

    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        PcTopBar("Galeria", Icons.Outlined.PhotoLibrary, navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } })
        val list = items
        when {
            list == null && error != null -> EmptyState(Icons.Outlined.CloudOff, "Não deu pra abrir", error ?: "", Modifier.padding(top = 40.dp)) {
                GhostButton("Tentar de novo", { scope.launch { error = null; load(false) } })
            }
            list == null -> {
                val b = rememberShimmer()
                LazyVerticalGrid(GridCells.Fixed(3), contentPadding = PaddingValues(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    items(18) { Bone(b, Modifier.aspectRatio(1f), RoundedCornerShape(8.dp)) }
                }
            }
            else -> LazyVerticalGrid(
                GridCells.Fixed(3), state = grid, contentPadding = PaddingValues(4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                item(span = { GridItemSpan(3) }) {
                    Row(Modifier.padding(8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("all" to "Tudo", "channels" to "Canais", "posts" to "Fórum").forEach { (k, label) ->
                            com.projectclub.android.ui.forum.SelectPill(label, source == k, { source = k })
                        }
                    }
                }
                if (list.isEmpty()) item(span = { GridItemSpan(3) }) { EmptyState(Icons.Outlined.PhotoLibrary, "Nada por aqui", "As fotos e vídeos postados aparecem aqui.") }
                items(list, key = { it.id }) { item -> Tile(item, likes[item.id] ?: 0) { viewing = item } }
                item(span = { GridItemSpan(3) }) { Spacer(Modifier.navigationBarsPadding()) }
            }
        }
    }

    viewing?.let { item ->
        Viewer(item, likes[item.id] ?: 0, item.id in mine, onLike = { toggle(item) }, onOpenSource = {
            viewing = null
            when {
                item.postId != null -> nav.post(item.postId)
                item.channel?.id != null -> nav.room(com.projectclub.android.data.Room(channelId = item.channel.id))
            }
        }, onAuthor = { item.author?.id?.let { viewing = null; nav.profile(it) } }) { viewing = null }
    }
}

@Composable
private fun Tile(item: GalleryItem, likes: Int, onClick: () -> Unit) {
    val loader = rememberAnimatedImageLoader()
    Box(Modifier.aspectRatio(1f).clip(RoundedCornerShape(8.dp)).background(PC.Surface2).clickable(onClick = onClick)) {
        if (!item.isVideo) AsyncImage(Config.media(item.url), item.filename, imageLoader = loader, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        else Icon(Icons.Outlined.PlayCircle, "Vídeo", tint = Color.White, modifier = Modifier.align(Alignment.Center).size(36.dp))
        if (likes > 0) Row(
            Modifier.align(Alignment.BottomEnd).padding(4.dp).clip(CircleShape).background(Color(0x99000000)).padding(horizontal = 6.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.Favorite, null, tint = PC.Pink, modifier = Modifier.size(12.dp))
            Text(" $likes", color = Color.White, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun Viewer(item: GalleryItem, likes: Int, liked: Boolean, onLike: () -> Unit, onOpenSource: () -> Unit, onAuthor: () -> Unit, onClose: () -> Unit) {
    var scale by remember { mutableFloatStateOf(1f) }
    var ox by remember { mutableFloatStateOf(0f) }
    var oy by remember { mutableFloatStateOf(0f) }
    val loader = rememberAnimatedImageLoader()
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            if (item.isVideo) {
                Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Outlined.PlayCircle, null, tint = Color.White, modifier = Modifier.size(64.dp))
                    GhostButton("Abrir onde foi postado", onOpenSource, color = Color.White)
                }
            } else AsyncImage(
                Config.media(item.url), null, imageLoader = loader, contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize()
                    .pointerInput(Unit) {
                        detectTransformGestures { _, pan, zoom, _ ->
                            scale = (scale * zoom).coerceIn(1f, 5f)
                            ox = if (scale > 1f) ox + pan.x else 0f
                            oy = if (scale > 1f) oy + pan.y else 0f
                        }
                    }
                    .graphicsLayer { scaleX = scale; scaleY = scale; translationX = ox; translationY = oy },
            )
            Row(Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(8.dp)) {
                IconButton(onClick = onClose) { Icon(Icons.Outlined.Close, "Fechar", tint = Color.White) }
            }
            Row(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Color(0xAA000000)).navigationBarsPadding().padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(Modifier.weight(1f).clickable(onClick = onAuthor), verticalAlignment = Alignment.CenterVertically) {
                    Avatar(item.author, 32.dp)
                    Spacer(Modifier.width(8.dp))
                    Column {
                        Text(item.author?.name ?: "", color = Color.White, style = MaterialTheme.typography.labelLarge)
                        Text(item.title ?: item.channel?.name?.let { "#$it" } ?: formatTime(item.createdAt), color = Color(0xBBFFFFFF), style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                IconButton(onClick = onLike) { Icon(if (liked) Icons.Outlined.Favorite else Icons.Outlined.FavoriteBorder, "Curtir", tint = if (liked) PC.Pink else Color.White) }
                Text("$likes", color = Color.White)
                IconButton(onClick = onOpenSource) { Icon(Icons.Outlined.OpenInNew, "Ver onde foi postado", tint = Color.White) }
            }
        }
    }
}
