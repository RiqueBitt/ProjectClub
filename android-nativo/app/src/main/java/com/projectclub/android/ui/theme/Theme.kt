package com.projectclub.android.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.projectclub.android.R

/** Cores do Project Club — as mesmas do tema escuro do site. */
object PC {
    val Bg = Color(0xFF060607)
    val Bar = Color(0xFF000000)
    val Surface = Color(0xFF0E0F12)
    val Surface2 = Color(0xFF16171B)
    val Surface3 = Color(0xFF1E1F24)
    val Line = Color(0xFF1F2026)
    val LineStrong = Color(0xFF2C2E35)
    val Header = Color(0xFFF2F3F5)
    val Text = Color(0xFFDBDEE1)
    val Muted = Color(0xFF8B8E94)
    val Faint = Color(0xFF5C5F66)
    val Brand = Color(0xFF4C9FFF)
    val BrandDark = Color(0xFF2E7FE0)
    val BrandSoft = Color(0x264C9FFF)
    val Green = Color(0xFF23A55A)
    val Yellow = Color(0xFFF0B232)
    val Red = Color(0xFFF23F43)
    val Mention = Color(0x334C9FFF)

    // Cores dos atalhos em destaque (iguais aos do site).
    val Announce = Color(0xFFEF4444)
    val Events = Color(0xFFEAB308)
    val Forum = Color(0xFF3B82F6)
    val Store = Color(0xFF22C55E)
    val Purple = Color(0xFFA46BFF)
    val Pink = Color(0xFFFF4FA3)

    /** Faixa azul dos destaques (banner da comunidade, cartão do Início). */
    val HeroGradient = Brush.linearGradient(listOf(Color(0xFF0B1F45), Color(0xFF173E8C), Color(0xFF2F6BD8)))
    val BannerGradient = Brush.verticalGradient(listOf(Color(0xFF1A3C8F), Color(0xFF2E6BE6), Color(0xFF6AA8FF)))

    fun presence(status: String?): Color = when (status) {
        "ONLINE" -> Green
        "IDLE" -> Yellow
        "DND" -> Red
        else -> Color(0xFF80848E)
    }
}

val Inter = FontFamily(
    Font(R.font.inter_regular, FontWeight.Normal),
    Font(R.font.inter_medium, FontWeight.Medium),
    Font(R.font.inter_semibold, FontWeight.SemiBold),
    Font(R.font.inter_bold, FontWeight.Bold),
    Font(R.font.inter_extrabold, FontWeight.ExtraBold),
)

/** Fonte dos títulos grandes em maiúsculas (login, banners). */
val Display = FontFamily(Font(R.font.bebas_neue, FontWeight.Normal))

private val scheme = darkColorScheme(
    primary = PC.Brand,
    onPrimary = Color.White,
    primaryContainer = PC.BrandDark,
    onPrimaryContainer = Color.White,
    secondary = PC.Brand,
    secondaryContainer = PC.BrandSoft,
    onSecondaryContainer = PC.Brand,
    background = PC.Bg,
    onBackground = PC.Text,
    surface = PC.Bg,
    onSurface = PC.Text,
    surfaceVariant = PC.Surface2,
    onSurfaceVariant = PC.Muted,
    surfaceContainer = PC.Surface,
    surfaceContainerHigh = PC.Surface2,
    surfaceContainerHighest = PC.Surface3,
    surfaceContainerLow = PC.Surface,
    surfaceContainerLowest = PC.Bg,
    outline = PC.LineStrong,
    outlineVariant = PC.Line,
    error = PC.Red,
)

private fun t(size: Int, weight: FontWeight = FontWeight.Normal, line: Int? = null, spacing: Double = 0.0) = TextStyle(
    fontFamily = Inter, fontSize = size.sp, fontWeight = weight,
    lineHeight = (line ?: (size + 6)).sp, letterSpacing = spacing.sp,
)

private val type = Typography(
    displaySmall = TextStyle(fontFamily = Display, fontSize = 52.sp, lineHeight = 50.sp),
    headlineMedium = t(28, FontWeight.ExtraBold, 34, -0.6),
    headlineSmall = t(24, FontWeight.ExtraBold, 30, -0.4),
    titleLarge = t(20, FontWeight.ExtraBold, 26, -0.3),
    titleMedium = t(16, FontWeight.Bold, 22),
    titleSmall = t(14, FontWeight.Bold, 20),
    bodyLarge = t(16, FontWeight.Normal, 23),
    bodyMedium = t(15, FontWeight.Normal, 21),
    bodySmall = t(13, FontWeight.Normal, 18),
    labelLarge = t(15, FontWeight.SemiBold, 20),
    labelMedium = t(13, FontWeight.SemiBold, 18),
    labelSmall = t(11, FontWeight.Bold, 14, 0.6),
)

private val shapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

@Composable
fun ProjectClubTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, typography = type, shapes = shapes, content = content)
}
