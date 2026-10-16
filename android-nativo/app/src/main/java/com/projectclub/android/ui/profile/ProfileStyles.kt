package com.projectclub.android.ui.profile

import android.content.Context
import android.graphics.Typeface
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

private fun grayDark(): ColorFilter {
    val m = ColorMatrix().apply { setToSaturation(0.35f) }
    return ColorFilter.colorMatrix(m)
}

val PROFILE_STYLE_NAMES = mapOf(
    "win2000" to "Windows 2000", "anime" to "Anime", "terror" to "Terror", "bugado" to "Bugado", "nostalgia" to "Nostalgia",
)

fun profileStyleOf(key: String?): PStyle? = when (key) {
    "win2000" -> PStyle(
        key = "win2000",
        bg = Brush.verticalGradient(listOf(Color(0xFFD4D0C8), Color(0xFFD4D0C8))), base = Color(0xFFD4D0C8),
        panel = Color.White, panelBorder = Color(0xFF808080),
        header = Color.Black, text = Color.Black, muted = Color(0xFF3B3B3B), accent = Color(0xFF0A246A),
        button = Brush.verticalGradient(listOf(Color(0xFFE4E1DA), Color(0xFFD4D0C8))), buttonText = Color.Black, buttonBorder = Color(0xFF404040),
        corner = 0.dp, buttonCorner = 0.dp, nameFont = FontFamily.SansSerif, bodyFont = FontFamily.SansSerif,
    )
    "anime" -> PStyle(
        key = "anime",
        bg = Brush.linearGradient(listOf(Color(0xFFFFD1E8), Color(0xFFE3D4FF), Color(0xFFCFEEFF))), base = Color(0xFFF2DDF4),
        panel = Color(0x9EFFFFFF), panelBorder = Color(0xFFFFB3D6),
        header = Color(0xFF3A1650), text = Color(0xFF4A2A5E), muted = Color(0xFF8A6AA0), accent = Color(0xFFFF5FA8),
        button = Brush.horizontalGradient(listOf(Color(0xFFFF6FB1), Color(0xFFB07CFF))), buttonText = Color.White, buttonBorder = Color.White,
        corner = 20.dp, buttonCorner = 50.dp, nameFont = FontFamily.SansSerif, bodyFont = FontFamily.SansSerif,
        nameShadow = Shadow(Color(0xAAFF5FA8), Offset(0f, 0f), 14f),
    )
    "terror" -> PStyle(
        key = "terror",
        bg = Brush.verticalGradient(listOf(Color(0xFF3A0000), Color(0xFF0A0202), Color(0xFF070303))), base = Color(0xFF070303),
        panel = Color(0xB8140000), panelBorder = Color(0xFF5A0A0A),
        header = Color(0xFFE01B2F), text = Color(0xFFD9C9C9), muted = Color(0xFF8F7373), accent = Color(0xFFB3001B),
        button = Brush.verticalGradient(listOf(Color(0xFF2A0000), Color(0xFF120000))), buttonText = Color(0xFFFF3B3B), buttonBorder = Color(0xFF8A0000),
        corner = 4.dp, buttonCorner = 3.dp, nameFont = FontFamily.Serif, bodyFont = FontFamily.Serif,
        nameShadow = Shadow(Color(0xB3E01B2F), Offset(0f, 0f), 12f), bannerFilter = grayDark(),
    )
    "bugado" -> PStyle(
        key = "bugado",
        bg = Brush.verticalGradient(listOf(Color(0xFF05060F), Color(0xFF0B0B1D), Color(0xFF050510))), base = Color(0xFF05060F),
        panel = Color(0x0D00FFF0), panelBorder = Color(0xFF00FFF0),
        header = Color.White, text = Color(0xFFC8FFF4), muted = Color(0xFF6FB6C9), accent = Color(0xFF00FFF0),
        button = Brush.verticalGradient(listOf(Color(0xFF05060F), Color(0xFF05060F))), buttonText = Color(0xFF00FFF0), buttonBorder = Color(0xFF00FFF0),
        corner = 0.dp, buttonCorner = 0.dp, nameFont = FontFamily.Monospace, bodyFont = FontFamily.Monospace,
        nameShadow = Shadow(Color(0xFFFF004C), Offset(4f, 0f), 0f),
    )
    "nostalgia" -> PStyle(
        key = "nostalgia",
        bg = Brush.radialGradient(listOf(Color(0xFFF6ECD6), Color(0xFFE3CFA6))), base = Color(0xFFF1E4C8),
        panel = Color(0xFFFFFAF0), panelBorder = Color(0xFFD9C39B),
        header = Color(0xFF3A2614), text = Color(0xFF4B3621), muted = Color(0xFF8A6D4C), accent = Color(0xFFA0522D),
        button = Brush.verticalGradient(listOf(Color(0xFFA0623A), Color(0xFF7A4523))), buttonText = Color(0xFFFFF6E3), buttonBorder = Color(0xFF5C3318),
        corner = 3.dp, buttonCorner = 6.dp, nameFont = FontFamily.Cursive, bodyFont = FontFamily.Serif,
        bannerFilter = sepia(0.85f),
    )
    else -> null
}

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

/** Barra de título azul do Windows 2000 (só nesse estilo). */
@Composable
fun StyleTitleBar(s: PStyle, title: String = "Propriedades do perfil") {
    if (s.key != "win2000") return
    Row(
        Modifier.fillMaxWidth().height(24.dp).background(Brush.horizontalGradient(listOf(Color(0xFF0A246A), Color(0xFFA6CAF0)))).padding(horizontal = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 12.sp, modifier = Modifier.weight(1f))
        repeat(3) { Box(Modifier.padding(start = 2.dp).size(16.dp, 14.dp).background(Color(0xFFD4D0C8)).border(1.dp, Color(0xFF404040))) }
    }
}

/** Enfeites por cima (scanlines do bugado, vinheta do terror, brilhos do anime...). */
@Composable
fun StyleOverlay(s: PStyle, modifier: Modifier = Modifier) {
    when (s.key) {
        "bugado" -> Canvas(modifier.fillMaxSize()) {
            var y = 0f
            while (y < size.height) { drawRect(Color(0x38000000), Offset(0f, y), androidx.compose.ui.geometry.Size(size.width, 1.5f)); y += 4f }
            drawRect(Color(0x22FF004C), Offset(0f, 0f), androidx.compose.ui.geometry.Size(3f, size.height))
            drawRect(Color(0x2200FFF0), Offset(size.width - 3f, 0f), androidx.compose.ui.geometry.Size(3f, size.height))
        }
        "terror" -> Box(modifier.fillMaxSize().background(Brush.radialGradient(listOf(Color.Transparent, Color(0xB0000000)), radius = 1400f)))
        "nostalgia" -> Box(modifier.fillMaxSize().background(Brush.radialGradient(listOf(Color.Transparent, Color(0x47583C14)), radius = 1400f)))
        "anime" -> Canvas(modifier.fillMaxSize()) {
            val pts = listOf(0.12f to 0.18f, 0.78f to 0.3f, 0.4f to 0.7f, 0.88f to 0.82f, 0.25f to 0.52f, 0.6f to 0.12f)
            pts.forEach { (x, y) -> drawCircle(Color(0xE6FFFFFF), 3.5f, Offset(size.width * x, size.height * y)) }
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
