package com.projectclub.android.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** Cores do Project Club (mesmas do tema escuro do site). */
object PC {
    val Bg = Color(0xFF111318)
    val Surface = Color(0xFF1A1D24)
    val Surface2 = Color(0xFF22262F)
    val Line = Color(0xFF2B303B)
    val Text = Color(0xFFE8E9EE)
    val Muted = Color(0xFF9AA0AC)
    val Brand = Color(0xFF4C9FFF)
    val BrandDark = Color(0xFF2E7FE0)
    val Green = Color(0xFF23A55A)
    val Yellow = Color(0xFFF0B232)
    val Red = Color(0xFFF23F43)
    val Mention = Color(0x334C9FFF)

    fun presence(status: String?): Color = when (status) {
        "ONLINE" -> Green
        "IDLE" -> Yellow
        "DND" -> Red
        else -> Color(0xFF80848E)
    }
}

private val scheme = darkColorScheme(
    primary = PC.Brand,
    onPrimary = Color.White,
    primaryContainer = PC.BrandDark,
    onPrimaryContainer = Color.White,
    secondary = PC.Brand,
    background = PC.Bg,
    onBackground = PC.Text,
    surface = PC.Bg,
    onSurface = PC.Text,
    surfaceVariant = PC.Surface,
    onSurfaceVariant = PC.Muted,
    surfaceContainer = PC.Surface,
    surfaceContainerHigh = PC.Surface2,
    surfaceContainerHighest = PC.Surface2,
    surfaceContainerLow = PC.Surface,
    outline = PC.Line,
    outlineVariant = PC.Line,
    error = PC.Red,
)

private val type = Typography(
    titleLarge = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.3).sp),
    titleMedium = TextStyle(fontSize = 17.sp, fontWeight = FontWeight.Bold),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontSize = 15.sp, lineHeight = 21.sp),
    labelSmall = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.6.sp),
)

@Composable
fun ProjectClubTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, typography = type, content = content)
}
