package com.projectclub.android.ui.home

import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.LocalMall
import androidx.compose.material.icons.outlined.MonetizationOn
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.StarOutline
import androidx.compose.material.icons.outlined.SystemUpdate
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.projectclub.android.data.ChatLogic
import com.projectclub.android.data.Repository
import com.projectclub.android.data.Room
import com.projectclub.android.data.Updater
import kotlinx.coroutines.launch
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.Bone
import com.projectclub.android.ui.common.HeroBox
import com.projectclub.android.ui.common.IconTile
import com.projectclub.android.ui.common.PcCard
import com.projectclub.android.ui.common.PcLogo
import com.projectclub.android.ui.common.PcTopBar
import com.projectclub.android.ui.common.PillButton
import com.projectclub.android.ui.common.rememberShimmer
import com.projectclub.android.ui.common.shortTime
import com.projectclub.android.ui.theme.PC
import java.time.LocalTime

/** Aba Início: o mesmo resumo da página inicial do site. */
@Composable
fun HomeTab(repo: Repository, actions: HomeActions, nav: com.projectclub.android.ui.nav.AppNav, goTab: (Tab) -> Unit) {
    val me by repo.me.collectAsState()
    val community by repo.community.collectAsState()
    val presence by repo.presence.collectAsState()
    val rosters by repo.voiceRosters.collectAsState()
    val conversations by repo.conversations.collectAsState()
    val loaded by repo.loaded.collectAsState()
    val update by Updater.state.collectAsState()
    val updateHidden by Updater.dismissed.collectAsState()
    val uri = LocalUriHandler.current

    val members = community?.members.orEmpty()
    val online = members.count { (presence[it.user.id] ?: it.user.status) in setOf("ONLINE", "IDLE", "DND") }
    val allChannels = community?.let { c -> c.channels + c.categories.flatMap { it.channels } }.orEmpty()
    val firstChat = allChannels.sortedBy { it.position }.firstOrNull { it.isChat && it.name.contains("geral", ignoreCase = true) }
        ?: allChannels.firstOrNull { it.isChat }
    val liveCalls = allChannels.filter { it.isVoice && rosters[it.id].orEmpty().isNotEmpty() }

    Column(Modifier.fillMaxSize()) {
        PcTopBar("Início", Icons.Outlined.Home)
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            val showUpdate = !updateHidden && update !is com.projectclub.android.data.UpdateState.None &&
                !(update is com.projectclub.android.data.UpdateState.Downloading)
            AnimatedVisibility(showUpdate) { UpdateCard(update) }

            // Destaque azul: saudação + números da comunidade
            HeroBox(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(20.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(64.dp).clip(RoundedCornerShape(18.dp)).background(Color(0x66000000)), contentAlignment = Alignment.Center) { PcLogo(46.dp) }
                        Spacer(Modifier.width(14.dp))
                        Column {
                            Text("${greeting()}, ${me?.name ?: ""}", color = Color(0xCCFFFFFF), style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(community?.community?.name ?: "Project Club", style = MaterialTheme.typography.headlineMedium, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Stat("membros", if (loaded) "%,d".format(members.size).replace(',', '.') else null, Modifier.weight(1f))
                        Stat("online agora", if (loaded) online.toString() else null, Modifier.weight(1f))
                    }
                }
            }

            // Atalhos 2x2
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                QuickCard(Icons.Outlined.ChatBubbleOutline, "Conversar", firstChat?.let { "# ${it.name}" } ?: "Canais", Modifier.weight(1f)) {
                    if (firstChat != null) actions.openRoom(Room(channelId = firstChat.id)) else goTab(Tab.Community)
                }
                QuickCard(Icons.AutoMirrored.Outlined.Article, "Fórum", "Posts e temas", Modifier.weight(1f)) { nav.forum() }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                QuickCard(Icons.Outlined.People, "Social", "Amigos e mensagens", Modifier.weight(1f)) { goTab(Tab.Social) }
                QuickCard(Icons.Outlined.StarOutline, "Progresso", "Ranks e conquistas", Modifier.weight(1f)) { nav.progress(null) }
            }

            // Calls acontecendo agora
            if (liveCalls.isNotEmpty()) {
                SectionTitle(Icons.AutoMirrored.Outlined.VolumeUp, "Em call agora", PC.Green)
                liveCalls.forEach { ch ->
                    val people = rosters[ch.id].orEmpty().mapNotNull { repo.user(it.userId) }
                    PcCard(onClick = { actions.joinVoice(ch.id, ch.name) }, padding = PaddingValues(14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconTile(Icons.AutoMirrored.Outlined.VolumeUp, PC.Green)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(ch.name, style = MaterialTheme.typography.titleSmall, color = PC.Header, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text("${people.size} na call · toque pra entrar", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
                            }
                            AvatarStack(people.take(4))
                        }
                    }
                }
            }

            // Conversas recentes
            val recent = conversations.take(4)
            if (!loaded) {
                SectionTitle(Icons.Outlined.ChatBubbleOutline, "Conversas recentes", PC.Brand)
                val b = rememberShimmer()
                repeat(3) { Bone(b, Modifier.fillMaxWidth().height(64.dp), RoundedCornerShape(18.dp)) }
            } else if (recent.isNotEmpty()) {
                SectionTitle(Icons.Outlined.ChatBubbleOutline, "Conversas recentes", PC.Brand)
                PcCard(padding = PaddingValues(6.dp)) {
                    recent.forEach { conv ->
                        val other = conv.members.firstOrNull { it.id != me?.id }
                        val unread = ChatLogic.isConversationUnread(conv, me?.id)
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable { actions.openRoom(Room(conversationId = conv.id)) }.padding(10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Avatar(other, 40.dp, if (conv.isGroup) null else presence[other?.id] ?: "OFFLINE")
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(repo.conversationTitle(conv), color = PC.Header, fontWeight = if (unread) FontWeight.ExtraBold else FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(conv.lastMessage?.content?.replace('\n', ' ') ?: "Diga oi 👋", color = if (unread) PC.Text else PC.Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            Text(shortTime(conv.lastMessage?.createdAt), color = PC.Muted, style = MaterialTheme.typography.labelSmall)
                            if (unread) { Spacer(Modifier.width(8.dp)); Box(Modifier.size(9.dp).clip(CircleShape).background(PC.Brand)) }
                        }
                    }
                }
            }

            // Mais do Project Club
            SectionTitle(Icons.Outlined.StarOutline, "Explorar", PC.Yellow)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                MiniTile(Icons.Outlined.LocalMall, "Loja", PC.Store, Modifier.weight(1f)) { nav.store(null) }
                MiniTile(Icons.Outlined.CalendarMonth, "Eventos", PC.Events, Modifier.weight(1f)) { nav.events() }
                MiniTile(Icons.Outlined.MonetizationOn, "Economia", PC.Purple, Modifier.weight(1f)) { nav.economy() }
                MiniTile(Icons.Outlined.TaskAlt, "Missões", PC.Pink, Modifier.weight(1f)) { nav.economy() }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

private fun greeting(): String = when (LocalTime.now().hour) {
    in 5..11 -> "Bom dia"
    in 12..17 -> "Boa tarde"
    else -> "Boa noite"
}

@Composable
private fun Stat(label: String, value: String?, modifier: Modifier) {
    val shape = RoundedCornerShape(16.dp)
    Column(modifier.clip(shape).background(Color(0x55000814)).border(1.dp, Color(0x332F6BD8), shape).padding(horizontal = 14.dp, vertical = 12.dp)) {
        Text(label, color = Color(0xCCFFFFFF), style = MaterialTheme.typography.bodySmall)
        if (value != null) Text(value, color = Color.White, style = MaterialTheme.typography.headlineSmall)
        else Bone(rememberShimmer(), Modifier.padding(top = 6.dp).size(width = 70.dp, height = 22.dp))
    }
}

@Composable
private fun QuickCard(icon: ImageVector, title: String, subtitle: String, modifier: Modifier, onClick: () -> Unit) {
    PcCard(modifier, onClick = onClick, padding = PaddingValues(14.dp)) {
        IconTile(icon, PC.Brand, 40.dp)
        Spacer(Modifier.height(10.dp))
        Text(title, style = MaterialTheme.typography.titleSmall, color = PC.Header, maxLines = 1)
        Text(subtitle, color = PC.Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun MiniTile(icon: ImageVector, label: String, color: Color, modifier: Modifier, onClick: () -> Unit) {
    PcCard(modifier, onClick = onClick, padding = PaddingValues(vertical = 14.dp, horizontal = 4.dp)) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            IconTile(icon, color, 40.dp)
            Spacer(Modifier.height(8.dp))
            Text(label, style = MaterialTheme.typography.labelMedium, color = PC.Text, maxLines = 1)
        }
    }
}

@Composable
internal fun SectionTitle(icon: ImageVector, text: String, color: Color) {
    Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = color, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(10.dp))
        Text(text, style = MaterialTheme.typography.titleLarge, color = PC.Header)
    }
}

@Composable
internal fun AvatarStack(users: List<com.projectclub.android.data.User>, size: androidx.compose.ui.unit.Dp = 26.dp) {
    Box(Modifier.width(size + (size - 8.dp) * (users.size - 1).coerceAtLeast(0))) {
        users.forEachIndexed { i, u ->
            Box(Modifier.offset(x = (size - 8.dp) * i).clip(CircleShape).border(2.dp, PC.Surface, CircleShape)) { Avatar(u, size) }
        }
    }
}


/** Aviso de atualização: baixa sozinho; instala sozinho ao sair do app (Android 12+). */
@Composable
private fun UpdateCard(st: com.projectclub.android.data.UpdateState) {
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val (title, text, button, action) = when (st) {
        is com.projectclub.android.data.UpdateState.Ready -> when {
            st.needsPermission -> Quad("Atualização ${st.release.versionName} pronta",
                "Libere uma vez \"instalar apps\" pro Project Club e as próximas atualizações instalam sozinhas.",
                "Liberar atualizações automáticas", { Updater.openPermissionSettings() })
            Updater.canInstallSilently() -> Quad("Atualização ${st.release.versionName} pronta",
                "Ela instala sozinha quando você sair do app. Ou instale agora (o app fecha e reabre na versão nova).",
                "Instalar agora", { Updater.install(userAsked = true) })
            else -> Quad("Atualização ${st.release.versionName} pronta", "Já foi baixada — é só confirmar.", "Instalar agora", { Updater.install(userAsked = true) })
        }
        is com.projectclub.android.data.UpdateState.Installing -> Quad(
            if (st.percent != null) "Preparando ${st.release.versionName}… ${st.percent}%" else "Instalando ${st.release.versionName}…",
            "O app vai fechar e já volta na versão nova.", null, null)
        is com.projectclub.android.data.UpdateState.Failed -> Quad("Não deu pra atualizar", st.message, "Tentar de novo", { Updater.retry(); scope.launch { Updater.check(force = true) } })
        else -> return
    }
    PcCard(border = PC.Brand.copy(alpha = 0.5f), padding = PaddingValues(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconTile(Icons.Outlined.SystemUpdate, PC.Brand)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleSmall, color = PC.Header)
                Text(text, color = PC.Muted, style = MaterialTheme.typography.bodySmall)
            }
            IconButton(onClick = { Updater.dismiss() }) { Icon(Icons.Outlined.Close, "Agora não", tint = PC.Muted) }
        }
        if (button != null && action != null) {
            Spacer(Modifier.height(10.dp))
            PillButton(button, action, Modifier.fillMaxWidth())
        }
    }
}

private data class Quad(val a: String, val b: String, val c: String?, val d: (() -> Unit)?)
