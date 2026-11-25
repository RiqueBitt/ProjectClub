package com.projectclub.android.ui.voice

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.projectclub.android.voice.CallState
import kotlinx.coroutines.delay

private val Gold = Color(0xFFE8B93C)
private val Wood = Color(0xFF8A5A2B)
private val WoodLid = Color(0xFFA46A33)
private val Ink = Color(0xFF3B2410)

/** Baú desenhado em código (mesmo desenho do site). */
@Composable
private fun ChestArt(open: Boolean, modifier: Modifier = Modifier) {
    Canvas(modifier.size(48.dp, 42.dp)) {
        val u = size.width / 64f
        val stroke = Stroke(2.5f * u)
        drawRoundRect(Wood, Offset(6 * u, 24 * u), Size(52 * u, 28 * u), CornerRadius(4 * u))
        drawRoundRect(Ink, Offset(6 * u, 24 * u), Size(52 * u, 28 * u), CornerRadius(4 * u), style = stroke)
        drawRect(Gold, Offset(28 * u, 24 * u), Size(8 * u, 28 * u))
        val lid = Path().apply {
            moveTo(6 * u, 24 * u); quadraticTo(6 * u, 8 * u, 32 * u, 8 * u); quadraticTo(58 * u, 8 * u, 58 * u, 24 * u); close()
        }
        val lift = if (open) -10 * u else 0f
        translate(top = lift) {
            drawPath(lid, WoodLid)
            drawPath(lid, Ink, style = stroke)
            drawRect(Gold, Offset(28 * u, 9 * u), Size(8 * u, 15 * u))
        }
        drawRoundRect(Color(0xFFFFF1B8), Offset(29 * u, 26 * u), Size(6 * u, 7 * u), CornerRadius(1.5f * u))
    }
}

/**
 * Baú da call: aparece de vez em quando; quem tocar primeiro leva moedas.
 * O servidor sorteia e decide quem ganhou — aqui só mostra.
 */
@Composable
fun CallChestOverlay(state: CallState, meId: String?, claim: ((String) -> Unit) -> Unit, modifier: Modifier = Modifier) {
    val chest = state.chest
    val result = state.chestResult
    var error by remember { mutableStateOf<String?>(null) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(chest?.id) { while (chest != null) { now = System.currentTimeMillis(); delay(1000) } }
    LaunchedEffect(error) { if (error != null) { delay(3500); error = null } }

    Column(modifier, horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        AnimatedVisibility(chest != null, enter = scaleIn() + fadeIn(), exit = fadeOut()) {
            val left = ((chest?.expiresAt ?: 0L) - now).coerceAtLeast(0L) / 1000
            val pulse by rememberInfiniteTransition(label = "chest").animateFloat(1f, 1.06f, infiniteRepeatable(tween(800), RepeatMode.Reverse), label = "p")
            Column(
                Modifier.scale(pulse).clip(RoundedCornerShape(16.dp)).background(Color(0xE618191C))
                    .border(1.dp, Gold.copy(alpha = 0.6f), RoundedCornerShape(16.dp))
                    .clickable { claim { error = it } }
                    .semantics { contentDescription = "Abrir o baú da call" }
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                ChestArt(open = false)
                Text("Baú da call!", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                Text("Toque pra abrir · ${left}s", color = Color.White.copy(alpha = 0.7f), fontSize = 11.sp)
            }
        }
        error?.let {
            Text(it, color = Color.White, fontSize = 12.sp, modifier = Modifier.width(220.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xE618191C)).padding(8.dp))
        }
        AnimatedVisibility(chest == null && result != null, enter = fadeIn(), exit = fadeOut()) {
            val r = result ?: return@AnimatedVisibility
            val mine = r.userId != null && r.userId == meId
            Row(
                Modifier.clip(RoundedCornerShape(16.dp)).background(Color(0xEB18191C))
                    .then(if (mine) Modifier.border(1.dp, Gold, RoundedCornerShape(16.dp)) else Modifier)
                    .padding(start = 10.dp, end = 14.dp, top = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ChestArt(open = true)
                Spacer(Modifier.width(10.dp))
                Column {
                    Text(if (mine) "Você abriu o baú" else "${r.name} abriu o baú", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    Text("+${r.coins} moedas" + (if (r.gems > 0) " · +${r.gems} gemas" else ""), color = Gold, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                }
            }
        }
    }
}
