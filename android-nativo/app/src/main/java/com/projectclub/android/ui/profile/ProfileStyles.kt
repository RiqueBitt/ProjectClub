package com.projectclub.android.ui.profile

import android.content.Context
import android.graphics.Typeface
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.projectclub.android.Config
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest

/**
 * Estilos de perfil da Loja (User.profileStyle) no app nativo: as mesmas
 * cinco chaves do PC (win2000, anime, terror, bugado, nostalgia), com a
 * paleta, cantos, fontes, botões e enfeites de cada um. Usado no
 * miniperfil, no topo do perfil completo e na prévia da Loja.
 */
data class PStyle(
    val key: String,
    val bg: Brush,
    val base: Color,
    val panel: Color,
    val panelBorder: Color,
    val header: Color,
    val text: Color,
    val muted: Color,
    val accent: Color,
    val button: Brush,
    val buttonText: Color,
    val buttonBorder: Color,
    val corner: Dp,
    val buttonCorner: Dp,
    val nameFont: FontFamily,
    val bodyFont: FontFamily,
    val nameShadow: Shadow? = null,
    val bannerFilter: ColorFilter? = null,
    /** Enfeite por cima: sparkles, petals, snow, bubbles, embers, stars, scan, rain, vignette, grain, fireflies, none. */
    val overlay: String = "none",
    /** Faixa do topo (barra de título/letreiro), quando o estilo tem. */
    val titleBar: String? = null,
    val titleBg: Brush? = null,
    val titleColor: Color = Color.White,
)

private fun sepia(amount: Float): ColorFilter {
    val m = ColorMatrix(
        floatArrayOf(
            1 - 0.607f * amount, 0.769f * amount, 0.189f * amount, 0f, 0f,
            0.349f * amount, 1 - 0.314f * amount, 0.168f * amount, 0f, 0f,
            0.272f * amount, 0.534f * amount, 1 - 0.869f * amount, 0f, 0f,
            0f, 0f, 0f, 1f, 0f,
        ),
    )
    return ColorFilter.colorMatrix(m)
}

    return ColorFilter.colorMatrix(m)
}

private fun c(hex: Long) = Color(hex)
private fun v(vararg hex: Long) = Brush.verticalGradient(hex.map { Color(it) })
private fun h(vararg hex: Long) = Brush.horizontalGradient(hex.map { Color(it) })
private fun sh(hex: Long, blur: Float = 12f, x: Float = 0f, y: Float = 0f) = Shadow(Color(hex), Offset(x, y), blur)
private val SERIF = FontFamily.Serif
private val SANS = FontFamily.SansSerif
private val MONO = FontFamily.Monospace
private val CURSIVE = FontFamily.Cursive

/** Monta um estilo (cores em 0xAARRGGBB). */
private fun ps(
    key: String, bg: Brush, base: Long, panel: Long, panelBorder: Long, header: Long, text: Long, muted: Long, accent: Long,
    button: Brush, buttonText: Long, buttonBorder: Long, corner: Int, buttonCorner: Int,
    nameFont: FontFamily = SANS, bodyFont: FontFamily = SANS, nameShadow: Shadow? = null, bannerFilter: ColorFilter? = null,
    overlay: String = "none", titleBar: String? = null, titleBg: Brush? = null, titleColor: Long = 0xFFFFFFFF,
) = PStyle(
    key, bg, c(base), c(panel), c(panelBorder), c(header), c(text), c(muted), c(accent), button, c(buttonText), c(buttonBorder),
    corner.dp, buttonCorner.dp, nameFont, bodyFont, nameShadow, bannerFilter, overlay, titleBar, titleBg, c(titleColor),
)

private fun saturation(x: Float) = ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(x) })

/** Os 35 estilos (mesmas chaves do PC). */
private val STYLES: Map<String, PStyle> = listOf(
    ps("win2000", v(0xFFD4D0C8, 0xFFD4D0C8), 0xFFD4D0C8, 0xFFFFFFFF, 0xFF808080, 0xFF000000, 0xFF000000, 0xFF404040, 0xFF0A246A,
        v(0xFFE4E1DA, 0xFFD4D0C8), 0xFF000000, 0xFF404040, 0, 0, titleBar = "🖥️  Propriedades do perfil", titleBg = h(0xFF0A246A, 0xFF3A6EA5, 0xFFA6CAF0)),
    ps("anime", Brush.linearGradient(listOf(c(0xFFFFD1E8), c(0xFFE6D6FF), c(0xFFCDEEFF))), 0xFFF5DDF4, 0xB8FFFFFF, 0xFFFFB3D6, 0xFFFF4F9F, 0xFF4A2A5E, 0xFF8A6AA0, 0xFFFF4F9F,
        h(0xFFFF6FB1, 0xFFC56DFF, 0xFF7AB8FF), 0xFFFFFFFF, 0xFFFFFFFF, 22, 50, nameShadow = sh(0xCC8B6DFF, 0f, 4f, 4f), overlay = "petals",
        titleBar = "✧ ･ﾟ: *✧ PERFIL ✧*:･ﾟ✧", titleBg = h(0xFFFF6FB1, 0xFFC56DFF, 0xFF7AB8FF)),
    ps("terror", v(0xFF3A0000, 0xFF0A0202, 0xFF060202), 0xFF060202, 0xD0180000, 0xFF5A0A0A, 0xFFE0122E, 0xFFDCCACA, 0xFF8F7070, 0xFFC1001F,
        v(0xFF3A0000, 0xFF140000), 0xFFFF3B3B, 0xFF8A0000, 3, 2, nameFont = SERIF, bodyFont = SERIF, nameShadow = sh(0xE6FF001E, 16f),
        bannerFilter = saturation(0.3f), overlay = "blood"),
    ps("bugado", v(0xFF05060F, 0xFF0B0B1D, 0xFF050510), 0xFF05060F, 0x1400FFF0, 0xFF00FFF0, 0xFFFFFFFF, 0xFFC8FFF4, 0xFF6FB6C9, 0xFF00FFF0,
        v(0xFF05060F, 0xFF05060F), 0xFF00FFF0, 0xFF00FFF0, 0, 0, nameFont = MONO, bodyFont = MONO, nameShadow = sh(0xFFFF004C, 0f, 4f), overlay = "scan",
        titleBar = "ERR_0x7F · SINAL INSTÁVEL ▓▒░", titleBg = h(0xFF00FFF0, 0xFF00FFF0), titleColor = 0xFF05060F),
    ps("nostalgia", Brush.radialGradient(listOf(c(0xFFF6ECD6), c(0xFFE3CFA6))), 0xFFF1E4C8, 0xFFFFFAF0, 0xFFD9C39B, 0xFF3A2614, 0xFF4B3621, 0xFF8A6D4C, 0xFFA0522D,
        v(0xFFA0623A, 0xFF7A4523), 0xFFFFF6E3, 0xFF5C3318, 3, 6, nameFont = CURSIVE, bodyFont = SERIF, bannerFilter = sepia(0.85f), overlay = "vignette"),
    ps("cyberpunk", v(0xFF1A1420, 0xFF0A0612), 0xFF0A0612, 0x1AFF2A6D, 0xFFFF2A6D, 0xFFFCEE0A, 0xFFE6F7FF, 0xFF8AA4B8, 0xFFFCEE0A,
        v(0xFFFCEE0A, 0xFFFCEE0A), 0xFF0A0612, 0xFF05D9E8, 0, 0, nameShadow = sh(0xFFFF2A6D, 0f, 4f, 4f), overlay = "scan",
        titleBar = "NETRUNNER ID ▸ ONLINE", titleBg = h(0xFFFCEE0A, 0xFFFCEE0A), titleColor = 0xFF0A0612),
    ps("vaporwave", v(0xFF2B0F54, 0xFF6B1D7A, 0xFFFF6EC7), 0xFF4A1668, 0x8C2B0F54, 0xFF01CDFE, 0xFFFFFFFF, 0xFFFFF0FB, 0xFFFFC3EE, 0xFF01CDFE,
        v(0xFFFF71CE, 0xFFB967FF), 0xFFFFFFFF, 0xFFFFFFFF, 0, 0, nameShadow = sh(0xFF01CDFE, 0f, 4f, 4f), overlay = "stars",
        titleBar = "ｖａｐｏｒ.ｅｘｅ  ✕", titleBg = h(0xFFFF71CE, 0xFF01CDFE), titleColor = 0xFF2B0F54),
    ps("pixel", v(0xFF1D1D3A, 0xFF222246), 0xFF1D1D3A, 0xFF000000, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFF8F8F8, 0xFFA8A8C8, 0xFFF8B800,
        v(0xFFE40058, 0xFFE40058), 0xFFFFFFFF, 0xFF000000, 0, 0, nameFont = MONO, bodyFont = MONO, nameShadow = sh(0xFFE40058, 0f, 4f, 4f),
        titleBar = "1UP 000420   ★×07   WORLD 1-1", titleBg = h(0xFF000000, 0xFF000000)),
    ps("oceano", v(0xFF0A4F7A, 0xFF06314F, 0xFF021626), 0xFF06314F, 0x8C06314F, 0x593EE6D0, 0xFFFFFFFF, 0xFFD6F3FF, 0xFF7FB4CC, 0xFF3EE6D0,
        v(0xFF3EE6D0, 0xFF1A9BBD), 0xFF02263B, 0x003EE6D0, 18, 50, nameShadow = sh(0xB33EE6D0, 14f), overlay = "bubbles"),
    ps("floresta", v(0xFF1F3A1F, 0xFF142814, 0xFF0B180B), 0xFF142814, 0xBF142814, 0xFF4F7A3A, 0xFFF6FFE9, 0xFFE3F2D8, 0xFF9CBF8C, 0xFFB6E36B,
        v(0xFF7AA63F, 0xFF4F7A2A), 0xFFF6FFE9, 0xFF2C4A18, 16, 18, nameFont = SERIF, bodyFont = SERIF, nameShadow = sh(0x99F4D35E, 12f), overlay = "fireflies"),
    ps("galaxia", Brush.radialGradient(listOf(c(0xFF3A1A6A), c(0xFF07031A))), 0xFF07031A, 0x99140A32, 0x73B58BFF, 0xFFE8D8FF, 0xFFE8E2FF, 0xFFA49AD0, 0xFFB58BFF,
        h(0xFF7A4DFF, 0xFF2A8CFF), 0xFFFFFFFF, 0x4DFFFFFF, 16, 12, nameShadow = sh(0xCC7A4DFF, 16f), overlay = "stars"),
    ps("sakura", v(0xFFFFF6F9, 0xFFFDE7EF), 0xFFFDEFF4, 0xCCFFFFFF, 0xFFF3C4D3, 0xFF3D222B, 0xFF5A3A45, 0xFFA07A86, 0xFFE8597F,
        v(0xFFE8597F, 0xFFE8597F), 0xFFFFFFFF, 0xFFC43C63, 4, 4, nameFont = SERIF, bodyFont = SERIF, overlay = "petals"),
    ps("inverno", v(0xFFE8F4FF, 0xFFCFE6FB, 0xFFB7D6F3), 0xFFDCEEFD, 0xA6FFFFFF, 0xFFFFFFFF, 0xFF102A43, 0xFF23415C, 0xFF5D7D99, 0xFF2F80ED,
        v(0xFF66B3FF, 0xFF2F80ED), 0xFFFFFFFF, 0xCCFFFFFF, 14, 12, nameShadow = sh(0x662F80ED, 12f), overlay = "snow"),
    ps("lava", v(0xFF1A0A06, 0xFF2A0D05, 0xFF3D1104), 0xFF2A0D05, 0xCC280C04, 0xFF7A2A08, 0xFFFFB300, 0xFFFFE2CC, 0xFFC9907A, 0xFFFF6A00,
        v(0xFFFFB300, 0xFFFF3D00), 0xFF2A0D05, 0xFFA52A00, 8, 8, nameShadow = sh(0xFFFF3D00, 14f), overlay = "embers"),
    ps("realeza", v(0xFF121212, 0xFF0A0A0A), 0xFF0A0A0A, 0xFF141414, 0xFF8A6D1E, 0xFFF6E7B4, 0xFFEFE6CF, 0xFFA8976B, 0xFFD4AF37,
        v(0xFFF6E7B4, 0xFFD4AF37, 0xFFA88520), 0xFF1A1406, 0xFFF6E7B4, 2, 2, nameFont = SERIF, bodyFont = SERIF, nameShadow = sh(0x99D4AF37, 12f)),
    ps("matrix", v(0xFF021208, 0xFF010A03), 0xFF010A03, 0xD9001406, 0xFF00B830, 0xFFD4FFDC, 0xFF9DFFB0, 0xFF3FAE5B, 0xFF00FF46,
        v(0xFF010A03, 0xFF010A03), 0xFF00FF46, 0xFF00FF46, 0, 0, nameFont = MONO, bodyFont = MONO, nameShadow = sh(0xFF00FF46, 12f),
        bannerFilter = saturation(0f), overlay = "rain", titleBar = "root@projectclub:~$ whoami ▌", titleBg = h(0xFF000000, 0xFF000000), titleColor = 0xFF00FF46),
    ps("caderno", v(0xFFFFFEF8, 0xFFFFFEF8), 0xFFFFFEF8, 0xE6FFF9C4, 0xFFE0D27A, 0xFFE53935, 0xFF1C3D7A, 0xFF5A73A3, 0xFFE53935,
        v(0xFFFFFFFF, 0xFFFFFFFF), 0xFF1C3D7A, 0xFF1C3D7A, 2, 14, nameFont = CURSIVE, bodyFont = CURSIVE, overlay = "lines"),
    ps("steampunk", v(0xFF3B2A1A, 0xFF2A1D11), 0xFF2A1D11, 0xFF4A3522, 0xFFC9A24A, 0xFFFFE9BF, 0xFFF1DCB4, 0xFFB8956A, 0xFFC9A24A,
        v(0xFFE6C278, 0xFFC9A24A, 0xFF8C6A2B), 0xFF2A1D11, 0xFF5A3F1A, 6, 50, nameFont = SERIF, bodyFont = SERIF, nameShadow = sh(0x80C9A24A, 10f), bannerFilter = sepia(0.6f)),
    ps("gotico", v(0xFF2A1238, 0xFF120A18, 0xFF0A060E), 0xFF0A060E, 0xCC1E0E28, 0xFF5A2D7A, 0xFFF4ECFF, 0xFFE3D6EE, 0xFF9A86AD, 0xFF9B4DCA,
        v(0xFF5A1F7A, 0xFF3A0F52), 0xFFF4ECFF, 0xFF9B4DCA, 24, 18, nameFont = SERIF, bodyFont = SERIF, nameShadow = sh(0xB39B4DCA, 14f), overlay = "vignette"),
    ps("arcade", v(0xFF2A0B3A, 0xFF0B0B22), 0xFF0B0B22, 0xFF12123A, 0xFFFF00AA, 0xFFE6FDFF, 0xFFE6E6FF, 0xFF8B8BC4, 0xFF00E5FF,
        v(0xFFFF6AD5, 0xFFFF00AA, 0xFFA3006C), 0xFFFFFFFF, 0xFF0B0B22, 6, 50, nameFont = MONO, nameShadow = sh(0xFF00E5FF, 16f), overlay = "scan",
        titleBar = "INSERT COIN ● HI-SCORE 999990", titleBg = h(0xFF000000, 0xFF000000), titleColor = 0xFFFFEB3B),
    ps("sunset", v(0xFFFF7E5F, 0xFFFEB47B, 0xFF7B4397, 0xFF2C1650), 0xFF7B4397, 0x592C1650, 0x59FFFFFF, 0xFFFFFFFF, 0xFFFFF3EA, 0xFFFFD9C4, 0xFFFFCD6B,
        h(0xFFFF5E62, 0xFFFF9966), 0xFFFFFFFF, 0x00FFFFFF, 18, 50, nameFont = CURSIVE, nameShadow = sh(0x99FFCD6B, 16f)),
    ps("candy", v(0xFFFFF0F6, 0xFFFFE1EF), 0xFFFFE8F2, 0xFFFFFFFF, 0xFFFFB6D5, 0xFFFF4FA0, 0xFF7A2E52, 0xFFC06A92, 0xFFFF4FA0,
        h(0xFFFF4FA0, 0xFFFF7CBB), 0xFFFFFFFF, 0xFFFFFFFF, 20, 50, nameFont = CURSIVE, nameShadow = sh(0xFF59C9FF, 0f, 3f, 3f), overlay = "sprinkles"),
    ps("aurora", v(0xFF0B3A3A, 0xFF04121F, 0xFF020A12), 0xFF04121F, 0x9904121F, 0x4D3DFFC0, 0xFF3DFFC0, 0xFFDFF9FF, 0xFF84B5C4, 0xFF3DFFC0,
        h(0xFF3DFFC0, 0xFF3DD5FF, 0xFF8A6BFF), 0xFF04121F, 0x003DFFC0, 16, 12, nameShadow = sh(0x998A6BFF, 16f), overlay = "stars"),
    ps("deserto", v(0xFFF6D8A8, 0xFFEAB676), 0xFFEFC690, 0xD1FFF0D6, 0xFFC98A4B, 0xFF3A200B, 0xFF4A2D14, 0xFF8A5E36, 0xFFC0582B,
        v(0xFFD9733F, 0xFFB04A1F), 0xFFFFF6E8, 0xFF7A2F10, 10, 10, nameFont = SERIF, bannerFilter = sepia(0.35f)),
    ps("halloween", v(0xFF2A0F3D, 0xFF170824, 0xFF0D0516), 0xFF170824, 0xCC2A0F3D, 0xFFFF7518, 0xFFFF7518, 0xFFFFE7CC, 0xFFC49AD6, 0xFFFF7518,
        v(0xFFFFA149, 0xFFFF7518, 0xFFC74F00), 0xFF1A0A00, 0xFF2A0F3D, 12, 20, nameFont = SERIF, nameShadow = sh(0xCCFF7518, 14f), overlay = "bats"),
    ps("natal", v(0xFF0F3D24, 0xFF0A2A18), 0xFF0A2A18, 0x14FFFFFF, 0xFFE53935, 0xFFFFFFFF, 0xFFF4FFF6, 0xFFA8D4B4, 0xFFE53935,
        h(0xFFE53935, 0xFFFFFFFF, 0xFFE53935), 0xFF7A0F0F, 0xFFFFFFFF, 12, 12, nameFont = CURSIVE, nameShadow = sh(0x99FFD54F, 14f), overlay = "snow"),
    ps("lofi", v(0xFF2D2A4A, 0xFF3D3360, 0xFF4B3B6B), 0xFF3D3360, 0x0FFFFFFF, 0x24FFFFFF, 0xFFFFFFFF, 0xFFECE6FF, 0xFFB0A6D6, 0xFFFFB88C,
        v(0xFFFFB88C, 0xFFFFB88C), 0xFF2D2A4A, 0x00FFFFFF, 14, 14, nameFont = CURSIVE, nameShadow = sh(0x80FFB88C, 16f), bannerFilter = saturation(0.75f), overlay = "rain"),
    ps("holografico", Brush.linearGradient(listOf(c(0xFFE8F0FF), c(0xFFFFE5F7), c(0xFFE5FFF6), c(0xFFFFF8DC), c(0xFFE5ECFF))), 0xFFF2EEFF, 0x8CFFFFFF, 0xE6FFFFFF, 0xFF7A5CFF, 0xFF2A2F45, 0xFF6A7092, 0xFF7A5CFF,
        h(0xFFA68BFF, 0xFF6FE3FF, 0xFFFF9BE8, 0xFFFFE08A), 0xFF141830, 0xFFFFFFFF, 18, 14, nameShadow = sh(0x8000C2FF, 12f), overlay = "sparkles"),
    ps("militar", Brush.radialGradient(listOf(c(0xFF5D6B3D), c(0xFF3B4727), c(0xFF2F3A1F))), 0xFF3B4727, 0xD91C2410, 0xFF8A9460, 0xFFF3F7E4, 0xFFE6ECD2, 0xFFAAB48C, 0xFFD4C35A,
        v(0xFFD4C35A, 0xFFD4C35A), 0xFF1C2410, 0xFF1C2410, 2, 2, nameFont = MONO, bodyFont = MONO, nameShadow = sh(0xFF1C2410, 0f, 2f, 2f), bannerFilter = saturation(0.5f),
        titleBar = "ID: OPERADOR · ACESSO CONFIDENCIAL", titleBg = h(0xFFD4C35A, 0xFFD4C35A), titleColor = 0xFF1C2410),
    ps("faroeste", Brush.radialGradient(listOf(c(0xFFF1DCAE), c(0xFFD9B77F))), 0xFFE9CF9C, 0xFFEFDCB5, 0xFF8A5A32, 0xFF2A1708, 0xFF3A220E, 0xFF6E4A2A, 0xFFA33B20,
        v(0xFFA33B20, 0xFF7A2812), 0xFFF6E6C4, 0xFF3A1608, 2, 4, nameFont = SERIF, bodyFont = SERIF, bannerFilter = sepia(0.9f), overlay = "vignette",
        titleBar = "★ PROCURADO ★  RECOMPENSA: $10.000", titleBg = h(0xFFEFDCB5, 0xFFEFDCB5), titleColor = 0xFF2A1708),
    ps("medieval", Brush.radialGradient(listOf(c(0xFFF3E2B8), c(0xFFD9B97A))), 0xFFEBD6A6, 0xB3FFF6DC, 0xFF8C6A30, 0xFF8C1C13, 0xFF3D2A12, 0xFF7A5A30, 0xFF8C1C13,
        Brush.radialGradient(listOf(c(0xFFC0392B), c(0xFF8C1C13), c(0xFF5A0E08))), 0xFFF3E2B8, 0xFF5A0E08, 2, 50, nameFont = SERIF, bodyFont = SERIF, bannerFilter = sepia(0.6f), overlay = "vignette"),
    ps("cafe", v(0xFF5B3A24, 0xFF3E2716), 0xFF3E2716, 0xFF2B2B2B, 0xFF8A6240, 0xFFFFF7EE, 0xFFF3E6D8, 0xFFC4A68A, 0xFFE0B384,
        v(0xFFE0B384, 0xFFE0B384), 0xFF3E2716, 0xFF8A6240, 4, 50, nameFont = CURSIVE, bodyFont = SANS, bannerFilter = sepia(0.4f), overlay = "steam"),
    ps("grafite", v(0xFF6A3226, 0xFF4A241C), 0xFF4A241C, 0x99000000, 0xFFFF2BD6, 0xFF39FF14, 0xFFFFFFFF, 0xFFF0D0C0, 0xFF39FF14,
        v(0xFF39FF14, 0xFF39FF14), 0xFF000000, 0xFF000000, 12, 10, nameFont = CURSIVE, nameShadow = sh(0xFFFF2BD6, 0f, 3f, 3f), overlay = "bricks"),
    ps("marmore", v(0xFFFBFBFA, 0xFFEEEDEA), 0xFFF5F4F1, 0xBFFFFFFF, 0xFFE3E0D9, 0xFF111111, 0xFF2B2B2B, 0xFF8A8780, 0xFFB8955A,
        v(0xFF111111, 0xFF111111), 0xFFFFFFFF, 0xFF111111, 0, 0, nameFont = SERIF, bannerFilter = saturation(0.15f), overlay = "marble"),
    ps("noir", v(0xFF1A1A1A, 0xFF0B0B0B), 0xFF0B0B0B, 0x8C000000, 0xFF3A3A3A, 0xFFFFFFFF, 0xFFE6E6E6, 0xFF9A9A9A, 0xFFE6E6E6,
        v(0xFFE6E6E6, 0xFFE6E6E6), 0xFF0B0B0B, 0xFF0B0B0B, 0, 0, nameFont = SERIF, bodyFont = SERIF, bannerFilter = saturation(0f), overlay = "grain",
        titleBar = "CASO Nº 1947 — ARQUIVO CONFIDENCIAL", titleBg = h(0xFFE6E6E6, 0xFFE6E6E6), titleColor = 0xFF0B0B0B),
).associateBy { it.key }

val PROFILE_STYLE_NAMES = mapOf(
    "win2000" to "Windows 2000", "anime" to "Anime", "terror" to "Terror", "bugado" to "Bugado", "nostalgia" to "Nostalgia",
    "cyberpunk" to "Cyberpunk 2099", "vaporwave" to "Vaporwave", "pixel" to "8-bit", "oceano" to "Oceano Profundo", "floresta" to "Floresta Encantada",
    "galaxia" to "Galáxia", "sakura" to "Sakura", "inverno" to "Inverno", "lava" to "Vulcão", "realeza" to "Realeza", "matrix" to "Matrix",
    "caderno" to "Caderno", "steampunk" to "Steampunk", "gotico" to "Gótico", "arcade" to "Arcade 80", "sunset" to "Pôr do Sol", "candy" to "Doceria",
    "aurora" to "Aurora Boreal", "deserto" to "Deserto", "halloween" to "Halloween", "natal" to "Natal", "lofi" to "Lo-fi Chill",
    "holografico" to "Holográfico", "militar" to "Tático", "faroeste" to "Faroeste", "medieval" to "Pergaminho", "cafe" to "Cafeteria",
    "grafite" to "Grafite", "marmore" to "Mármore", "noir" to "Filme Noir",
)

fun profileStyleOf(key: String?): PStyle? = key?.let { STYLES[it] }

/** Botão no visual do estilo (relevo do Windows, pílula do anime...). */
@Composable
fun StyledButton(s: PStyle, text: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null) {
    val shape = RoundedCornerShape(s.buttonCorner)
    Row(
        modifier.heightIn(min = 46.dp).clip(shape).background(s.button)
            .border(if (s.key == "win2000") 2.dp else 1.dp, s.buttonBorder, shape)
            .clickable(onClick = onClick).padding(horizontal = 18.dp),
        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) { Icon(icon, null, tint = s.buttonText, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)) }
        Text(text, color = s.buttonText, fontFamily = s.bodyFont, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleSmall)
    }
}

/** Faixa do topo (barra de título do Windows, letreiro do arcade, cartaz do faroeste...). */
@Composable
fun StyleTitleBar(s: PStyle, title: String? = null) {
    val text = title ?: s.titleBar ?: return
    Row(
        Modifier.fillMaxWidth().height(24.dp).background(s.titleBg ?: s.button).padding(horizontal = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, color = s.titleColor, fontWeight = FontWeight.Bold, fontSize = 11.sp, fontFamily = if (s.key == "win2000") SANS else s.bodyFont, maxLines = 1, modifier = Modifier.weight(1f))
        if (s.key == "win2000") listOf("_", "□", "✕").forEach {
            Box(Modifier.padding(start = 2.dp).size(16.dp, 14.dp).background(Color(0xFFD4D0C8)).border(1.dp, Color(0xFF404040)), contentAlignment = Alignment.Center) {
                Text(it, color = Color.Black, fontSize = 9.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

/** Enfeites por cima (partículas, chuva, vinheta, grão...), desenhados num Canvas. */
@Composable
fun StyleOverlay(s: PStyle, modifier: Modifier = Modifier) {
    val pts = remember { List(18) { i -> ((i * 37) % 100) / 100f to ((i * 61 + 13) % 100) / 100f } }
    when (s.overlay) {
        "vignette" -> Box(modifier.fillMaxSize().background(Brush.radialGradient(listOf(Color.Transparent, Color(0x55000000)), radius = 1400f)))
        "blood" -> Canvas(modifier.fillMaxSize()) {
            drawRect(Brush.radialGradient(listOf(Color.Transparent, Color(0xB0000000)), center = center, radius = size.maxDimension * 0.7f))
            drawRect(Color(0xFF8A0000), Offset.Zero, androidx.compose.ui.geometry.Size(size.width, 5f))
            listOf(0.07f to 60f, 0.24f to 90f, 0.43f to 36f, 0.61f to 80f, 0.79f to 46f, 0.93f to 70f).forEach { (x, len) ->
                drawRect(Color(0xFF9A0000), Offset(size.width * x, 0f), androidx.compose.ui.geometry.Size(8f, len))
                drawCircle(Color(0xFF9A0000), 7f, Offset(size.width * x + 4f, len))
            }
        }
        "scan" -> Canvas(modifier.fillMaxSize()) {
            var y = 0f
            while (y < size.height) { drawRect(Color(0x30000000), Offset(0f, y), androidx.compose.ui.geometry.Size(size.width, 1.5f)); y += 4f }
            drawRect(s.accent.copy(alpha = 0.18f), Offset(0f, 0f), androidx.compose.ui.geometry.Size(3f, size.height))
        }
        "grain", "bricks", "lines", "marble" -> Canvas(modifier.fillMaxSize()) {
            when (s.overlay) {
                "grain" -> {
                    pts.forEach { (x, y) -> drawCircle(Color(0x30FFFFFF), 1.2f, Offset(size.width * x, size.height * y)) }
                    drawRect(Brush.radialGradient(listOf(Color.Transparent, Color(0xA0000000)), center = center, radius = size.maxDimension * 0.7f))
                }
                "bricks" -> { var y = 0f; var row = 0
                    while (y < size.height) {
                        drawRect(Color(0x33000000), Offset(0f, y), androidx.compose.ui.geometry.Size(size.width, 2f))
                        var x = if (row % 2 == 0) 0f else 48f
                        while (x < size.width) { drawRect(Color(0x33000000), Offset(x, y), androidx.compose.ui.geometry.Size(2f, 24f)); x += 96f }
                        y += 24f; row++
                    } }
                "lines" -> { var y = 23f
                    while (y < size.height) { drawRect(Color(0x55B8D4F0), Offset(0f, y), androidx.compose.ui.geometry.Size(size.width, 1.5f)); y += 24f }
                    drawRect(Color(0x88F28B82), Offset(38f, 0f), androidx.compose.ui.geometry.Size(2f, size.height)) }
                else -> {
                    drawLine(Color(0x26A0A0AA), Offset(0f, size.height * 0.2f), Offset(size.width, size.height * 0.6f), 2f)
                    drawLine(Color(0x33B8955A), Offset(size.width * 0.3f, 0f), Offset(size.width * 0.9f, size.height), 1.5f)
                }
            }
        }
        "none" -> Unit
        else -> {
            // Partículas que se mexem (pétalas, neve, bolhas, brasas, estrelas, vaga-lumes...).
            val t = rememberInfiniteTransition(label = "fx")
            val p by t.animateFloat(0f, 1f, infiniteRepeatable(tween(9000, easing = LinearEasing)), label = "p")
            val (color, radius, dir) = when (s.overlay) {
                "petals" -> Triple(Color(0xCCFFB7D5), 4f, 1f)
                "snow" -> Triple(Color(0xE6FFFFFF), 3f, 1f)
                "rain" -> Triple(s.accent.copy(alpha = 0.35f), 1.5f, 1.6f)
                "bubbles" -> Triple(Color(0x80FFFFFF), 3f, -1f)
                "embers" -> Triple(Color(0xFFFFB300), 2.2f, -1f)
                "fireflies" -> Triple(Color(0xFFF4FF8A), 2.5f, -0.3f)
                "bats" -> Triple(Color(0xFF0D0516), 5f, -0.2f)
                "steam" -> Triple(Color(0x22FFFFFF), 14f, -0.4f)
                "sprinkles" -> Triple(Color(0xFFFF6B9D), 2.5f, 0f)
                else -> Triple(Color(0xE6FFFFFF), 1.6f, 0f) // stars / sparkles
            }
            Canvas(modifier.fillMaxSize()) {
                pts.forEachIndexed { i, (x, y0) ->
                    var y = (y0 + p * dir * (0.6f + (i % 3) * 0.2f)) % 1f
                    if (y < 0) y += 1f
                    val a = if (dir == 0f) (0.4f + 0.6f * kotlin.math.abs(kotlin.math.sin((p * 6.28f) + i))) else 1f
                    if (s.overlay == "rain") drawLine(color, Offset(size.width * x, size.height * y), Offset(size.width * x - 3f, size.height * y + 14f), radius)
                    else drawCircle(color.copy(alpha = color.alpha * a), radius * (0.7f + (i % 3) * 0.25f), Offset(size.width * x + kotlin.math.sin(p * 6.28f + i) * 6f, size.height * y))
                }
            }
        }
    }
}

/** Estilo de texto do nome: fonte da Loja (se tiver) > fonte do estilo. */
fun nameTextStyle(base: TextStyle, s: PStyle?, font: FontFamily?): TextStyle {
    var t = base
    if (s != null) t = t.copy(color = s.header, fontFamily = s.nameFont, shadow = s.nameShadow)
    if (font != null) t = t.copy(fontFamily = font)
    return t
}

// ---------- Fonte do nome comprada na Loja ----------
// User.profileFont = {id, family, url}. O Android só abre .ttf/.otf: a do
// Google Fonts vem como .ttf (o servidor já guarda o link certo); arquivo
// .woff/.woff2 enviado pela staff fica com a fonte padrão aqui.
private val fontCache = mutableMapOf<String, FontFamily?>()

private fun fontUrlOf(raw: String?): Pair<String, String>? = runCatching {
    val o = org.json.JSONObject(raw ?: return null)
    val url = o.optString("url").takeIf { it.isNotBlank() } ?: return null
    if (Regex("\\.(woff2?)($|\\?)", RegexOption.IGNORE_CASE).containsMatchIn(url)) return null
    (o.optString("id").ifBlank { url }) to url
}.getOrNull()

private suspend fun loadFont(ctx: Context, id: String, url: String): FontFamily? = withContext(Dispatchers.IO) {
    runCatching {
        val dir = File(ctx.cacheDir, "shop-fonts").apply { mkdirs() }
        val name = MessageDigest.getInstance("SHA-1").digest((id + url).toByteArray()).joinToString("") { "%02x".format(it) }
        val file = File(dir, "$name.ttf")
        if (!file.exists() || file.length() == 0L) {
            val full = Config.media(url) ?: url
            val conn = java.net.URL(full).openConnection() as java.net.HttpURLConnection
            conn.connectTimeout = 8000; conn.readTimeout = 15000
            conn.inputStream.use { input -> file.outputStream().use { input.copyTo(it) } }
            if (file.length() > 6_000_000) { file.delete(); return@runCatching null }
        }
        FontFamily(Typeface.createFromFile(file))
    }.getOrNull()
}

@Composable
fun rememberShopFont(raw: String?): FontFamily? {
    val ctx = LocalContext.current
    val target = remember(raw) { fontUrlOf(raw) } ?: return null
    var font by remember(target) { mutableStateOf(fontCache[target.first]) }
    LaunchedEffect(target) {
        if (font == null && !fontCache.containsKey(target.first)) {
            val f = loadFont(ctx, target.first, target.second)
            fontCache[target.first] = f
            font = f
        }
    }
    return font
}
