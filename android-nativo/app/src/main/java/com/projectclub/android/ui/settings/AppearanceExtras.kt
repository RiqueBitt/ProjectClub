package com.projectclub.android.ui.settings

import android.widget.Toast
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.toBitmap
import com.projectclub.android.data.Repository
import com.projectclub.android.ui.theme.APP_ICONS
import com.projectclub.android.ui.theme.AppIcons
import com.projectclub.android.ui.theme.COLOR_THEMES
import com.projectclub.android.ui.theme.ColorTheme
import com.projectclub.android.ui.theme.PC
import com.projectclub.android.ui.theme.ThemeStore
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** Temas coloridos (com o personalizado) e ícone do app — Configurações → Aparência. */
@Composable
fun ColorThemePicker(repo: Repository, settings: JsonObject?, onSettings: (JsonObject?) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var editing by remember { mutableStateOf(false) }

    fun push() {
        val extra = settings?.get("extraPrefs") as? JsonObject
        val next = ThemeStore.toServer(extra)
        onSettings(JsonObject((settings ?: JsonObject(emptyMap())) + ("extraPrefs" to next)))
        scope.launch {
            runCatching { repo.api.patch<JsonElement>("/api/users/me/settings", JsonObject(mapOf("extraPrefs" to next))) }
                .onFailure { Toast.makeText(ctx, "Não deu pra salvar o tema na conta.", Toast.LENGTH_SHORT).show() }
        }
    }

    Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Temas coloridos", color = PC.Header, fontWeight = FontWeight.Bold)
        Text("Pinta o app inteiro. Vale também no site e no PC.", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Swatch("Nenhum", Brush.linearGradient(listOf(Color(0xFF1F2937), Color(0xFF111827))), null, ThemeStore.themeId == "none") { ThemeStore.set(ctx, "none"); push() }
            COLOR_THEMES.forEach { t ->
                Swatch(t.name, Brush.linearGradient(t.colors.map { Color(it) }), Color(t.accent), ThemeStore.themeId == t.id) { ThemeStore.set(ctx, t.id); push() }
            }
            val c = ThemeStore.custom
            Swatch("Personalizado", Brush.linearGradient(c.colors.map { Color(it) }.let { if (it.size == 1) it + it else it }), Color(c.accent), ThemeStore.themeId == "custom", edit = true) { editing = true }
        }
    }
    if (editing) CustomThemeDialog(ThemeStore.custom, onDismiss = { editing = false }) { t -> ThemeStore.setCustom(ctx, t); push(); editing = false }
}

@Composable
private fun Swatch(name: String, brush: Brush, accent: Color?, on: Boolean, edit: Boolean = false, onClick: () -> Unit) {
    Column(Modifier.width(78.dp).clickable(onClick = onClick), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier.size(70.dp, 56.dp).clip(RoundedCornerShape(12.dp)).background(brush)
                .border(2.dp, if (on) PC.Brand else Color.Transparent, RoundedCornerShape(12.dp)),
            contentAlignment = Alignment.BottomEnd,
        ) {
            if (edit) Text("✎", color = Color.White, fontSize = 20.sp, modifier = Modifier.align(Alignment.Center))
            if (accent != null) Box(Modifier.padding(6.dp).size(13.dp).clip(CircleShape).background(accent).border(2.dp, Color.White.copy(alpha = .8f), CircleShape))
        }
        Spacer(Modifier.height(4.dp))
        Text(name, color = if (on) PC.Header else PC.Muted, fontSize = 11.sp, maxLines = 2, textAlign = TextAlign.Center, overflow = TextOverflow.Ellipsis)
    }
}

// Cores prontas pra escolher no tema personalizado (sem seletor livre de
// cor no Compose, uma paleta grande resolve bem no celular).
private val PALETTE = listOf(
    0xFF7F1D1D, 0xFFB91C1C, 0xFFEF4444, 0xFFF97316, 0xFFC2410C, 0xFFF59E0B, 0xFFCA8A04, 0xFFFACC15,
    0xFF365314, 0xFF166534, 0xFF22C55E, 0xFF10B981, 0xFF0F766E, 0xFF14B8A6, 0xFF0891B2, 0xFF0369A1,
    0xFF1E3A8A, 0xFF2563EB, 0xFF3B82F6, 0xFF4338CA, 0xFF6D28D9, 0xFF8B5CF6, 0xFFA855F7, 0xFFC026D3,
    0xFFBE185D, 0xFFEC4899, 0xFFF472B6, 0xFF78350F, 0xFF57534E, 0xFF334155, 0xFF0F172A, 0xFFE5E7EB,
)

@Composable
private fun CustomThemeDialog(start: ColorTheme, onDismiss: () -> Unit, onSave: (ColorTheme) -> Unit) {
    var colors by remember { mutableStateOf(start.colors) }
    var accent by remember { mutableStateOf(start.accent) }
    var slot by remember { mutableIntStateOf(0) } // 0..n-1 = cor do degradê, -1 = destaque
    var mix by remember { mutableFloatStateOf(start.mix.toFloat()) }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = PC.Surface2,
        title = { Text("Tema personalizado", color = PC.Header) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.fillMaxWidth().height(70.dp).clip(RoundedCornerShape(12.dp)).background(Brush.linearGradient(colors.map { Color(it) }.let { if (it.size == 1) it + it else it })), contentAlignment = Alignment.BottomEnd) {
                    Box(Modifier.padding(8.dp).size(18.dp).clip(CircleShape).background(Color(accent)))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    colors.forEachIndexed { i, c ->
                        Box(Modifier.size(34.dp).clip(CircleShape).background(Color(c)).border(3.dp, if (slot == i) Color.White else Color.Transparent, CircleShape).clickable { slot = i })
                    }
                    if (colors.size < 5) Text("+", color = PC.Brand, fontSize = 22.sp, modifier = Modifier.clickable { colors = colors + colors.last(); slot = colors.size - 1 }.padding(6.dp))
                    if (colors.size > 1) Text("−", color = PC.Muted, fontSize = 22.sp, modifier = Modifier.clickable { colors = colors.dropLast(1); slot = 0 }.padding(6.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Destaque", color = PC.Muted, fontSize = 12.sp)
                    Box(Modifier.size(30.dp).clip(CircleShape).background(Color(accent)).border(3.dp, if (slot == -1) Color.White else Color.Transparent, CircleShape).clickable { slot = -1 })
                }
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    PALETTE.chunked(8).forEach { row ->
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            row.forEach { c ->
                                Box(Modifier.size(28.dp).clip(RoundedCornerShape(7.dp)).background(Color(c)).clickable {
                                    if (slot == -1) accent = c else colors = colors.toMutableList().also { it[slot.coerceIn(0, it.size - 1)] = c }
                                })
                            }
                        }
                    }
                }
                Text("Intensidade da cor: ${mix.toInt()}%", color = PC.Muted, fontSize = 12.sp)
                Slider(value = mix, onValueChange = { mix = it }, valueRange = 0f..100f, colors = SliderDefaults.colors(thumbColor = PC.Brand, activeTrackColor = PC.Brand))
            }
        },
        confirmButton = { TextButton(onClick = { onSave(start.copy(colors = colors, accent = accent, mix = mix.toInt())) }) { Text("Usar este tema", color = PC.Brand) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancelar", color = PC.Muted) } },
    )
}

@Composable
fun AppIconPicker() {
    val ctx = LocalContext.current
    var current by remember { mutableStateOf(AppIcons.current(ctx)) }
    Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Ícone do app", color = PC.Header, fontWeight = FontWeight.Bold)
        Text("Muda o ícone do Project Club na tela inicial do celular (pode levar alguns segundos pra aparecer).", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            APP_ICONS.forEach { icon ->
                val bmp = remember(icon.id) { ContextCompat.getDrawable(ctx, icon.res)?.toBitmap(144, 144)?.asImageBitmap() }
                val on = current == icon.id
                Column(Modifier.width(70.dp).clickable {
                    if (!on) {
                        AppIcons.set(ctx, icon.id); current = icon.id
                        Toast.makeText(ctx, "Ícone trocado para ${icon.name}.", Toast.LENGTH_SHORT).show()
                    }
                }, horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.size(58.dp).clip(RoundedCornerShape(16.dp)).border(2.dp, if (on) PC.Brand else Color.Transparent, RoundedCornerShape(16.dp)).padding(3.dp)) {
                        if (bmp != null) Image(bmp, icon.name, Modifier.clip(RoundedCornerShape(13.dp)))
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(icon.name, color = if (on) PC.Header else PC.Muted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}
