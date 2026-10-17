package com.projectclub.android.ui.announcements

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.CloudOff
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.data.Repository
import com.projectclub.android.data.StaffAnnouncement
import com.projectclub.android.data.StaffAnnouncementsResponse
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.Chip
import com.projectclub.android.ui.common.EmptyState
import com.projectclub.android.ui.common.GhostButton
import com.projectclub.android.ui.common.ListSkeleton
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.common.formatTime
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch

/** Anúncios da equipe. */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun AnnouncementsScreen(repo: Repository, nav: AppNav) {
    val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf<List<StaffAnnouncement>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    suspend fun load() {
        try { list = repo.api.get<StaffAnnouncementsResponse>("/api/anuncios").announcements; error = null }
        catch (e: Exception) { if (list == null) error = e.message ?: "Não deu pra carregar." }
    }
    LaunchedEffect(Unit) { load() }

    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        PcTopBar("Anúncios", Icons.Outlined.Campaign, navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } })
        val l = list
        when {
            l == null && error != null -> EmptyState(Icons.Outlined.CloudOff, "Não deu pra abrir", error ?: "", Modifier.padding(top = 40.dp)) {
                GhostButton("Tentar de novo", { scope.launch { error = null; load() } })
            }
            l == null -> ListSkeleton(5)
            else -> PullToRefreshBox(refreshing, onRefresh = { scope.launch { refreshing = true; load(); refreshing = false } }, Modifier.fillMaxSize()) {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (l.isEmpty()) item { EmptyState(Icons.Outlined.Campaign, "Nenhum anúncio", "Os recados da equipe aparecem aqui.") }
                    items(l.sortedWith(compareByDescending<StaffAnnouncement> { it.pinned }.thenByDescending { it.createdAt }), key = { it.id }) { a ->
                        val shape = RoundedCornerShape(20.dp)
                        Column(Modifier.fillMaxWidth().clip(shape).background(PC.Surface).border(1.dp, if (a.pinned) PC.Announce.copy(alpha = 0.4f) else PC.Line, shape)) {
                            Config.media(a.bannerUrl)?.let { AsyncImage(it, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth().heightIn(max = 200.dp)) }
                            Column(Modifier.padding(16.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Avatar(a.author, 28.dp)
                                    Spacer(Modifier.width(8.dp))
                                    Text(a.author?.name ?: "Equipe", color = PC.Text, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
                                    if (a.pinned) Chip("Fixado", PC.Announce)
                                }
                                Spacer(Modifier.height(10.dp))
                                Text(a.title, style = MaterialTheme.typography.titleLarge, color = PC.Header)
                                Spacer(Modifier.height(6.dp))
                                Text(a.body, color = PC.Text, style = MaterialTheme.typography.bodyLarge)
                                a.linkUrl?.takeIf { it.isNotBlank() }?.let { link ->
                                    Spacer(Modifier.height(12.dp))
                                    Text(
                                        a.linkLabel?.takeIf { it.isNotBlank() } ?: "Abrir link", color = PC.Brand, style = MaterialTheme.typography.labelLarge,
                                        modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(PC.BrandSoft).clickable { nav.link(link) }.padding(horizontal = 14.dp, vertical = 9.dp),
                                    )
                                }
                                Spacer(Modifier.height(10.dp))
                                Text(formatTime(a.createdAt), color = PC.Muted, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                    item { Spacer(Modifier.navigationBarsPadding()) }
                }
            }
        }
    }
}
