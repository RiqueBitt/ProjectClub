package com.projectclub.android.ui.activity

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.data.Repository
import com.projectclub.android.data.User
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.EmptyState
import com.projectclub.android.ui.common.ListSkeleton
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.common.formatTime
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.profile.LocalOpenUser
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Serializable data class FeedPost(val id: String = "", val title: String? = null, val excerpt: String? = null, val imageUrl: String? = null, val score: Int = 0, val commentCount: Int = 0)
@Serializable data class FeedModpack(val id: String = "", val name: String = "", val gameName: String? = null, val coverUrl: String? = null, val downloadCount: Int = 0, val likeCount: Int = 0)
@Serializable data class FeedAchievement(val name: String = "", val description: String? = null, val rarity: String? = null, val iconUrl: String? = null)
@Serializable data class FeedLevel(val level: Int = 0, val levelName: String? = null)
@Serializable data class FeedCheers(val count: Int = 0, val mine: Boolean = false, val users: List<User> = emptyList())
@Serializable data class FeedItem(
    val key: String, val type: String, val at: String? = null, val user: User? = null, val updated: Boolean = false,
    val post: FeedPost? = null, val modpack: FeedModpack? = null, val achievement: FeedAchievement? = null, val level: FeedLevel? = null,
    val cheers: FeedCheers = FeedCheers(),
)
@Serializable data class NowActivity(val type: String? = null, val name: String = "", val detail: String? = null, val imageUrl: String? = null)
@Serializable data class FeedNow(val user: User? = null, val activity: NowActivity? = null)
@Serializable data class ActivityFeed(val friendCount: Int = 0, val now: List<FeedNow> = emptyList(), val items: List<FeedItem> = emptyList(), val nextBefore: String? = null)

private val FILTERS = listOf("all" to "Tudo", "post" to "Posts", "modpack" to "Modpacks", "achievement" to "Conquistas", "level" to "Níveis")

/** Atividade dos amigos (igual à página /atividade do PC): jogando agora + linha do tempo com "Parabéns". */
@Composable
fun ActivityScreen(repo: Repository, nav: AppNav) {
    var feed by remember { mutableStateOf<ActivityFeed?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var filter by remember { mutableStateOf("all") }
    var loadingMore by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val openUser = LocalOpenUser.current
    LaunchedEffect(Unit) {
        runCatching { repo.api.get<ActivityFeed>("/api/activity/feed") }.onSuccess { feed = it }.onFailure { error = it.message ?: "Não deu pra carregar." }
    }
    fun more() {
        val before = feed?.nextBefore ?: return
        if (loadingMore) return
        loadingMore = true
        scope.launch {
            runCatching { repo.api.get<ActivityFeed>("/api/activity/feed?before=${java.net.URLEncoder.encode(before, "UTF-8")}") }
                .onSuccess { n -> feed = feed?.copy(items = feed!!.items + n.items, nextBefore = n.nextBefore) }
            loadingMore = false
        }
    }
    fun cheer(item: FeedItem) {
        scope.launch {
            runCatching { repo.api.postIgnore("/api/activity/cheer", buildJsonObject { put("itemKey", item.key) }) }.onSuccess {
                feed = feed?.copy(items = feed!!.items.map {
                    if (it.key != item.key) it
                    else it.copy(cheers = it.cheers.copy(mine = !it.cheers.mine, count = (it.cheers.count + if (it.cheers.mine) -1 else 1).coerceAtLeast(0)))
                })
            }
        }
    }

    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        PcTopBar("Atividade", Icons.Outlined.Bolt, navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } })
        val f = feed
        when {
            error != null -> EmptyState(Icons.Outlined.Bolt, "Não deu pra carregar", error!!)
            f == null -> ListSkeleton(8, 46.dp)
            f.friendCount == 0 -> EmptyState(Icons.Outlined.Bolt, "Sem amigos ainda", "Adicione amigos pra ver o que eles estão fazendo.")
            else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (f.now.isNotEmpty()) item(key = "now") {
                    Text("JOGANDO AGORA", color = PC.Muted, style = MaterialTheme.typography.labelSmall)
                    Spacer(Modifier.height(8.dp))
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        f.now.forEach { n ->
                            Column(
                                Modifier.width(210.dp).clip(RoundedCornerShape(16.dp)).background(PC.Surface).border(1.dp, PC.Line, RoundedCornerShape(16.dp))
                                    .clickable { n.user?.id?.let(openUser) },
                            ) {
                                Box(Modifier.fillMaxWidth().height(90.dp).background(PC.Surface2)) {
                                    Config.media(n.activity?.imageUrl)?.let { AsyncImage(it, null, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize()) }
                                }
                                Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Avatar(n.user, 30.dp)
                                    Spacer(Modifier.width(8.dp))
                                    Column {
                                        Text(n.user?.name ?: "…", color = PC.Header, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        Text(n.activity?.name ?: "", color = PC.Green, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    }
                                }
                            }
                        }
                    }
                }
                item(key = "filters") {
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FILTERS.forEach { (k, label) -> com.projectclub.android.ui.forum.SelectPill(label, filter == k, { filter = k }) }
                    }
                }
                val shown = f.items.filter { filter == "all" || it.type == filter }
                if (shown.isEmpty()) item { Text("Nada por aqui ainda.", color = PC.Muted, modifier = Modifier.padding(8.dp)) }
                items(shown, key = { it.key }) { item -> FeedCard(item, onUser = { item.user?.id?.let(openUser) }, onCheer = { cheer(item) }, onOpen = {
                    when (item.type) { "post" -> item.post?.id?.let(nav::post); else -> Unit }
                }) }
                if (f.nextBefore != null) item(key = "more") {
                    LaunchedEffect(f.nextBefore) { more() }
                    Box(Modifier.fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) { Text("Carregando mais…", color = PC.Muted) }
                }
            }
        }
    }
}

@Composable
private fun FeedCard(item: FeedItem, onUser: () -> Unit, onCheer: () -> Unit, onOpen: () -> Unit) {
    val (what, accent) = when (item.type) {
        "post" -> "publicou no Feed" to PC.Brand
        "modpack" -> (if (item.updated) "atualizou um modpack" else "criou um modpack") to PC.Purple
        "achievement" -> "desbloqueou uma conquista" to PC.Yellow
        "level" -> "subiu de nível" to PC.Green
        else -> "" to PC.Muted
    }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(PC.Surface).border(1.dp, PC.Line, RoundedCornerShape(18.dp)).clickable(onClick = onOpen).padding(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(item.user, 36.dp, modifier = Modifier.clickable(onClick = onUser))
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(item.user?.name ?: "…", color = PC.Header, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("$what · ${formatTime(item.at)}", color = PC.Muted, style = MaterialTheme.typography.labelSmall)
            }
            Box(Modifier.size(10.dp).clip(RoundedCornerShape(5.dp)).background(accent))
        }
        Spacer(Modifier.height(10.dp))
        when (item.type) {
            "post" -> item.post?.let { p ->
                p.title?.let { Text(it, color = PC.Header, fontWeight = FontWeight.SemiBold) }
                p.excerpt?.takeIf { it.isNotBlank() }?.let { Text(it, color = PC.Text, maxLines = 3, overflow = TextOverflow.Ellipsis) }
                Config.media(p.imageUrl)?.let { AsyncImage(it, null, contentScale = ContentScale.Crop, modifier = Modifier.padding(top = 8.dp).fillMaxWidth().height(160.dp).clip(RoundedCornerShape(12.dp))) }
                Text("▲ ${p.score} · ${p.commentCount} comentários", color = PC.Muted, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 6.dp))
            }
            "modpack" -> item.modpack?.let { m ->
                Text(m.name, color = PC.Header, fontWeight = FontWeight.SemiBold)
                Text(listOfNotNull(m.gameName, "${m.downloadCount} downloads", "${m.likeCount} curtidas").joinToString(" · "), color = PC.Muted, style = MaterialTheme.typography.labelSmall)
            }
            "achievement" -> item.achievement?.let { a ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(40.dp).clip(RoundedCornerShape(10.dp)).background(PC.Surface2), contentAlignment = Alignment.Center) {
                        val img = Config.media(a.iconUrl)
                        if (img != null) AsyncImage(img, a.name, modifier = Modifier.size(30.dp)) else Text("🏆")
                    }
                    Spacer(Modifier.width(10.dp))
                    Column {
                        Text(a.name, color = PC.Header, fontWeight = FontWeight.SemiBold)
                        a.description?.let { Text(it, color = PC.Muted, style = MaterialTheme.typography.bodySmall) }
                    }
                }
            }
            "level" -> item.level?.let { l -> Text("Nível ${l.level}" + (l.levelName?.let { " · $it" } ?: ""), color = PC.Green, fontWeight = FontWeight.Bold) }
        }
        Spacer(Modifier.height(10.dp))
        Row(
            Modifier.clip(RoundedCornerShape(50)).background(if (item.cheers.mine) PC.BrandSoft else PC.Surface2).clickable(onClick = onCheer).padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("🎉", color = PC.Text)
            Spacer(Modifier.width(6.dp))
            Text(if (item.cheers.count > 0) "Parabéns · ${item.cheers.count}" else "Parabéns", color = if (item.cheers.mine) PC.Brand else PC.Text, style = MaterialTheme.typography.labelLarge)
        }
    }
}
