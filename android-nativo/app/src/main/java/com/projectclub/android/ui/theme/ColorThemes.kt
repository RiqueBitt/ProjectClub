package com.projectclub.android.ui.theme

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Temas coloridos do Project Club (iguais aos do site, Configurações →
 * Aparência): degradê de fundo + superfícies tingidas + cor de destaque.
 * Salvos na conta (UserSettings.extraPrefs: colorTheme / customTheme) e no
 * aparelho, pra abrir já com a cor certa.
 */
data class ColorTheme(val id: String, val name: String, val colors: List<Long>, val angle: Int, val accent: Long, val mix: Int = 55)

val COLOR_THEMES = listOf(
    ColorTheme("menta", "Verde-menta", listOf(0xFF0F766E, 0xFF134E4A), 160, 0xFF2DD4BF),
    ColorTheme("citrico", "Sorvete cítrico", listOf(0xFFA16207, 0xFF365314), 135, 0xFFFACC15),
    ColorTheme("chuva", "Nuvem de chuva retrô", listOf(0xFF334155, 0xFF1E293B, 0xFF0F172A), 180, 0xFF94A3B8),
    ColorTheme("hanami", "Hanami", listOf(0xFF9D174D, 0xFF4C1D95), 135, 0xFFF9A8D4),
    ColorTheme("nascer", "Nascer do sol", listOf(0xFFC2410C, 0xFF7E22CE), 150, 0xFFFB923C),
    ColorTheme("algodao", "Algodão-doce", listOf(0xFFBE185D, 0xFF1D4ED8), 120, 0xFFF0ABFC),
    ColorTheme("lofi", "LoFi Vibes", listOf(0xFF3730A3, 0xFF7C2D12), 200, 0xFFA5B4FC),
    ColorTheme("deserto", "Cáqui do deserto", listOf(0xFF78716C, 0xFF57534E, 0xFF292524), 170, 0xFFD6D3D1),
    ColorTheme("por-do-sol", "Pôr do sol", listOf(0xFFB91C1C, 0xFFC2410C, 0xFF581C87), 165, 0xFFFDBA74),
    ColorTheme("cromatico", "Brilho cromático", listOf(0xFF0E7490, 0xFF7E22CE, 0xFFBE123C), 135, 0xFF67E8F9),
    ColorTheme("floresta", "Floresta", listOf(0xFF166534, 0xFF14532D, 0xFF052E16), 180, 0xFF4ADE80),
    ColorTheme("lua", "Lua carmesim", listOf(0xFF7F1D1D, 0xFF1C1917), 200, 0xFFF87171),
    ColorTheme("meia-noite", "Azul meia-noite", listOf(0xFF1E3A8A, 0xFF0C0A3E), 180, 0xFF60A5FA),
    ColorTheme("marte", "Marte", listOf(0xFF9A3412, 0xFF431407), 150, 0xFFFB923C),
    ColorTheme("crepusculo", "Crepúsculo", listOf(0xFF6D28D9, 0xFFBE185D, 0xFF0F172A), 170, 0xFFC4B5FD),
    ColorTheme("mar", "Sob o mar", listOf(0xFF0369A1, 0xFF0F766E, 0xFF082F49), 190, 0xFF7DD3FC),
    ColorTheme("tempestade", "Tempestade retrô", listOf(0xFF4338CA, 0xFF0F766E), 135, 0xFFA78BFA),
    ColorTheme("neon", "Noites neon", listOf(0xFFC026D3, 0xFF0891B2, 0xFF1E1B4B), 135, 0xFFE879F9),
    ColorTheme("morango", "Limonada de morango", listOf(0xFFE11D48, 0xFFCA8A04), 135, 0xFFFDA4AF),
    ColorTheme("aurora", "Aurora", listOf(0xFF047857, 0xFF4338CA, 0xFF0F172A), 160, 0xFF6EE7B7),
    ColorTheme("sepia", "Sépia", listOf(0xFF78350F, 0xFF451A03), 180, 0xFFFCD34D),
    ColorTheme("ametista", "Crepúsculo ametista", listOf(0xFF581C87, 0xFF312E81), 150, 0xFFD8B4FE),
)

/** Cores efetivas do app (padrão = preto do Project Club). */
data class Palette(
    val bg: Color, val bar: Color, val surface: Color, val surface2: Color, val surface3: Color,
    val line: Color, val lineStrong: Color, val brand: Color, val brandDark: Color, val brandSoft: Color,
    val mention: Color, val gradient: Brush?,
    /** Faixas de destaque (cartão do Início, banners) nas cores do tema. */
    val hero: Brush? = null, val banner: Brush? = null,
) {
    companion object {
        val Default = Palette(
            bg = Color(0xFF060607), bar = Color(0xFF000000), surface = Color(0xFF0E0F12), surface2 = Color(0xFF16171B),
            surface3 = Color(0xFF1E1F24), line = Color(0xFF1F2026), lineStrong = Color(0xFF2C2E35),
            brand = Color(0xFF4C9FFF), brandDark = Color(0xFF2E7FE0), brandSoft = Color(0x264C9FFF), mention = Color(0x334C9FFF),
            gradient = null,
        )
    }
}

private fun shade(c: Color, keep: Float) = Color(red = (c.red * keep).coerceIn(0f, 1f), green = (c.green * keep).coerceIn(0f, 1f), blue = (c.blue * keep).coerceIn(0f, 1f))

/** Mesma conta do site (utils/extraPrefs.js → themeVars). */
fun paletteOf(t: ColorTheme): Palette {
    val cols = t.colors.map { Color(it) }
    val tone = Color(red = cols.map { it.red }.average().toFloat(), green = cols.map { it.green }.average().toFloat(), blue = cols.map { it.blue }.average().toFloat())
    val mix = t.mix / 100f
    fun k(base: Float) = base * (0.7f + mix * 0.6f)
    val accent = Color(t.accent)
    val grad = Brush.linearGradient(cols.map { shade(it, 0.42f + mix * 0.3f) }.let { if (it.size == 1) it + it else it })
    return Palette(
        bg = shade(tone, k(0.16f)), bar = shade(tone, k(0.12f)), surface = shade(tone, k(0.22f)), surface2 = shade(tone, k(0.27f)),
        surface3 = shade(tone, k(0.34f)), line = shade(tone, k(0.3f)), lineStrong = shade(tone, k(0.45f)),
        brand = accent, brandDark = shade(accent, 0.82f), brandSoft = accent.copy(alpha = 0.15f), mention = accent.copy(alpha = 0.2f),
        gradient = grad,
        hero = Brush.linearGradient(cols.map { shade(it, 0.55f + mix * 0.25f) }.let { if (it.size == 1) it + it else it }),
        banner = Brush.verticalGradient(cols.map { shade(it, 0.7f + mix * 0.2f) }.let { if (it.size == 1) it + it else it }),
    )
}

object ThemeStore {
    private const val FILE = "app_prefs"
    /** Tema escolhido: "none", um id da lista ou "custom". */
    var themeId by mutableStateOf("none")
        private set
    var custom by mutableStateOf(ColorTheme("custom", "Personalizado", listOf(0xFF5B21B6, 0xFF1E3A8A), 135, 0xFF8B5CF6, 55))
        private set
    var palette by mutableStateOf(Palette.Default)
        private set

    fun current(): ColorTheme? = when (themeId) {
        "none" -> null
        "custom" -> custom
        else -> COLOR_THEMES.firstOrNull { it.id == themeId }
    }

    private fun recompute() { palette = current()?.let(::paletteOf) ?: Palette.Default }

    fun init(context: Context) {
        val p = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
        themeId = p.getString("colorTheme", "none") ?: "none"
        val cols = p.getString("customColors", null)?.split(',')?.mapNotNull { it.toLongOrNull() }?.takeIf { it.isNotEmpty() }
        if (cols != null) custom = custom.copy(colors = cols, angle = p.getInt("customAngle", 135), accent = p.getLong("customAccent", 0xFF8B5CF6), mix = p.getInt("customMix", 55))
        recompute()
    }

    private fun save(context: Context) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
            .putString("colorTheme", themeId)
            .putString("customColors", custom.colors.joinToString(","))
            .putInt("customAngle", custom.angle).putLong("customAccent", custom.accent).putInt("customMix", custom.mix)
            .apply()
    }

    fun set(context: Context, id: String) { themeId = id; recompute(); save(context) }
    fun setCustom(context: Context, t: ColorTheme) { custom = t; themeId = "custom"; recompute(); save(context) }

    /** Lê o que veio da conta (extraPrefs). Sem nada lá, mantém o do aparelho. */
    fun applyServer(context: Context, extra: JsonObject?) {
        if (extra == null) return
        if (extra["themeSync"]?.jsonPrimitive?.contentOrNull == "false") return
        val id = extra["colorTheme"]?.jsonPrimitive?.contentOrNull ?: return
        (extra["customTheme"] as? JsonObject)?.let { c ->
            val colors = (c["colors"] as? JsonArray)?.mapNotNull { hexToLong(it.jsonPrimitive.contentOrNull) }
            if (!colors.isNullOrEmpty()) custom = custom.copy(
                colors = colors,
                angle = c["angle"]?.jsonPrimitive?.intOrNull ?: 135,
                accent = hexToLong(c["accent"]?.jsonPrimitive?.contentOrNull) ?: custom.accent,
                mix = c["mix"]?.jsonPrimitive?.intOrNull ?: 55,
            )
        }
        themeId = if (id == "custom" || id == "none" || COLOR_THEMES.any { it.id == id }) id else "none"
        recompute(); save(context)
    }

    /** O que vai pra conta (mesclado nas extraPrefs existentes). */
    fun toServer(extra: JsonObject?): JsonObject {
        val base = extra?.toMutableMap() ?: mutableMapOf()
        base["colorTheme"] = JsonPrimitive(themeId)
        base["customTheme"] = buildJsonObject {
            put("colors", JsonArray(custom.colors.map { JsonPrimitive(longToHex(it)) }))
            put("angle", custom.angle); put("accent", longToHex(custom.accent)); put("mix", custom.mix)
        }
        return JsonObject(base)
    }
}

fun hexToLong(h: String?): Long? {
    val s = h?.removePrefix("#") ?: return null
    if (s.length != 6) return null
    return s.toLongOrNull(16)?.let { 0xFF000000 or it }
}
fun longToHex(v: Long): String = "#%06x".format(v and 0xFFFFFF)
