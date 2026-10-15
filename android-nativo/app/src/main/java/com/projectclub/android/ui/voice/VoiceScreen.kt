package com.projectclub.android.ui.voice

import android.app.Activity
import android.media.projection.MediaProjectionManager
import android.view.SurfaceView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.VolumeOff
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Headset
import androidx.compose.material.icons.filled.HeadsetOff
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.ScreenShare
import androidx.compose.material.icons.filled.StopScreenShare
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.projectclub.android.data.Repository
import com.projectclub.android.data.User
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.theme.PC
import com.projectclub.android.voice.CallService
import com.projectclub.android.voice.CallStatus
import com.projectclub.android.voice.VoiceManager

@Composable
fun VoiceScreen(voice: VoiceManager, repo: Repository, onBack: () -> Unit, onOpenWeb: (String) -> Unit) {
    val s by voice.state.collectAsState()
    val rosters by repo.voiceRosters.collectAsState()
    val me by repo.me.collectAsState()
    val ctx = LocalContext.current
    var focused by remember { mutableStateOf<String?>(null) }

    val shareLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val data = r.data
        if (r.resultCode == Activity.RESULT_OK && data != null) CallService.startScreen(ctx, r.resultCode, data)
    }

    val channelName = s.channelName
    if (channelName == null || s.status == CallStatus.Idle) {
        Column(Modifier.fillMaxSize().background(PC.Bg).statusBarsPadding().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Text(s.error ?: "Você não está em nenhuma chamada.", color = PC.Muted, textAlign = TextAlign.Center)
            Button(onClick = { voice.clearError(); onBack() }, modifier = Modifier.padding(top = 16.dp)) { Text("Voltar") }
        }
        return
    }

    if (s.status == CallStatus.Unsupported) {
        val webPath = if (channelName.startsWith("dm:")) "/conversations/${channelName.removePrefix("dm:")}" else "/channels/$channelName"
        Column(Modifier.fillMaxSize().background(PC.Bg).statusBarsPadding().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Chamadas em modo reserva", style = MaterialTheme.typography.titleMedium)
            Text(
                "O limite do servidor de voz principal deste mês acabou e as chamadas estão no provedor reserva, que ainda não tem versão nativa. Entre por esta tela do site:",
                color = PC.Muted, textAlign = TextAlign.Center, modifier = Modifier.padding(vertical = 12.dp),
            )
            Button(onClick = { voice.leave(notifyServer = false); onOpenWeb(webPath) }) { Text("Entrar pelo site") }
            Button(onClick = { voice.leave(notifyServer = false); onBack() }, modifier = Modifier.padding(top = 8.dp)) { Text("Voltar") }
        }
        return
    }

    val participants = rosters[channelName].orEmpty()
    val others = participants.filter { it.userId != me?.id }
    val sharing = others.filter { it.screenSharing && s.remoteVideo.contains(it.userId) }

    Column(Modifier.fillMaxSize().background(Color(0xFF0B0C10)).statusBarsPadding().navigationBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Minimizar a chamada") }
            Column(Modifier.weight(1f)) {
                Text(s.title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    when (s.status) {
                        CallStatus.Connecting -> "Conectando…"
                        CallStatus.Reconnecting -> "Reconectando…"
                        else -> if (s.sharingScreen) "Você está compartilhando a tela" else "${participants.size.coerceAtLeast(1)} na chamada"
                    },
                    color = if (s.status == CallStatus.Connected) PC.Green else PC.Yellow, style = MaterialTheme.typography.labelSmall,
                )
            }
        }
        s.error?.let { Text(it, color = PC.Red, modifier = Modifier.padding(horizontal = 16.dp).clickable { voice.clearError() }) }

        Box(Modifier.weight(1f).fillMaxWidth()) {
            val big = focused?.let { f -> sharing.firstOrNull { it.userId == f } } ?: sharing.firstOrNull()
            Column(Modifier.fillMaxSize()) {
                if (big != null) {
                    ScreenTile(voice, big.userId, repo.user(big.userId), Modifier.fillMaxWidth().weight(1f).padding(8.dp))
                    if (sharing.size > 1) Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        sharing.filter { it.userId != big.userId }.take(3).forEach { p ->
                            Box(Modifier.weight(1f).aspectRatio(16f / 9f).clickable { focused = p.userId }) {
                                ScreenTile(voice, p.userId, repo.user(p.userId), Modifier.fillMaxSize())
                            }
                        }
                    }
                }
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(104.dp),
                    modifier = Modifier.fillMaxWidth().let { if (big == null) it.weight(1f) else it.height(130.dp) },
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    item(key = "me") {
                        Tile(me, s.speaking.contains("me") && !s.muted, s.muted || s.deafened, s.deafened, s.sharingScreen)
                    }
                    items(others, key = { it.userId }) { p ->
                        Tile(repo.user(p.userId), s.speaking.contains(p.userId), p.muted, p.deafened, p.screenSharing)
                    }
                }
            }
            if (s.status == CallStatus.Connecting) CircularProgressIndicator(Modifier.align(Alignment.Center))
        }

        Row(Modifier.fillMaxWidth().padding(vertical = 16.dp), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
            Control(if (s.muted) Icons.Filled.MicOff else Icons.Filled.Mic, if (s.muted) "Ativar microfone" else "Silenciar", active = s.muted) { voice.toggleMute() }
            Control(if (s.deafened) Icons.Filled.HeadsetOff else Icons.Filled.Headset, if (s.deafened) "Voltar a ouvir" else "Ensurdecer", active = s.deafened) { voice.toggleDeafen() }
            Control(if (s.speakerOn) Icons.AutoMirrored.Filled.VolumeUp else Icons.AutoMirrored.Filled.VolumeOff, if (s.speakerOn) "Viva-voz ligado" else "Viva-voz desligado", active = !s.speakerOn) { voice.toggleSpeaker() }
            Control(if (s.sharingScreen) Icons.Filled.StopScreenShare else Icons.Filled.ScreenShare, if (s.sharingScreen) "Parar de compartilhar" else "Compartilhar a tela", active = s.sharingScreen) {
                if (s.sharingScreen) voice.stopScreenShare()
                else shareLauncher.launch(ctx.getSystemService(MediaProjectionManager::class.java).createScreenCaptureIntent())
            }
            Box(Modifier.size(60.dp).clip(CircleShape).background(PC.Red).clickable { voice.leave(); onBack() }, contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.CallEnd, "Sair da chamada", tint = Color.White)
            }
        }
    }
}

@Composable
private fun Control(icon: ImageVector, label: String, active: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.size(52.dp).clip(CircleShape).background(if (active) Color.White else PC.Surface2).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, label, tint = if (active) Color.Black else PC.Text) }
}

@Composable
private fun Tile(user: User?, speaking: Boolean, muted: Boolean, deafened: Boolean, sharing: Boolean) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier.size(76.dp).clip(CircleShape).border(3.dp, if (speaking) PC.Green else Color.Transparent, CircleShape).padding(5.dp),
            contentAlignment = Alignment.Center,
        ) { Avatar(user, 66.dp) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (deafened) Icon(Icons.Filled.HeadsetOff, "Ensurdecido", tint = PC.Red, modifier = Modifier.size(14.dp))
            else if (muted) Icon(Icons.Filled.MicOff, "Mudo", tint = PC.Red, modifier = Modifier.size(14.dp))
            if (sharing) Icon(Icons.Filled.ScreenShare, "Compartilhando a tela", tint = PC.Brand, modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(2.dp))
            Text(user?.name ?: "…", maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold)
        }
    }
}

/** Tela compartilhada de alguém, ao vivo (vídeo da Agora num SurfaceView). */
@Composable
private fun ScreenTile(voice: VoiceManager, userId: String, user: User?, modifier: Modifier) {
    Box(modifier.clip(RoundedCornerShape(12.dp)).background(Color.Black)) {
        AndroidView(factory = { c -> SurfaceView(c).also { voice.bindRemoteVideo(it, userId) } }, modifier = Modifier.fillMaxSize())
        DisposableEffect(userId) { onDispose { voice.unbindRemoteVideo(userId) } }
        Text(
            "Tela de ${user?.name ?: "alguém"}", color = Color.White, style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.align(Alignment.BottomStart).padding(8.dp).clip(RoundedCornerShape(6.dp)).background(Color(0x99000000)).padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}
