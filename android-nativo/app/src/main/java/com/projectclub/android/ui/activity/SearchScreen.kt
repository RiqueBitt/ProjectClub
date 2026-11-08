package com.projectclub.android.ui.activity

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Tag
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.projectclub.android.data.Message
import com.projectclub.android.data.MessagesResponse
import com.projectclub.android.data.Repository
import com.projectclub.android.data.Room
import com.projectclub.android.data.User
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.PcField
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.common.formatTime
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.profile.LocalOpenUser
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.serialization.Serializable
import java.net.URLEncoder

@Serializable data class UserSearch(val users: List<User> = emptyList())

/** Busca global (igual à do PC): pessoas, canais e mensagens. */
@Composable
fun SearchScreen(repo: Repository, nav: AppNav) {
    var q by remember { mutableStateOf("") }
    var users by remember { mutableStateOf<List<User>>(emptyList()) }
    var messages by remember { mutableStateOf<List<Message>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    val community by repo.community.collectAsState()
    val openUser = LocalOpenUser.current
    val channels = community?.categories.orEmpty().flatMap { it.channels }
        .filter { q.trim().length >= 2 && it.name.contains(q.trim(), ignoreCase = true) }.take(8)

    LaunchedEffect(q) {
        val t = q.trim()
        if (t.length < 2) { users = emptyList(); messages = emptyList(); return@LaunchedEffect }
        delay(350)
        busy = true
        val enc = URLEncoder.encode(t, "UTF-8")
        coroutineScope {
            val u = async { runCatching { repo.api.get<UserSearch>("/api/users/search?q=$enc").users }.getOrDefault(emptyList()) }
            val m = async { runCatching { repo.api.get<MessagesResponse>("/api/messages/search?q=$enc").messages }.getOrDefault(emptyList()) }
            users = u.await(); messages = m.await()
        }
        busy = false
    }

    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        PcTopBar("Buscar", Icons.Outlined.Search, navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } })
        PcField(q, { q = it }, "Pessoas, canais, mensagens…", icon = Icons.Outlined.Search, modifier = Modifier.padding(16.dp))
        LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (q.trim().length < 2) item { Text("Digite pelo menos 2 letras. Dica: de:pessoa, tem:imagem, em:canal.", color = PC.Muted) }
            if (users.isNotEmpty()) {
                item { Header("Pessoas") }
                items(users.take(10), key = { "u" + it.id }) { u ->
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { openUser(u.id) }.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Avatar(u, 38.dp)
                        Spacer(Modifier.width(10.dp))
                        Column { Text(u.name, color = PC.Header, fontWeight = FontWeight.SemiBold); Text("@${u.username ?: ""}", color = PC.Muted, style = MaterialTheme.typography.labelSmall) }
                    }
                }
            }
            if (channels.isNotEmpty()) {
                item { Header("Canais") }
                items(channels, key = { "c" + it.id }) { c ->
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { if (c.isChat) nav.room(Room(channelId = c.id)) else nav.link("/canal/" + android.net.Uri.encode(c.slug ?: c.id)) }.padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Outlined.Tag, null, tint = PC.Muted)
                        Spacer(Modifier.width(10.dp))
                        Text(c.name, color = PC.Header)
                    }
                }
            }
            if (messages.isNotEmpty()) {
                item { Header("Mensagens") }
                items(messages.take(30), key = { "m" + it.id }) { m ->
                    val author = m.author ?: repo.user(m.authorId)
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(PC.Surface)
                            .clickable { nav.room(if (m.channelId != null) Room(channelId = m.channelId) else Room(conversationId = m.conversationId)) }.padding(10.dp),
                    ) {
                        Avatar(author, 32.dp)
                        Spacer(Modifier.width(10.dp))
                        Column {
                            Text("${author?.name ?: "Usuário"} · ${formatTime(m.createdAt)}", color = PC.Muted, style = MaterialTheme.typography.labelSmall)
                            Text(m.content ?: "📎 Anexo", color = PC.Text, maxLines = 3, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
            if (busy) item { Text("Buscando…", color = PC.Muted, modifier = Modifier.padding(8.dp)) }
            else if (q.trim().length >= 2 && users.isEmpty() && channels.isEmpty() && messages.isEmpty()) item { Text("Nada encontrado.", color = PC.Muted, modifier = Modifier.padding(8.dp)) }
        }
    }
}

@Composable
private fun Header(t: String) = Text(t.uppercase(), color = PC.Muted, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 10.dp, bottom = 2.dp))
