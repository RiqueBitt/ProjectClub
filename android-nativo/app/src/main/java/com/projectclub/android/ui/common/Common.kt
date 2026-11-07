package com.projectclub.android.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.projectclub.android.Config
import com.projectclub.android.data.User
import com.projectclub.android.ui.theme.PC
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Moldura de avatar já lida do JSON salvo no usuário. */
data class AvatarDeco(val url: String, val scale: Float, val x: Float, val y: Float)

private val decoCache = java.util.concurrent.ConcurrentHashMap<String, AvatarDeco>()
private val noDeco = AvatarDeco("", 1f, 0f, 0f)

fun avatarDecorationOf(raw: String?): AvatarDeco? {
    if (raw.isNullOrBlank()) return null
    val d = decoCache.getOrPut(raw) {
        runCatching {
            val o = org.json.JSONObject(raw)
            val url = o.optString("url")
            if (url.isBlank()) noDeco
            else AvatarDeco(url, o.optDouble("s", 1.2).toFloat().coerceIn(1f, 2f), o.optDouble("x", 0.0).toFloat(), o.optDouble("y", 0.0).toFloat())
        }.getOrDefault(noDeco)
    }
    return d.takeIf { it.url.isNotBlank() }
}

/** Quem está online só pelo celular (vem do Repository.mobileUsers no MainActivity). */
val LocalMobileUsers = androidx.compose.runtime.staticCompositionLocalOf<Set<String>> { emptySet() }

/** Avatar redondo (com a bolinha de presença, se [status] vier). */
@Composable
fun Avatar(user: User?, size: Dp = 40.dp, status: String? = null, modifier: Modifier = Modifier, decoration: Boolean = true) {
    Box(modifier.size(size), contentAlignment = Alignment.Center) {
        val url = Config.media(user?.avatarUrl)
        if (url != null) {
            AsyncImage(
                model = url, contentDescription = user?.name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize().clip(CircleShape).background(PC.Surface2),
            )
        } else {
            Box(
                Modifier.fillMaxSize().clip(CircleShape).background(colorFor(user?.id)),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    (user?.name ?: "?").take(1).uppercase(),
                    color = Color.White, fontWeight = FontWeight.Bold, fontSize = (size.value * 0.42f).sp,
                )
            }
        }
        // Moldura da Loja (User.avatarDecoration = JSON {url, s, x, y}): por
        // cima do avatar, maior que ele (s = escala) e deslocada (x/y em %).
        if (decoration) avatarDecorationOf(user?.avatarDecoration)?.let { d ->
            val decoSize = size * d.scale
            AsyncImage(
                model = Config.media(d.url), contentDescription = null,
                imageLoader = com.projectclub.android.ui.store.rememberAnimatedImageLoader(),
                contentScale = ContentScale.Fit,
                modifier = Modifier.requiredSize(decoSize).offset(decoSize * (d.x / 100f), decoSize * (d.y / 100f)),
            )
        }
        if (status != null) {
            val dot = (size.value * 0.32f).dp
            val mobile = status == "ONLINE" && user?.id != null && user.id in LocalMobileUsers.current
            if (mobile) {
                // Online só pelo celular: um celularzinho verde no lugar da bolinha.
                Box(
                    Modifier.size(width = dot * 0.78f, height = dot * 1.15f).align(Alignment.BottomEnd).offset(1.dp, 1.dp)
                        .clip(androidx.compose.foundation.shape.RoundedCornerShape(dot * 0.22f)).background(PC.Bg).padding(2.dp)
                        .clip(androidx.compose.foundation.shape.RoundedCornerShape(dot * 0.16f)).background(PC.presence(status)),
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        Modifier.padding(start = dot * 0.12f, end = dot * 0.12f, top = dot * 0.14f, bottom = dot * 0.26f).fillMaxSize()
                            .clip(androidx.compose.foundation.shape.RoundedCornerShape(1.dp)).background(PC.Bg),
                    )
                }
            } else Box(
                Modifier.size(dot).align(Alignment.BottomEnd).offset(1.dp, 1.dp)
                    .clip(CircleShape).background(PC.presence(status)).border(2.dp, PC.Bg, CircleShape),
            )
        }
    }
}

private val avatarColors = listOf(0xFF5865F2, 0xFF3BA55C, 0xFFFAA61A, 0xFFED4245, 0xFFEB459E, 0xFF4C9FFF).map { Color(it) }
fun colorFor(id: String?): Color = avatarColors[((id?.hashCode() ?: 0) and 0x7fffffff) % avatarColors.size]

private val zone: ZoneId = ZoneId.systemDefault()
private val hourFmt = DateTimeFormatter.ofPattern("HH:mm", Locale("pt", "BR"))
private val dayFmt = DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm", Locale("pt", "BR"))

fun instantOf(iso: String?): Instant? = iso?.let { runCatching { Instant.parse(it) }.getOrNull() }

/** "hoje às 14:03", "ontem às 09:10", "12/10/2026 18:00". */
fun formatTime(iso: String?): String {
    val t = instantOf(iso)?.atZone(zone) ?: return ""
    val today = LocalDate.now(zone)
    return when (t.toLocalDate()) {
        today -> "hoje às ${t.format(hourFmt)}"
        today.minusDays(1) -> "ontem às ${t.format(hourFmt)}"
        else -> t.format(dayFmt)
    }
}

/** Horário curto pra listas (14:03 hoje; 12/10 em outros dias). */
fun shortTime(iso: String?): String {
    val t = instantOf(iso)?.atZone(zone) ?: return ""
    return if (t.toLocalDate() == LocalDate.now(zone)) t.format(hourFmt)
    else t.format(DateTimeFormatter.ofPattern("dd/MM", Locale("pt", "BR")))
}

private val tokenRe = Regex("""(https?://[^\s<>]+)|(<#([A-Za-z0-9_-]{1,64})>)|(@[A-Za-z0-9_.]{2,32})|(\*\*([^*]+)\*\*)|(:([A-Za-z0-9_]{2,32}):)""")

/**
 * Texto da mensagem com links clicáveis, menções (@nome) destacadas,
 * menção de canal (<#id> → #nome) e **negrito**.
 */
fun richText(text: String, myUsername: String?, emojis: Set<String> = emptySet(), channelName: (String) -> String?): AnnotatedString = buildAnnotatedString {
    var last = 0
    for (m in tokenRe.findAll(text)) {
        append(text.substring(last, m.range.first))
        when {
            m.groups[1] != null -> {
                val url = m.value.trimEnd('.', ',', ')', '!', '?')
                withLink(LinkAnnotation.Url(url, TextLinkStyles(SpanStyle(color = PC.Brand, textDecoration = TextDecoration.Underline)))) { append(url) }
                append(m.value.substring(url.length))
            }
            m.groups[2] != null -> withStyle(SpanStyle(color = PC.Brand, background = PC.Mention, fontWeight = FontWeight.SemiBold)) {
                append("#" + (channelName(m.groups[3]!!.value) ?: "canal"))
            }
            m.groups[4] != null -> {
                val mine = myUsername != null && m.value.equals("@$myUsername", ignoreCase = true)
                val everyone = m.value == "@everyone" || m.value == "@here"
                withStyle(SpanStyle(color = PC.Brand, background = if (mine || everyone) PC.Mention else Color.Transparent, fontWeight = FontWeight.SemiBold)) { append(m.value) }
            }
            m.groups[5] != null -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(m.groups[6]!!.value) }
            // Emoji da comunidade (:nome:) vira imagem no meio do texto.
            m.groups[7] != null -> {
                val name = m.groups[8]!!.value
                if (name in emojis) appendInlineContent("emoji:$name", m.value) else append(m.value)
            }
        }
        last = m.range.last + 1
    }
    append(text.substring(last))
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(text.uppercase(), style = MaterialTheme.typography.labelSmall, color = PC.Muted, modifier = modifier)
}
