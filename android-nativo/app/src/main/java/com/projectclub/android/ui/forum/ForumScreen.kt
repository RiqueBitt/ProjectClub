package com.projectclub.android.ui.forum

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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.LocalFireDepartment
import androidx.compose.material.icons.outlined.NewReleases
import androidx.compose.material.icons.outlined.TrendingUp
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.projectclub.android.data.ForumCommunity
import com.projectclub.android.data.ForumPost
import com.projectclub.android.data.Repository
import com.projectclub.android.ui.common.EmptyState
import com.projectclub.android.ui.common.GhostButton
import com.projectclub.android.ui.common.HeroBox
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/** Fórum (/comunidades do site): temas no topo e o feed de posts. */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun ForumScreen(repo: Repository, nav: AppNav) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var communities by remember { mutableStateOf<List<ForumCommunity>?>(null) }
    var posts by remember { mutableStateOf<List<ForumPost>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var sort by rememberSaveable { mutableStateOf("hot") }
    var refreshing by remember { mutableStateOf(false) }

    suspend fun load() {
        try {
            if (communities == null) communities = runCatching { ForumApi.communities(repo) }.getOrNull()
            posts = ForumApi.posts(repo, sort)
            error = null
        } catch (e: Exception) { if (posts == null) error = errorText(e) }
    }
    LaunchedEffect(sort) { load() }

    Box(Modifier.fillMaxSize().background(PC.Bg)) {
        Column(Modifier.fillMaxSize()) {
            PcTopBar("Fórum", Icons.AutoMirrored.Outlined.Article, navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } })
            PullToRefreshBox(refreshing, onRefresh = { scope.launch { refreshing = true; communities = null; load(); refreshing = false } }, Modifier.fillMaxSize()) {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp, 16.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    item(key = "hero") {
                        HeroBox(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(20.dp)) {
                                Text("Fórum", style = MaterialTheme.typography.headlineMedium, color = Color.White)
                                Text("Posts e temas da comunidade", color = Color(0xCCFFFFFF))
                            }
                        }
                    }
                    communities?.takeIf { it.isNotEmpty() }?.let { list ->
                        item(key = "temas") {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text("Temas", style = MaterialTheme.typography.titleLarge, color = PC.Header)
                                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    list.forEach { c -> CommunityChip(c) { nav.forumCommunity(c.slug) } }
                                }
                            }
                        }
                    }
                    item(key = "sort") {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            SelectPill("Em alta", sort == "hot", { sort = "hot" }, icon = Icons.Outlined.LocalFireDepartment)
                            SelectPill("Novos", sort == "new", { sort = "new" }, icon = Icons.Outlined.NewReleases)
                            SelectPill("Mais votados", sort == "top", { sort = "top" }, icon = Icons.Outlined.TrendingUp)
                        }
                    }
                    feedItems(this, repo, nav, scope, ctx, posts, error, { posts = it }, onRetry = { scope.launch { error = null; load() } })
                    item { Spacer(Modifier.navigationBarsPadding()) }
                }
            }
        }
        ExtendedFloatingActionButton(
            onClick = { nav.newPost(null) }, containerColor = PC.Brand, contentColor = Color.White,
            icon = { Icon(Icons.Outlined.Add, null) }, text = { Text("Novo post") },
            modifier = Modifier.align(Alignment.BottomEnd).navigationBarsPadding().padding(16.dp),
        )
    }
}

@Composable
private fun CommunityChip(c: ForumCommunity, onClick: () -> Unit) {
    val shape = RoundedCornerShape(18.dp)
    Row(
        Modifier.width(220.dp).clip(shape).background(PC.Surface).border(1.dp, PC.Line, shape).clickable(onClick = onClick).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ClubIcon(c.iconUrl, c.name, 42.dp)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(c.name, color = PC.Header, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("${c.postCount} posts", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
        }
    }
}

/** Itens do feed de posts (usado no Fórum e na página do Tema). */
internal fun feedItems(
    scope0: androidx.compose.foundation.lazy.LazyListScope,
    repo: Repository, nav: AppNav, scope: CoroutineScope, ctx: android.content.Context,
    posts: List<ForumPost>?, error: String?, setPosts: (List<ForumPost>) -> Unit, onRetry: () -> Unit,
    showClub: Boolean = true, onTag: ((String) -> Unit)? = null,
) = with(scope0) {
    when {
        posts == null && error != null -> item {
            EmptyState(Icons.Outlined.CloudOff, "Não deu pra carregar", error) { GhostButton("Tentar de novo", onRetry) }
        }
        posts == null -> item { PostSkeletons(3) }
        posts.isEmpty() -> item { EmptyState(Icons.AutoMirrored.Outlined.Article, "Nenhum post ainda", "Seja o primeiro a postar!") }
        else -> items(posts, key = { it.id }) { p ->
            ForumPostCard(
                p,
                onOpen = { nav.post(p.id) },
                onVote = { v ->
                    val before = posts
                    setPosts(posts.map { if (it.id == p.id) it.withVote(v) else it })
                    scope.launch {
                        try { ForumApi.vote(repo, p.id, nextVote(p.myVote, v)) }
                        catch (e: Exception) { setPosts(before); toast(ctx, errorText(e)) }
                    }
                },
                onAuthor = { p.author?.id?.let(nav::profile) },
                onClub = if (showClub) p.community?.slug?.let { s -> { nav.forumCommunity(s) } } else null,
                onTag = onTag,
                onPollVote = { opt ->
                    scope.launch {
                        try {
                            val poll = ForumApi.pollVote(repo, p.id, opt)
                            if (poll != null) setPosts(posts.map { if (it.id == p.id) it.copy(poll = poll) else it })
                        } catch (e: Exception) { toast(ctx, errorText(e)) }
                    }
                },
            )
        }
    }
}
