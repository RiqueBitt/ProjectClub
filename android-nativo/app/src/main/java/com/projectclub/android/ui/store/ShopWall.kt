package com.projectclub.android.ui.store

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.imageResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.projectclub.android.R
import com.projectclub.android.data.User
import kotlin.math.roundToInt

/*
 * A parede da Loja, igual à do site (LojaPage.jsx + shop-store.css):
 * painel perfurado de madeira, cartelas verdes e cada item numa caixinha de
 * plástico pendurada num gancho cromado, com a faixa da raridade no topo.
 *
 * As imagens são os mesmos renders do Blender que o site usa quando não tem
 * WebGL (client/public/loja/parede → res/drawable-nodpi/loja_*): painel,
 * caixinha (cinza, tingida com a cor do item), gancho e a sombra. As medidas
 * são as do "quadro" do render (264 x 357,6), em proporção — então a caixinha
 * fica certa em qualquer largura de tela.
 */

// ---------- cores e raridade (as mesmas regras do site) ----------

private val PACK_TINTS = listOf(0xFF35D05A, 0xFFFF5FA8, 0xFF7D6BFF, 0xFFFFB02E, 0xFF31C7EE, 0xFFFF6A55).map { Color(it) }
private val SHOP_COLORS = mapOf(
    "roxo" to 0xFF8B5CF6, "azul" to 0xFF3B82F6, "verde" to 0xFF22C55E, "amarelo" to 0xFFEAB308,
    "laranja" to 0xFFF97316, "vermelho" to 0xFFEF4444, "rosa" to 0xFFEC4899,
)

internal data class PackLook(val tint: Color, val tilt: Float)

/** Cor da caixinha e o quanto ela pende: o mesmo hash do site (`kind:id`). */
internal fun packLook(item: ShopItem): PackLook {
    var h = 0L
    for (ch in "${item.kind.key}:${item.id}") h = (h * 31 + ch.code) and 0xFFFFFFFFL
    val tint = SHOP_COLORS[item.color]?.let { Color(it) } ?: PACK_TINTS[(h % PACK_TINTS.size).toInt()]
    val tilt = ((((h ushr 3) % 5) - 2) * 0.6).toFloat()
    return PackLook(tint, tilt)
}

internal val RARITY_LABEL = mapOf(
    "COMUM" to "Comum", "INCOMUM" to "Incomum", "RARA" to "Rara", "EPICA" to "Épica", "LENDARIA" to "Lendária", "MITICA" to "Mítica",
)

/** A raridade escolhida pela staff ou, sem escolha, pelo preço (igual ao rarityOf do site). */
internal fun rarityOf(item: ShopItem): String {
    item.rarity?.takeIf { it in RARITY_LABEL }?.let { return it }
    if (item.exclusiveTier == "SUPER") return "MITICA"
    val v = item.coins ?: item.gems?.let { it * 100 } ?: 0
    var r = when { v >= 6000 -> "LENDARIA"; v >= 2500 -> "EPICA"; v >= 1000 -> "RARA"; v >= 400 -> "INCOMUM"; else -> "COMUM" }
    if (item.limited && r in setOf("COMUM", "INCOMUM", "RARA")) r = "EPICA"
    if (item.exclusiveTier == "SUBSCRIBER" && r in setOf("COMUM", "INCOMUM")) r = "RARA"
    return r
}

private class BandLook(val top: Color, val base: Color, val line: Color, val rainbow: Boolean = false)

private fun bandLook(r: String) = when (r) {
    "INCOMUM" -> BandLook(Color(0xFF9DFFB4), Color(0xFF33CC63), Color(0xFF0D4A22))
    "RARA" -> BandLook(Color(0xFFA9DCFF), Color(0xFF3A8DFF), Color(0xFF0F2F6E))
    "EPICA" -> BandLook(Color(0xFFF0C4FF), Color(0xFFA64DFF), Color(0xFF3B0D6B))
    "LENDARIA" -> BandLook(Color(0xFFFFE98A), Color(0xFFFFAD1F), Color(0xFF6B3A00))
    "MITICA" -> BandLook(Color.White, Color(0xFFFF7AD9), Color(0xFF3A1260), rainbow = true)
    else -> BandLook(Color(0xFFF4F6F9), Color(0xFFC3CAD4), Color(0xFF3D4552))
}

private val RAINBOW = listOf(Color(0xFFFF4D6D), Color(0xFFFF9F1C), Color(0xFFFFE347), Color(0xFF3EE07A), Color(0xFF33C3FF), Color(0xFF8A5CFF))

/** Fonte de desenho animado da faixa (Lilita One, OFL — a mesma do site). */
private val LilitaOne = FontFamily(Font(R.font.lilita_one))

/**
 * Faixa da raridade, estilo desenho animado (igual à do site): cor chapada em
 * dois tons, contorno grosso, brilho branco, estrelinhas nas pontas e o nome
 * em branco com contorno e sombra dura. A Mítica é em listras de arco-íris.
 */
@Composable
internal fun RarityBand(rarity: String, modifier: Modifier = Modifier) {
    val b = bandLook(rarity)
    BoxWithConstraints(modifier) {
        val h = maxHeight
        val density = LocalDensity.current
        Canvas(Modifier.fillMaxSize()) {
            val ol = size.height * 0.1f
            val r = size.height * 0.36f
            drawRoundRect(b.line, cornerRadius = CornerRadius(r + ol))
            val ix = ol; val iy = ol; val iw = size.width - ol * 2; val ih = size.height - ol * 2
            val inner = Path().apply { addRoundRect(androidx.compose.ui.geometry.RoundRect(ix, iy, ix + iw, iy + ih, CornerRadius(r))) }
            clipPath(inner) {
                if (b.rainbow) {
                    val sw = iw / RAINBOW.size
                    RAINBOW.forEachIndexed { i, c ->
                        val p = Path().apply {
                            moveTo(ix + i * sw - ih * 0.5f, iy + ih); lineTo(ix + i * sw + ih * 0.5f, iy)
                            lineTo(ix + (i + 1) * sw + ih * 0.5f + 2f, iy); lineTo(ix + (i + 1) * sw - ih * 0.5f + 2f, iy + ih); close()
                        }
                        drawPath(p, c)
                    }
                    drawRect(RAINBOW.first(), Offset(ix - ih, iy), Size(ih * 0.6f, ih))
                    drawRect(RAINBOW.last(), Offset(ix + iw - ih * 0.1f, iy), Size(ih, ih))
                } else {
                    drawRect(b.base, Offset(ix, iy), Size(iw, ih))
                    drawRect(b.top, Offset(ix, iy), Size(iw, ih * 0.5f))
                }
                drawRect(Color.Black.copy(alpha = 0.16f), Offset(ix, iy + ih * 0.78f), Size(iw, ih * 0.22f))
                drawRoundRect(Color.White.copy(alpha = 0.75f), Offset(ix + ih * 0.55f, iy + ih * 0.1f), Size(iw - ih * 1.1f, ih * 0.16f), CornerRadius(ih * 0.08f))
            }
            // estrelinhas nas pontas
            for (x in listOf(ix + ih * 0.52f, ix + iw - ih * 0.52f)) {
                val star = Path()
                val big = ih * 0.3f
                for (i in 0 until 10) {
                    val rr = if (i % 2 == 1) big * 0.45f else big
                    val a = -Math.PI / 2 + i * Math.PI / 5
                    val px = x + (Math.cos(a) * rr).toFloat(); val py = size.height / 2 + (Math.sin(a) * rr).toFloat()
                    if (i == 0) star.moveTo(px, py) else star.lineTo(px, py)
                }
                star.close()
                drawPath(star, b.line, style = Stroke(ol * 0.55f, join = StrokeJoin.Round))
                drawPath(star, Color(0xFFFFF36B))
            }
        }
        // o nome: branco, com contorno (sombra em volta) e sombra dura embaixo
        val fs = with(density) { (h * 0.5f).toSp() }
        val label = (RARITY_LABEL[rarity] ?: rarity).uppercase()
        val style = TextStyle(fontFamily = LilitaOne, fontSize = fs, letterSpacing = 0.04.em, textAlign = TextAlign.Center)
        Box(Modifier.fillMaxSize().padding(horizontal = h * 0.9f), contentAlignment = Alignment.Center) {
            Text(label, style = style.copy(color = b.line), maxLines = 1, modifier = Modifier.offset(x = h * 0.03f, y = h * 0.08f))
            for ((dx, dy) in listOf(-1 to 0, 1 to 0, 0 to -1, 0 to 1, -1 to -1, 1 to 1, -1 to 1, 1 to -1)) {
                Text(label, style = style.copy(color = b.line), maxLines = 1, modifier = Modifier.offset(x = h * 0.05f * dx, y = h * 0.05f * dy))
            }
            Text(label, style = style.copy(color = Color.White), maxLines = 1)
        }
    }
}

// ---------- a caixinha ----------

/** Plástico cinza do render tingido com a cor do item (o "luminosity" do site). */
private fun plasticFilter(tint: Color): ColorFilter {
    val c = Color(
        red = tint.red * 0.46f + 0.933f * 0.54f, green = tint.green * 0.46f + 0.953f * 0.54f, blue = tint.blue * 0.46f + 0.973f * 0.54f,
    )
    val k = 1.18f
    val lr = 0.299f * k; val lg = 0.587f * k; val lb = 0.114f * k
    return ColorFilter.colorMatrix(
        ColorMatrix(
            floatArrayOf(
                lr * c.red, lg * c.red, lb * c.red, 0f, 0f,
                lr * c.green, lg * c.green, lb * c.green, 0f, 0f,
                lr * c.blue, lg * c.blue, lb * c.blue, 0f, 0f,
                0f, 0f, 0f, 1f, 0f,
            ),
        ),
    )
}

/**
 * A caixinha no tamanho [sw] (largura do quadro do render). [hook] desenha o
 * gancho; [swing] faz ela balançar um pouco ao aparecer, em volta do furo da aba.
 */
@Composable
internal fun PackArt(
    item: ShopItem, me: User?, sw: Dp, modifier: Modifier = Modifier,
    hook: Boolean = true, swing: Boolean = true, pressed: Boolean = false,
) {
    val look = packLook(item)
    val rot = remember(item.id) { Animatable(if (swing) look.tilt + 5f else look.tilt) }
    LaunchedEffect(item.id) { rot.animateTo(look.tilt, spring(dampingRatio = 0.22f, stiffness = 40f)) }
    val scale by animateFloatAsState(if (pressed) 0.975f else 1f, label = "aperta")
    val sh = sw * (357.6f / 264f)
    Box(modifier.size(sw, sh)) {
        Box(
            Modifier.fillMaxSize().graphicsLayer {
                rotationZ = rot.value; scaleX = scale; scaleY = scale
                transformOrigin = TransformOrigin(0.45341f, 0.2354f)
            },
        ) {
            // sombra que a caixinha faz na cartela
            Image(painterResource(R.drawable.loja_sombra), null, Modifier.fillMaxSize().graphicsLayer { alpha = 0.92f }, contentScale = ContentScale.FillBounds)
            // FUNDO: o item dentro da caixinha
            Box(
                Modifier.offset(x = sw * 0.10606f, y = sh * 0.30643f).size(sw * 0.69697f, sh * 0.59301f)
                    .clip(RoundedCornerShape(sw * 0.044f))
                    .background(Brush.radialGradient(listOf(mix(look.tint, Color(0xFF0A1410), 0.42f), mix(look.tint, Color(0xFF050A08), 0.14f)))),
                contentAlignment = Alignment.Center,
            ) {
                Box(Modifier.fillMaxSize().padding(end = sw * 0.036f, top = sw * 0.02f), contentAlignment = Alignment.Center) {
                    PackContents(item, me, sw)
                }
                // sombra das paredes do plástico em cima do item
                Box(
                    Modifier.fillMaxSize().drawBehind {
                        drawRect(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.45f), Color.Transparent), endY = size.height * 0.18f))
                        drawRect(Brush.horizontalGradient(listOf(Color.Black.copy(alpha = 0.4f), Color.Transparent), endX = size.width * 0.16f))
                    },
                )
            }
            // o plástico
            Image(painterResource(R.drawable.loja_caixinha), null, Modifier.fillMaxSize(), contentScale = ContentScale.FillBounds, colorFilter = plasticFilter(look.tint))
            // FRENTE: faixa da raridade e selos colados no filme
            Box(Modifier.offset(x = sw * 0.05025f, y = sh * 0.33296f).size(sw * 0.70848f, sh * 0.6028f)) {
                RarityBand(rarityOf(item), Modifier.padding(horizontal = sw * 0.02f).padding(top = sw * 0.012f).fillMaxWidth().height(sw * 0.085f))
                val flag = when {
                    item.soldOut -> "Esgotado" to Color(0xFF6B7280)
                    item.limited && !item.owned -> "Limitado" to Color(0xFFF5B400)
                    item.locked -> "Exclusivo" to Color(0xFF8B5CF6)
                    item.isNew && !item.owned -> "Novo" to Color(0xFFFF3D8B)
                    else -> null
                }
                flag?.let { (t, c) ->
                    Text(
                        t, color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = with(LocalDensity.current) { (sw * 0.052f).toSp() },
                        modifier = Modifier.offset(x = -sw * 0.04f, y = sw * 0.12f).graphicsLayer { rotationZ = -4f }
                            .clip(RoundedCornerShape(sw * 0.02f)).background(c).padding(horizontal = sw * 0.03f, vertical = sw * 0.008f),
                    )
                }
                if (item.owned) {
                    Text(
                        if (item.locked || item.exclusiveTier != null) "LIBERADO" else "COMPRADO",
                        color = if (item.equipped) Color(0xFF4DFF8A) else Color.White,
                        fontFamily = LilitaOne, fontSize = with(LocalDensity.current) { (sw * 0.075f).toSp() }, letterSpacing = 0.08.em,
                        modifier = Modifier.align(Alignment.Center).offset(y = sw * 0.06f).graphicsLayer { rotationZ = -9f }
                            .clip(RoundedCornerShape(sw * 0.02f)).background(Color(0x610A1610))
                            .border(sw * 0.012f, if (item.equipped) Color(0xFF4DFF8A) else Color.White, RoundedCornerShape(sw * 0.02f))
                            .padding(horizontal = sw * 0.04f, vertical = sw * 0.01f),
                    )
                }
            }
        }
        // o gancho fica parado (é ele que segura a caixinha)
        if (hook) Image(painterResource(R.drawable.loja_gancho), null, Modifier.fillMaxSize(), contentScale = ContentScale.FillBounds)
    }
}

private fun mix(a: Color, b: Color, t: Float) = Color(
    red = a.red * t + b.red * (1 - t), green = a.green * t + b.green * (1 - t), blue = a.blue * t + b.blue * (1 - t), alpha = 1f,
)

/** O que vai dentro da caixinha: moldura no avatar, efeito, fonte ou estilo. */
@Composable
private fun PackContents(item: ShopItem, me: User?, sw: Dp) {
    val k = sw / 264.dp
    when (item.kind) {
        Kind.Font -> {
            val f = com.projectclub.android.ui.profile.rememberShopFont(item.fontJson)
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(6.dp)) {
                Text(me?.name ?: "Seu nome", color = Color.White, fontFamily = f, fontSize = (26 * k).sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("Aa Bb Cc 123", color = Color(0xC7FFFFFF), fontFamily = f, fontSize = (15 * k).sp, maxLines = 1)
            }
        }
        else -> ItemPreview(item, me, Modifier.fillMaxSize(), transparent = true, scale = k)
    }
}

// ---------- a parede ----------

private val WOOD_LIGHT = Color(0xFF8A5220)
private val WOOD_DARK = Color(0xFF55300D)
private val CARD_TOP = Color(0xFF0F3D22)
private val CARD_DEEP = Color(0xFF082715)

/** Medidas de uma fileira da parede pra largura [rowWidth] (2 cartelas por fileira). */
internal class WallMetrics(rowWidth: Dp) {
    val side = 10.dp                     // folga do painel até as cartelas
    val gap = 10.dp
    val cardW = (rowWidth - side * 2 - gap) / 2
    val sw = cardW * 1.12f               // quadro do render (a caixinha passa um pouco da cartela)
    val headroom = sw * 0.196f           // o gancho e a aba ficam acima da cartela
    val artH = sw * 1.125f
    val bodyH = 112.dp
    // Altura da fileira e o ladrilho do painel (6 x 6 furos): o ladrilho estica um tiquinho
    // pra caber um número inteiro deles na fileira — assim os furos continuam certinhos de
    // uma fileira pra outra, sem sobrar parede entre elas.
    val rowH = headroom + artH + bodyH + 30.dp
    val tile = rowH / maxOf(1, (rowH / (sw * (252f / 264f))).roundToInt())
}

/** Uma fileira do painel perfurado com até 2 cartelas. [first]/[last] fecham a moldura de madeira. */
@Composable
internal fun WallRow(
    items: List<ShopItem>, me: User?, first: Boolean, last: Boolean,
    onOpen: (ShopItem) -> Unit, card: @Composable (ShopItem, WallMetrics) -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
        val m = WallMetrics(maxWidth)
        val painel = androidx.compose.ui.graphics.ImageBitmap.imageResource(R.drawable.loja_painel)
        val shape = RoundedCornerShape(
            topStart = if (first) 14.dp else 0.dp, topEnd = if (first) 14.dp else 0.dp,
            bottomStart = if (last) 14.dp else 0.dp, bottomEnd = if (last) 14.dp else 0.dp,
        )
        Box(
            Modifier.fillMaxWidth().height(m.rowH).clip(shape).drawBehind {
                // painel: ladrilhos a partir do canto de cima da fileira
                val t = m.tile.toPx().roundToInt().coerceAtLeast(8)
                var y = 0
                while (y < size.height) {
                    var x = 0
                    while (x < size.width) {
                        drawImage(painel, IntOffset.Zero, IntSize(painel.width, painel.height), IntOffset(x, y), IntSize(t, t))
                        x += t
                    }
                    y += t
                }
                drawRect(Brush.radialGradient(listOf(Color(0x33FFE2AA), Color(0x42783800)), center = Offset(size.width * 0.3f, 0f), radius = size.width * 1.3f))
                // moldura de madeira
                val bw = 5.dp.toPx()
                drawRect(WOOD_LIGHT, size = Size(bw, size.height))
                drawRect(Color(0xFF6A3A11), Offset(size.width - bw, 0f), Size(bw, size.height))
                if (first) drawRect(WOOD_LIGHT, size = Size(size.width, bw))
                if (last) drawRect(WOOD_DARK, Offset(0f, size.height - bw), Size(size.width, bw))
                // sombra por dentro da moldura
                drawRect(Brush.horizontalGradient(listOf(Color(0x57461F00), Color.Transparent), startX = bw, endX = bw + 14.dp.toPx()))
                if (first) drawRect(Brush.verticalGradient(listOf(Color(0x57461F00), Color.Transparent), startY = bw, endY = bw + 18.dp.toPx()))
            },
        ) {
            Row(Modifier.padding(start = m.side, end = m.side, top = m.headroom + 8.dp), horizontalArrangement = Arrangement.spacedBy(m.gap)) {
                items.forEach { item -> Box(Modifier.width(m.cardW)) { card(item, m) } }
            }
        }
    }
}

/** A cartela verde com a caixinha pendurada e as informações embaixo. */
@Composable
internal fun PackCard(item: ShopItem, me: User?, m: WallMetrics, onClick: () -> Unit) {
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val shape = RoundedCornerShape(16.dp)
    Box(Modifier.width(m.cardW)) {
        Column(
            Modifier.fillMaxWidth().height(m.artH + m.bodyH)
                .drawBehind {
                    // luz de cima e a sombra que a cartela faz no painel
                    drawRoundRect(Color(0x99381A00), Offset(6.dp.toPx(), 10.dp.toPx()), size, CornerRadius(16.dp.toPx()))
                }
                .clip(shape)
                .background(Brush.verticalGradient(listOf(CARD_TOP, CARD_DEEP)))
                .background(Brush.radialGradient(listOf(Color(0x3846BE69), Color.Transparent), center = Offset.Unspecified))
                .border(if (item.equipped) 1.5.dp else 1.dp, if (item.equipped) Color(0xFF2FD45C) else Color(0x14FFFFFF), shape)
                .clickable(interactionSource = src, indication = null, onClick = onClick),
        ) {
            Spacer(Modifier.height(m.artH))
            Box(Modifier.fillMaxWidth().height(1.dp).background(Color(0x14FFFFFF)))
            Column(Modifier.padding(horizontal = 10.dp, vertical = 9.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    "${item.kind.label.uppercase()} · ${RARITY_LABEL[rarityOf(item)]?.uppercase()}",
                    color = Color(0xFFA8C8B3), fontSize = 9.5.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.04.em, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Text(item.name, color = Color.White, fontSize = 14.5.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(6.dp))
                when {
                    item.owned -> CardButton(if (item.equipped) "Em uso" else "Usar", ghost = item.equipped, onClick = onClick)
                    item.locked -> CardButton("Exclusivo", exclusive = true, onClick = onClick)
                    item.soldOut -> Text("Esgotado — só por troca", color = Color(0xFFA8C8B3), fontSize = 12.sp)
                    else -> Row(verticalAlignment = Alignment.CenterVertically) {
                        Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            item.coins?.let { CurrencyAmount(false, it, iconSize = 15.dp, color = Color.White) }
                            item.gems?.let { CurrencyAmount(true, it, iconSize = 15.dp, color = Color.White) }
                        }
                        CardButton("Comprar", onClick = onClick)
                    }
                }
            }
        }
        // a caixinha pendurada (passa um pouco da cartela, como no site)
        PackArt(
            item, me, m.sw, pressed = pressed,
            modifier = Modifier.offset(x = (m.cardW / 2) - m.sw * 0.432f, y = -m.headroom),
        )
    }
}

@Composable
private fun CardButton(text: String, ghost: Boolean = false, exclusive: Boolean = false, onClick: () -> Unit) {
    val shape = RoundedCornerShape(10.dp)
    Text(
        text, color = if (ghost) Color(0xFFC8F5D6) else Color.White, fontSize = 12.5.sp, fontWeight = FontWeight.Bold, maxLines = 1,
        modifier = Modifier.clip(shape)
            .background(
                when {
                    exclusive -> Brush.linearGradient(listOf(Color(0xFF7C3AED), Color(0xFFDB2777)))
                    ghost -> Brush.linearGradient(listOf(Color(0x1FFFFFFF), Color(0x1FFFFFFF)))
                    else -> Brush.verticalGradient(listOf(Color(0xFF2FD45C), Color(0xFF19A841)))
                },
            )
            .border(1.dp, if (ghost) Color(0x3DFFFFFF) else Color(0x33000000), shape)
            .clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 6.dp),
        style = TextStyle(shadow = if (ghost) null else Shadow(Color(0x55000000), Offset(0f, 1f), 1f)),
    )
}

