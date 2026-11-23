package com.projectclub.android.ui.voice

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.material.icons.automirrored.filled.VolumeOff
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.projectclub.android.data.User
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.GhostButton
import com.projectclub.android.ui.theme.PC
import com.projectclub.android.voice.CallReaction
import com.projectclub.android.voice.QUICK_REACTIONS
import kotlin.math.abs

/** Barrinha com os emojis rápidos (aparece em cima dos controles). */
@Composable
fun ReactionPicker(onPick: (String) -> Unit) {
    Row(
        Modifier.padding(horizontal = 16.dp, vertical = 4.dp).clip(RoundedCornerShape(26.dp)).background(PC.Surface2)
            .border(1.dp, PC.Line, RoundedCornerShape(26.dp)).padding(horizontal = 8.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        QUICK_REACTIONS.forEach { e ->
            Box(Modifier.size(44.dp).clip(CircleShape).clickable { onPick(e) }, contentAlignment = Alignment.Center) {
                Text(e, fontSize = 24.sp)
            }
        }
    }
}

/** Reações subindo pela tela (igual ao PC), com o nome de quem mandou. */
@Composable
fun FloatingReactions(reactions: List<CallReaction>, userOf: (String) -> User?, modifier: Modifier = Modifier) {
    BoxWithConstraints(modifier.fillMaxSize()) {
        val h = maxHeight
        val w = maxWidth
        reactions.forEach { r ->
            androidx.compose.runtime.key(r.id) {
                val t = remember { Animatable(0f) }
                LaunchedEffect(Unit) { t.animateTo(1f, tween(3000, easing = LinearOutSlowInEasing)) }
                // Posição horizontal "aleatória" mas estável por reação.
                val lane = (abs(r.id % 7) / 7f) * 0.6f + 0.2f
                Column(
                    Modifier.offset(x = w * lane - 28.dp, y = h * (0.82f - 0.62f * t.value))
                        .alpha(if (t.value < 0.75f) 1f else (1f - t.value) * 4f).scale(0.8f + 0.4f * minOf(1f, t.value * 5f)),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(r.emoji, fontSize = 38.sp)
                    Text(
                        userOf(r.userId)?.name ?: "…", color = Color.White, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.width(72.dp).clip(RoundedCornerShape(6.dp)).background(Color(0x99000000)).padding(horizontal = 6.dp, vertical = 1.dp),
                    )
                }
            }
        }
    }
}

/** Folha de uma pessoa na chamada: volume só pra você e atalho pro perfil. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CallPersonSheet(user: User?, userId: String, volume: Int, onVolume: (Int) -> Unit, onProfile: () -> Unit, onDismiss: () -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var v by remember(userId) { mutableFloatStateOf(volume.toFloat()) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = PC.Surface) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(user, 52.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(user?.name ?: "…", color = PC.Header, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    user?.username?.let { Text("@$it", color = PC.Muted, style = MaterialTheme.typography.bodySmall) }
                }
            }
            Spacer(Modifier.height(18.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Volume do usuário", color = PC.Header, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                Text("${v.toInt()}%", color = if (v.toInt() == 100) PC.Muted else PC.Brand, fontWeight = FontWeight.Bold)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.AutoMirrored.Filled.VolumeOff, null, tint = PC.Muted, modifier = Modifier.size(18.dp))
                Slider(
                    value = v, onValueChange = { v = it }, onValueChangeFinished = { onVolume(v.toInt()) },
                    valueRange = 0f..200f, modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
                    colors = SliderDefaults.colors(thumbColor = PC.Brand, activeTrackColor = PC.Brand, inactiveTrackColor = PC.Surface3),
                )
                Icon(Icons.AutoMirrored.Filled.VolumeUp, null, tint = PC.Muted, modifier = Modifier.size(18.dp))
            }
            Text("Só muda o que você ouve. Ninguém fica sabendo.", color = PC.Faint, style = MaterialTheme.typography.bodySmall)
            if (v.toInt() != 100) TextButton(onClick = { v = 100f; onVolume(100) }) { Text("Voltar pra 100%", color = PC.Brand) }
            Spacer(Modifier.height(10.dp))
            GhostButton("Ver perfil", onProfile, Modifier.fillMaxWidth(), icon = Icons.Outlined.Person)
        }
    }
}

/* ---------------- Soundboard e apertar para falar (iguais ao site) ---------------- */

@kotlinx.serialization.Serializable
data class SoundboardSound(val id: String = "", val name: String = "", val emoji: String? = null, val url: String = "", val durationMs: Int? = null)

@kotlinx.serialization.Serializable
data class SoundboardList(val sounds: List<SoundboardSound> = emptyList())

@Composable
fun SoundboardPanel(state: com.projectclub.android.voice.CallState, actions: CallActions) {
    var sounds by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf<List<SoundboardSound>?>(null) }
    var msg by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf<String?>(null) }
    var playing by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf<String?>(null) }
    androidx.compose.runtime.LaunchedEffect(Unit) { sounds = actions.loadSounds() }
    Column(
        Modifier.padding(horizontal = 16.dp, vertical = 4.dp).fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(PC.Surface2)
            .border(1.dp, PC.Line, RoundedCornerShape(20.dp)).padding(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Soundboard", color = PC.Header, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold, modifier = Modifier.weight(1f))
            Text("Apertar para falar", color = PC.Muted, fontSize = 12.sp)
            Spacer(Modifier.width(6.dp))
            androidx.compose.material3.Switch(checked = state.pushToTalk, onCheckedChange = actions.setPushToTalk)
        }
        val list = sounds
        when {
            list == null -> Text("Carregando sons…", color = PC.Muted, fontSize = 12.sp, modifier = Modifier.padding(vertical = 6.dp))
            list.isEmpty() -> Text("Ainda não tem sons. A staff adiciona pelo PC.", color = PC.Muted, fontSize = 12.sp, modifier = Modifier.padding(vertical = 6.dp))
            else -> androidx.compose.foundation.lazy.LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 6.dp)) {
                items(list.size) { i ->
                    val snd = list[i]
                    Column(
                        Modifier.width(76.dp).clip(RoundedCornerShape(14.dp)).background(if (playing == snd.id) PC.Brand.copy(alpha = 0.25f) else PC.Surface3)
                            .clickable(enabled = !state.deafened) {
                                playing = snd.id; msg = null
                                actions.playSound(snd.id) { err -> playing = null; msg = err }
                            }.padding(vertical = 8.dp, horizontal = 4.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(snd.emoji?.takeIf { it.isNotBlank() } ?: "🔊", fontSize = 24.sp)
                        Text(snd.name, color = PC.Text, fontSize = 11.sp, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                    }
                }
            }
        }
        if (state.deafened) Text("Você está sem som — ligue o áudio pra usar o soundboard.", color = PC.Muted, fontSize = 11.sp)
        msg?.let { Text(it, color = PC.Red, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp)) }
    }
}

/** Botão grande: segure para falar, solte pra mutar de novo. */
@Composable
fun PushToTalkButton(state: com.projectclub.android.voice.CallState, actions: CallActions) {
    val held = state.pttHeld
    Box(
        Modifier.padding(horizontal = 16.dp, vertical = 4.dp).fillMaxWidth().height(56.dp).clip(RoundedCornerShape(18.dp))
            .background(if (held) PC.Green else PC.Surface2).border(1.dp, if (held) PC.Green else PC.Line, RoundedCornerShape(18.dp))
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    actions.pushToTalk(true)
                    waitForUpOrCancellation()
                    actions.pushToTalk(false)
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            when { state.muted || state.deafened -> "Desmute o microfone pra falar"; held -> "Falando…"; else -> "Segure para falar" },
            color = if (held) Color.Black else PC.Header, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold,
        )
    }
}
