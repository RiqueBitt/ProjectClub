package com.projectclub.android.ui.forum

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.outlined.Add
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.data.ForumCommunity
import com.projectclub.android.data.ForumPost
import com.projectclub.android.data.Repository
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch

/** Um Tema do Fórum com os posts dele (filtro por categoria e tag). */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun ForumCommunityScreen(repo: Repository, nav: AppNav, slug: String) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var community by remember { mutableStateOf<ForumCommunity?>(null) }
    var posts by remember { mutableStateOf<List<ForumPost>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var sort by rememberSaveable { mutableStateOf("hot") }
    var category by rememberSaveable { mutableStateOf("") }
    var tag by rememberSaveable { mutableStateOf("") }
    var refreshing by remember { mutableStateOf(false) }

    suspend fun load() {
        try {
            if (community == null) community = ForumApi.community(repo, slug)
            posts = ForumApi.posts(repo, sort, tag.ifBlank { null }, slug, category.ifBlank { null })
            error = null
        } catch (e: Exception) { if (posts == null) error = errorText(e) }
    }
    LaunchedEffect(sort, category, tag) { load() }

    Box(Modifier.fillMaxSize().background(PC.Bg)) {
        Column(Modifier.fillMaxSize()) {
            PcTopBar(community?.name ?: "Tema", Icons.AutoMirrored.Outlined.Article, navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } })
            PullToRefreshBox(refreshing, onRefresh = { scope.launch { refreshing = true; load(); refreshing = false } }, Modifier.fillMaxSize()) {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp, 16.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    community?.let { c ->
                        item(key = "head") {
                            Column {
                                Box(Modifier.fillMaxWidth().height(120.dp).background(PC.BannerGradient, androidx.compose.foundation.shape.RoundedCornerShape(20.dp))) {
                                    Config.media(c.bannerUrl)?.let {
                                        AsyncImage(it, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize().clip(androidx.compose.foundation.shape.RoundedCornerShape(20.dp)))
                                    }
                                    Box(Modifier.fillMaxSize().clip(androidx.compose.foundation.shape.RoundedCornerShape(20.dp)).background(Brush.verticalGradient(listOf(Color.Transparent, Color(0x99000000)))))
                                }
                                Spacer(Modifier.height(12.dp))
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    ClubIcon(c.iconUrl, c.name, 48.dp)
                                    Spacer(Modifier.width(12.dp))
                                    Column {
                                        Text(c.name, style = MaterialTheme.typography.headlineSmall, color = PC.Header)
                                        Text("${c.postCount} posts", color = PC.Muted)
                                    }
                                }
                                c.description?.takeIf { it.isNotBlank() }?.let { Text(it, color = PC.Text, modifier = Modifier.padding(top = 8.dp)) }
                            }
                        }
                        if (c.categories.isNotEmpty()) item(key = "cats") {
                            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                SelectPill("Tudo", category.isEmpty(), { category = "" })
                                c.categories.sortedBy { it.position }.forEach { cat -> SelectPill(cat.name, category == cat.id, { category = if (category == cat.id) "" else cat.id }) }
                            }
                        }
                        if (c.postTags.isNotEmpty()) item(key = "tags") { TagFilterRow(c.postTags, tag) { tag = it } }
                    }
                    item(key = "sort") {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            SelectPill("Em alta", sort == "hot", { sort = "hot" })
                            SelectPill("Novos", sort == "new", { sort = "new" })
                            SelectPill("Mais votados", sort == "top", { sort = "top" })
                        }
                    }
                    feedItems(this, repo, nav, scope, ctx, posts, error, { posts = it }, onRetry = { scope.launch { error = null; load() } }, showClub = false, onTag = { tag = it })
                    item { Spacer(Modifier.navigationBarsPadding()) }
                }
            }
        }
        ExtendedFloatingActionButton(
            onClick = { nav.newPost(slug) }, containerColor = PC.Brand, contentColor = Color.White,
            icon = { Icon(Icons.Outlined.Add, null) }, text = { Text("Novo post") },
            modifier = Modifier.align(Alignment.BottomEnd).navigationBarsPadding().padding(16.dp),
        )
    }
}
