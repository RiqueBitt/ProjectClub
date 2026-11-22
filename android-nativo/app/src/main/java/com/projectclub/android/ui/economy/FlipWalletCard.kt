package com.projectclub.android.ui.economy

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.projectclub.android.data.EcoWallet
import com.projectclub.android.data.User
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.store.fmtNum
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt

/*
 * Cartão da carteira (mesmo do site): toque vira, arrastar pro lado gira
 * e assenta na face mais próxima. Frente com foto, moedas, gemas e a
 * bandeira fictícia ClubPay; verso com tarja preta, "assinatura
 * autorizada", faixa com rabisco + final do número, CVV e a estrelinha.
 * Estilos: DEFAULT (azul), GOLD (Assinante) e RAINBOW (Super Assinante).
 */

/** Número de enfeite, igual ao do site (FNV-1a do id, 4 dígitos). */
private fun fakeNumber(seed: String?): String {
    var h = 2166136261L
    for (ch in (seed ?: "project-club")) {
        h = h xor ch.code.toLong()
        h = (h * 16777619L) and 0xFFFFFFFFL
    }
    return (h % 10000).toString().padStart(4, '0')
}

private data class CardLook(val front: List<Color>, val back: List<Color>, val ink: Color, val backInk: Color)

private fun lookOf(style: String?): CardLook = when (style) {
    "GOLD" -> CardLook(
        front = listOf(Color(0xFF0B0B0D), Color(0xFF1C1810), Color(0xFF3A2E12)),
        back = listOf(Color(0xFFF3E3B5), Color(0xFFE2C77F), Color(0xFFC9A04A)),
        ink = Color(0xFFF0D58A), backInk = Color(0xFF4A3A12),
    )
    "RAINBOW" -> CardLook(
        front = listOf(Color(0xFF0B0B0D), Color(0xFF16121F), Color(0xFF0F1A22)),
        back = listOf(Color(0xFFFFD6E7), Color(0xFFD9D4FF), Color(0xFFC8F1FF), Color(0xFFD7FFD9)),
        ink = Color.White, backInk = Color(0xFF2B2440),
    )
    else -> CardLook(
        front = listOf(Color(0xFF1D3FAF), Color(0xFF2F6BE6), Color(0xFF55A6FF)),
        back = listOf(Color(0xFFDCEBFF), Color(0xFFB9D6FF), Color(0xFF9CC5FF)),
        ink = Color.White, backInk = Color(0xFF1A2D55),
    )
}

private val RainbowEdge = listOf(Color(0xFFFF5F6D), Color(0xFFFFC371), Color(0xFF7CFFB2), Color(0xFF4FC3F7), Color(0xFFB388FF), Color(0xFFFF5F6D))

@Composable
fun FlipWalletCard(w: EcoWallet, me: User?, modifier: Modifier = Modifier) {
    val scope = rememberCoroutineScope()
    val rot = remember { Animatable(0f) }
    val density = LocalDensity.current
    val look = lookOf(w.cardStyle)
    val name = me?.displayName ?: me?.username ?: "Membro"
    val number = remember(me?.id) { fakeNumber(me?.id) }
    // Leve flutuação (o "respirar" do site).
    val bob by rememberInfiniteTransition(label = "bob").animateFloat(
        -1.5f, 1.5f, infiniteRepeatable(tween(3000, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "bobv",
    )
    val showingBack = abs((rot.value / 180f).roundToInt()) % 2 == 1
    fun settle(target: Float) = scope.launch { rot.animateTo(target, tween(520, easing = FastOutSlowInEasing)) }
    fun flip() = settle(((rot.targetValue / 180f).roundToInt() * 180f) + 180f)

    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(1.586f)
                .graphicsLayer {
                    rotationY = rot.value
                    rotationX = bob
                    cameraDistance = 14f * density.density
                }
                .semantics {
                    contentDescription = "Cartão da carteira de $name: ${fmtNum(w.coins)} moedas e ${fmtNum(w.gems)} gemas. " +
                        if (showingBack) "Mostrando o verso." else "Mostrando a frente."
                    onClick(label = "Virar o cartão") { flip(); true }
                }
                .pointerInput(Unit) { detectTapGestures(onTap = { flip() }) }
                .pointerInput(Unit) {
                    detectHorizontalDragGestures(
                        onDragEnd = { settle((rot.value / 180f).roundToInt() * 180f) },
                        onDragCancel = { settle((rot.value / 180f).roundToInt() * 180f) },
                    ) { change, dx ->
                        change.consume()
                        scope.launch { rot.snapTo(rot.value + dx / density.density * 0.9f) }
                    }
                },
        ) {
            // A face de trás é desenhada espelhada (rotationY 180) pra ler certo quando o cartão vira.
            if (showingBack) Face(look.back, Modifier.graphicsLayer { rotationY = 180f }, w.cardStyle) { CardBack(look, number) }
            else Face(look.front, Modifier, w.cardStyle) { CardFront(look, me, name, w) }
        }
        Spacer(Modifier.height(8.dp))
        Text("Toque pra virar · arraste pra girar", color = Color(0x99FFFFFF), fontSize = 12.sp)
    }
}

@Composable
private fun Face(colors: List<Color>, modifier: Modifier, style: String?, content: @Composable BoxScope.() -> Unit) {
    val shape = RoundedCornerShape(20.dp)
    val edge = when (style) {
        "RAINBOW" -> Modifier.border(1.5.dp, Brush.linearGradient(RainbowEdge), shape)
        "GOLD" -> Modifier.border(1.dp, Color(0x88F0D58A), shape)
        else -> Modifier.border(1.dp, Color(0x33FFFFFF), shape)
    }
    Box(modifier.fillMaxSize().clip(shape).background(Brush.linearGradient(colors)).then(edge), content = content)
}

@Composable
private fun BoxScope.CardFront(look: CardLook, me: User?, name: String, w: EcoWallet) {
    Column(Modifier.fillMaxSize().padding(18.dp), verticalArrangement = Arrangement.SpaceBetween) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Project Club", color = look.ink, fontWeight = FontWeight.Bold, fontSize = 15.sp, modifier = Modifier.weight(1f))
            Text("))))", color = look.ink.copy(alpha = .7f), fontSize = 12.sp)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            // Chip
            Box(
                Modifier.size(40.dp, 30.dp).clip(RoundedCornerShape(6.dp))
                    .background(Brush.linearGradient(listOf(Color(0xFFE9D9A6), Color(0xFFB99A4E)))),
            )
            Spacer(Modifier.weight(1f))
            Avatar(me, size = 48.dp, decoration = false)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("🪙 ${fmtNum(w.coins)}", color = look.ink, fontWeight = FontWeight.Bold, fontSize = 17.sp)
            Text("💎 ${fmtNum(w.gems)}", color = look.ink, fontWeight = FontWeight.Bold, fontSize = 17.sp)
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
            Column(Modifier.weight(1f)) {
                Text("TITULAR", color = look.ink.copy(alpha = .65f), fontSize = 9.sp, letterSpacing = 1.sp)
                Text(name, color = look.ink, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 1)
            }
            Text("Club", color = look.ink, fontSize = 14.sp)
            Text("Pay", color = look.ink, fontWeight = FontWeight.Black, fontSize = 14.sp)
        }
    }
}

@Composable
private fun BoxScope.CardBack(look: CardLook, number: String) {
    Column(Modifier.fillMaxSize()) {
        Spacer(Modifier.height(18.dp))
        // Tarja magnética
        Box(Modifier.fillMaxWidth().height(36.dp).background(Color(0xFF111114)))
        Spacer(Modifier.height(14.dp))
        Column(Modifier.padding(horizontal = 18.dp)) {
            Text("ASSINATURA AUTORIZADA", color = look.backInk.copy(alpha = .75f), fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Row(
                    Modifier.weight(1f).height(34.dp).clip(RoundedCornerShape(4.dp)).background(Color.White).padding(horizontal = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Scribble(look.backInk, Modifier.width(70.dp).height(20.dp))
                    Spacer(Modifier.weight(1f))
                    Text(number, color = Color(0xFF222222), fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace, fontSize = 15.sp, letterSpacing = 2.sp)
                }
                Spacer(Modifier.width(10.dp))
                Box(Modifier.size(58.dp, 34.dp).clip(RoundedCornerShape(4.dp)).background(Color.White), contentAlignment = Alignment.Center) {
                    Text(number.substring(1, 4), color = Color(0xFF222222), fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace, fontSize = 15.sp)
                }
            }
        }
    }
    // Quadradinho translúcido com estrela no canto inferior esquerdo
    Box(
        Modifier.align(Alignment.BottomStart).padding(18.dp).size(36.dp).clip(RoundedCornerShape(8.dp))
            .background(Color.White.copy(alpha = .35f)).border(1.dp, Color.White.copy(alpha = .5f), RoundedCornerShape(8.dp)),
        contentAlignment = Alignment.Center,
    ) { Text("★", color = Color.White, fontSize = 18.sp) }
}

@Composable
private fun Scribble(color: Color, modifier: Modifier) {
    Canvas(modifier) {
        val sx = size.width / 120f
        val sy = size.height / 30f
        val pts = listOf(4 to 20, 17 to 8, 16 to 22, 27 to 8, 30 to 20, 39 to 11, 45 to 19, 53 to 13, 60 to 18, 69 to 14, 80 to 16, 95 to 13, 116 to 8)
        val p = Path().apply {
            moveTo(pts[0].first * sx, pts[0].second * sy)
            for (i in 1 until pts.size) {
                val (x0, y0) = pts[i - 1]; val (x1, y1) = pts[i]
                quadraticTo(x0 * sx, y0 * sy, (x0 + x1) / 2f * sx, (y0 + y1) / 2f * sy)
            }
            lineTo(pts.last().first * sx, pts.last().second * sy)
        }
        drawPath(p, color, style = Stroke(width = 2.2f * sx, cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}
