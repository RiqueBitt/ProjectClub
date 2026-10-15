package com.projectclub.android.ui.home

import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.Celebration
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Leaderboard
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.QuestionAnswer
import androidx.compose.material.icons.filled.Savings
import androidx.compose.material.icons.filled.SportsEsports
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material.icons.filled.SupportAgent
import androidx.compose.material.icons.filled.TaskAlt
import androidx.compose.material3.AlertDialog
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.projectclub.android.BuildConfig
import com.projectclub.android.data.Repository
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.SectionLabel
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch

/**
 * Fase 1: o que ainda não é nativo abre o site dentro do app (já logado).
 * Cada item vira tela nativa nas próximas fases.
 */
@Composable
fun MoreTab(repo: Repository, actions: HomeActions, modifier: Modifier) {
    val me by repo.me.collectAsState()
    val presence by repo.presence.collectAsState()
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var confirmLogout by remember { mutableStateOf(false) }

    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
        Row(
            Modifier.fillMaxWidth().clickable { actions.openWeb("/profile") }.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Avatar(me, 56.dp, presence[me?.id] ?: "ONLINE")
            Spacer(Modifier.width(14.dp))
            Column {
                Text(me?.name ?: "", style = MaterialTheme.typography.titleMedium)
                Text("@${me?.username ?: ""}", color = PC.Muted)
            }
        }
        Section("Comunidade") {
            Item(Icons.Filled.Home, "Início") { actions.openWeb("/inicio") }
            Item(Icons.Filled.QuestionAnswer, "Fórum") { actions.openWeb("/forum") }
            Item(Icons.Filled.Celebration, "Eventos") { actions.openWeb("/comunidade/eventos") }
            Item(Icons.Filled.PhotoLibrary, "Galeria") { actions.openWeb("/comunidade/galeria") }
            Item(Icons.Filled.Groups, "Clubes") { actions.openWeb("/clans") }
        }
        Section("Economia e diversão") {
            Item(Icons.Filled.Storefront, "Loja") { actions.openWeb("/loja") }
            Item(Icons.Filled.Savings, "Economia") { actions.openWeb("/economia") }
            Item(Icons.Filled.TaskAlt, "Missões") { actions.openWeb("/missoes") }
            Item(Icons.Filled.EmojiEvents, "Conquistas") { actions.openWeb("/conquistas") }
            Item(Icons.Filled.Leaderboard, "Rank") { actions.openWeb("/rank") }
            Item(Icons.Filled.SportsEsports, "Minijogos") { actions.openWeb("/minijogos") }
        }
        Section("Conta") {
            Item(Icons.Filled.Person, "Meu perfil") { actions.openWeb("/profile") }
            Item(Icons.Filled.SupportAgent, "Suporte") { actions.openWeb("/tickets") }
            if (me?.platformRole == "ADMIN" || me?.platformRole == "MODERATOR") Item(Icons.Filled.AdminPanelSettings, "Painel da equipe") { actions.openWeb("/admin") }
            Item(Icons.Filled.NotificationsActive, "Notificações do celular") {
                ctx.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName))
            }
            Item(Icons.Filled.Language, "Abrir o site completo") { actions.openWeb("/") }
            Item(Icons.AutoMirrored.Filled.Logout, "Sair", danger = true) { confirmLogout = true }
        }
        Text(
            "Project Club nativo · versão ${BuildConfig.VERSION_NAME}" + if (BuildConfig.HAS_FIREBASE) "" else " · notificações push desligadas",
            color = PC.Muted, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(16.dp),
        )
    }
    if (confirmLogout) AlertDialog(
        onDismissRequest = { confirmLogout = false },
        title = { Text("Sair da conta?") },
        text = { Text("Você vai precisar entrar de novo neste aparelho.") },
        confirmButton = { TextButton(onClick = { confirmLogout = false; scope.launch { repo.logout() } }) { Text("Sair", color = PC.Red) } },
        dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text("Cancelar") } },
    )
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    SectionLabel(title, Modifier.padding(start = 16.dp, top = 16.dp, bottom = 6.dp))
    Column(Modifier.padding(horizontal = 12.dp).clip(RoundedCornerShape(14.dp)).background(PC.Surface)) { content() }
}

@Composable
private fun Item(icon: ImageVector, label: String, danger: Boolean = false, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = if (danger) PC.Red else PC.Muted, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(14.dp))
        Text(label, color = if (danger) PC.Red else PC.Text, fontWeight = FontWeight.Medium)
    }
}
