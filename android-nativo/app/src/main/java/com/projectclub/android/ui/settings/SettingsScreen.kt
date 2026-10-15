package com.projectclub.android.ui.settings

import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.AlternateEmail
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Mail
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.projectclub.android.BuildConfig
import com.projectclub.android.data.MeResponse
import com.projectclub.android.data.Repository
import com.projectclub.android.ui.common.IconTile
import com.projectclub.android.ui.common.PcCard
import com.projectclub.android.ui.common.PcField
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.common.formatTime
import com.projectclub.android.ui.nav.AppNav
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

@Serializable
private data class SessionInfo(
    val id: String = "",
    val device: String? = null,
    val userAgent: String? = null,
    val ip: String? = null,
    val createdAt: String? = null,
    val lastUsedAt: String? = null,
    val isCurrent: Boolean = false,
)

@Serializable
private data class SessionsResponse(val sessions: List<SessionInfo> = emptyList())

private data class Choice(val value: String, val label: String)

private val PROFILE_PRIVACY = listOf(Choice("everyone", "Todo mundo"), Choice("friends_groups", "Amigos e grupos"), Choice("friends", "Só amigos"))
private val DM_PRIVACY = listOf(Choice("everyone", "Todo mundo"), Choice("friends_groups", "Amigos e grupos"), Choice("friends", "Só amigos"), Choice("none", "Ninguém"))
private val FRIEND_PRIVACY = listOf(Choice("everyone", "Todo mundo"), Choice("friends_of_friends", "Amigos de amigos"), Choice("none", "Ninguém"))
private val FILTER = listOf(Choice("off", "Desligado"), Choice("moderate", "Moderado"), Choice("high", "Alto"))
private val STATUS = listOf(Choice("ONLINE", "Online"), Choice("IDLE", "Ausente"), Choice("DND", "Não perturbe"), Choice("INVISIBLE", "Invisível"))

/** Configurações da conta e do perfil (as mesmas do PC que fazem sentido no celular). */
@Composable
fun SettingsScreen(repo: Repository, nav: AppNav) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val me by repo.me.collectAsState()
    val presence by repo.presence.collectAsState()
    var settings by remember { mutableStateOf<JsonObject?>(null) }
    var sessions by remember { mutableStateOf<List<SessionInfo>?>(null) }
    var choosing by remember { mutableStateOf<Triple<String, String, List<Choice>>?>(null) }
    var dialog by remember { mutableStateOf<String?>(null) }
    var confirmLogout by remember { mutableStateOf(false) }

    fun toast(t: String) = Toast.makeText(ctx, t, Toast.LENGTH_SHORT).show()
    suspend fun loadSettings() {
        runCatching { settings = repo.api.get<JsonElement>("/api/users/me/settings").jsonObject["settings"]?.jsonObject }
    }
    suspend fun loadSessions() { runCatching { sessions = repo.api.get<SessionsResponse>("/api/auth/sessions").sessions } }
    LaunchedEffect(Unit) { loadSettings(); loadSessions() }

    fun str(key: String) = (settings?.get(key) as? JsonPrimitive)?.contentOrNull
    fun bool(key: String) = (settings?.get(key) as? JsonPrimitive)?.booleanOrNull == true
    fun save(key: String, value: JsonPrimitive) {
        val before = settings
        settings = JsonObject((settings ?: JsonObject(emptyMap())) + (key to value))
        scope.launch {
            try { repo.api.patch<JsonElement>("/api/users/me/settings", JsonObject(mapOf(key to value))) }
            catch (e: Exception) { settings = before; toast(e.message ?: "Não deu pra salvar.") }
        }
    }

    Column(Modifier.fillMaxSize().background(PC.Bg)) {
        PcTopBar("Configurações", Icons.Outlined.Settings, navigation = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Voltar", tint = PC.Text) } })
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Section("Status")
            PcCard(padding = PaddingValues(6.dp)) {
                val current = presence[me?.id] ?: me?.status ?: "ONLINE"
                STATUS.forEach { s ->
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable {
                            scope.launch {
                                try { repo.api.patch<MeResponse>("/api/users/me/status", buildJsonObject { put("status", s.value) }).let { repo.updateMe(it.user) } }
                                catch (e: Exception) { toast(e.message ?: "Não deu pra trocar o status.") }
                            }
                        }.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.size(12.dp).clip(CircleShape).background(PC.presence(if (s.value == "INVISIBLE") "OFFLINE" else s.value)))
                        Text("   ${s.label}", color = PC.Header, modifier = Modifier.weight(1f))
                        if (current == s.value || (current == "OFFLINE" && s.value == "INVISIBLE")) Text("✓", color = PC.Brand)
                    }
                }
            }

            Section("Perfil")
            PcCard(padding = PaddingValues(6.dp)) {
                Line(Icons.Outlined.Edit, "Editar perfil", "Foto, banner, nome, bio e status", PC.Purple) { nav.editProfile() }
                Line(Icons.Outlined.AlternateEmail, "ClubTag", "@${me?.username ?: ""}", PC.Brand) { dialog = "username" }
            }

            Section("Conta")
            PcCard(padding = PaddingValues(6.dp)) {
                Line(Icons.Outlined.Mail, "E-mail", me?.email ?: "—", PC.Green) { }
                Line(Icons.Outlined.Lock, "Trocar senha", null, PC.Yellow) { dialog = "password" }
            }

            Section("Privacidade e segurança")
            PcCard(padding = PaddingValues(6.dp)) {
                ChoiceLine("Quem vê meu perfil", "profilePrivacy", PROFILE_PRIVACY, str("profilePrivacy")) { choosing = it }
                ChoiceLine("Quem pode me mandar mensagem", "dmPrivacy", DM_PRIVACY, str("dmPrivacy")) { choosing = it }
                ChoiceLine("Quem pode me adicionar", "friendRequestPrivacy", FRIEND_PRIVACY, str("friendRequestPrivacy")) { choosing = it }
                ChoiceLine("Filtro de conteúdo", "contentFilterLevel", FILTER, str("contentFilterLevel")) { choosing = it }
                Toggle("Filtro de spam", bool("spamFilterEnabled")) { save("spamFilterEnabled", JsonPrimitive(it)) }
                Toggle("Confirmação de leitura", bool("showReadReceipts")) { save("showReadReceipts", JsonPrimitive(it)) }
            }

            Section("Chat")
            PcCard(padding = PaddingValues(6.dp)) {
                Toggle("Prévia de links", bool("showLinkPreviews")) { save("showLinkPreviews", JsonPrimitive(it)) }
                Toggle("Tocar GIFs e vídeos sozinhos", bool("autoPlayMedia")) { save("autoPlayMedia", JsonPrimitive(it)) }
                Toggle("Mostrar horário das mensagens", bool("showTimestamps")) { save("showTimestamps", JsonPrimitive(it)) }
            }

            Section("Notificações")
            PcCard(padding = PaddingValues(6.dp)) {
                Toggle("Sons de notificação", bool("notificationSounds")) { save("notificationSounds", JsonPrimitive(it)) }
                Toggle("Avisos por e-mail", bool("emailNotifications")) { save("emailNotifications", JsonPrimitive(it)) }
                Line(Icons.Outlined.NotificationsActive, "Notificações do celular", "Sons, vibração e tipos de aviso", PC.Pink) {
                    ctx.startActivity(Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, ctx.packageName))
                }
            }

            Section("Aparelhos conectados")
            PcCard(padding = PaddingValues(6.dp)) {
                val list = sessions
                if (list == null) Text("Carregando...", color = PC.Muted, modifier = Modifier.padding(12.dp))
                list?.forEach { s ->
                    Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        IconTile(Icons.Outlined.Devices, if (s.isCurrent) PC.Green else PC.Muted, 36.dp, 20.dp)
                        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                            Text((s.device ?: "Aparelho") + if (s.isCurrent) " · este" else "", color = PC.Header, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text("Usado ${formatTime(s.lastUsedAt)}${s.ip?.let { " · $it" } ?: ""}", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
                        }
                        if (!s.isCurrent) TextButton(onClick = {
                            scope.launch { try { repo.api.delete("/api/auth/sessions/${s.id}"); loadSessions() } catch (e: Exception) { toast(e.message ?: "Não deu certo.") } }
                        }) { Text("Sair", color = PC.Red) }
                    }
                }
                if ((list?.count { !it.isCurrent } ?: 0) > 0) TextButton(onClick = {
                    scope.launch { try { repo.api.delete("/api/auth/sessions/other"); loadSessions(); toast("Os outros aparelhos foram desconectados.") } catch (e: Exception) { toast(e.message ?: "Não deu certo.") } }
                }, modifier = Modifier.padding(start = 4.dp)) { Text("Desconectar todos os outros", color = PC.Red) }
            }

            PcCard(padding = PaddingValues(6.dp)) {
                Line(Icons.AutoMirrored.Outlined.Logout, "Sair da conta", null, PC.Red, danger = true) { confirmLogout = true }
            }
            Text("Project Club para Android · versão ${BuildConfig.VERSION_NAME}", color = PC.Faint, style = MaterialTheme.typography.bodySmall, modifier = Modifier.align(Alignment.CenterHorizontally).navigationBarsPadding().padding(8.dp))
        }
    }

    choosing?.let { (title, key, options) ->
        AlertDialog(
            onDismissRequest = { choosing = null }, containerColor = PC.Surface2,
            title = { Text(title) },
            text = {
                Column {
                    options.forEach { o ->
                        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { save(key, JsonPrimitive(o.value)); choosing = null }.padding(12.dp)) {
                            Text(o.label, color = PC.Header, modifier = Modifier.weight(1f))
                            if (str(key) == o.value) Text("✓", color = PC.Brand)
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { choosing = null }) { Text("Fechar", color = PC.Text) } },
        )
    }

    when (dialog) {
        "username" -> {
            var name by remember { mutableStateOf(me?.username.orEmpty()) }
            var busy by remember { mutableStateOf(false) }
            AlertDialog(
                onDismissRequest = { dialog = null }, containerColor = PC.Surface2,
                title = { Text("Trocar ClubTag") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        PcField(name, { name = it.trim().removePrefix("@") }, "nova_clubtag", icon = Icons.Outlined.AlternateEmail)
                        Text("Dá pra trocar uma vez a cada 7 dias.", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
                    }
                },
                confirmButton = {
                    TextButton(enabled = name.isNotBlank() && !busy, onClick = {
                        busy = true
                        scope.launch {
                            try { repo.updateMe(repo.api.patch<MeResponse>("/api/users/me/username", buildJsonObject { put("username", name) }).user); toast("ClubTag trocada!"); dialog = null }
                            catch (e: Exception) { toast(e.message ?: "Não deu pra trocar.") }
                            busy = false
                        }
                    }) { Text("Salvar", color = PC.Brand) }
                },
                dismissButton = { TextButton(onClick = { dialog = null }) { Text("Cancelar", color = PC.Text) } },
            )
        }
        "password" -> {
            var current by remember { mutableStateOf("") }
            var next by remember { mutableStateOf("") }
            var busy by remember { mutableStateOf(false) }
            AlertDialog(
                onDismissRequest = { dialog = null }, containerColor = PC.Surface2,
                title = { Text("Trocar senha") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        PcField(current, { current = it }, "Senha atual", icon = Icons.Outlined.Lock, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
                        PcField(next, { next = it }, "Nova senha (mín. 8)", icon = Icons.Outlined.Lock, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
                    }
                },
                confirmButton = {
                    TextButton(enabled = current.isNotBlank() && next.length >= 8 && !busy, onClick = {
                        busy = true
                        scope.launch {
                            try {
                                repo.api.post<JsonElement>("/api/auth/change-password", buildJsonObject { put("currentPassword", current); put("newPassword", next) })
                                toast("Senha trocada!"); dialog = null
                            } catch (e: Exception) { toast(e.message ?: "Não deu pra trocar a senha.") }
                            busy = false
                        }
                    }) { Text("Trocar", color = PC.Brand) }
                },
                dismissButton = { TextButton(onClick = { dialog = null }) { Text("Cancelar", color = PC.Text) } },
            )
        }
    }

    if (confirmLogout) AlertDialog(
        onDismissRequest = { confirmLogout = false }, containerColor = PC.Surface2,
        title = { Text("Sair da conta?") },
        text = { Text("Você vai precisar entrar de novo neste aparelho.", color = PC.Muted) },
        confirmButton = { TextButton(onClick = { confirmLogout = false; scope.launch { repo.logout() } }) { Text("Sair", color = PC.Red) } },
        dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text("Cancelar", color = PC.Text) } },
    )
}

@Composable
private fun Section(text: String) {
    Text(text.uppercase(), color = PC.Muted, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(start = 6.dp, top = 8.dp))
}

@Composable
private fun Line(icon: ImageVector, label: String, value: String?, color: Color, danger: Boolean = false, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconTile(icon, color, 36.dp, 20.dp)
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(label, color = if (danger) PC.Red else PC.Header, style = MaterialTheme.typography.labelLarge)
            value?.let { Text(it, color = PC.Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
        if (!danger) Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = PC.Faint)
    }
}

@Composable
private fun ChoiceLine(title: String, key: String, options: List<Choice>, value: String?, onOpen: (Triple<String, String, List<Choice>>) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable { onOpen(Triple(title, key, options)) }.padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, color = PC.Header, modifier = Modifier.weight(1f))
        Text(options.firstOrNull { it.value == value }?.label ?: "—", color = PC.Brand, style = MaterialTheme.typography.labelLarge)
        Spacer(Modifier.width(4.dp))
        Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = PC.Faint)
    }
}

@Composable
private fun Toggle(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable { onChange(!checked) }.padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = PC.Header, modifier = Modifier.weight(1f))
        Switch(checked, onChange, colors = SwitchDefaults.colors(checkedTrackColor = PC.Brand, uncheckedTrackColor = PC.Surface3, uncheckedBorderColor = PC.LineStrong))
    }
}
