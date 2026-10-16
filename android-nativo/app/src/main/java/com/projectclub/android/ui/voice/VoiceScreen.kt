package com.projectclub.android.ui.voice

import android.app.Activity
import android.media.projection.MediaProjectionManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.withInfiniteAnimationFrameMillis
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeOff
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.FullscreenExit
import androidx.compose.material.icons.filled.Headset
import androidx.compose.material.icons.filled.HeadsetOff
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.ScreenShare
import androidx.compose.material.icons.filled.StopScreenShare
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.projectclub.android.data.Repository
import com.projectclub.android.data.User
import com.projectclub.android.data.VoiceParticipant
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.theme.PC
import com.projectclub.android.voice.CallService
import com.projectclub.android.voice.CallState
import com.projectclub.android.voice.CallStatus
import com.projectclub.android.voice.VoiceManager
import kotlinx.coroutines.delay

/** Ações da tela de chamada (separadas pra tela poder ser desenhada sem chamada de verdade). */
class CallActions(
    val minimize: () -> Unit,
    val toggleMute: () -> Unit,
    val toggleDeafen: () -> Unit,
    val toggleSpeaker: () -> Unit,
    val toggleScreen: () -> Unit,
    val leave: () -> Unit,
    val clearError: () -> Unit,
)

@Composable
fun VoiceScreen(voice: VoiceManager, repo: Repository, onBack: () -> Unit, onOpenWeb: (String) -> Unit) {
    val s by voice.state.collectAsState()
    val rosters by repo.voiceRosters.collectAsState()
    val me by repo.me.collectAsState()
    val ctx = LocalContext.current

    val shareLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val data = r.data
        if (r.resultCode == Activity.RESULT_OK && data != null) CallService.startScreen(ctx, r.resultCode, data)
    }

    val channelName = s.channelName
    if (channelName == null || s.status == CallStatus.Idle) {
        CallMessage(
            title = "Chamada encerrada",
            text = s.error ?: "Você não está em nenhuma chamada.",
            primary = "Voltar" to { voice.clearError(); onBack() },
        )
        return
    }
    if (s.status == CallStatus.Unsupported) {
        val webPath = if (channelName.startsWith("dm:")) "/conversations/${channelName.removePrefix("dm:")}" else "/channels/$channelName"
        CallMessage(
            title = "Chamada pelo site",
            text = "As chamadas estão no servidor de reserva agora, que ainda não tem versão no app. Dá pra entrar por esta conversa no site.",
            primary = "Entrar pelo site" to { voice.leave(notifyServer = false); onOpenWeb(webPath) },
            secondary = "Voltar" to { voice.leave(notifyServer = false); onBack() },
        )
        return
    }

    CallLayout(
        state = s,
        me = me,
        participants = rosters[channelName].orEmpty(),
        userOf = { repo.user(it) },
        actions = CallActions(
            minimize = onBack,
            toggleMute = voice::toggleMute,
            toggleDeafen = voice::toggleDeafen,
            toggleSpeaker = voice::toggleSpeaker,
            toggleScreen = {
                if (s.sharingScreen) voice.stopScreenShare()
                else shareLauncher.launch(ctx.getSystemService(MediaProjectionManager::class.java).createScreenCaptureIntent())
            },
            leave = { voice.leave(); onBack() },
            clearError = voice::clearError,
        ),
        screen = { userId, modifier ->
            Box(modifier) {
                AndroidView(factory = { c -> voice.createVideoView(c).also { voice.bindRemoteVideo(it, userId) } }, modifier = Modifier.fillMaxSize())
                DisposableEffect(userId) { onDispose { voice.unbindRemoteVideo(userId) } }
            }
        },
    )
}

/**
 * Tela da chamada, no visual do Project Club: topo com o canal e o tempo
 * de chamada, grade de pessoas (anel verde quando fala), tela compartilhada
 * em destaque e a barra de controles embaixo.
 */
@Composable
fun CallLayout(
    state: CallState,
    me: User?,
    participants: List<VoiceParticipant>,
    userOf: (String) -> User?,
    actions: CallActions,
    screen: @Composable (userId: String, modifier: Modifier) -> Unit,
) {
    val others = participants.filter { it.userId != me?.id }
    val sharing = others.filter { it.screenSharing && state.remoteVideo.contains(it.userId) }
    var focused by rememberSaveable { mutableStateOf<String?>(null) }
    var fullscreen by rememberSaveable { mutableStateOf(false) }
    val big = focused?.let { f -> sharing.firstOrNull { it.userId == f } } ?: sharing.firstOrNull()
    LaunchedEffect(big == null) { if (big == null) fullscreen = false }

    // Tempo de chamada: conta desde que conectou.
    var startedAt by remember(state.channelName) { mutableLongStateOf(0L) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(state.status) { if (state.status == CallStatus.Connected && startedAt == 0L) startedAt = System.currentTimeMillis() }
    // withInfiniteAnimationFrameMillis: nos testes de tela o relógio "infinito"
    // é pausado (senão a captura nunca termina); no celular conta normal.
    LaunchedEffect(startedAt) {
        while (startedAt > 0) { withInfiniteAnimationFrameMillis { }; now = System.currentTimeMillis(); delay(1000) }
    }

    val people = buildList {
        add(Person(me?.id ?: "me", me, isMe = true, speaking = state.speaking.contains("me") && !state.muted, muted = state.muted || state.deafened, deafened = state.deafened, sharing = state.sharingScreen))
        others.forEach { p -> add(Person(p.userId, userOf(p.userId), false, state.speaking.contains(p.userId), p.muted, p.deafened, p.screenSharing)) }
    }

    Box(
        Modifier.fillMaxSize().background(
            Brush.verticalGradient(listOf(Color(0xFF0D1220), Color(0xFF08090C), Color(0xFF050506))),
        ),
    ) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            if (!fullscreen) CallTopBar(state, people.size, if (startedAt > 0) now - startedAt else null, actions.minimize)

            AnimatedVisibility(state.error != null, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                Row(
                    Modifier.padding(horizontal = 16.dp, vertical = 6.dp).fillMaxWidth().clip(RoundedCornerShape(14.dp))
                        .background(PC.Red.copy(alpha = 0.14f)).border(1.dp, PC.Red.copy(alpha = 0.35f), RoundedCornerShape(14.dp))
                        .padding(start = 12.dp, top = 10.dp, bottom = 10.dp, end = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.ErrorOutline, null, tint = PC.Red, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(10.dp))
                    Text(state.error.orEmpty(), color = Color(0xFFFFC9CA), style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                    Box(Modifier.size(32.dp).clip(CircleShape).clickable(onClick = actions.clearError), contentAlignment = Alignment.Center) {
                        Icon(Icons.Filled.Close, "Fechar aviso", tint = PC.Muted, modifier = Modifier.size(16.dp))
                    }
                }
            }

            Box(Modifier.weight(1f).fillMaxWidth()) {
                if (big != null) {
                    Column(Modifier.fillMaxSize()) {
                        ScreenStage(
                            big.userId, userOf(big.userId), fullscreen, { fullscreen = !fullscreen }, screen,
                            Modifier.fillMaxWidth().weight(1f).padding(horizontal = if (fullscreen) 0.dp else 12.dp, vertical = if (fullscreen) 0.dp else 6.dp),
                        )
                        if (!fullscreen) {
                            val rest = sharing.filter { it.userId != big.userId }
                            if (rest.isNotEmpty()) LazyRow(
                                contentPadding = PaddingValues(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp),
                                modifier = Modifier.padding(vertical = 4.dp),
                            ) {
                                items(rest, key = { "s" + it.userId }) { p ->
                                    Box(Modifier.width(132.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(12.dp)).clickable { focused = p.userId }) {
                                        screen(p.userId, Modifier.fillMaxSize().background(Color.Black))
                                        Text(
                                            userOf(p.userId)?.name ?: "…", color = Color.White, fontSize = 10.sp, maxLines = 1,
                                            modifier = Modifier.align(Alignment.BottomStart).padding(5.dp).clip(RoundedCornerShape(5.dp)).background(Color(0x99000000)).padding(horizontal = 6.dp, vertical = 2.dp),
                                        )
                                    }
                                }
                            }
                            LazyRow(
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                items(people, key = { it.id }) { p -> MiniPerson(p, onClick = { if (p.sharing && !p.isMe) focused = p.id }) }
                            }
                        }
                    }
                } else {
                    PeopleGrid(people)
                }
                if (state.status == CallStatus.Connecting || state.status == CallStatus.Reconnecting) {
                    Box(Modifier.fillMaxSize().background(Color(0x99050506)), contentAlignment = Alignment.Center) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            CircularProgressIndicator(color = PC.Brand, strokeWidth = 3.dp, modifier = Modifier.size(36.dp))
                            Spacer(Modifier.height(14.dp))
                            Text(if (state.status == CallStatus.Connecting) "Entrando na chamada…" else "Reconectando…", color = PC.Text, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }

            if (!fullscreen) ControlDock(state, actions)
        }
    }
}

private data class Person(
    val id: String, val user: User?, val isMe: Boolean, val speaking: Boolean,
    val muted: Boolean, val deafened: Boolean, val sharing: Boolean,
)

private fun duration(ms: Long): String {
    val t = ms / 1000
    val h = t / 3600; val m = (t % 3600) / 60; val s = t % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%02d:%02d".format(m, s)
}

@Composable
private fun CallTopBar(state: CallState, count: Int, elapsed: Long?, onMinimize: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = 6.dp, end = 14.dp, top = 6.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(44.dp).clip(CircleShape).clickable(onClick = onMinimize), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.KeyboardArrowDown, "Minimizar a chamada", tint = PC.Header, modifier = Modifier.size(28.dp))
        }
        Column(Modifier.weight(1f).padding(start = 4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.AutoMirrored.Filled.VolumeUp, null, tint = PC.Muted, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text(state.title.ifBlank { "Chamada" }, style = MaterialTheme.typography.titleMedium, color = PC.Header, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Spacer(Modifier.height(3.dp))
            val (label, color) = when (state.status) {
                CallStatus.Connecting -> "Conectando…" to PC.Yellow
                CallStatus.Reconnecting -> "Reconectando…" to PC.Yellow
                else -> (if (state.sharingScreen) "Compartilhando sua tela" else "Voz conectada") to PC.Green
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                LiveDot(color)
                Spacer(Modifier.width(6.dp))
                Text(label, color = color, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
                if (elapsed != null && state.status == CallStatus.Connected) {
                    Text("  ·  ${duration(elapsed)}", color = PC.Muted, style = MaterialTheme.typography.labelMedium)
                }
            }
        }
        Row(
            Modifier.clip(RoundedCornerShape(50)).background(PC.Surface2).border(1.dp, PC.Line, RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.People, null, tint = PC.Text, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(5.dp))
            Text("$count", color = PC.Header, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
private fun LiveDot(color: Color) {
    val t = rememberInfiniteTransition(label = "dot")
    val a by t.animateFloat(1f, 0.35f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "a")
    Box(Modifier.size(8.dp).clip(CircleShape).background(color.copy(alpha = a)))
}

/** Grade de pessoas: 1 sozinho = grande no meio; 2–4 = cartões grandes; mais = grade compacta. */
@Composable
private fun PeopleGrid(people: List<Person>) {
    if (people.size == 1) {
        Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            BigAvatar(people[0], 132.dp)
            Spacer(Modifier.height(18.dp))
            Text(people[0].user?.name ?: "Você", style = MaterialTheme.typography.titleLarge, color = PC.Header, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(6.dp))
            Text("Só você por aqui. Quando alguém entrar, aparece aqui.", color = PC.Muted, textAlign = TextAlign.Center)
        }
        return
    }
    val columns = if (people.size <= 4) 2 else 3
    Box(Modifier.fillMaxSize()) {
        LazyVerticalGrid(
            columns = GridCells.Fixed(columns),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            items(people, key = { it.id }) { p -> PersonCard(p, compact = columns == 3) }
        }
    }
}

@Composable
private fun PersonCard(p: Person, compact: Boolean) {
    val border by animateColorAsState(if (p.speaking) PC.Green else Color.White.copy(alpha = 0.06f), tween(180), label = "b")
    val shape = RoundedCornerShape(22.dp)
    val accent = profileColor(p.user?.profileColor)
    Box(
        Modifier.fillMaxWidth().aspectRatio(if (compact) 0.86f else 0.95f).clip(shape)
            .background(Brush.verticalGradient(listOf(accent.copy(alpha = 0.28f), PC.Surface2.copy(alpha = 0.95f))))
            .border(if (p.speaking) 2.5.dp else 1.dp, border, shape),
    ) {
        Column(Modifier.fillMaxSize().padding(10.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            BigAvatar(p, if (compact) 64.dp else 84.dp)
            Spacer(Modifier.height(10.dp))
            Text(
                p.user?.name ?: "…", color = PC.Header, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                style = if (compact) MaterialTheme.typography.labelLarge else MaterialTheme.typography.titleSmall,
            )
            if (p.isMe) Text("você", color = PC.Muted, style = MaterialTheme.typography.labelSmall)
        }
        Row(Modifier.align(Alignment.TopEnd).padding(8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (p.sharing) Badge(Icons.Filled.ScreenShare, PC.Brand, "Compartilhando a tela")
            if (p.deafened) Badge(Icons.Filled.HeadsetOff, PC.Red, "Ensurdecido")
            else if (p.muted) Badge(Icons.Filled.MicOff, PC.Red, "Mudo")
        }
    }
}

@Composable
private fun Badge(icon: ImageVector, color: Color, label: String) {
    Box(Modifier.size(26.dp).clip(CircleShape).background(Color(0xCC0B0C10)).border(1.dp, color.copy(alpha = 0.5f), CircleShape), contentAlignment = Alignment.Center) {
        Icon(icon, label, tint = color, modifier = Modifier.size(14.dp))
    }
}

/** Avatar com o anel de quem fala (pulsando de leve). */
@Composable
private fun BigAvatar(p: Person, size: androidx.compose.ui.unit.Dp) {
    val t = rememberInfiniteTransition(label = "ring")
    val pulse by t.animateFloat(1f, 1.08f, infiniteRepeatable(tween(700, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "p")
    val ring by animateFloatAsState(if (p.speaking) 1f else 0f, tween(200), label = "r")
    Box(contentAlignment = Alignment.Center) {
        if (ring > 0f) Box(
            Modifier.size(size + 14.dp).scale(if (p.speaking) pulse else 1f).clip(CircleShape)
                .background(PC.Green.copy(alpha = 0.18f * ring)).border(3.dp, PC.Green.copy(alpha = ring), CircleShape),
        )
        Avatar(p.user, size)
    }
}

@Composable
private fun MiniPerson(p: Person, onClick: () -> Unit) {
    Column(Modifier.width(64.dp).clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box {
            BigAvatar(p, 46.dp)
            if (p.muted || p.deafened) Box(Modifier.align(Alignment.BottomEnd).size(18.dp).clip(CircleShape).background(PC.Red), contentAlignment = Alignment.Center) {
                Icon(if (p.deafened) Icons.Filled.HeadsetOff else Icons.Filled.MicOff, null, tint = Color.White, modifier = Modifier.size(11.dp))
            }
        }
        Spacer(Modifier.height(4.dp))
        Text(if (p.isMe) "Você" else p.user?.name ?: "…", color = PC.Text, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun ScreenStage(
    userId: String, user: User?, fullscreen: Boolean, onToggle: () -> Unit,
    screen: @Composable (String, Modifier) -> Unit, modifier: Modifier,
) {
    val shape = RoundedCornerShape(if (fullscreen) 0.dp else 18.dp)
    Box(modifier.clip(shape).background(Color.Black).border(if (fullscreen) 0.dp else 1.dp, PC.Line, shape)) {
        screen(userId, Modifier.fillMaxSize())
        Row(
            Modifier.align(Alignment.TopStart).padding(10.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xB3000000)).padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(7.dp).clip(CircleShape).background(PC.Red))
            Spacer(Modifier.width(6.dp))
            Text("AO VIVO", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
            Spacer(Modifier.width(8.dp))
            Text(user?.name ?: "alguém", color = Color.White, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Box(
            Modifier.align(Alignment.BottomEnd).padding(10.dp).size(40.dp).clip(CircleShape).background(Color(0xB3000000)).clickable(onClick = onToggle),
            contentAlignment = Alignment.Center,
        ) { Icon(if (fullscreen) Icons.Filled.FullscreenExit else Icons.Filled.Fullscreen, if (fullscreen) "Sair da tela cheia" else "Tela cheia", tint = Color.White) }
    }
}

/** Barra de controles embaixo (mesma ordem do PC: mic, fone, áudio, tela, sair). */
@Composable
private fun ControlDock(state: CallState, actions: CallActions) {
    Row(
        Modifier.padding(horizontal = 12.dp, vertical = 10.dp).fillMaxWidth().clip(RoundedCornerShape(28.dp))
            .background(Color(0xF2121318)).border(1.dp, Color.White.copy(alpha = 0.07f), RoundedCornerShape(28.dp))
            .padding(horizontal = 8.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically,
    ) {
        DockButton(if (state.muted) Icons.Filled.MicOff else Icons.Filled.Mic, if (state.muted) "Mudo" else "Microfone", danger = state.muted, onClick = actions.toggleMute)
        DockButton(if (state.deafened) Icons.Filled.HeadsetOff else Icons.Filled.Headset, if (state.deafened) "Sem som" else "Ouvir", danger = state.deafened, onClick = actions.toggleDeafen)
        DockButton(if (state.speakerOn) Icons.AutoMirrored.Filled.VolumeUp else Icons.AutoMirrored.Filled.VolumeOff, if (state.speakerOn) "Alto-falante" else "Fone", active = !state.speakerOn, onClick = actions.toggleSpeaker)
        DockButton(if (state.sharingScreen) Icons.Filled.StopScreenShare else Icons.Filled.ScreenShare, if (state.sharingScreen) "Parar tela" else "Tela", active = state.sharingScreen, onClick = actions.toggleScreen)
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                Modifier.size(width = 64.dp, height = 50.dp).clip(RoundedCornerShape(18.dp)).background(PC.Red).clickable(onClick = actions.leave),
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Filled.CallEnd, "Sair da chamada", tint = Color.White, modifier = Modifier.size(26.dp)) }
            Spacer(Modifier.height(5.dp))
            Text("Sair", color = PC.Muted, fontSize = 11.sp)
        }
    }
}

@Composable
private fun DockButton(icon: ImageVector, label: String, active: Boolean = false, danger: Boolean = false, onClick: () -> Unit) {
    val bg by animateColorAsState(
        when { danger -> PC.Red.copy(alpha = 0.18f); active -> Color.White; else -> PC.Surface3 }, tween(160), label = "bg",
    )
    val tint = when { danger -> PC.Red; active -> Color.Black; else -> PC.Header }
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier.size(50.dp).clip(RoundedCornerShape(18.dp)).background(bg)
                .border(1.dp, if (danger) PC.Red.copy(alpha = 0.45f) else Color.Transparent, RoundedCornerShape(18.dp))
                .clickable(onClick = onClick),
            contentAlignment = Alignment.Center,
        ) { Icon(icon, label, tint = tint, modifier = Modifier.size(24.dp)) }
        Spacer(Modifier.height(5.dp))
        Text(label, color = if (danger) PC.Red else PC.Muted, fontSize = 11.sp, maxLines = 1)
    }
}

/** Tela simples de aviso (sem chamada / chamada só pelo site). */
@Composable
private fun CallMessage(title: String, text: String, primary: Pair<String, () -> Unit>, secondary: Pair<String, () -> Unit>? = null) {
    Column(
        Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFF0D1220), PC.Bg))).statusBarsPadding().navigationBarsPadding().padding(28.dp),
        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(Modifier.size(72.dp).clip(CircleShape).background(PC.Surface2), contentAlignment = Alignment.Center) {
            Icon(Icons.AutoMirrored.Filled.VolumeUp, null, tint = PC.Muted, modifier = Modifier.size(32.dp))
        }
        Spacer(Modifier.height(18.dp))
        Text(title, style = MaterialTheme.typography.titleLarge, color = PC.Header, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text(text, color = PC.Muted, textAlign = TextAlign.Center)
        Spacer(Modifier.height(22.dp))
        Box(
            Modifier.fillMaxWidth().height(50.dp).clip(RoundedCornerShape(25.dp)).background(Color.White).clickable(onClick = primary.second),
            contentAlignment = Alignment.Center,
        ) { Text(primary.first, color = Color.Black, fontWeight = FontWeight.Bold) }
        secondary?.let { (label, act) ->
            Spacer(Modifier.height(10.dp))
            Box(
                Modifier.fillMaxWidth().height(50.dp).clip(RoundedCornerShape(25.dp)).border(1.dp, PC.LineStrong, RoundedCornerShape(25.dp)).clickable(onClick = act),
                contentAlignment = Alignment.Center,
            ) { Text(label, color = PC.Header, fontWeight = FontWeight.SemiBold) }
        }
    }
}

private fun profileColor(hex: String?): Color =
    runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrNull() ?: PC.Brand
