package com.projectclub.android.ui.economy

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.projectclub.android.data.EcoWallet
import com.projectclub.android.data.User
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.common.CurrencyArt
import com.projectclub.android.ui.store.fmtNum
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sin

/*
 * Cartão da carteira — o MESMO desenho do site (client/src/components/WalletCard.jsx
 * + styles/wallet-card.css). Tudo é medido em "u" = 1% da largura do cartão, igual
 * ao CSS, então ele fica idêntico em qualquer tamanho (Economia, chat, Loja).
 *
 * Frente: anéis finos e o floco em marca d'água, "Project Club" com o floco,
 * a foto num aro, o chip dourado e o sinal de aproximação, moedas e gemas com
 * a arte do site, o nome em maiúsculas + nível e a bandeira fictícia ClubPay.
 * Verso (claro na cor do estilo): tarja preta, "assinatura autorizada", faixa
 * da assinatura com o final do número, código e a estrelinha.
 * Toque vira; arrastar gira com inércia e assenta na face mais próxima; luz,
 * sombra da face e reflexo acompanham o giro; sombra/"poça" de luz no chão.
 * Estilos: DEFAULT (azul), GOLD (preto e dourado, Assinante) e RAINBOW
 * (preto e arco-íris, Super Assinante).
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

private val SPECTRUM = listOf(
    Color(0xFFFF5D7A), Color(0xFFFFB65C), Color(0xFFF6F27A), Color(0xFF5CF7A6),
    Color(0xFF5CC8FF), Color(0xFF9A7BFF), Color(0xFFFF5DDC), Color(0xFFFF5D7A),
)

private class CardLook(
    val ink: Color, val inkSoft: Color,
    val foil: List<Color>?,             // texto em folha (dourado / arco-íris)
    val ring: List<Color>,              // aro da foto
    val backInk: Color, val sigInk: Color,
    val pool: Color,                    // luz rebatida no chão
    val rim: Color,
)

private fun lookOf(style: String?): CardLook = when (style) {
    "GOLD" -> CardLook(
        ink = Color(0xFFF4E2A8), inkSoft = Color(0xB8F4E2A8),
        foil = listOf(Color(0xFFFFF4CC), Color(0xFFDCAE4A), Color(0xFFFFF1BA), Color(0xFFB98A2C), Color(0xFFF6DC8C)),
        ring = listOf(Color(0xFFFFF1BF), Color(0xFFB8892F)),
        backInk = Color(0xFF4A3A12), sigInk = Color(0xFF6B5216), pool = Color(0xFFE2B24A), rim = Color(0x80E8C468),
    )
    "RAINBOW" -> CardLook(
        ink = Color.White, inkSoft = Color(0xB3FFFFFF),
        foil = SPECTRUM, ring = SPECTRUM,
        backInk = Color(0xFF3B3760), sigInk = Color(0xFF3B3760), pool = Color(0xFF9A7BFF), rim = Color(0x4DFFFFFF),
    )
    else -> CardLook(
        ink = Color.White, inkSoft = Color(0xB3FFFFFF), foil = null,
        ring = listOf(Color.White, Color(0xFF9ECBFF)),
        backInk = Color(0xFF1F2B46), sigInk = Color(0xFF1F2B46), pool = Color(0xFF3F74F5), rim = Color(0x21FFFFFF),
    )
}

// Desenhos de traço do site (viewBox 24 / 50x38 / 120x30).
private val FLAKE = PathParser().parsePathString(
    "M12 2.5v19M3.8 7.25l16.4 9.5M20.2 7.25 3.8 16.75M9.6 4.3 12 6.2l2.4-1.9M9.6 19.7l2.4-1.9 2.4 1.9M4.2 10.6l2.85-1.1-.45-3M19.8 13.4l-2.85 1.1.45 3M19.8 10.6l-2.85-1.1.45-3M4.2 13.4l2.85 1.1-.45 3",
).toPath()
private val CHIP = PathParser().parsePathString(
    "M17 0v10a4 4 0 0 1-4 4H0M33 0v10a4 4 0 0 0 4 4h13M0 24h13a4 4 0 0 1 4 4v10M50 24H37a4 4 0 0 0-4 4v10M17 14v10M33 14v10M17 19h16",
).toPath()
private val WAVES = PathParser().parsePathString(
    "M6.5 9.5a4 4 0 0 1 0 5M10 7a7.5 7.5 0 0 1 0 10M13.5 4.5a11 11 0 0 1 0 15M17 2a14.5 14.5 0 0 1 0 20",
).toPath()
private val SCRIBBLE = PathParser().parsePathString(
    "M4 20c6-10 10-14 13-12s-4 14-1 14 7-14 11-14-1 12 3 12 6-9 9-9 2 8 6 8 5-6 8-6c4 0 3 5 7 5s5-4 9-4 7 3 11 2 10-3 15-6",
).toPath()
private val STAR = PathParser().parsePathString("m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z").toPath()

/** Desenha um traço do viewBox [vw]x[vh] esticado pra caber no DrawScope. */
private fun DrawScope.strokeArt(path: Path, vw: Float, vh: Float, color: Color, width: Float, fill: Boolean = false) {
    scale(size.width / vw, size.height / vh, pivot = Offset.Zero) {
        if (fill) drawPath(path, color)
        else drawPath(path, color, style = Stroke(width = width, cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

@Composable
fun FlipWalletCard(w: EcoWallet, me: User?, modifier: Modifier = Modifier, hint: Boolean = true) {
    val scope = rememberCoroutineScope()
    val rot = remember { Animatable(0f) }
    var tiltX by remember { mutableFloatStateOf(0f) }
    var touched by remember { mutableFloatStateOf(0f) }
    val density = LocalDensity.current
    val look = lookOf(w.cardStyle)
    val name = me?.displayName ?: me?.username ?: "Membro"
    val number = remember(me?.id) { fakeNumber(me?.id) }
    val lvl = w.accountLevel.takeIf { it > 0 }
    // "Respirar" do site: sobe e desce devagar com um tiquinho de giro.
    val t = rememberInfiniteTransition(label = "wcard")
    val bob by t.animateFloat(0f, 1f, infiniteRepeatable(tween(3500, easing = LinearEasing), RepeatMode.Reverse), label = "bob")
    val hue by t.animateFloat(0f, 360f, infiniteRepeatable(tween(14000, easing = LinearEasing)), label = "hue")
    val theta = rot.value
    val rad = theta * PI.toFloat() / 180f
    val showingBack = cos(rad) < 0f
    fun lit(deg: Float) = max(0f, cos((deg - 22f) * PI.toFloat() / 180f))
    val shade = 0.3f * (1f - lit(if (showingBack) theta - 180f else theta))
    // Reflexo: corre pelo cartão conforme ele gira (como o --gx do site).
    val glareX = (0.26f + sin(rad) * 0.62f).coerceIn(-0.45f, 1.45f)
    val glareY = (0.18f - tiltX * 0.024f).coerceIn(-0.3f, 1.3f)

    fun settle(target: Float, kick: Float = 0f) = scope.launch {
        rot.animateTo(target, spring(dampingRatio = 0.62f, stiffness = Spring.StiffnessLow), initialVelocity = kick)
    }
    fun flip() { touched = 1f; settle(((rot.targetValue / 180f).roundToInt() * 180f) + 180f, 260f) }

    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        BoxWithConstraints(Modifier.widthIn(max = 440.dp).fillMaxWidth()) {
            val u: Dp = maxWidth / 100f
            val uPx = with(density) { u.toPx() }
            val usp: TextUnit = with(density) { u.toSp() }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .aspectRatio(1.586f)
                        .graphicsLayer {
                            rotationY = theta
                            rotationX = tiltX
                            translationY = -1.5f * uPx * bob
                            rotationZ = -0.35f + 0.7f * bob
                            cameraDistance = 15f * density.density
                        }
                        .semantics {
                            contentDescription = "Cartão da carteira de $name: ${fmtNum(w.coins)} moedas e ${fmtNum(w.gems)} gemas" +
                                (lvl?.let { ", nível $it" } ?: "") + ". " + if (showingBack) "Mostrando o verso." else "Mostrando a frente."
                            onClick(label = "Virar o cartão") { flip(); true }
                        }
                        .pointerInput(Unit) { detectTapGestures(onTap = { flip() }) }
                        .pointerInput(Unit) {
                            var vel = 0f
                            var last = 0L
                            detectHorizontalDragGestures(
                                onDragStart = { vel = 0f; last = System.nanoTime(); touched = 1f },
                                onDragEnd = {
                                    tiltX = 0f
                                    // onde pararia com o impulso → face mais próxima disso
                                    settle(((rot.value + vel * 0.16f) / 180f).roundToInt() * 180f, vel.coerceIn(-1500f, 1500f))
                                },
                                onDragCancel = { tiltX = 0f; settle((rot.value / 180f).roundToInt() * 180f) },
                            ) { change, dx ->
                                change.consume()
                                val now = System.nanoTime()
                                val dt = max(1L, now - last) / 1e9f
                                last = now
                                val deg = dx / density.density * 0.6f
                                vel = (vel * 0.55f + (deg / dt) * 0.45f).coerceIn(-1500f, 1500f)
                                tiltX = (tiltX * 0.9f + (change.position.y - size.height / 2f) / size.height * -2f).coerceIn(-9f, 9f)
                                scope.launch { rot.snapTo(rot.value + deg) }
                            }
                        },
                ) {
                    val shape = RoundedCornerShape(u * 4.4f)
                    if (showingBack) {
                        // O verso é desenhado espelhado pra ler certo com o cartão virado.
                        Box(Modifier.fillMaxSize().graphicsLayer { rotationY = 180f }.clip(shape)) {
                            CardBack(w.cardStyle, look, number, u, usp, hue)
                            Glare(1f - glareX, glareY, shade)
                        }
                    } else {
                        Box(Modifier.fillMaxSize().clip(shape)) {
                            CardFront(w, me, name, lvl, look, u, usp, hue)
                            Glare(glareX, glareY, shade)
                        }
                    }
                    // borda do material (no arco-íris, o aro holográfico)
                    if (w.cardStyle == "RAINBOW") {
                        Box(
                            Modifier.fillMaxSize().graphicsLayer { scaleX = if (showingBack) -1f else 1f }
                                .border(u * 0.5f, Brush.sweepGradient(rotateColors(SPECTRUM, hue)), shape),
                        )
                    } else Box(Modifier.fillMaxSize().border(1.dp, look.rim, shape))
                }
                // Sombra no chão + a "poça" da luz que o cartão rebate (encolhe quando ele fica de perfil).
                Canvas(Modifier.fillMaxWidth(0.92f).height(u * 7).padding(top = u * 1.2f)) {
                    val k = max(0.06f, abs(cos(rad)))
                    val ww = size.width * k
                    drawOval(
                        Brush.radialGradient(listOf(look.pool.copy(alpha = 0.32f), Color.Transparent), center = center, radius = ww / 2f),
                        topLeft = Offset(center.x - ww / 2f, 0f), size = Size(ww, size.height),
                    )
                    drawOval(
                        Brush.radialGradient(listOf(Color.Black.copy(alpha = 0.55f), Color.Transparent), center = center, radius = ww * 0.42f),
                        topLeft = Offset(center.x - ww * 0.42f, size.height * 0.2f), size = Size(ww * 0.84f, size.height * 0.6f),
                    )
                }
            }
        }
        if (hint) {
            Spacer(Modifier.height(6.dp))
            Text(
                "Arraste para girar, toque para virar",
                color = Color(0x99FFFFFF).copy(alpha = if (touched > 0f) 0.35f else 0.6f), fontSize = 12.sp,
            )
        }
    }
}

private fun rotateColors(c: List<Color>, hue: Float): List<Color> {
    val n = c.size - 1
    val shift = ((hue / 360f) * n).toInt().mod(n)
    val base = c.dropLast(1)
    val r = base.drop(shift) + base.take(shift)
    return r + r.first()
}

/** Reflexo de luz + escurecida da face que vira pra longe da luz. */
@Composable
private fun Glare(gx: Float, gy: Float, shade: Float) {
    Canvas(Modifier.fillMaxSize()) {
        val c = Offset(size.width * gx, size.height * gy)
        drawRect(Brush.radialGradient(listOf(Color.White.copy(alpha = 0.3f), Color.White.copy(alpha = 0.07f), Color.Transparent), center = c, radius = size.width * 0.44f), blendMode = BlendMode.Screen)
        drawRect(
            Brush.linearGradient(
                listOf(Color.Transparent, Color.White.copy(alpha = 0.11f), Color.Transparent),
                start = Offset(c.x - size.width * 0.2f, 0f), end = Offset(c.x + size.width * 0.2f, size.height * 0.25f),
            ),
            blendMode = BlendMode.Screen,
        )
        if (shade > 0.001f) drawRect(Color.Black.copy(alpha = shade))
    }
}

@Composable
private fun CardFront(w: EcoWallet, me: User?, name: String, lvl: Int?, look: CardLook, u: Dp, usp: TextUnit, hue: Float) {
    val style = w.cardStyle
    val foil = look.foil?.let { Brush.linearGradient(if (style == "RAINBOW") rotateColors(it, hue) else it) }
    // Texto em folha (dourado/arco-íris) usa pincel; o resto, a cor do estilo.
    fun ts(size: Float, weight: FontWeight, italic: Boolean = false, spacing: Float = 0f, useFoil: Boolean = false): TextStyle {
        val fs = if (italic) FontStyle.Italic else FontStyle.Normal
        return if (useFoil && foil != null) TextStyle(brush = foil, fontSize = usp * size, fontWeight = weight, fontStyle = fs, letterSpacing = spacing.em)
        else TextStyle(color = look.ink, fontSize = usp * size, fontWeight = weight, fontStyle = fs, letterSpacing = spacing.em)
    }
    Box(
        Modifier.fillMaxSize().background(
            when (style) {
                "GOLD" -> Brush.linearGradient(listOf(Color(0xFF1D1B16), Color(0xFF0F0E0B), Color(0xFF050504)))
                "RAINBOW" -> Brush.linearGradient(listOf(Color(0xFF141417), Color(0xFF08080A), Color.Black))
                else -> Brush.linearGradient(0f to Color(0xFF2552CC), 0.46f to Color(0xFF142D8C), 1f to Color(0xFF091654))
            },
        ),
    ) {
        // Arte: luz no canto de cima, anéis finos (só no azul), aro dourado (Assinante) e o floco.
        Canvas(Modifier.fillMaxSize().graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }) {
            val tl = when (style) {
                "GOLD" -> Color(0x33E6BE60)
                "RAINBOW" -> Color(0xFF26262C)
                else -> Color(0x8096CDFF)
            }
            drawRect(Brush.radialGradient(listOf(tl, Color.Transparent), center = Offset.Zero, radius = size.width * 0.95f))
            if (style == null || style == "DEFAULT") {
                val cx = size.width * 1.04f
                val cy = size.height * 0.56f
                val step = size.width * 0.025f
                var r = step
                while (r < size.width * 1.2f) {
                    drawCircle(Color.White.copy(alpha = 0.075f), r, Offset(cx, cy), style = Stroke(width = size.width * 0.002f))
                    r += step
                }
                // some à esquerda (o "mask" do CSS)
                drawRect(
                    Brush.horizontalGradient(0f to Color.Transparent, 0.22f to Color.Transparent, 1f to Color.Black),
                    blendMode = BlendMode.DstIn,
                )
            }
            if (style == "GOLD") {
                // fios do metal escovado
                var x = 0f
                while (x < size.width) { drawLine(Color.White.copy(alpha = 0.028f), Offset(x, 0f), Offset(x, size.height)); x += 3f }
                val i = size.width * 0.023f
                drawRoundRect(
                    Color(0x6BE8C468), topLeft = Offset(i, i), size = Size(size.width - i * 2, size.height - i * 2),
                    cornerRadius = androidx.compose.ui.geometry.CornerRadius(size.width * 0.044f - i), style = Stroke(size.width * 0.0022f),
                )
            }
            if (style == "RAINBOW") {
                drawRect(Brush.linearGradient(listOf(Color(0x1AFF5D7A), Color(0x0DFFB65C), Color(0x0D5CF7A6), Color(0x1A5CC8FF), Color(0x1F9A7BFF), Color(0x17FF5DDC))))
            }
        }
        // Floco em marca d'água (direita, embaixo, saindo do cartão).
        Canvas(Modifier.size(u * 70).offset(x = u * 54f, y = u * 33f)) {
            val c = when (style) { "GOLD" -> Color(0x21E8C468); "RAINBOW" -> Color(0x1AFFFFFF); else -> Color(0x29FFFFFF) }
            strokeArt(FLAKE, 24f, 24f, c, 0.2f)
        }

        Box(Modifier.fillMaxSize().padding(horizontal = u * 5.6f, vertical = u * 5.2f)) {
            Column {
                // topo: banco + foto
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                    Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                        Canvas(Modifier.size(u * 4.6f)) { strokeArt(FLAKE, 24f, 24f, if (style == "GOLD") Color(0xFFE8C468) else Color.White, 2f) }
                        Spacer(Modifier.width(u * 1.5f))
                        Text("Project Club", style = ts(3.9f, FontWeight.SemiBold, spacing = 0.01f, useFoil = foil != null), maxLines = 1)
                    }
                    Box(
                        Modifier.size(u * 14.5f).clip(CircleShape)
                            .background(if (style == "RAINBOW") Brush.sweepGradient(rotateColors(look.ring, hue)) else Brush.linearGradient(look.ring))
                            .padding(u * 0.55f),
                    ) { Avatar(me, size = u * 13.4f, decoration = false) }
                }
                // chip + aproximação (sobe um pouco, como no site)
                Row(Modifier.offset(y = -u * 3.4f), verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier.size(u * 11.4f, u * 8.7f).clip(RoundedCornerShape(u * 1.9f)).background(
                            if (style == "RAINBOW") Brush.linearGradient(listOf(Color(0xFFF4F7FB), Color(0xFF9AA7BA), Color(0xFFEEF2F8), Color(0xFF7F8DA3)))
                            else Brush.linearGradient(0f to Color(0xFFF8E6A6), 0.36f to Color(0xFFD8AB49), 0.56f to Color(0xFFF5DC8E), 1f to Color(0xFFB5832B)),
                        ),
                    ) {
                        Canvas(Modifier.fillMaxSize()) {
                            strokeArt(CHIP, 50f, 38f, if (style == "RAINBOW") Color(0x99283C3C) else Color(0x9E583C0A), 1.1f)
                        }
                    }
                    Spacer(Modifier.width(u * 2.6f))
                    Canvas(Modifier.size(u * 6f)) { strokeArt(WAVES, 24f, 24f, (if (style == "GOLD") Color(0xFFE8C468) else look.ink).copy(alpha = 0.78f), 1.9f) }
                }
                // saldos
                Row(Modifier.offset(y = -u * 1.4f), horizontalArrangement = Arrangement.spacedBy(u * 5.4f), verticalAlignment = Alignment.CenterVertically) {
                    Balance(false, w.coins, "moedas", look, u, ts(8.2f, FontWeight.SemiBold, spacing = -0.02f, useFoil = foil != null), usp)
                    Balance(true, w.gems, "gemas", look, u, ts(8.2f, FontWeight.SemiBold, spacing = -0.02f, useFoil = foil != null), usp)
                }
            }
            // pé: titular + bandeira
            Row(Modifier.align(Alignment.BottomStart).fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                Column(Modifier.weight(1f)) {
                    Text(
                        name.uppercase(), style = ts(3.8f, FontWeight.SemiBold, spacing = 0.09f, useFoil = style == "GOLD"),
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    if (lvl != null) Text("Nível $lvl", style = TextStyle(fontSize = (usp * 2.9f).coerceAtLeastSp(8.sp), fontWeight = FontWeight.Medium, color = look.inkSoft))
                }
                Spacer(Modifier.width(u * 3f))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier.padding(u * 0.9f).size(u * 5.2f).graphicsLayer { rotationZ = 45f }.clip(RoundedCornerShape(u * 1.3f))
                            .background(if (style == "GOLD") Color(0x24E8C468) else Color(0x29FFFFFF))
                            .border(u * 0.3f, if (style == "GOLD") Color(0xFFE8C468) else Color(0xB8FFFFFF), RoundedCornerShape(u * 1.3f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Canvas(Modifier.size(u * 3.85f).graphicsLayer { rotationZ = -45f }) {
                            strokeArt(FLAKE, 24f, 24f, if (style == "GOLD") Color(0xFFF6DC8C) else Color.White, 1.9f)
                        }
                    }
                    Spacer(Modifier.width(u * 1.5f))
                    Text(
                        buildAnnotatedString {
                            append("Club")
                            withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append("Pay") }
                        },
                        style = ts(3.9f, FontWeight.Medium, italic = true, spacing = 0.01f, useFoil = foil != null),
                    )
                }
            }
        }
    }
}

/** "8sp no mínimo", como o max(8px, …) do CSS. */
private fun TextUnit.coerceAtLeastSp(v: TextUnit): TextUnit = if (v.value >= value) v else this

@Composable
private fun Balance(gems: Boolean, amount: Int, label: String, look: CardLook, u: Dp, numStyle: TextStyle, usp: TextUnit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        CurrencyArt(gems, u * 6f)
        Spacer(Modifier.width(u * 1.5f))
        Text(fmtNum(amount), style = numStyle, maxLines = 1)
        Spacer(Modifier.width(u * 1.5f))
        Text(label, style = TextStyle(fontSize = (usp * 3f).coerceAtLeastSp(8.sp), fontWeight = FontWeight.Medium, color = look.inkSoft), modifier = Modifier.padding(top = u * 2f))
    }
}

@Composable
private fun CardBack(style: String?, look: CardLook, number: String, u: Dp, usp: TextUnit, hue: Float) {
    val bg = when (style) {
        "GOLD" -> Brush.linearGradient(0f to Color(0xFFF3E6BD), 0.55f to Color(0xFFE2C98A), 1f to Color(0xFFCFAE63))
        "RAINBOW" -> Brush.linearGradient(
            rotateColors(listOf(Color(0xFFFFD6E0), Color(0xFFFFE9C7), Color(0xFFFFFBC7), Color(0xFFD4FFE6), Color(0xFFD6F1FF), Color(0xFFE5DCFF), Color(0xFFFFD6F3), Color(0xFFFFD6E0)), hue),
        )
        else -> Brush.linearGradient(0f to Color(0xFFA9C3EC), 0.55f to Color(0xFF8FB0E3), 1f to Color(0xFF7EA2DA))
    }
    Box(Modifier.fillMaxSize().background(bg)) {
        Canvas(Modifier.fillMaxSize()) {
            drawRect(Brush.radialGradient(listOf(Color.White.copy(alpha = 0.5f), Color.Transparent), center = Offset(size.width, 0f), radius = size.width * 0.9f))
        }
        Column(Modifier.fillMaxSize()) {
            Spacer(Modifier.height(u * 5.7f))
            // tarja magnética
            Box(
                Modifier.fillMaxWidth().height(u * 10f).background(
                    Brush.verticalGradient(0f to Color(0xFF1C1C1F), 0.55f to Color(0xFF0C0C0E), 1f to Color(0xFF171719)),
                ),
            )
            Text(
                "ASSINATURA AUTORIZADA",
                style = TextStyle(fontSize = (usp * 2.4f).coerceAtLeastSp(7.sp), fontWeight = FontWeight.Bold, letterSpacing = 0.07.em, color = look.sigInk.copy(alpha = 0.82f)),
                modifier = Modifier.padding(start = u * 7f, top = u * 3.2f),
            )
            Row(Modifier.padding(start = u * 7f, end = u * 7f, top = u * 1.3f).height(u * 9.5f)) {
                Box(
                    Modifier.weight(1f).fillMaxSize().clip(RoundedCornerShape(u * 0.7f)).drawWithContent {
                        // listras diagonais da faixa de assinatura
                        drawRect(Color(0xFFF7F7F3))
                        val step = u.toPx() * 2f
                        rotate(45f) {
                            var x = -size.width
                            while (x < size.width * 2) { drawRect(Color(0xFFEFEEE8), Offset(x, -size.height * 2), Size(step / 2f, size.height * 5)); x += step }
                        }
                        drawContent()
                    }.padding(horizontal = u * 2.8f),
                ) {
                    Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                        // rabisco da assinatura (mantém a proporção 120x30)
                        Canvas(Modifier.weight(1f).fillMaxSize().padding(vertical = u * 1.4f)) {
                            scale(size.height / 30f, size.height / 30f, pivot = Offset.Zero) {
                                drawPath(SCRIBBLE, Color(0xFF20222A), style = Stroke(2.2f, cap = StrokeCap.Round, join = StrokeJoin.Round))
                            }
                        }
                        Text(number, style = TextStyle(fontSize = usp * 4.1f, fontWeight = FontWeight.Bold, letterSpacing = 0.08.em, color = Color(0xFF20222A)))
                    }
                }
                Spacer(Modifier.width(u * 3.4f))
                Box(
                    Modifier.width(u * 20.6f).fillMaxSize().clip(RoundedCornerShape(u * 0.7f)).background(Color(0xFFF7F7F3)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(number.substring(1, 4), style = TextStyle(fontSize = usp * 4.1f, fontWeight = FontWeight.Bold, letterSpacing = 0.08.em, color = Color(0xFF20222A)))
                }
            }
        }
        // estrelinha no quadradinho claro
        Box(
            Modifier.align(Alignment.BottomStart).padding(start = u * 7f, bottom = u * 5.7f).size(u * 13f)
                .clip(RoundedCornerShape(u * 2.4f)).background(Color.White.copy(alpha = if (style == "RAINBOW") 0.55f else 0.45f))
                .border(u * 0.25f, Color.White.copy(alpha = if (style == "RAINBOW") 0.9f else 0.3f), RoundedCornerShape(u * 2.4f)),
            contentAlignment = Alignment.Center,
        ) {
            Canvas(Modifier.size(u * 7.15f)) {
                strokeArt(STAR, 24f, 24f, if (style == "GOLD") Color(0xFFFFFAF0) else Color.White.copy(alpha = 0.96f), 0f, fill = true)
            }
        }
    }
}
