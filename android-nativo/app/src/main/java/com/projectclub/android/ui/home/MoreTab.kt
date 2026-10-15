package com.projectclub.android.ui.home

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.AdminPanelSettings
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.EmojiEvents
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Leaderboard
import androidx.compose.material.icons.outlined.LocalMall
import androidx.compose.material.icons.outlined.MonetizationOn
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.SportsEsports
import androidx.compose.material.icons.outlined.SupportAgent
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.projectclub.android.BuildConfig
import com.projectclub.android.Config
import com.projectclub.android.data.Repository
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.IconTile
import com.projectclub.android.ui.common.PcCard
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch

private data class Entry(val icon: ImageVector, val label: String, val color: Color, val path: String)

/** Aba Você: perfil e tudo do Project Club que abre pelo site (já logado). */
@Composable
fun MoreTab(repo: Repository, actions: HomeActions, nav: com.projectclub.android.ui.nav.AppNav) {
    val me by repo.me.collectAsState()
    val presence by repo.presence.collectAsState()
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var confirmLogout by remember { mutableStateOf(false) }

    val grid = listOf(
        Entry(Icons.Outlined.LocalMall, "Loja", PC.Store, "/loja"),
        Entry(Icons.Outlined.MonetizationOn, "Economia", PC.Purple, "/economia"),
        Entry(Icons.Outlined.TaskAlt, "Missões", PC.Pink, "/missoes"),
        Entry(Icons.Outlined.EmojiEvents, "Conquistas", PC.Yellow, "/progresso?tab=conquistas"),
        Entry(Icons.Outlined.Leaderboard, "Rank", PC.Brand, "/rank"),
        Entry(Icons.Outlined.SportsEsports, "Minijogos", Color(0xFF22D3EE), "/minijogos"),
        Entry(Icons.Outlined.Groups, "Clubes", Color(0xFFFB923C), "/clans"),
        Entry(Icons.Outlined.CalendarMonth, "Eventos", PC.Events, "/comunidade/eventos"),
        Entry(Icons.AutoMirrored.Outlined.Article, "Fórum", PC.Forum, "/comunidades"),
    )

    Column(Modifier.fillMaxSize()) {
        PcTopBar("Você", Icons.Outlined.Person) {
            androidx.compose.material3.IconButton(onClick = { nav.settings() }) { Icon(Icons.Outlined.Settings, "Configurações", tint = PC.Text) }
        }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            // Cartão do perfil (banner + avatar), como o mini perfil do site
            val shape = RoundedCornerShape(24.dp)
            Column(Modifier.fillMaxWidth().clip(shape).background(PC.Surface).border(1.dp, PC.Line, shape).clickable { me?.id?.let(nav::profile) }) {
                Box(Modifier.fillMaxWidth().height(136.dp)) {
                    Box(Modifier.fillMaxWidth().height(96.dp).background(profileBrush(me?.profileColor))) {
                        Config.media(me?.bannerUrl)?.let { AsyncImage(it, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
                    }
                    Box(Modifier.padding(start = 16.dp, top = 50.dp).size(86.dp).clip(CircleShape).background(PC.Surface), contentAlignment = Alignment.Center) {
                        Avatar(me, 74.dp, presence[me?.id] ?: "ONLINE")
                    }
                }
                Column(Modifier.padding(start = 18.dp, end = 18.dp, bottom = 18.dp, top = 6.dp)) {
                    Text(me?.name ?: "", style = MaterialTheme.typography.headlineSmall, color = PC.Header, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("@${me?.username ?: ""}", color = PC.Muted)
                    me?.customStatus?.takeIf { it.isNotBlank() }?.let {
                        Spacer(Modifier.height(8.dp))
                        Text(listOfNotNull(me?.customStatusEmoji, it).joinToString(" "), color = PC.Text, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }

            // Grade de atalhos
            grid.chunked(3).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    row.forEach { e ->
                        PcCard(Modifier.weight(1f), onClick = { actions.openWeb(e.path) }, padding = PaddingValues(vertical = 16.dp, horizontal = 6.dp)) {
                            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                                IconTile(e.icon, e.color, 44.dp, 24.dp)
                                Spacer(Modifier.height(8.dp))
                                Text(e.label, color = PC.Text, style = MaterialTheme.typography.labelMedium, maxLines = 1)
                            }
                        }
                    }
                    repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }

            // Conta
            PcCard(padding = PaddingValues(6.dp)) {
                Line(Icons.Outlined.Person, "Meu perfil", PC.Brand) { me?.id?.let(nav::profile) }
                Line(Icons.Outlined.Edit, "Editar perfil", PC.Purple) { nav.editProfile() }
                Line(Icons.Outlined.Settings, "Configurações", PC.Brand) { nav.settings() }
                Line(Icons.Outlined.Campaign, "Anúncios", PC.Announce) { nav.announcements() }
                Line(Icons.Outlined.PhotoLibrary, "Galeria", Color(0xFFF472B6)) { nav.gallery() }
                Line(Icons.Outlined.SupportAgent, "Suporte", PC.Green) { actions.openWeb("/tickets") }
                if (me?.platformRole == "ADMIN" || me?.platformRole == "MODERATOR") Line(Icons.Outlined.AdminPanelSettings, "Painel da equipe", PC.Yellow) { actions.openWeb("/admin") }
                Line(Icons.Outlined.NotificationsActive, "Notificações do celular", PC.Pink) {
                    ctx.startActivity(Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, ctx.packageName))
                }
                Line(Icons.Outlined.Language, "Abrir o site no navegador", PC.Muted) { nav.external("/inicio") }
                HorizontalDivider(color = PC.Line, modifier = Modifier.padding(vertical = 4.dp))
                Line(Icons.AutoMirrored.Outlined.Logout, "Sair da conta", PC.Red, danger = true) { confirmLogout = true }
            }
            Text(
                "Project Club para Android · versão ${BuildConfig.VERSION_NAME}",
                color = PC.Faint, style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.align(Alignment.CenterHorizontally).padding(bottom = 8.dp),
            )
        }
    }
    if (confirmLogout) AlertDialog(
        onDismissRequest = { confirmLogout = false },
        containerColor = PC.Surface2,
        title = { Text("Sair da conta?") },
        text = { Text("Você vai precisar entrar de novo neste aparelho.", color = PC.Muted) },
        confirmButton = { TextButton(onClick = { confirmLogout = false; scope.launch { repo.logout() } }) { Text("Sair", color = PC.Red) } },
        dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text("Cancelar", color = PC.Text) } },
    )
}

private fun profileBrush(hex: String?): Brush {
    val c = runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrNull()
    return if (c != null) Brush.linearGradient(listOf(c, c.copy(alpha = 0.55f))) else PC.HeroGradient
}

@Composable
private fun Line(icon: ImageVector, label: String, color: Color, danger: Boolean = false, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconTile(icon, color, 36.dp, 20.dp)
        Spacer(Modifier.width(12.dp))
        Text(label, color = if (danger) PC.Red else PC.Header, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
        if (!danger) Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = PC.Faint)
    }
}
