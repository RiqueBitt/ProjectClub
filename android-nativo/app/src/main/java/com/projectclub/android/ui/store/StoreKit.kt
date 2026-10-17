package com.projectclub.android.ui.store

import android.content.Context
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Diamond
import androidx.compose.material.icons.outlined.MonetizationOn
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.ImageLoader
import coil.decode.GifDecoder
import coil.decode.ImageDecoderDecoder
import com.projectclub.android.ui.common.instantOf
import com.projectclub.android.ui.theme.PC
import java.text.NumberFormat
import java.util.Locale

/*
 * Peças pequenas usadas pela Loja e pela Economia: moedas/gemas,
 * números no formato brasileiro, contagem regressiva e um ImageLoader
 * que anima GIF/WebP (molduras, efeitos e baús são animados).
 */

/** Cor das moedas e das gemas (iguais às do site). */
val CoinColor = Color(0xFFF0B232)
val GemColor = Color(0xFFB07CFF)

val CoinIcon: ImageVector get() = Icons.Outlined.MonetizationOn
val GemIcon: ImageVector get() = Icons.Outlined.Diamond

private val ptBr: Locale = Locale.forLanguageTag("pt-BR")

/** 12345 -> "12.345". */
fun fmtNum(n: Int?): String = NumberFormat.getIntegerInstance(ptBr).format((n ?: 0).toLong())

/** "2d 4h" / "3h 12min" / "45min" até [iso]; null se já passou. */
fun untilText(iso: String?, now: Long = System.currentTimeMillis()): String? {
    val target = instantOf(iso)?.toEpochMilli() ?: return null
    val ms = target - now
    if (ms <= 0) return null
    val d = ms / 86_400_000L
    val h = (ms % 86_400_000L) / 3_600_000L
    val m = (ms % 3_600_000L) / 60_000L
    return when {
        d > 0 -> "${d}d ${h}h"
        h > 0 -> "${h}h ${m}min"
        else -> "${maxOf(1L, m)}min"
    }
}

/** Valor com ícone de moeda/gema, ex.: (o) 1.200 */
@Composable
fun CurrencyAmount(gems: Boolean, amount: Int?, modifier: Modifier = Modifier, iconSize: Dp = 16.dp, color: Color? = null, bold: Boolean = true) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Icon(if (gems) GemIcon else CoinIcon, if (gems) "Gemas" else "Moedas", tint = if (gems) GemColor else CoinColor, modifier = Modifier.size(iconSize))
        Spacer(Modifier.width(4.dp))
        Text(
            fmtNum(amount), color = color ?: PC.Header, style = MaterialTheme.typography.labelLarge,
            fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal, maxLines = 1,
        )
    }
}

/** Pílula de saldo (topo da Loja e da Economia). */
@Composable
fun BalancePill(gems: Boolean, amount: Int?, modifier: Modifier = Modifier) {
    val c = if (gems) GemColor else CoinColor
    Row(
        modifier.clip(CircleShape).background(Color(0x66000000)).border(1.dp, c.copy(alpha = 0.35f), CircleShape)
            .padding(horizontal = 12.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
    ) {
        CurrencyAmount(gems, amount, iconSize = 18.dp, color = Color.White)
    }
}

private object AnimatedImages {
    @Volatile private var loader: ImageLoader? = null

    fun get(context: Context): ImageLoader = loader ?: synchronized(this) {
        loader ?: ImageLoader.Builder(context.applicationContext)
            .components {
                if (Build.VERSION.SDK_INT >= 28) add(ImageDecoderDecoder.Factory()) else add(GifDecoder.Factory())
            }
            .crossfade(true)
            // Mesmo cache em disco do loader padrão (modo offline: GIFs/avatares salvos aparecem sem internet).
            .diskCache { com.projectclub.android.data.offline.ImageCaches.disk(context.applicationContext) }
            .respectCacheHeaders(false)
            .build()
            .also { loader = it }
    }
}

/** ImageLoader do Coil que anima GIF e WebP animado (um só pro app inteiro). */
@Composable
fun rememberAnimatedImageLoader(): ImageLoader {
    val context = LocalContext.current
    return remember(context) { AnimatedImages.get(context) }
}
