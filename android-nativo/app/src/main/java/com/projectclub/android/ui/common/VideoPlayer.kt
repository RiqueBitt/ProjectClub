package com.projectclub.android.ui.common

import android.view.ViewGroup
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Fullscreen
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView

/**
 * Player de vídeo do app (Media3/ExoPlayer) — vídeos mandados no chat, na
 * galeria e nos posts. Controles nativos do PlayerView (play/pausa, barra de
 * tempo, volume) e botão de tela cheia. O ExoPlayer é criado quando o player
 * aparece e liberado quando sai da tela.
 */
@Composable
fun VideoPlayer(url: String, modifier: Modifier = Modifier, autoPlay: Boolean = true, onFullscreen: (() -> Unit)? = null) {
    val context = LocalContext.current
    val player = remember(url) {
        ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(url))
            repeatMode = Player.REPEAT_MODE_OFF
            playWhenReady = autoPlay
            prepare()
        }
    }
    DisposableEffect(player) { onDispose { player.release() } }
    Box(modifier.background(Color.Black)) {
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    this.player = player
                    useController = true
                    setShowNextButton(false)
                    setShowPreviousButton(false)
                    layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                }
            },
            update = { it.player = player },
            modifier = Modifier.fillMaxSize(),
        )
        if (onFullscreen != null) {
            IconButton(onClick = onFullscreen, modifier = Modifier.align(Alignment.TopEnd).padding(4.dp)) {
                Icon(Icons.Outlined.Fullscreen, "Tela cheia", tint = Color.White)
            }
        }
    }
}

/**
 * Vídeo dentro da conversa: começa como uma caixa escura com o botão de play
 * (não baixa nada antes do toque); ao tocar vira o player com controles, com
 * botão pra abrir em tela cheia.
 */
@Composable
fun InlineVideo(url: String, maxWidth: Dp = 300.dp, modifier: Modifier = Modifier) {
    var playing by remember(url) { mutableStateOf(false) }
    var fullscreen by remember(url) { mutableStateOf(false) }
    val shape = RoundedCornerShape(10.dp)
    Box(modifier.widthIn(max = maxWidth).aspectRatio(16f / 9f).clip(shape).background(Color.Black)) {
        if (playing && !fullscreen) {
            VideoPlayer(url, Modifier.fillMaxSize(), autoPlay = true, onFullscreen = { fullscreen = true })
        } else {
            Box(Modifier.fillMaxSize().clickable { playing = true }, contentAlignment = Alignment.Center) {
                Box(Modifier.size(56.dp).clip(CircleShape).background(Color(0x99000000)), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.PlayCircle, "Tocar vídeo", tint = Color.White, modifier = Modifier.size(48.dp))
                }
            }
        }
    }
    if (fullscreen) FullscreenVideo(url) { fullscreen = false; playing = true }
}

/** Vídeo em tela cheia (galeria, botão de tela cheia do chat). */
@Composable
fun FullscreenVideo(url: String, onClose: () -> Unit) {
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            VideoPlayer(url, Modifier.fillMaxSize(), autoPlay = true)
            IconButton(onClick = onClose, modifier = Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(8.dp)) {
                Icon(Icons.Outlined.Close, "Fechar", tint = Color.White)
            }
        }
    }
}
