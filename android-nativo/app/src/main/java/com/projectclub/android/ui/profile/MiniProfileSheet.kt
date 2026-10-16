package com.projectclub.android.ui.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.data.ProfileData
import com.projectclub.android.data.ProfileSummary
import com.projectclub.android.data.Repository
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.GhostButton
import com.projectclub.android.ui.common.PillButton
import com.projectclub.android.ui.store.rememberAnimatedImageLoader
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Abre o miniperfil de alguém (qualquer tela: avatar, nome, membro…). */
val LocalOpenUser = androidx.compose.runtime.staticCompositionLocalOf<(String) -> Unit> { {} }

/**
 * Miniperfil (igual ao do site, em folha que sobe de baixo): banner, avatar
 * com moldura, status, bio, insígnias e atalhos pra mensagem / amizade /
 * perfil completo. O efeito de perfil toca por cima.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MiniProfileSheet(
    repo: Repository, userId: String,
    onDismiss: () -> Unit, onFullProfile: (String) -> Unit, onMessage: (String) -> Unit,
) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val me by repo.me.collectAsState()
    val presence by repo.presence.collectAsState()
    val friends by repo.friends.collectAsState()
    val scope = rememberCoroutineScope()
    var profile by remember(userId) { mutableStateOf<ProfileData?>(null) }
    var failed by remember(userId) { mutableStateOf(false) }
    var info by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(userId) {
        runCatching { repo.api.get<ProfileSummary>("/api/users/$userId/summary").profile }
            .onSuccess { profile = it; failed = it == null }.onFailure { failed = true }
    }
    val cached = repo.user(userId)
    val u = profile?.user?.toUser() ?: cached
    val isMe = userId == me?.id
    val friendship = friends.firstOrNull { it.user.id == userId }
    val loader = rememberAnimatedImageLoader()

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = PC.Surface, dragHandle = null) {
        Box(Modifier.fillMaxWidth()) {
            Column(Modifier.fillMaxWidth().navigationBarsPadding()) {
                // Banner (imagem, ou a cor do perfil)
                Box(Modifier.fillMaxWidth().height(118.dp).background(bannerBrush(u?.profileColor))) {
                    Config.media(u?.bannerUrl)?.let {
                        AsyncImage(it, null, imageLoader = loader, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize())
                    }
                    Box(Modifier.align(Alignment.TopCenter).padding(top = 8.dp).size(width = 40.dp, height = 4.dp).clip(CircleShape).background(Color(0x99FFFFFF)))
                }
                Box(Modifier.fillMaxWidth().padding(horizontal = 18.dp)) {
                    Box(Modifier.offset(y = (-44).dp).size(96.dp).clip(CircleShape).background(PC.Surface), contentAlignment = Alignment.Center) {
                        Avatar(u, 82.dp, presence[userId] ?: if (isMe) "ONLINE" else "OFFLINE")
                    }
                }
                Column(Modifier.padding(start = 18.dp, end = 18.dp, top = 0.dp).offset(y = (-34).dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(u?.name ?: "…", style = MaterialTheme.typography.headlineSmall, color = PC.Header, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                        profile?.user?.tagEmoji?.let { Spacer(Modifier.width(6.dp)); Text(it) }
                    }
                    Text(listOfNotNull(u?.username?.let { "@$it" }, u?.pronouns?.takeIf { it.isNotBlank() }).joinToString(" · "), color = PC.Muted, style = MaterialTheme.typography.bodyMedium)
                    u?.customStatus?.takeIf { it.isNotBlank() }?.let {
                        Spacer(Modifier.height(10.dp))
                        Text(
                            listOfNotNull(u.customStatusEmoji, it).joinToString(" "), color = PC.Text,
                            modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(PC.Surface2).padding(horizontal = 12.dp, vertical = 8.dp),
                        )
                    }
                    Spacer(Modifier.height(12.dp))
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(PC.Surface2).border(1.dp, PC.Line, RoundedCornerShape(16.dp)).padding(14.dp)) {
                        if (profile == null && !failed) {
                            CircularProgressIndicator(Modifier.size(22.dp).align(Alignment.CenterHorizontally), strokeWidth = 2.dp, color = PC.Brand)
                        } else {
                            val bio = u?.bio?.takeIf { it.isNotBlank() }
                            Text("SOBRE MIM", color = PC.Muted, style = MaterialTheme.typography.labelSmall)
                            Spacer(Modifier.height(4.dp))
                            Text(bio ?: if (profile?.profileRestricted == true) "Perfil privado." else "Sem bio ainda.", color = if (bio != null) PC.Text else PC.Muted, maxLines = 6, overflow = TextOverflow.Ellipsis)
                            val badges = profile?.badges.orEmpty()
                            if (badges.isNotEmpty()) {
                                Spacer(Modifier.height(12.dp))
                                Text("INSÍGNIAS", color = PC.Muted, style = MaterialTheme.typography.labelSmall)
                                Spacer(Modifier.height(6.dp))
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    badges.take(8).forEach { b ->
                                        Box(Modifier.size(30.dp).clip(RoundedCornerShape(8.dp)).background(PC.Surface3), contentAlignment = Alignment.Center) {
                                            val img = Config.media(b.iconUrl)
                                            if (img != null) AsyncImage(img, b.name, imageLoader = loader, modifier = Modifier.size(22.dp))
                                            else Text(b.icon ?: "🏅")
                                        }
                                    }
                                }
                            }
                            profile?.user?.accountLevel?.let { lvl ->
                                Spacer(Modifier.height(10.dp))
                                Text("Nível $lvl", color = PC.Brand, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                    info?.let { Spacer(Modifier.height(8.dp)); Text(it, color = PC.Green, style = MaterialTheme.typography.bodySmall) }
                    Spacer(Modifier.height(14.dp))
                    if (!isMe) {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            PillButton("Mensagem", { onMessage(userId) }, Modifier.weight(1f), icon = Icons.AutoMirrored.Outlined.Chat)
                            if (friendship == null && u?.username != null) {
                                GhostButton("Adicionar", {
                                    scope.launch {
                                        runCatching { repo.api.postIgnore("/api/friends/request", buildJsonObject { put("username", u.username) }); repo.loadFriends() }
                                            .onSuccess { info = "Pedido de amizade enviado." }.onFailure { info = it.message }
                                    }
                                }, Modifier.weight(1f), icon = Icons.Outlined.PersonAdd)
                            }
                        }
                        Spacer(Modifier.height(10.dp))
                    }
                    GhostButton("Ver perfil completo", { onFullProfile(userId) }, Modifier.fillMaxWidth(), icon = Icons.Outlined.Person)
                    Spacer(Modifier.height(4.dp))
                }
            }
            ProfileEffectOverlay(u?.profileEffect, Modifier.matchParentSize())
        }
    }
}

private fun bannerBrush(hex: String?): Brush {
    val c = runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrNull() ?: PC.Brand
    return Brush.linearGradient(listOf(c, c.copy(alpha = 0.55f)))
}
