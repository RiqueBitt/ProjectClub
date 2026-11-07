package com.projectclub.android.ui.login

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.animation.core.withInfiniteAnimationFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Matrix
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sign
import kotlin.math.sqrt
import kotlin.math.tan
import kotlin.random.Random

// ---------------------------------------------------------------------
// A turminha da tela de entrar — porte fiel do AuthCharacters.jsx do site
// (mesmas silhuetas, cores sorteadas, rostinhos, acessórios e reações):
//
//   parado    → respiram, piscam, trocam olhares, pulinhos
//   digitando → se inclinam pro campo e os olhos seguem o texto
//   senha     → tapam os olhos / fecham os olhos sorrindo
//   "mostrar" → a Lila espia com um olho só (a caçula olha feio pra ela)
//   erro      → susto (pulinho + tremida) e depois biquinho emburrado
//   sucesso   → pulo de comemoração com brilhinhos
//
// Tudo é desenhado num Canvas com um laço de quadros (molas simuladas),
// sem recomposição por quadro — só o desenho é refeito.
// ---------------------------------------------------------------------

enum class CritterField { None, Text, Password }

/** Reação pontual: mude o [key] pra disparar de novo a mesma reação. */
data class CritterReaction(val type: String, val key: Int)

private const val VBX = 38f
private const val VBW = 416f
private const val VBH = 244f
private const val FLOOR = 228f
private val INK = Color(0xFF1D1631)

private fun clamp(v: Float, a: Float, b: Float) = max(a, min(b, v))
private fun path(d: String): Path = PathParser().parsePathString(d).toPath()

// -------------------------- sorteio de visual ------------------------

private class Family(h: Float) {
    private fun hsl(h: Float, s: Float, l: Float) = Color.hsl(((h % 360f) + 360f) % 360f, s / 100f, l / 100f)
    val top = hsl(h, 74f, 85f)
    val base = hsl(h, 67f, 71f)
    val deep = hsl(h, 60f, 52f)
    val mitt = hsl(h, 62f, 94f)
    val lid = hsl(h, 66f, 80f)
    val cheek = hsl((h * 0.12f + 344f) % 360f, 92f, 73f)
}

private val HUES = listOf(258f, 160f, 8f, 44f, 205f, 328f, 96f, 24f, 278f, 184f, 342f, 52f)

private fun hueDist(a: Float, b: Float): Float { val d = abs(a - b) % 360f; return min(d, 360f - d) }
private fun pickHues(n: Int, rnd: Random): List<Float> {
    val pool = HUES.shuffled(rnd)
    val out = mutableListOf<Float>()
    for (c in pool) { if (out.all { hueDist(it, c) >= 30f }) out += c; if (out.size == n) break }
    for (c in pool) { if (out.size == n) break; if (c !in out) out += c }
    return out
}

private class Lay(val eyeYf: Float, val gapf: Float, val eyeRf: Float, val mouthDyf: Float)
private class ShapeOut(val body: String, val top: Float, val lay: Lay)

private fun shape(name: String, cx: Float, w: Float, h: Float, floor: Float): ShapeOut {
    val top = floor - h; val hw = w / 2
    return when (name) {
        "pilula" -> {
            val br = min(hw, 16f)
            ShapeOut("M${cx - hw} ${floor - br} V${top + hw} A$hw $hw 0 0 1 ${cx + hw} ${top + hw} V${floor - br} Q${cx + hw} $floor ${cx + hw - br} $floor H${cx - hw + br} Q${cx - hw} $floor ${cx - hw} ${floor - br} Z", top, Lay(0.34f, 0.2f, 0.15f, 0.3f))
        }
        "cupula" -> ShapeOut("M${cx - hw} $floor V${top + h * 0.55f} C${cx - hw} ${top + h * 0.16f} ${cx - hw * 0.5f} $top $cx $top C${cx + hw * 0.5f} $top ${cx + hw} ${top + h * 0.16f} ${cx + hw} ${top + h * 0.55f} V$floor Z", top, Lay(0.52f, 0.16f, 0.085f, 0.17f))
        "quadrado" -> {
            val tr = min(hw * 0.55f, 34f); val brc = 14f
            ShapeOut("M${cx - hw} ${top + tr} Q${cx - hw} $top ${cx - hw + tr} $top H${cx + hw - tr} Q${cx + hw} $top ${cx + hw} ${top + tr} V${floor - brc} Q${cx + hw} $floor ${cx + hw - brc} $floor H${cx - hw + brc} Q${cx - hw} $floor ${cx - hw} ${floor - brc} Z", top, Lay(0.42f, 0.16f, 0.075f, 0.2f))
        }
        "bolha" -> {
            val mid = top + h * 0.5f
            ShapeOut("M${cx - hw} $mid C${cx - hw} ${top + h * 0.16f} ${cx - hw * 0.45f} $top $cx $top C${cx + hw * 0.45f} $top ${cx + hw} ${top + h * 0.16f} ${cx + hw} $mid C${cx + hw} ${floor - h * 0.08f} ${cx + hw * 0.55f} $floor $cx $floor C${cx - hw * 0.55f} $floor ${cx - hw} ${floor - h * 0.08f} ${cx - hw} $mid Z", top, Lay(0.46f, 0.17f, 0.12f, 0.22f))
        }
        "ovo" -> ShapeOut("M$cx $top C${cx + hw} ${top + h * 0.05f} ${cx + hw} ${top + h * 0.52f} ${cx + hw * 0.92f} ${top + h * 0.72f} C${cx + hw * 0.82f} $floor ${cx + hw * 0.4f} $floor $cx $floor C${cx - hw * 0.4f} $floor ${cx - hw * 0.82f} $floor ${cx - hw * 0.92f} ${top + h * 0.72f} C${cx - hw} ${top + h * 0.52f} ${cx - hw} ${top + h * 0.05f} $cx $top Z", top, Lay(0.4f, 0.16f, 0.13f, 0.26f))
        else -> /* feijao */ ShapeOut("M${cx - hw} ${top + hw} a$hw $hw 0 0 1 $w 0 V${floor - hw} a$hw $hw 0 0 1 ${-w} 0 Z", top, Lay(0.4f, 0.19f, 0.14f, 0.28f))
    }
}

private val SHAPE_NAMES = listOf("pilula", "cupula", "quadrado", "bolha", "ovo", "feijao")
private val EYE_TYPES = listOf("ball", "dot", "bean")
private val IDLE_MOUTHS = listOf("smile", "soft", "cat", "grin")
private val IDLE_BROWS = listOf("soft", "up", "none")
private val ACC_SWAY = listOf("antenna", "sprout", "horn")
private val ACC_BOUNCE = listOf("leaf", "ears", "bow")

private class Role(val id: String, val cx: Float, val w: Float, val h: Float, val k: Float, val z: Float, val lean: Float, val face: Float, val baby: Boolean = false)

private val ROLES = listOf(
    Role("lila", 191f, 84f, 130f, 80f, 0.6f, 6f, 6f),
    Role("menta", 296f, 150f, 112f, 55f, 0.72f, 3.4f, 7f),
    Role("coral", 116f, 108f, 100f, 120f, 0.55f, 4.6f, 6f),
    Role("mel", 396f, 66f, 60f, 190f, 0.42f, 8f, 4f, baby = true),
)

private class Critter(
    val id: String, val idx: Int, val role: Role, val col: Family, val shapeName: String, val eye: String,
    val acc: String?, val idleMouth: String, val idleBrow: String,
) {
    val cx = role.cx; val w = role.w
    private val s = shape(shapeName, cx, w, role.h, FLOOR)
    val body: Path = path(s.body)
    val bodyTop = s.top
    private val eyeY = s.top + role.h * s.lay.eyeYf
    val eyeDX = w * s.lay.gapf
    private val er = max(5f, w * s.lay.eyeRf)
    val r: Float; val pr: Float; val pMax: Float
    init {
        when (eye) {
            "ball" -> { r = er; pr = er * 0.5f; pMax = clamp(er * 0.42f, 2.6f, 5f) }
            "dot" -> { r = er * 0.72f; pr = er * 0.7f; pMax = clamp(er * 0.5f, 2.4f, 3.6f) }
            else -> { r = er * 0.72f; pr = er * 0.74f; pMax = clamp(er * 0.38f, 2.2f, 3.2f) }
        }
    }
    val eyes = listOf(Offset(cx - eyeDX, eyeY), Offset(cx + eyeDX, eyeY))
    val brow = max(12f, er * 1.5f)
    private val mouthY = eyeY + w * s.lay.mouthDyf
    val mouth = Offset(cx, mouthY)
    val mouthS = clamp(w / 110f, 0.72f, 1.12f)
    val blush = listOf(Offset(cx - (eyeDX + er), eyeY + er * 1.4f), Offset(cx + (eyeDX + er), eyeY + er * 1.4f))
    val blushR = Size(er * 0.78f * 2, er * 0.46f * 2)
    val rest = listOf(Offset(cx - w * 0.42f, FLOOR - 16), Offset(cx + w * 0.42f, FLOOR - 16))
    val up = listOf(Offset(cx - w * 0.52f, eyeY - 4), Offset(cx + w * 0.52f, eyeY - 4))
    val chin = Offset(cx + eyeDX + er * 0.5f, mouthY + 1)
    val coverIn = if (role.baby) eyeDX * 0.42f else 0f
    val hand = clamp(w / 110f, 0.85f, 1.08f)
    val accAnchor = Offset(cx, bodyTop + 2)
    val sway get() = acc in ACC_SWAY
    val lidPath: Path = path("M${-r - 2} ${-2 * r - 4} H${r + 2} V0 Q0 3 ${-r - 2} 0 Z")
}

private class Cast(val list: List<Critter>) {
    val byId = list.associateBy { it.id }
    val swayer = list.firstOrNull { it.acc != null && it.sway }?.id
    val bouncer = list.firstOrNull { it.acc != null && !it.sway }?.id
}

private fun makeCast(rnd: Random = Random.Default): Cast {
    val shapes = SHAPE_NAMES.shuffled(rnd).take(ROLES.size)
    val hues = pickHues(ROLES.size, rnd)
    val accs = listOf(ACC_SWAY.random(rnd), ACC_BOUNCE.random(rnd), (ACC_SWAY + ACC_BOUNCE + listOf("none", "none")).random(rnd), "none").shuffled(rnd)
    return Cast(ROLES.mapIndexed { i, role ->
        Critter(
            role.id, i, role, Family(hues[i]), shapes[i], EYE_TYPES.random(rnd),
            accs[i].takeIf { it != "none" }, IDLE_MOUTHS.random(rnd), IDLE_BROWS.random(rnd),
        )
    })
}

// ------------------------------ humores ------------------------------

private sealed interface Look {
    data object Target : Look
    data object Form : Look
    data object Away : Look
    data object Front : Look
    data class At(val id: String) : Look
}

private data class Mood(
    val eyes: Pair<String, String>, val mouth: String, val brow: String = "none",
    val hands: String = "rest", val blush: Int = 1, val look: Look = Look.Target,
)

private fun E(eyes: String, mouth: String, brow: String = "none", hands: String = "rest", blush: Int = 1, look: Look = Look.Target) =
    Mood(eyes to eyes, mouth, brow, hands, blush, look)

private val MOODS: Map<String, Map<String, Mood>> = mapOf(
    "idle" to mapOf(
        "lila" to E("open", "smile", brow = "soft"), "menta" to E("open", "soft", brow = "soft"),
        "coral" to E("open", "cat", blush = 2), "mel" to E("open", "smile"),
    ),
    "typing" to mapOf(
        "lila" to E("open", "grin", brow = "up"), "menta" to E("open", "smile", brow = "soft"),
        "coral" to E("open", "smile", blush = 2), "mel" to E("wide", "o"),
    ),
    "password" to mapOf(
        "lila" to E("closed", "smile", brow = "soft", look = Look.Away),
        "menta" to E("squeeze", "smile", look = Look.Away, blush = 2),
        "coral" to E("closed", "cat", hands = "cover", blush = 3),
        "mel" to E("closed", "soft", hands = "cover", blush = 2),
    ),
    "peek" to mapOf(
        "lila" to Mood("squeeze" to "open", "smirk", brow = "sly", hands = "peek"),
        "menta" to E("squeeze", "wavy", look = Look.Away, blush = 2),
        "coral" to E("closed", "cat", hands = "cover", blush = 3),
        "mel" to E("half", "flat", brow = "cross", look = Look.At("lila")),
    ),
    "error" to mapOf(
        "lila" to E("wide", "o", brow = "up", blush = 0, look = Look.Front),
        "menta" to E("wide", "wavy", brow = "up", blush = 0, look = Look.Front),
        "coral" to E("wide", "o", brow = "up", blush = 0, look = Look.Front),
        "mel" to E("wide", "o", brow = "up", blush = 0, look = Look.Front),
    ),
    "pout" to mapOf(
        "lila" to E("half", "pout", brow = "angry", look = Look.Form),
        "menta" to E("half", "flat", brow = "cross", look = Look.Form),
        "coral" to E("half", "pout", brow = "angry", blush = 3, look = Look.Form),
        "mel" to E("half", "pout", brow = "angry", blush = 3, look = Look.Form),
    ),
    "success" to mapOf(
        "lila" to E("happy", "big", brow = "up", hands = "up", blush = 2, look = Look.Front),
        "menta" to E("happy", "grin", blush = 2, look = Look.Front),
        "coral" to E("happy", "big", hands = "up", blush = 3, look = Look.Front),
        "mel" to E("happy", "big", hands = "up", blush = 3, look = Look.Front),
    ),
)

private class MouthArt(val path: Path?, val fill: Boolean = false, val ellipse: Boolean = false)
private val MOUTHS: Map<String, MouthArt> by lazy {
    mapOf(
        "smile" to MouthArt(path("M-7 -1.5 Q0 6 7 -1.5")),
        "soft" to MouthArt(path("M-4.5 0 Q0 3.5 4.5 0")),
        "cat" to MouthArt(path("M-8 -1 Q-4 4 0 -0.5 Q4 4 8 -1")),
        "grin" to MouthArt(path("M-8 -2.5 Q0 -0.5 8 -2.5 Q7 8 0 8.5 Q-7 8 -8 -2.5 Z"), fill = true),
        "big" to MouthArt(path("M-10 -3 Q0 -1 10 -3 Q9 11 0 11.5 Q-9 11 -10 -3 Z"), fill = true),
        "o" to MouthArt(null, ellipse = true),
        "flat" to MouthArt(path("M-4.5 0.5 H4.5")),
        "wavy" to MouthArt(path("M-8 0.5 Q-6 -2.5 -2.7 0.5 Q0 3 2.7 0.5 Q6 -2.5 8 0.5")),
        "pout" to MouthArt(path("M-6 3.5 Q0 -3 6 3.5")),
        "smirk" to MouthArt(path("M-6 1.5 Q1 4.5 7.5 -2.5")),
    )
}

/** Sobrancelhas: deslocamento y, giro do olho esquerdo, giro do direito. */
private val BROWS = mapOf(
    "soft" to floatArrayOf(0f, -4f, 4f), "up" to floatArrayOf(-5f, -10f, 10f), "angry" to floatArrayOf(3f, 20f, -20f),
    "cross" to floatArrayOf(2f, 12f, -12f), "sly" to floatArrayOf(0f, 16f, -10f),
)

private val SPARKLES = listOf(
    Triple(120f, 98f, 1.1f), Triple(196f, 6f, 0.9f), Triple(250f, 58f, 0.7f), Triple(340f, 96f, 1f),
    Triple(430f, 148f, 0.8f), Triple(66f, 104f, 0.7f), Triple(150f, 40f, 0.6f), Triple(384f, 130f, 0.6f),
)

private class Arts {
    val mitten = path("M-7.5 6 C-9.5 0 -9 -7.5 -3.5 -9.5 C1.5 -11 7.5 -8.5 8 -2 C8.5 4 5.5 8.5 0 8.5 C-3.5 8.5 -6.5 8 -7.5 6 Z")
    val spark = path("M0 -9 C1.2 -2.4 2.4 -1.2 9 0 C2.4 1.2 1.2 2.4 0 9 C-1.2 2.4 -2.4 1.2 -9 0 C-2.4 -1.2 -1.2 -2.4 0 -9 Z")
    val closed = path("M-6.5 -0.5 Q0 4.5 6.5 -0.5")
    val happy = path("M-6.5 2.5 Q0 -5.5 6.5 2.5")
    val squeezeL = path("M-5 -5 L5 0 L-5 5")
    val squeezeR = path("M5 -5 L-5 0 L5 5")
    val brow = path("M-6 0.8 Q0 -1.8 6 0.8")
    val fingers = path("M-2.2 -7.5 V-3 M2.6 -7.2 V-3")
    val accs = mapOf(
        "antenna" to listOf(path("M0 1 C0 -9 4 -16 9 -27")),
        "sprout" to listOf(path("M0 2 C0 -6 2 -12 1 -20"), path("M1 -14 C-5 -16 -9 -12 -10 -8 C-4 -8 0 -10 1 -14 Z"), path("M1 -20 C-2 -26 1 -31 6 -32 C6 -26 4 -22 1 -20 Z")),
        "horn" to listOf(path("M-5.5 2 C-5 -11 -1 -21 2 -25 C5 -19 3 -7 3 2 Z"), path("M-3 -3 H1.2 M-3 -10 H1.8"), path("M-3.4 2 C-3 -8 -1 -16 0 -20")),
        "leaf" to listOf(path("M0 2 C-3 -8 -12 -14 -19 -12 C-15 -6 -9 -1 0 2 Z"), path("M0 2 C1 -10 8 -19 16 -20 C14 -11 8 -3 0 2 Z")),
        "bow" to listOf(path("M-2 -10 L-16 -17 L-16 -3 Z"), path("M2 -10 L16 -17 L16 -3 Z")),
    )
}

// ------------------------- animação (keyframes) ----------------------

/** Um quadro-chave de transformação (pivô no pé do personagem). */
private class KF(val at: Float, val tx: Float = 0f, val ty: Float = 0f, val sx: Float = 1f, val sy: Float = 1f, val rot: Float = 0f)

private class Anim(val start: Long, val dur: Long, val frames: List<KF>)

private class Xf(var tx: Float = 0f, var ty: Float = 0f, var sx: Float = 1f, var sy: Float = 1f, var rot: Float = 0f) {
    fun reset() { tx = 0f; ty = 0f; sx = 1f; sy = 1f; rot = 0f }
}

private fun easeInOut(t: Float) = (0.5f - 0.5f * cos(PI.toFloat() * t))

/** Aplica a animação ativa (se houver) no [out]. */
private fun sample(list: MutableList<Anim>, now: Long, out: Xf) {
    out.reset()
    list.removeAll { now > it.start + it.dur }
    val a = list.firstOrNull { now >= it.start } ?: return
    val p = (now - a.start).toFloat() / a.dur
    val f = a.frames
    val i = f.indexOfLast { it.at <= p }.coerceAtLeast(0)
    val k0 = f[i]; val k1 = f.getOrElse(i + 1) { k0 }
    val t = if (k1.at > k0.at) easeInOut((p - k0.at) / (k1.at - k0.at)) else 0f
    fun l(a: Float, b: Float) = a + (b - a) * t
    out.tx = l(k0.tx, k1.tx); out.ty = l(k0.ty, k1.ty); out.sx = l(k0.sx, k1.sx); out.sy = l(k0.sy, k1.sy); out.rot = l(k0.rot, k1.rot)
}

/** Estado vivo de cada personagem (molas, transições de rosto, pulos). */
private class Live(c: Critter) {
    var lean = 0f; var lv = 0f
    var fx = 0f; var fy = 0f; var fvx = 0f; var fvy = 0f
    var px = 0f; var py = 0f
    // Transições do rosto: alfa de cada estado do olho, por olho.
    val eye = Array(2) { mutableMapOf("open" to 1f, "closed" to 0f, "happy" to 0f, "squeeze" to 0f, "wide" to 0f, "half" to 0f) }
    val mouth = mutableMapOf<String, Float>().apply { MOUTHS.keys.forEach { put(it, 0f) }; put(c.idleMouth, 1f) }
    var browOn = if (c.idleBrow == "none") 0f else 1f
    var browY = 3f; val browRot = floatArrayOf(0f, 0f)
    var blush = 0.5f
    // Mãos: x, y, giro, visível (0–1), por mão.
    val hand = Array(2) { i -> floatArrayOf(c.rest[i].x, c.rest[i].y, 0f, 0f) }
    var blinkUntil = 0L
    val hops = mutableListOf<Anim>()
    val shadow = mutableListOf<Anim>()
    val accAnim = mutableListOf<Anim>()
    val hopX = Xf(); val shadowX = Xf(); val accX = Xf()
}

private fun handPose(c: Critter, pose: String, i: Int): FloatArray {
    val ex = c.eyes[i].x; val ey = c.eyes[i].y + 3
    val tilt = if (i == 0) -1f else 1f
    return when (pose) {
        "cover" -> floatArrayOf(ex - c.coverIn * tilt, ey + 1 + c.coverIn, 14 * tilt, 1f)
        "up" -> floatArrayOf(c.up[i].x, c.up[i].y, 28 * tilt, 1f)
        "peek" -> if (i == 0) floatArrayOf(ex, ey, -18f, 1f) else floatArrayOf(c.chin.x, c.chin.y, 30f, 1f)
        else -> floatArrayOf(c.rest[i].x, c.rest[i].y, 0f, 0f)
    }
}

// ------------------------------ componente ---------------------------

/**
 * @param field campo em foco no formulário.
 * @param caret 0–1: onde está o cursor de texto na largura do campo.
 * @param peek  "mostrar senha" ligado com algo digitado.
 * @param pointer último toque na tela (coordenadas da janela) — os olhos seguem.
 * @param alignRight encosta a turma à direita da caixa (como no celular do site).
 */
@Composable
fun AuthCritters(
    field: CritterField,
    caret: Float,
    peek: Boolean,
    reaction: CritterReaction?,
    modifier: Modifier = Modifier,
    pointer: Offset? = null,
    alignRight: Boolean = true,
) {
    val cast = remember { makeCast() }
    val arts = remember { Arts() }
    val live = remember { cast.list.associate { it.id to Live(it) } }
    var react by remember { mutableStateOf<String?>(null) }
    var frame by remember { mutableLongStateOf(0L) }
    var origin by remember { mutableStateOf(Offset.Zero) }
    val glance = remember { mutableMapOf<String, String>() }
    var glanceUntil by remember { mutableLongStateOf(0L) }

    val mode = when {
        react != null -> if (react == "pout") "error" else react!!
        peek -> "peek"
        field == CritterField.Password -> "password"
        field == CritterField.Text -> "typing"
        else -> "idle"
    }
    val moodKey = if (react == "pout") "pout" else mode
    val moodKeyNow by rememberUpdatedState(moodKey)
    val caretNow by rememberUpdatedState(caret)
    val pointerNow by rememberUpdatedState(pointer)
    val fieldNow by rememberUpdatedState(field)

    fun now() = System.nanoTime() / 1_000_000
    fun hop(c: Critter, h: Float, dur: Long = 560, delay: Long = 0, sq: Float = 1f) {
        val l = live.getValue(c.id); val t = now() + delay
        l.hops += Anim(t, dur, listOf(
            KF(0f), KF(0.16f, sx = 1 + 0.07f * sq, sy = 1 - 0.09f * sq),
            KF(0.48f, ty = -h, sx = 1 - 0.04f * sq, sy = 1 + 0.06f * sq), KF(0.74f),
            KF(0.86f, sx = 1 + 0.05f * sq, sy = 1 - 0.06f * sq), KF(1f),
        ))
        l.shadow += Anim(t, dur, listOf(KF(0f), KF(0.16f, sx = 1.06f), KF(0.48f, sx = 0.6f, sy = 0.7f), KF(0.74f), KF(1f)))
    }
    fun wiggle(id: String?) {
        id ?: return
        live.getValue(id).accAnim += Anim(now(), 1000, listOf(KF(0f), KF(0.2f, rot = -14f), KF(0.45f, rot = 11f), KF(0.7f, rot = -6f), KF(0.88f, rot = 2f), KF(1f)))
    }
    fun bounce(id: String?) {
        id ?: return
        live.getValue(id).accAnim += Anim(now(), 820, listOf(KF(0f), KF(0.3f, ty = -4f, sx = 1.06f, sy = 1.06f), KF(0.6f, ty = 1f, sx = 0.97f, sy = 0.97f), KF(1f)))
    }
    fun blink(id: String, ms: Long = 140) { live.getValue(id).blinkUntil = now() + ms }

    // Reações: erro = susto ~0,5s + biquinho até ~1,8s; sucesso fica.
    LaunchedEffect(reaction?.type, reaction?.key) {
        val r = reaction?.type ?: return@LaunchedEffect
        react = r
        if (r == "error") {
            cast.list.forEachIndexed { i, c ->
                val h = when (c.id) { "mel" -> 16f; "menta" -> 7f; else -> 11f }
                val l = live.getValue(c.id); val t = now() + i * 45L
                l.hops += Anim(t, 820, listOf(
                    KF(0f), KF(0.16f, ty = -h, sx = 0.95f, sy = 1.07f), KF(0.3f, sx = 1.07f, sy = 0.92f),
                    KF(0.42f, tx = -4f, rot = -2.2f), KF(0.54f, tx = 4f, rot = 2.2f), KF(0.66f, tx = -2.5f, rot = -1.2f),
                    KF(0.8f, tx = 1.5f, rot = 0.5f), KF(1f),
                ))
                l.shadow += Anim(t, 820, listOf(KF(0f), KF(0.16f, sx = 0.72f, sy = 0.8f), KF(0.3f), KF(1f)))
            }
            kotlinx.coroutines.delay(560); react = "pout"
            kotlinx.coroutines.delay(1290); react = null
        } else if (r == "success") {
            cast.list.forEachIndexed { i, c ->
                val h = mapOf("lila" to 26f, "menta" to 18f, "coral" to 30f, "mel" to 38f).getValue(c.id)
                hop(c, h, 720, 40L + i * 65, 1.3f)
                if (c.id == "mel") hop(c, 20f, 520, 40L + i * 65 + 720, 1f)
            }
            wiggle(cast.swayer); bounce(cast.bouncer)
        }
    }

    // Piscadas: cada um no seu ritmo (às vezes piscada dupla).
    cast.list.forEachIndexed { i, c ->
        LaunchedEffect(c.id) {
            while (true) {
                kotlinx.coroutines.delay((2200 + Random.nextInt(3600) + i * 250).toLong())
                blink(c.id)
                if (Random.nextFloat() < 0.2f) { kotlinx.coroutines.delay(260); blink(c.id) }
            }
        }
    }

    // Micro-ações quando parados: olhares, pulinho, acessório, amassadinho.
    LaunchedEffect(Unit) {
        val pairs = listOf("lila" to "coral", "menta" to "mel", "coral" to "mel", "lila" to "mel", "lila" to "menta")
        var n = 0
        kotlinx.coroutines.delay(1800)
        while (true) {
            if (moodKeyNow == "idle") {
                val what = if (n++ % 2 == 0) "glance" else listOf("hop", "wiggle", "bounce", "squish", "blink2").random()
                when (what) {
                    "glance" -> {
                        val (a, b) = pairs.random()
                        glance.clear(); glance[a] = b; glance[b] = a; glanceUntil = now() + 1500
                    }
                    "hop" -> { hop(cast.byId.getValue("mel"), 14f); hop(cast.byId.getValue("mel"), 8f, 460, 560) }
                    "wiggle" -> wiggle(cast.swayer)
                    "bounce" -> bounce(cast.bouncer)
                    "squish" -> live.getValue("coral").hops += Anim(now(), 700, listOf(KF(0f), KF(0.3f, sx = 1.06f, sy = 0.93f), KF(0.6f, sx = 0.97f, sy = 1.04f), KF(1f)))
                    else -> { blink("lila"); blink("menta") }
                }
                if (what == "glance") { kotlinx.coroutines.delay(900); glance.keys.toList().forEach { blink(it) } }
            }
            kotlinx.coroutines.delay((2600 + Random.nextInt(2600)).toLong())
        }
    }

    // Laço de quadros: molas do olhar/rosto/inclinação e transições.
    LaunchedEffect(Unit) {
        var last = withInfiniteAnimationFrameNanos { it }
        while (true) {
            val t = withInfiniteAnimationFrameNanos { it }
            val dt = ((t - last) / 1e9f).coerceIn(0.001f, 0.05f); last = t
            val mk = moodKeyNow
            val nowMs = now()
            // Pra onde olham (em coordenadas do desenho): o formulário fica
            // embaixo; o cursor anda da esquerda pra direita conforme digita.
            val form = Offset(VBX + VBW * 0.32f, VBH + 230f)
            val caretPt = Offset(VBX + VBW * (0.04f + 0.9f * caretNow.coerceIn(0f, 1f)), VBH + if (fieldNow == CritterField.Password) 300f else 190f)
            val ptr = pointerNow
            val tgt = when {
                fieldNow != CritterField.None -> caretPt
                ptr != null && lastScale > 0f -> Offset(VBX + (ptr.x - origin.x - lastOffX) / lastScale, (ptr.y - origin.y - lastOffY) / lastScale)
                else -> form
            }
            val formSide = sign(form.x - (VBX + VBW / 2)).let { if (it == 0f) 1f else it }
            val g = if (glanceUntil > nowMs && mk == "idle") glance else emptyMap()
            for (c in cast.list) {
                val l = live.getValue(c.id)
                val mood0 = MOODS.getValue(mk).getValue(c.id)
                val mood = if (mk == "idle") mood0.copy(mouth = c.idleMouth, brow = c.idleBrow) else mood0
                val ex = (c.eyes[0].x + c.eyes[1].x) / 2; val ey = c.eyes[0].y
                val look = g[c.id]?.let { Look.At(it) } ?: mood.look
                var dx = 0f; var dy = 0f; var leanG = 0f; var pScale = 1f
                when (look) {
                    Look.Target, Look.Form -> {
                        val p = if (look == Look.Form) form else tgt
                        dx = p.x - ex; dy = p.y - ey
                        leanG = clamp(dx / 150f, -1f, 1f) * c.role.lean * (if (mk == "typing") 1.15f else 0.7f)
                    }
                    Look.Away -> { dx = -150 * formSide; dy = -80f; leanG = -c.role.lean * 0.75f * formSide }
                    Look.Front -> { dy = 60f; pScale = 0.35f }
                    is Look.At -> {
                        val o = cast.byId.getValue(look.id)
                        dx = (o.eyes[0].x + o.eyes[1].x) / 2 - ex; dy = o.eyes[0].y - ey
                        leanG = clamp(dx / 150f, -1f, 1f) * c.role.lean * 0.6f
                    }
                }
                if (mk == "peek" && c.id == "lila") leanG = c.role.lean * 1.1f * formSide
                if (mk == "pout") leanG = -c.role.lean * 0.35f * formSide
                if (mk == "error" || mk == "success") leanG = 0f
                val dist = hypot(dx, dy).takeIf { it > 0f } ?: 1f
                val nx = dx / dist; val ny = dy / dist
                val pa = c.pMax * min(1f, dist / 70f) * pScale
                val fa = c.role.face * min(1f, dist / 200f) * (if (look == Look.Front) 0.3f else 1f)
                val tfx = nx * fa; val tfy = ny * fa * 0.6f + if (mk == "pout") -2f else 0f
                val tpx = nx * pa; val tpy = ny * pa * 0.85f
                // Mola levemente sub-amortecida (balancinho no fim).
                val k = c.role.k; val d = 2 * sqrt(k) * c.role.z
                l.lv += (k * (leanG - l.lean) - d * l.lv) * dt; l.lean += l.lv * dt
                val kf = k * 1.6f; val df = 2 * sqrt(kf) * min(0.9f, c.role.z + 0.15f)
                l.fvx += (kf * (tfx - l.fx) - df * l.fvx) * dt; l.fx += l.fvx * dt
                l.fvy += (kf * (tfy - l.fy) - df * l.fvy) * dt; l.fy += l.fvy * dt
                val a = 1 - exp(-dt * 14f)
                l.px += (tpx - l.px) * a; l.py += (tpy - l.py) * a

                // Transições de rosto (atraso pequeno por personagem, como no site).
                val fast = 1 - exp(-dt * 16f); val soft = 1 - exp(-dt * 10f)
                val states = listOf(mood.eyes.first, mood.eyes.second)
                for (i in 0..1) {
                    val s = states[i]; val m = l.eye[i]
                    fun go(key: String, on: Boolean, r: Float = fast) { m[key] = m.getValue(key) + ((if (on) 1f else 0f) - m.getValue(key)) * r }
                    go("open", s == "open" || s == "wide" || s == "half")
                    go("closed", s == "closed"); go("happy", s == "happy"); go("squeeze", s == "squeeze")
                    go("wide", s == "wide", soft); go("half", s == "half", soft)
                }
                for (key in l.mouth.keys.toList()) l.mouth[key] = l.mouth.getValue(key) + ((if (key == mood.mouth) 1f else 0f) - l.mouth.getValue(key)) * fast
                val b = BROWS[mood.brow]
                l.browOn += ((if (b != null) 1f else 0f) - l.browOn) * fast
                l.browY += ((b?.get(0) ?: 3f) - l.browY) * soft
                for (i in 0..1) l.browRot[i] += ((b?.get(i + 1) ?: 0f) - l.browRot[i]) * soft
                val blushT = when (mood.blush) { 0 -> 0f; 2 -> 0.72f; 3 -> 0.92f; else -> 0.5f }.let { if (c.id == "menta" && mood.blush > 0) max(it, 0.75f) else it }
                l.blush += (blushT - l.blush) * soft
                val handRate = if (mk == "error") 1 - exp(-dt * 22f) else 1 - exp(-dt * 9f)
                for (i in 0..1) {
                    val target = handPose(c, mood.hands, i)
                    val rate = if (mood.hands == "peek" && i == 1) 1 - exp(-dt * 3.2f) else handRate
                    for (j in 0..3) l.hand[i][j] += (target[j] - l.hand[i][j]) * rate
                }
                sample(l.hops, nowMs, l.hopX); sample(l.shadow, nowMs, l.shadowX); sample(l.accAnim, nowMs, l.accX)
            }
            frame = t
        }
    }

    Canvas(modifier.onGloballyPositioned { origin = it.positionInWindow() }) {
        if (frame < 0L) return@Canvas // lê o quadro: redesenha a cada quadro
        val s = min(size.width / VBW, size.height / VBH)
        val offX = (size.width - VBW * s) * (if (alignRight) 1f else 0.5f)
        val offY = size.height - VBH * s
        lastScale = s; lastOffX = offX; lastOffY = offY
        val nowMs = System.nanoTime() / 1_000_000
        withTransform({ translate(offX - VBX * s, offY); scale(s, s, Offset.Zero) }) {
            drawStage(cast, live, arts, nowMs, mode == "success")
        }
    }
}

// Escala/posição do último desenho (pra converter o toque em coordenadas do desenho).
private var lastScale = 0f
private var lastOffX = 0f
private var lastOffY = 0f

// ------------------------------- desenho ------------------------------

private fun DrawScope.drawStage(cast: Cast, live: Map<String, Live>, arts: Arts, nowMs: Long, success: Boolean) {
    // Chão: brilho de fundo, linha e sombras de contato.
    drawOval(Brush.radialGradient(listOf(Color.White.copy(alpha = 0.09f), Color.Transparent), Offset(246f, FLOOR - 64), 200f), Offset(46f, FLOOR - 164), Size(400f, 200f))
    drawRect(Brush.horizontalGradient(listOf(Color.Transparent, Color.White.copy(alpha = 0.22f), Color.Transparent), VBX, VBX + VBW), Offset(VBX, FLOOR), Size(VBW, 1f))
    drawOval(Brush.radialGradient(listOf(Color.Black.copy(alpha = 0.41f), Color.Transparent), Offset(248f, FLOOR + 3), 210f), Offset(38f, FLOOR - 6), Size(420f, 18f))
    for (c in cast.list) {
        val x = live.getValue(c.id).shadowX
        withTransform({ translate(c.cx, FLOOR + 1.5f); scale(x.sx, x.sy, Offset.Zero) }) {
            val rx = c.w * 0.56f
            drawOval(Brush.radialGradient(listOf(Color.Black.copy(alpha = 0.75f), Color.Transparent), Offset.Zero, rx), Offset(-rx, -5.5f), Size(rx * 2, 11f), alpha = 0.55f + 0.45f * min(1f, x.sy))
        }
    }
    for (c in cast.list) drawCritter(c, live.getValue(c.id), arts, nowMs)
    if (success) {
        SPARKLES.forEachIndexed { i, (x, y, sc) ->
            val t = (nowMs % 1600) / 1600f
            val tw = 0.65f + 0.35f * cos(2 * PI.toFloat() * (t + i * 0.13f))
            withTransform({ translate(x, y); scale(sc * tw, sc * tw, Offset.Zero) }) {
                drawPath(arts.spark, cast.list[i % cast.list.size].col.top, alpha = tw)
            }
        }
    }
}

private fun DrawScope.drawCritter(c: Critter, l: Live, arts: Arts, nowMs: Long) {
    val col = c.col
    val h = l.hopX
    // Respiração (cada um no seu ritmo; a caçula quica).
    val period = when (c.id) { "lila" -> 4600f; "menta" -> 5200f; "coral" -> 3900f; else -> 2600f }
    val phase = when (c.id) { "menta" -> 1800f; "coral" -> 900f; "mel" -> 400f; else -> 0f }
    val b = (0.5f - 0.5f * cos(2 * PI.toFloat() * ((nowMs + phase) % period) / period))
    val (bsx, bsy) = if (c.id == "mel") (1.025f - 0.04f * b) to (0.975f + 0.06f * b) else (1 + 0.012f * b) to (1 + 0.03f * b)

    withTransform({
        // pulo/tremida — pivô no pé
        translate(h.tx, h.ty)
        rotate(h.rot, Offset(c.cx, FLOOR))
        scale(h.sx, h.sy, Offset(c.cx, FLOOR))
        // inclinação (skewX a partir do chão)
        val m = Matrix()
        m.translate(c.cx, FLOOR)
        val sk = Matrix(); sk.values[Matrix.SkewX] = tan(Math.toRadians(-l.lean.toDouble())).toFloat()
        m.timesAssign(sk)
        m.translate(-c.cx, -FLOOR)
        transform(m)
        scale(bsx, bsy, Offset(c.cx, FLOOR))
    }) {
        drawAccessory(c, l, arts, nowMs)
        // Corpo com volume: gradiente, sombra própria, oclusão e brilho.
        drawPath(c.body, Brush.linearGradient(listOf(col.top, col.base, col.base), Offset(c.cx - c.w * 0.3f, c.bodyTop), Offset(c.cx + c.w * 0.3f, FLOOR)))
        clipPath(c.body) {
            val tall = FLOOR - c.bodyTop
            drawRect(Brush.verticalGradient(0.4f to col.deep.copy(alpha = 0f), 1f to col.deep.copy(alpha = 0.65f), startY = c.bodyTop, endY = FLOOR), Offset(c.cx - c.w, c.bodyTop - 30), Size(c.w * 2, tall + 30))
            drawRect(Brush.horizontalGradient(0.5f to col.deep.copy(alpha = 0f), 1f to col.deep.copy(alpha = 0.5f), startX = c.cx - c.w / 2, endX = c.cx + c.w / 2), Offset(c.cx - c.w, c.bodyTop - 30), Size(c.w * 2, tall + 30))
            drawRect(Brush.verticalGradient(listOf(col.deep.copy(alpha = 0f), col.deep.copy(alpha = 0.5f)), startY = FLOOR - 42, endY = FLOOR), Offset(c.cx - c.w, FLOOR - min(42f, tall * 0.4f)), Size(c.w * 2, 60f))
            val shx = c.cx - c.w * 0.24f; val shy = c.bodyTop + tall * 0.2f; val rx = c.w * 0.26f; val ry = min(30f, tall * 0.2f)
            withTransform({ scale(1f, ry / rx, Offset(shx, shy)) }) {
                drawCircle(Brush.radialGradient(listOf(Color.White.copy(alpha = 0.62f), Color.Transparent), Offset(shx, shy), rx), rx, Offset(shx, shy))
            }
            val hx = c.w * 0.12f; val hy = min(10f, tall * 0.08f)
            drawOval(Color.White.copy(alpha = 0.5f), Offset(c.cx - c.w * 0.26f - hx, c.bodyTop + tall * 0.12f - hy), Size(hx * 2, hy * 2))
        }
        drawPath(c.body, Color.White.copy(alpha = 0.15f), style = Stroke(1.2f))

        // Rosto (desloca inteiro pro lado que olha).
        translate(l.fx, l.fy) {
            for (p in c.blush) drawOval(col.cheek, Offset(p.x - c.blushR.width / 2, p.y - c.blushR.height / 2), c.blushR, alpha = l.blush)
            if (l.browOn > 0.02f) for (i in 0..1) {
                val e = c.eyes[i]
                withTransform({ translate(e.x, e.y - c.brow + l.browY); rotate(l.browRot[i], Offset.Zero) }) {
                    drawPath(arts.brow, INK, alpha = l.browOn, style = Stroke(3f, cap = StrokeCap.Round))
                }
            }
            for (i in 0..1) drawEye(c, l, i, arts, nowMs)
            drawMouth(c, l)
            for (i in 0..1) drawHand(c, l, i, arts)
        }
    }
}

private fun DrawScope.drawEye(c: Critter, l: Live, i: Int, arts: Arts, nowMs: Long) {
    val e = c.eyes[i]; val m = l.eye[i]
    val open = m.getValue("open"); val wide = m.getValue("wide"); val half = m.getValue("half")
    val blinking = nowMs < l.blinkUntil
    withTransform({ translate(e.x, e.y); scale(1 + 0.14f * wide, 1 + 0.14f * wide, Offset.Zero) }) {
        if (open > 0.02f) {
            val sy = (0.15f + 0.85f * open) * (1 - 0.18f * half) * (if (blinking && c.eye != "ball") 0.1f else 1f) *
                (if (c.eye != "ball" && half > 0.5f && (c.id == "menta" || c.id == "coral")) 0.62f else 1f)
            withTransform({ scale(1f, sy, Offset.Zero) }) {
                if (c.eye == "ball") drawCircle(Color.White, c.r, Offset.Zero, alpha = open)
                withTransform({ translate(l.px, l.py); scale(1 - 0.28f * wide, 1 - 0.28f * wide, Offset.Zero) }) {
                    if (c.eye == "bean") drawOval(INK, Offset(-c.pr * 0.92f, -c.pr * 1.32f), Size(c.pr * 1.84f, c.pr * 2.64f), alpha = open)
                    else drawCircle(INK, c.pr, Offset.Zero, alpha = open)
                    drawCircle(Color.White, c.pr * 0.36f, Offset(c.pr * 0.34f, -c.pr * 0.42f), alpha = open)
                    drawCircle(Color.White, c.pr * 0.15f, Offset(-c.pr * 0.36f, c.pr * 0.4f), alpha = open * 0.8f)
                }
                if (c.eye == "ball") {
                    // Pálpebra de verdade: desce por cima da esclera (recortada).
                    val lidY = when {
                        blinking -> c.r + 3f
                        else -> (-c.r - 4f) + ((-c.r * 0.12f) - (-c.r - 4f)) * half
                    }
                    clipPath(Path().apply { addOval(androidx.compose.ui.geometry.Rect(Offset.Zero, c.r + 0.3f)) }) {
                        translate(0f, lidY) { drawPath(c.lidPath, c.col.lid, alpha = open) }
                    }
                }
            }
            if (c.eye != "ball" && half > 0.02f) {
                drawLine(INK, Offset(-c.r - 2, -c.r * 0.15f), Offset(c.r + 2, -c.r * 0.15f), 2.6f, StrokeCap.Round, alpha = half * open)
            }
        }
        val stroke = Stroke(2.8f, cap = StrokeCap.Round, join = StrokeJoin.Round)
        fun alt(p: Path, a: Float) {
            if (a < 0.02f) return
            withTransform({ scale(0.6f + 0.4f * a, 0.2f + 0.8f * a, Offset.Zero) }) { drawPath(p, INK, alpha = a, style = stroke) }
        }
        alt(arts.closed, m.getValue("closed"))
        alt(arts.happy, m.getValue("happy"))
        alt(if (i == 0) arts.squeezeL else arts.squeezeR, m.getValue("squeeze"))
    }
}

private fun DrawScope.drawMouth(c: Critter, l: Live) {
    withTransform({ translate(c.mouth.x, c.mouth.y); scale(c.mouthS, c.mouthS, Offset.Zero) }) {
        for ((k, a) in l.mouth) {
            if (a < 0.02f) continue
            val art = MOUTHS.getValue(k)
            withTransform({ scale(0.5f + 0.5f * a, 0.5f + 0.5f * a, Offset.Zero) }) {
                when {
                    art.ellipse -> drawOval(Color(0xFF2B1631), Offset(-4.2f, 2f - 5.2f), Size(8.4f, 10.4f), alpha = a)
                    art.fill -> {
                        drawPath(art.path!!, Color(0xFF2B1631), alpha = a)
                        drawPath(art.path, Color(0xFF2B1631), alpha = a, style = Stroke(1.5f, join = StrokeJoin.Round))
                        val big = k == "big"
                        val rx = if (big) 5f else 3.6f; val ry = if (big) 2.8f else 2f; val cy = if (big) 7.6f else 5.8f
                        drawOval(Color(0xFFFF7C98), Offset(-rx, cy - ry), Size(rx * 2, ry * 2), alpha = a)
                    }
                    else -> drawPath(art.path!!, INK, alpha = a, style = Stroke(2.8f, cap = StrokeCap.Round, join = StrokeJoin.Round))
                }
            }
        }
    }
}

private fun DrawScope.drawHand(c: Critter, l: Live, i: Int, arts: Arts) {
    val (x, y, rot, vis) = l.hand[i].let { listOf(it[0], it[1], it[2], it[3]) }
    if (vis < 0.02f) return
    val sc = (0.4f + 0.6f * vis) * c.hand
    withTransform({ translate(x, y); rotate(rot, Offset.Zero); scale(sc * (if (i == 1) -1f else 1f), sc, Offset.Zero) }) {
        // luvinha: sombra, dedão, palma e risquinhos de dedo
        drawOval(Color(0xFF2A1840), Offset(0.5f - 9f, 3.5f - 8f), Size(18f, 16f), alpha = 0.24f * vis)
        withTransform({ rotate(-35f, Offset(-8.4f, 1.5f)) }) {
            drawOval(c.col.top, Offset(-8.4f - 3.6f, 1.5f - 2.8f), Size(7.2f, 5.6f), alpha = vis)
            drawOval(c.col.deep, Offset(-8.4f - 3.6f, 1.5f - 2.8f), Size(7.2f, 5.6f), alpha = vis, style = Stroke(1.5f))
        }
        drawPath(arts.mitten, Brush.verticalGradient(listOf(c.col.mitt, c.col.top), -11f, 8.5f), alpha = vis)
        drawPath(arts.mitten, c.col.deep, alpha = vis, style = Stroke(1.9f, join = StrokeJoin.Round))
        drawPath(arts.fingers, c.col.deep, alpha = 0.7f * vis, style = Stroke(1.2f, cap = StrokeCap.Round))
        drawOval(Color.White, Offset(-2.5f - 2.6f, -5f - 1.4f), Size(5.2f, 2.8f), alpha = 0.35f * vis)
    }
}

private fun DrawScope.drawAccessory(c: Critter, l: Live, arts: Arts, nowMs: Long) {
    val type = c.acc ?: return
    val col = c.col
    val swayDeg = if (c.sway) {
        val period = when (c.id) { "menta" -> 4400f; "coral" -> 3300f; "mel" -> 3000f; else -> 3800f }
        -3f + 7f * (0.5f - 0.5f * cos(2 * PI.toFloat() * (nowMs % period.toLong()) / period))
    } else 0f
    val ax = l.accX
    withTransform({
        translate(c.accAnchor.x, c.accAnchor.y)
        rotate(swayDeg + ax.rot, Offset.Zero)
        translate(ax.tx, ax.ty)
        scale(ax.sx, ax.sy, Offset.Zero)
    }) {
        val p = arts.accs[type]
        when (type) {
            "antenna" -> {
                drawPath(p!![0], col.deep, style = Stroke(3.2f, cap = StrokeCap.Round))
                val glow = 0.12f + 0.2f * (0.5f - 0.5f * cos(2 * PI.toFloat() * (nowMs % 2800) / 2800f))
                drawCircle(Brush.radialGradient(0.3f to Color(0xFFFFD977).copy(alpha = 0.55f), 1f to Color(0x00FFD977), center = Offset(10f, -30f), radius = 13f), 13f, Offset(10f, -30f), alpha = glow * 3f)
                drawCircle(Color(0xFFFFD977), 6f, Offset(10f, -30f))
                drawCircle(Color.White.copy(alpha = 0.9f), 1.8f, Offset(8f, -32f))
            }
            "sprout" -> {
                drawPath(p!![0], col.deep, style = Stroke(2.8f, cap = StrokeCap.Round))
                drawPath(p[1], col.base); drawPath(p[1], col.deep, style = Stroke(1.4f))
                drawPath(p[2], col.top); drawPath(p[2], col.deep, style = Stroke(1.4f))
            }
            "horn" -> {
                drawPath(p!![0], col.top); drawPath(p[0], col.deep, style = Stroke(1.6f, join = StrokeJoin.Round))
                drawPath(p[1], col.deep, alpha = 0.55f, style = Stroke(1.4f, cap = StrokeCap.Round))
                drawPath(p[2], Color.White, alpha = 0.45f, style = Stroke(1.4f, cap = StrokeCap.Round))
            }
            "leaf" -> {
                drawPath(p!![0], col.deep)
                drawPath(p[1], col.base); drawPath(p[1], col.deep, style = Stroke(1.5f))
            }
            "ears" -> for (sd in listOf(-1f, 1f)) {
                withTransform({ translate(sd * 13f, -2f); rotate(sd * 16f, Offset(0f, -10f)) }) {
                    drawOval(col.base, Offset(-8f, -23f), Size(16f, 26f))
                    drawOval(col.deep, Offset(-8f, -23f), Size(16f, 26f), style = Stroke(1.5f))
                    drawOval(col.cheek, Offset(-3.6f, -17f), Size(7.2f, 14f), alpha = 0.7f)
                }
            }
            "bow" -> {
                for (q in p!!) { drawPath(q, col.cheek); drawPath(q, col.deep, style = Stroke(1.5f, join = StrokeJoin.Round)) }
                drawCircle(col.deep, 4.5f, Offset(0f, -10f))
                drawOval(Color.White.copy(alpha = 0.6f), Offset(-1.5f - 1.6f, -11.5f - 1f), Size(3.2f, 2f))
            }
        }
    }
}
