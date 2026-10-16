package com.projectclub.android.ui.profile

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.EmojiEvents
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Favorite
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.FormatQuote
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.HourglassTop
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.MilitaryTech
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.PersonOff
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.ThumbUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.data.Friendship
import com.projectclub.android.data.ProfileAchievement
import com.projectclub.android.data.ProfileBadge
import com.projectclub.android.data.ProfileData
import com.projectclub.android.data.ProfileFanStatus
import com.projectclub.android.data.ProfileScrapsResponse
import com.projectclub.android.data.ProfileSummary
import com.projectclub.android.data.ProfileTestimonialsResponse
import com.projectclub.android.data.ProfileUser
import com.projectclub.android.data.ProfileVoteResponse
import com.projectclub.android.data.ProfileWallPost
import com.projectclub.android.data.Repository
import com.projectclub.android.data.User
import com.projectclub.android.net.ApiException
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.Bone
import com.projectclub.android.ui.common.Chip
import com.projectclub.android.ui.common.EmptyState
import com.projectclub.android.ui.common.GhostButton
import com.projectclub.android.ui.common.ListSkeleton
import com.projectclub.android.ui.common.PcCard
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.common.PillButton
import com.projectclub.android.ui.common.formatTime
import com.projectclub.android.ui.common.instantOf
import com.projectclub.android.ui.common.rememberShimmer
import com.projectclub.android.ui.common.shortTime
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.theme.PC
import java.time.ZoneId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Ação perigosa esperando confirmação (desfazer amizade, bloquear...). */
private class PendingConfirm(
    val title: String,
    val text: String,
    val confirmLabel: String,
    val action: suspend () -> Unit,
)

/**
 * Perfil de qualquer pessoa (inclusive o seu): banner, avatar com status,
 * nome, @usuário, pronomes, status personalizado, bio, nível, insígnias,
 * contadores e o mural (depoimentos e recados, só leitura).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(repo: Repository, nav: AppNav, userId: String) {
    val me by repo.me.collectAsState()
    val friends by repo.friends.collectAsState()
    val presence by repo.presence.collectAsState()
    val isMe = me?.id == userId
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var data by remember(userId) { mutableStateOf<ProfileData?>(null) }
    var fan by remember(userId) { mutableStateOf(ProfileFanStatus()) }
    var testimonials by remember(userId) { mutableStateOf<ProfileTestimonialsResponse?>(null) }
    var scraps by remember(userId) { mutableStateOf<ProfileScrapsResponse?>(null) }
    var error by remember(userId) { mutableStateOf<String?>(null) }
    var notFound by remember(userId) { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    var reloadTick by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf<PendingConfirm?>(null) }
    var menuOpen by remember { mutableStateOf(false) }
    var openBadge by remember { mutableStateOf<ProfileBadge?>(null) }

    fun toast(text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()

    // Seu próprio perfil recarrega quando você salva algo em "Editar perfil".
    val meKey = if (isMe) me else null
    LaunchedEffect(userId, reloadTick, meKey) {
        coroutineScope {
            launch {
                testimonials = try {
                    repo.api.get<ProfileTestimonialsResponse>("/api/testimonials/$userId")
                } catch (e: CancellationException) { throw e } catch (_: Exception) { testimonials ?: ProfileTestimonialsResponse() }
            }
            launch {
                scraps = try {
                    repo.api.get<ProfileScrapsResponse>("/api/scraps/$userId")
                } catch (e: CancellationException) { throw e } catch (_: Exception) { scraps ?: ProfileScrapsResponse() }
            }
            try {
                val s: ProfileSummary = repo.api.get("/api/users/$userId/summary")
                val p = s.profile
                if (p?.user == null) {
                    if (data == null) error = "Não deu pra carregar o perfil."
                } else {
                    data = p
                    s.fan?.let { fan = it }
                    error = null
                    notFound = false
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                if (e.status == 404) notFound = true
                if (data == null) error = e.message ?: "Não deu pra carregar o perfil." else toast(e.message ?: "Não deu pra atualizar.")
            } catch (e: Exception) {
                if (data == null) error = "Sem conexão com o Project Club." else toast("Sem conexão com o Project Club.")
            }
        }
        refreshing = false
    }
    LaunchedEffect(Unit) { runCatching { repo.loadFriends() } }

    fun act(block: suspend () -> Unit) {
        if (busy) return
        busy = true
        scope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toast(e.message ?: "Não deu certo.")
            } finally {
                busy = false
            }
        }
    }

    val profile = data
    val u = profile?.user
    val friendship: Friendship? = friends.firstOrNull { it.user.id == userId }
    val blocked = friendship?.status == "BLOCKED"

    fun askBlock(target: ProfileUser) {
        confirm = PendingConfirm(
            "Bloquear ${target.name}?",
            "Vocês deixam de ser amigos e essa pessoa não poderá mais te mandar mensagens nem pedidos de amizade.",
            "Bloquear",
        ) {
            repo.api.postIgnore("/api/friends/block", buildJsonObject { put("username", target.username) })
            repo.loadFriends()
            toast("${target.name} foi bloqueado(a).")
        }
    }

    fun unblock(target: ProfileUser) = act {
        repo.api.delete("/api/friends/block/${target.id}")
        repo.loadFriends()
        toast("Desbloqueado(a).")
    }

    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        PcTopBar(
            title = u?.name ?: "Perfil",
            icon = Icons.Outlined.Person,
            navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } },
        ) {
            if (isMe) {
                IconButton(onClick = { nav.editProfile() }) { Icon(Icons.Outlined.Edit, "Editar perfil", tint = PC.Text) }
            } else if (u != null) {
                Box {
                    IconButton(onClick = { menuOpen = true }) { Icon(Icons.Outlined.MoreVert, "Mais opções", tint = PC.Text) }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }, modifier = Modifier.background(PC.Surface2)) {
                        if (blocked) {
                            DropdownMenuItem(
                                text = { Text("Desbloquear", color = PC.Text) },
                                leadingIcon = { Icon(Icons.Outlined.Block, null, tint = PC.Muted) },
                                onClick = { menuOpen = false; unblock(u) },
                            )
                        } else {
                            DropdownMenuItem(
                                text = { Text("Bloquear", color = PC.Red) },
                                leadingIcon = { Icon(Icons.Outlined.Block, null, tint = PC.Red) },
                                onClick = { menuOpen = false; askBlock(u) },
                            )
                        }
                    }
                }
            }
        }

        when {
            profile == null && error != null -> EmptyState(
                if (notFound) Icons.Outlined.PersonOff else Icons.Outlined.ErrorOutline,
                if (notFound) "Usuário não encontrado" else "Não deu pra abrir o perfil",
                error ?: "",
            ) {
                if (!notFound) GhostButton("Tentar de novo", { error = null; reloadTick++ })
            }
            profile == null || u == null -> ProfileSkeleton()
            else -> PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = { refreshing = true; reloadTick++ },
                modifier = Modifier.fillMaxSize(),
            ) {
                val status = presence[userId] ?: u.status ?: "OFFLINE"
                LazyColumn(
                    Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    item(key = "header") { ProfileHeader(u, status, profile.isBirthdayToday) }

                    item(key = "actions") {
                        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            if (isMe) {
                                PillButton("Editar perfil", { nav.editProfile() }, Modifier.fillMaxWidth(), icon = Icons.Outlined.Edit)
                            } else {
                                PillButton("Mensagem", { nav.dmWith(userId) }, Modifier.fillMaxWidth(), icon = Icons.Outlined.ChatBubbleOutline, enabled = !blocked)
                                Row(
                                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    FriendButtons(
                                        friendship = friendship,
                                        onAdd = {
                                            act {
                                                repo.api.postIgnore("/api/friends/request", buildJsonObject { put("username", u.username) })
                                                repo.loadFriends()
                                                toast("Pedido de amizade enviado.")
                                            }
                                        },
                                        onAccept = { f ->
                                            act {
                                                repo.api.postIgnore("/api/friends/${f.id}/respond", buildJsonObject { put("action", "accept") })
                                                repo.loadFriends()
                                                toast("Agora vocês são amigos!")
                                            }
                                        },
                                        onDecline = { f ->
                                            act {
                                                repo.api.postIgnore("/api/friends/${f.id}/respond", buildJsonObject { put("action", "decline") })
                                                repo.loadFriends()
                                            }
                                        },
                                        onCancel = { f ->
                                            confirm = PendingConfirm("Cancelar pedido?", "O pedido de amizade para ${u.name} será cancelado.", "Cancelar pedido") {
                                                repo.api.delete("/api/friends/${f.id}")
                                                repo.loadFriends()
                                            }
                                        },
                                        onRemove = { f ->
                                            confirm = PendingConfirm("Desfazer amizade?", "${u.name} deixa de ser seu amigo(a). Dá pra mandar outro pedido depois.", "Desfazer") {
                                                repo.api.delete("/api/friends/${f.id}")
                                                repo.loadFriends()
                                            }
                                        },
                                        onUnblock = { unblock(u) },
                                    )
                                    if (!blocked) {
                                        GhostButton(
                                            if (fan.isFan) "Seguindo" else "Seguir",
                                            {
                                                act { fan = repo.api.post<ProfileFanStatus>("/api/fans/$userId/toggle") }
                                            },
                                            icon = if (fan.isFan) Icons.Outlined.Favorite else Icons.Outlined.FavoriteBorder,
                                            color = if (fan.isFan) PC.Pink else PC.Text,
                                        )
                                        GhostButton(
                                            if (profile.myVote == 1) "Up dado" else "Dar Up",
                                            {
                                                act {
                                                    val r: ProfileVoteResponse = repo.api.post("/api/users/$userId/vote", buildJsonObject { put("value", 1) })
                                                    val cur = data ?: return@act
                                                    data = cur.copy(
                                                        likeCount = r.likeCount, dislikeCount = r.dislikeCount, myVote = r.myVote,
                                                        totalUps = cur.totalUps + (r.likeCount - cur.likeCount),
                                                    )
                                                }
                                            },
                                            icon = Icons.Outlined.ThumbUp,
                                            color = if (profile.myVote == 1) PC.Brand else PC.Text,
                                        )
                                    }
                                }
                            }
                        }
                    }

                    item(key = "stats") { StatsRow(profile, fan, isMe) }

                    item(key = "level") { LevelCard(u, profile.levelProgress) }

                    if (!isMe && profile.profileRestricted) item(key = "restricted") {
                        PcCard(Modifier.padding(horizontal = 16.dp).fillMaxWidth(), padding = PaddingValues(14.dp), border = PC.LineStrong) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Outlined.Lock, null, tint = PC.Muted, modifier = Modifier.size(20.dp))
                                Spacer(Modifier.width(12.dp))
                                Text(
                                    "Esta pessoa limitou quem pode ver os detalhes completos do perfil — você está vendo só as informações públicas.",
                                    color = PC.Muted, style = MaterialTheme.typography.bodySmall,
                                )
                            }
                        }
                    }

                    u.bio?.takeIf { it.isNotBlank() }?.let { bio ->
                        item(key = "bio") {
                            SectionCard("Sobre mim", Icons.Outlined.Person) {
                                Text(bio, color = PC.Text, style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                    }

                    if (profile.badges.isNotEmpty()) item(key = "badges") {
                        SectionCard("Insígnias", Icons.Outlined.MilitaryTech, profile.badges.size) {
                            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                profile.badges.forEach { b ->
                                    IconTileLabel(b.name, b.iconUrl, b.icon ?: "🏅", onClick = { openBadge = b })
                                }
                            }
                        }
                    }

                    if (profile.displayedAchievements.isNotEmpty()) item(key = "achievements") {
                        SectionCard("Conquistas", Icons.Outlined.EmojiEvents, profile.displayedAchievements.size) {
                            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                profile.displayedAchievements.forEach { a: ProfileAchievement ->
                                    IconTileLabel(a.name, a.iconUrl, "🏆", onClick = { a.description?.takeIf { it.isNotBlank() }?.let { toast(it) } })
                                }
                            }
                        }
                    }

                    profile.relationshipPartner?.let { partner ->
                        item(key = "relationship") {
                            SectionCard("Relacionamento", Icons.Outlined.Favorite) {
                                Row(
                                    Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { nav.profile(partner.id) }.padding(vertical = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text("Namorando com", color = PC.Muted, style = MaterialTheme.typography.bodyMedium)
                                    Spacer(Modifier.width(10.dp))
                                    Avatar(partner, 28.dp)
                                    Spacer(Modifier.width(8.dp))
                                    Text(partner.name, color = PC.Header, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                    }

                    if (!isMe && profile.mutualFriends.isNotEmpty()) item(key = "mutual") {
                        SectionCard("Amigos em comum", Icons.Outlined.People, profile.mutualFriends.size) {
                            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                                profile.mutualFriends.forEach { f ->
                                    Column(
                                        Modifier.width(64.dp).clip(RoundedCornerShape(12.dp)).clickable { nav.profile(f.id) },
                                        horizontalAlignment = Alignment.CenterHorizontally,
                                    ) {
                                        Avatar(f, 52.dp)
                                        Spacer(Modifier.height(6.dp))
                                        Text(f.name, color = PC.Text, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    }
                                }
                            }
                        }
                    }

                    item(key = "testimonials") {
                        WallCard(
                            "Depoimentos", Icons.Outlined.FormatQuote, testimonials?.testimonials, testimonials?.total ?: 0,
                            "Nenhum depoimento ainda.",
                        ) { id -> nav.profile(id) }
                    }
                    item(key = "scraps") {
                        WallCard(
                            "Recados", Icons.Outlined.Forum, scraps?.scraps, scraps?.total ?: 0,
                            "Nenhum recado ainda.",
                        ) { id -> nav.profile(id) }
                    }

                    item(key = "end") { Spacer(Modifier.navigationBarsPadding()) }
                }
            }
        }
    }

    confirm?.let { c ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            containerColor = PC.Surface2,
            title = { Text(c.title, color = PC.Header) },
            text = { Text(c.text, color = PC.Muted) },
            confirmButton = {
                TextButton(onClick = { confirm = null; act(c.action) }) { Text(c.confirmLabel, color = PC.Red) }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Voltar", color = PC.Text) } },
        )
    }

    openBadge?.let { b ->
        AlertDialog(
            onDismissRequest = { openBadge = null },
            containerColor = PC.Surface2,
            icon = { BadgeIcon(b.iconUrl, b.icon ?: "🏅", 56) },
            title = { Text(b.name, color = PC.Header, textAlign = TextAlign.Center) },
            text = {
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                    b.description?.takeIf { it.isNotBlank() }?.let {
                        Text(it, color = PC.Text, textAlign = TextAlign.Center)
                        Spacer(Modifier.height(8.dp))
                    }
                    formatTime(b.awardedAt).takeIf { it.isNotEmpty() }?.let {
                        Text("Desbloqueada $it", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
                    }
                }
            },
            confirmButton = { TextButton(onClick = { openBadge = null }) { Text("Fechar", color = PC.Brand) } },
        )
    }
}

// ---------------------------------------------------------------- peças

@Composable
private fun ProfileHeader(u: ProfileUser, status: String, birthday: Boolean) {
    val user = remember(u) { u.toUser() }
    Column(Modifier.fillMaxWidth()) {
        Box(Modifier.fillMaxWidth().height(206.dp)) {
            // Banner: imagem, ou a cor do perfil, ou o azul padrão.
            val bannerMod = Modifier.fillMaxWidth().height(150.dp)
            val bannerUrl = Config.media(u.bannerUrl)
            val color = parseHex(u.profileColor)
            Box(
                bannerMod.background(
                    if (color != null) Brush.linearGradient(listOf(color, color.copy(alpha = 0.55f))) else PC.BannerGradient,
                ),
            ) {
                if (bannerUrl != null) {
                    AsyncImage(model = bannerUrl, contentDescription = null, imageLoader = com.projectclub.android.ui.store.rememberAnimatedImageLoader(), contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                }
                Box(
                    Modifier.fillMaxWidth().height(60.dp).align(Alignment.BottomCenter)
                        .background(Brush.verticalGradient(listOf(Color.Transparent, PC.Bg.copy(alpha = 0.7f)))),
                )
            }
            Box(
                Modifier.padding(start = 16.dp, top = 94.dp).size(112.dp).background(PC.Bg, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Avatar(user, 102.dp, status)
            }
            // Efeito de perfil da Loja tocando por cima do topo do perfil.
            ProfileEffectOverlay(u.profileEffect, Modifier.matchParentSize())
        }
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    u.name, style = MaterialTheme.typography.headlineSmall, color = PC.Header,
                    maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false),
                )
                if (birthday) { Spacer(Modifier.width(8.dp)); Text("🎂", fontSize = 22.sp) }
            }
            val handle = buildString {
                append("@").append(u.username ?: "")
                u.pronouns?.takeIf { it.isNotBlank() }?.let { append(" · ").append(it) }
            }
            Text(handle, color = PC.Muted, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(10.dp))
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Chip(statusLabel(status), PC.presence(status), dot = true)
                when (u.platformRole) {
                    "ADMIN" -> Chip("Administrador", PC.Red)
                    "MODERATOR" -> Chip("Moderador", PC.Purple)
                }
                if (!u.tagText.isNullOrBlank()) Chip(listOfNotNull(u.tagEmoji, u.tagText).joinToString(" "), PC.Brand)
                u.clanTag?.tag?.takeIf { it.isNotBlank() }?.let { Chip("[$it]", PC.Yellow) }
            }
            if (!u.customStatus.isNullOrBlank() || !u.customStatusEmoji.isNullOrBlank()) {
                Spacer(Modifier.height(10.dp))
                Row(
                    Modifier.clip(RoundedCornerShape(16.dp)).background(PC.Surface2).padding(horizontal = 14.dp, vertical = 9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    u.customStatusEmoji?.takeIf { it.isNotBlank() }?.let {
                        Text(it, fontSize = 18.sp)
                        Spacer(Modifier.width(8.dp))
                    }
                    u.customStatus?.takeIf { it.isNotBlank() }?.let {
                        Text(it, color = PC.Text, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    }
}

@Composable
private fun FriendButtons(
    friendship: Friendship?,
    onAdd: () -> Unit,
    onAccept: (Friendship) -> Unit,
    onDecline: (Friendship) -> Unit,
    onCancel: (Friendship) -> Unit,
    onRemove: (Friendship) -> Unit,
    onUnblock: () -> Unit,
) {
    when {
        friendship == null || friendship.status == "DECLINED" ->
            GhostButton("Adicionar amigo", onAdd, icon = Icons.Outlined.PersonAdd, color = PC.Brand)
        friendship.status == "ACCEPTED" ->
            GhostButton("Amigos", { onRemove(friendship) }, icon = Icons.Outlined.Check, color = PC.Green)
        friendship.status == "PENDING" && friendship.isIncoming -> {
            GhostButton("Aceitar pedido", { onAccept(friendship) }, icon = Icons.Outlined.Check, color = PC.Green)
            GhostButton("Recusar", { onDecline(friendship) }, icon = Icons.Outlined.Close, color = PC.Muted)
        }
        friendship.status == "PENDING" ->
            GhostButton("Pedido enviado", { onCancel(friendship) }, icon = Icons.Outlined.HourglassTop, color = PC.Muted)
        friendship.status == "BLOCKED" ->
            GhostButton("Desbloquear", onUnblock, icon = Icons.Outlined.Block, color = PC.Red)
        else -> GhostButton("Adicionar amigo", onAdd, icon = Icons.Outlined.PersonAdd, color = PC.Brand)
    }
}

@Composable
private fun StatsRow(profile: ProfileData, fan: ProfileFanStatus, isMe: Boolean) {
    val u = profile.user
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Stat(Icons.Outlined.ThumbUp, profile.totalUps.toString(), "Ups")
        Stat(Icons.Outlined.Star, (u?.accountLevel ?: 1).toString(), "Nível")
        Stat(Icons.Outlined.Favorite, fan.count.toString(), if (fan.count == 1) "Seguidor" else "Seguidores")
        if (profile.badges.isNotEmpty()) Stat(Icons.Outlined.MilitaryTech, profile.badges.size.toString(), "Insígnias")
        if (!isMe && profile.mutualFriends.isNotEmpty()) Stat(Icons.Outlined.People, profile.mutualFriends.size.toString(), "Em comum")
        joinedLabel(u?.createdAt)?.let { Stat(Icons.Outlined.CalendarMonth, it, "Entrou em") }
    }
}

@Composable
private fun Stat(icon: ImageVector, value: String, label: String) {
    Row(
        Modifier.clip(RoundedCornerShape(16.dp)).background(PC.Surface).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(32.dp).clip(RoundedCornerShape(10.dp)).background(PC.BrandSoft), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = PC.Brand, modifier = Modifier.size(17.dp))
        }
        Spacer(Modifier.width(10.dp))
        Column {
            Text(value, color = PC.Header, style = MaterialTheme.typography.titleSmall)
            Text(label, color = PC.Muted, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun LevelCard(u: ProfileUser, progress: Int) {
    val p = progress.coerceIn(0, 100)
    val barColor = parseHex(u.levelBarColor) ?: PC.Brand
    PcCard(Modifier.padding(horizontal = 16.dp).fillMaxWidth(), padding = PaddingValues(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Star, null, tint = PC.Yellow, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text("Nível ${u.accountLevel ?: 1}", color = PC.Header, style = MaterialTheme.typography.titleSmall)
            u.accountXp?.let {
                Spacer(Modifier.width(8.dp))
                Text("· $it XP", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.weight(1f))
            Text("$p% para o próximo", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
        }
        Spacer(Modifier.height(10.dp))
        Box(Modifier.fillMaxWidth().height(8.dp).clip(CircleShape).background(PC.Surface3)) {
            Box(Modifier.fillMaxWidth(p / 100f).fillMaxHeight().clip(CircleShape).background(barColor))
        }
    }
}

@Composable
private fun SectionCard(title: String, icon: ImageVector, count: Int? = null, content: @Composable ColumnScope.() -> Unit) {
    PcCard(Modifier.padding(horizontal = 16.dp).fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, tint = PC.Muted, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(title.uppercase(), style = MaterialTheme.typography.labelSmall, color = PC.Muted)
            if (count != null && count > 0) {
                Spacer(Modifier.width(6.dp))
                Text(count.toString(), style = MaterialTheme.typography.labelSmall, color = PC.Faint)
            }
        }
        Spacer(Modifier.height(12.dp))
        content()
    }
}

@Composable
private fun BadgeIcon(iconUrl: String?, emoji: String, size: Int) {
    val url = Config.media(iconUrl)
    Box(Modifier.size(size.dp).clip(CircleShape).background(PC.Surface2), contentAlignment = Alignment.Center) {
        if (url != null) {
            AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.size((size * 0.72f).dp))
        } else {
            Text(emoji, fontSize = (size * 0.48f).sp)
        }
    }
}

@Composable
private fun IconTileLabel(name: String, iconUrl: String?, emoji: String, onClick: () -> Unit) {
    Column(
        Modifier.width(76.dp).clip(RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        BadgeIcon(iconUrl, emoji, 52)
        Spacer(Modifier.height(6.dp))
        Text(
            name, color = PC.Text, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center,
            maxLines = 2, overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun WallCard(
    title: String,
    icon: ImageVector,
    items: List<ProfileWallPost>?,
    total: Int,
    emptyText: String,
    onAuthor: (String) -> Unit,
) {
    SectionCard(title, icon, total) {
        when {
            items == null -> ListSkeleton(2, 36.dp, Modifier.padding(0.dp))
            items.isEmpty() -> Text(emptyText, color = PC.Muted, style = MaterialTheme.typography.bodyMedium)
            else -> Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                items.take(WALL_PREVIEW).forEach { post -> WallItem(post, onAuthor) }
                val more = maxOf(total, items.size) - WALL_PREVIEW
                if (more > 0) {
                    Text(
                        "+ $more ${if (more == 1) "outro" else "outros"}",
                        color = PC.Faint, style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}

private const val WALL_PREVIEW = 5

@Composable
private fun WallItem(post: ProfileWallPost, onAuthor: (String) -> Unit) {
    val author: User? = post.author
    Row(verticalAlignment = Alignment.Top) {
        Avatar(
            author, 36.dp,
            modifier = Modifier.clip(CircleShape).clickable(enabled = author != null) { author?.let { onAuthor(it.id) } },
        )
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    author?.name ?: "Alguém", color = PC.Header, style = MaterialTheme.typography.titleSmall,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false),
                )
                Spacer(Modifier.width(8.dp))
                Text(shortTime(post.createdAt), color = PC.Faint, style = MaterialTheme.typography.labelSmall)
            }
            Spacer(Modifier.height(2.dp))
            Text(post.text, color = PC.Text, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun ProfileSkeleton() {
    val b = rememberShimmer()
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxWidth().height(206.dp)) {
            Bone(b, Modifier.fillMaxWidth().height(150.dp), RoundedCornerShape(0.dp))
            Box(
                Modifier.padding(start = 16.dp, top = 94.dp).size(112.dp).background(PC.Bg, CircleShape),
                contentAlignment = Alignment.Center,
            ) { Bone(b, Modifier.size(102.dp), CircleShape) }
        }
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Bone(b, Modifier.fillMaxWidth(0.55f).height(24.dp))
            Bone(b, Modifier.fillMaxWidth(0.35f).height(14.dp))
            Spacer(Modifier.height(6.dp))
            Bone(b, Modifier.fillMaxWidth().height(52.dp), CircleShape)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                repeat(3) { Bone(b, Modifier.width(104.dp).height(52.dp), RoundedCornerShape(16.dp)) }
            }
            Bone(b, Modifier.fillMaxWidth().height(70.dp), RoundedCornerShape(20.dp))
            Bone(b, Modifier.fillMaxWidth().height(110.dp), RoundedCornerShape(20.dp))
        }
    }
}

// ---------------------------------------------------------------- utilidades

private fun statusLabel(status: String): String = when (status) {
    "ONLINE" -> "Online"
    "IDLE" -> "Ausente"
    "DND" -> "Não perturbe"
    else -> "Offline"
}

private val MONTHS = listOf("Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez")

/** "Out 2024" a partir da data de criação da conta. */
private fun joinedLabel(iso: String?): String? {
    val t = instantOf(iso)?.atZone(ZoneId.systemDefault()) ?: return null
    return "${MONTHS[t.monthValue - 1]} ${t.year}"
}

/** "#RRGGBB" → Color (null se vier vazio ou inválido). */
internal fun parseHex(hex: String?): Color? {
    if (hex.isNullOrBlank() || !hex.startsWith("#")) return null
    return runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrNull()
}
