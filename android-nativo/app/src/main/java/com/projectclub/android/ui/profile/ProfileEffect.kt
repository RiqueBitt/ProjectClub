package com.projectclub.android.ui.profile

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.layout.ContentScale
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.ui.store.rememberAnimatedImageLoader
import kotlinx.coroutines.delay

/** Efeito de perfil (User.profileEffect = JSON {url, d:{s,x,y,o,t}, m:{...}}); no celular vale o "m". */
data class ProfileFx(val url: String, val scale: Float, val x: Float, val y: Float, val opacity: Float, val seconds: Float)

fun profileEffectOf(raw: String?): ProfileFx? {
    if (raw.isNullOrBlank()) return null
    return runCatching {
        val o = org.json.JSONObject(raw)
        val url = o.optString("url").takeIf { it.isNotBlank() } ?: return null
        val c = o.optJSONObject("m") ?: o.optJSONObject("d") ?: org.json.JSONObject()
        ProfileFx(
            url,
            c.optDouble("s", 1.0).toFloat().coerceIn(0.2f, 3f),
            c.optDouble("x", 0.0).toFloat(), c.optDouble("y", 0.0).toFloat(),
            c.optDouble("o", 0.85).toFloat().coerceIn(0f, 1f),
            c.optDouble("t", 4.0).toFloat().coerceIn(1f, 30f),
        )
    }.getOrNull()
}

/**
 * Animação transparente por cima do perfil: aparece ao abrir e depois a
 * cada 30 s, fica visível pela duração definida pela staff e some com fade
 * (igual ao ProfileEffectOverlay do site).
 */
@Composable
fun ProfileEffectOverlay(raw: String?, modifier: Modifier = Modifier) {
    val fx = remember(raw) { profileEffectOf(raw) } ?: return
    var visible by remember { mutableStateOf(false) }
    var run by remember { mutableIntStateOf(0) }
    LaunchedEffect(fx) {
        delay(250)
        while (true) {
            run++; visible = true
            delay((fx.seconds * 1000).toLong())
            visible = false
            delay(30_000)
        }
    }
    val loader = rememberAnimatedImageLoader()
    BoxWithConstraints(modifier.fillMaxSize()) {
        AnimatedVisibility(visible, enter = fadeIn(tween(300)), exit = fadeOut(tween(600)), modifier = Modifier.align(Alignment.Center)) {
            val w = maxWidth * fx.scale
            AsyncImage(
                model = coil.request.ImageRequest.Builder(androidx.compose.ui.platform.LocalContext.current)
                    .data(Config.media(fx.url)).memoryCacheKey("${fx.url}#$run").build(),
                contentDescription = null, imageLoader = loader, contentScale = ContentScale.FillWidth,
                modifier = Modifier.requiredSize(w, maxHeight * fx.scale)
                    .offset(w * (fx.x / 100f), maxHeight * fx.scale * (fx.y / 100f)).alpha(fx.opacity),
            )
        }
    }
}
