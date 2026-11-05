package com.projectclub.android.ui.chat

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.systemGestureExclusion
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Search
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.min
import androidx.compose.ui.unit.sp
import com.projectclub.android.data.Member
import com.projectclub.android.data.Repository
import com.projectclub.android.data.Role
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.PcField
import com.projectclub.android.ui.profile.LocalOpenUser
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * Lista de membros que entra pela direita, como no site (e no Discord do
 * celular): puxa a borda direita da tela pra abrir, arrasta pra direita ou
 * toca fora pra fechar. `open`/`onOpenChange` deixam um botão da barra abrir
 * também.
 */
@Composable
fun MembersDrawerHost(
    repo: Repository,
    enabled: Boolean,
    open: Boolean,
    onOpenChange: (Boolean) -> Unit,
    content: @Composable () -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        content()
        if (!enabled) return@BoxWithConstraints
        val density = LocalDensity.current
        val panelWidth = min(maxWidth * 0.86f, 340.dp)
        val widthPx = with(density) { panelWidth.toPx() }
        // 0 = fechado, 1 = aberto (segue o dedo enquanto arrasta)
        val progress = remember { Animatable(0f) }
        val scope = rememberCoroutineScope()
        var dragging by remember { mutableStateOf(false) }

        // "voltar" do Android fecha a lista antes de sair da conversa
        BackHandler(enabled = open) { onOpenChange(false) }
        LaunchedEffect(open) {
            if (!dragging) progress.animateTo(if (open) 1f else 0f, spring(dampingRatio = 0.9f, stiffness = 500f))
        }
        fun settle(velocity: Float) {
            dragging = false
            val target = when {
                velocity < -800f -> true
                velocity > 800f -> false
                else -> progress.value > 0.45f
            }
            scope.launch { progress.animateTo(if (target) 1f else 0f, spring(dampingRatio = 0.9f, stiffness = 500f)) }
            onOpenChange(target)
        }
        val dragState = rememberDraggableState { delta ->
            dragging = true
            scope.launch { progress.snapTo((progress.value - delta / widthPx).coerceIn(0f, 1f)) }
        }

        // borda direita: puxar pra esquerda abre. O Android usa as bordas pro
        // gesto de "voltar"; a faixa do meio da tela fica reservada pra lista.
        if (progress.value == 0f) {
            Box(
                Modifier
                    .align(Alignment.CenterEnd)
                    .width(22.dp)
                    .fillMaxHeight(0.6f)
                    .systemGestureExclusion()
                    .draggable(dragState, Orientation.Horizontal, onDragStopped = { settle(it) }),
            )
        }

        if (progress.value > 0f) {
            // fundo escuro: toca pra fechar
            Box(
                Modifier
                    .fillMaxSize()
                    .alpha(progress.value)
                    .background(Color(0x99000000))
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { onOpenChange(false) }
                    .draggable(dragState, Orientation.Horizontal, onDragStopped = { settle(it) }),
            )
            Box(
                Modifier
                    .align(Alignment.CenterEnd)
                    .offset { IntOffset(((1f - progress.value) * widthPx).roundToInt(), 0) }
                    .width(panelWidth)
                    .fillMaxHeight()
                    .background(PC.Bar)
                    .draggable(dragState, Orientation.Horizontal, onDragStopped = { settle(it) }),
            ) {
                MembersPanel(repo, onClose = { onOpenChange(false) })
            }
        }
    }
}

private data class MemberRow(val member: Member, val status: String, val role: Role?, val color: Color?)
private data class MemberGroup(val label: String, val rows: List<MemberRow>, val dim: Boolean = false)

private fun parseColor(hex: String?): Color? {
    val h = hex?.trim()?.removePrefix("#") ?: return null
    if (h.length != 6) return null
    return h.toLongOrNull(16)?.let { Color(0xFF000000 or it) }
}

private fun isOnline(status: String) = status != "OFFLINE" && status != "INVISIBLE" && status.isNotBlank()

@Composable
fun MembersPanel(repo: Repository, onClose: () -> Unit) {
    val community by repo.community.collectAsState()
    val presence by repo.presence.collectAsState()
    val openUser = LocalOpenUser.current
    var query by remember { mutableStateOf("") }

    val members = community?.members.orEmpty()
    val roles = community?.roles.orEmpty()
    val groups = remember(members, roles, presence, query) {
        val q = query.trim().lowercase()
        val byId = roles.associateBy { it.id }
        val rows = members
            .filter { q.isEmpty() || it.user.name.lowercase().contains(q) || it.user.username.orEmpty().lowercase().contains(q) }
            .map { m ->
                val mine = m.roleIds.mapNotNull { byId[it] }.filter { !it.isDefault }
                val top = mine.maxByOrNull { it.position }
                val colored = mine.filter { parseColor(it.color) != null }.maxByOrNull { it.position }
                MemberRow(m, presence[m.user.id] ?: m.user.status ?: "OFFLINE", top, parseColor(colored?.color))
            }
            .sortedBy { it.member.user.name.lowercase() }
        val online = rows.filter { isOnline(it.status) }
        val offline = rows.filter { !isOnline(it.status) }
        val out = mutableListOf<MemberGroup>()
        val used = HashSet<String>()
        for (role in roles.filter { it.hoist && !it.isDefault }.sortedByDescending { it.position }) {
            val inRole = online.filter { it.role?.id == role.id }
            if (inRole.isNotEmpty()) {
                inRole.forEach { used += it.member.user.id }
                out += MemberGroup("${role.name} — ${inRole.size}", inRole)
            }
        }
        val rest = online.filter { it.member.user.id !in used }
        if (rest.isNotEmpty()) out += MemberGroup("Online — ${rest.size}", rest)
        if (offline.isNotEmpty()) out += MemberGroup("Offline — ${offline.size}", offline, dim = true)
        out
    }

    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Group, null, tint = PC.Muted, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(8.dp))
            Text("Membros — ${members.size}", color = PC.Header, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            IconButton(onClick = onClose) { Icon(Icons.Outlined.Close, "Fechar", tint = PC.Muted) }
        }
        PcField(query, { query = it }, "Buscar membro", Modifier.padding(horizontal = 12.dp), icon = Icons.Outlined.Search)
        if (members.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Carregando membros…", color = PC.Muted)
            }
            return@Column
        }
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 8.dp, end = 8.dp, top = 8.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            for (g in groups) {
                item(key = "h-${g.label}") {
                    Text(
                        g.label.uppercase(), color = PC.Muted, fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.4.sp,
                        modifier = Modifier.padding(start = 8.dp, top = 14.dp, bottom = 6.dp),
                    )
                }
                items(g.rows, key = { "${g.label}-${it.member.user.id}" }) { r ->
                    MemberItem(r, dim = g.dim) { openUser(r.member.user.id) }
                }
            }
            item { Spacer(Modifier.height(8.dp).navigationBarsPadding()) }
        }
    }
}

@Composable
private fun MemberItem(r: MemberRow, dim: Boolean, onClick: () -> Unit) {
    val u = r.member.user
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 6.dp)
            .alpha(if (dim) 0.55f else 1f),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(u, 36.dp, r.status)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                u.name, color = r.color ?: PC.Header, maxLines = 1, overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold,
            )
            val status = listOfNotNull(u.customStatusEmoji?.takeIf { it.isNotBlank() }, u.customStatus?.takeIf { it.isNotBlank() }).joinToString(" ")
            if (status.isNotBlank()) {
                Text(status, color = PC.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}
