package com.projectclub.android.ui.common

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.text.TextStyle

/**
 * Efeitos de texto da Loja (itens TEXTFX, User.profileNameEffect = "FX_<CHAVE>")
 * — o mesmo desenho do site (client/src/utils/nameStyle.js FX_STYLES +
 * styles/name-fx.css): cores em degradê andando pelo nome e brilho em volta.
 */
private class Fx(val colors: List<Color>, val glow: Color?, val vertical: Boolean = false, val ms: Int = 4000, val solid: Color? = null, val offsetShadow: Color? = null)

private val FX = mapOf(
    "FX_AURORA" to Fx(listOf(Color(0xFF4DFFB0), Color(0xFF3FC9FF), Color(0xFF9D6BFF)), Color(0x7350E6C8)),
    "FX_LAVA" to Fx(listOf(Color(0xFFB3120A), Color(0xFFFF4A14), Color(0xFFFFB020)), Color(0x99FF5A14), vertical = true, ms = 2600),
    "FX_GALAXIA" to Fx(listOf(Color(0xFF5B2BFF), Color(0xFFC24DFF), Color(0xFF4FB3FF), Color.White), Color(0x8CA0C8FF), ms = 6000),
    "FX_HOLOGRAFICO" to Fx(listOf(Color(0xFFFF9AD5), Color(0xFF9FF4FF), Color(0xFFFFF59A), Color(0xFFC9A6FF)), Color(0x59000000), ms = 2200),
    "FX_OURO" to Fx(listOf(Color(0xFFB8860B), Color(0xFFF5D576), Color.White, Color(0xFFF5D576), Color(0xFFB8860B)), Color(0x66000000), ms = 3200),
    "FX_ELETRICO" to Fx(emptyList(), Color(0xFF4FD8FF), solid = Color(0xFFBFF4FF)),
    "FX_DOCE" to Fx(listOf(Color(0xFFFF5FA8), Color.White, Color(0xFFFF5FA8), Color.White), Color(0x99961450), ms = 1200),
    "FX_SYNTHWAVE" to Fx(emptyList(), Color(0x8CFF3CC8), solid = Color(0xFFFF4FD8), offsetShadow = Color(0xFF21E6FF)),
)

fun isNameFx(effect: String?): Boolean = effect != null && FX.containsKey(effect)

/**
 * Estilo do nome com o efeito (null = não é efeito da Loja; usa o estilo normal).
 * [animate] = no perfil e no mini perfil anda; nas listas fica parado.
 */
@Composable
fun nameFxStyle(effect: String?, animate: Boolean = true): TextStyle? {
    val fx = effect?.let { FX[it] } ?: return null
    val t = rememberInfiniteTransition(label = "namefx")
    val anim = t.animateFloat(0f, 1f, infiniteRepeatable(tween(fx.ms, easing = LinearEasing), RepeatMode.Restart), label = "p")
    val p = if (animate) anim.value else 0f
    if (fx.solid != null) {
        // Elétrico pisca o brilho; Synthwave balança a sombra ciano.
        val glow = if (fx.offsetShadow == null) (0.55f + 0.45f * kotlin.math.abs(kotlin.math.sin(p * 6.283f * 2))) else 1f
        val dx = if (fx.offsetShadow != null) 4f * kotlin.math.cos(p * 6.283f) else 0f
        return TextStyle(
            color = fx.solid,
            shadow = Shadow(fx.offsetShadow ?: fx.glow!!.copy(alpha = glow), Offset(dx, if (fx.offsetShadow != null) 3f else 0f), if (fx.offsetShadow != null) 0f else 16f),
        )
    }
    // Degradê repetido (espelhado) que anda pelo nome.
    val span = 420f
    val shift = p * span * 2
    val brush = if (fx.vertical) {
        Brush.linearGradient(fx.colors + fx.colors.first(), start = Offset(0f, 120f - shift), end = Offset(0f, 120f - shift + 140f), tileMode = TileMode.Mirror)
    } else {
        Brush.linearGradient(fx.colors + fx.colors.first(), start = Offset(shift, 0f), end = Offset(shift + span, 40f), tileMode = TileMode.Mirror)
    }
    return TextStyle(brush = brush, shadow = fx.glow?.let { Shadow(it, Offset.Zero, 12f) })
}

