package com.projectclub.android.ui.common

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.projectclub.android.R
import com.projectclub.android.ui.theme.PC

/*
 * Peças visuais do app, desenhadas pra ficar igual ao site do Project Club:
 * cartões escuros com borda fina e cantos bem redondos, botões em pílula,
 * campos com rótulo em maiúsculas e esqueletos animados no carregamento.
 */

/** Cartão padrão (fundo escuro, borda fina, cantos 20). */
@Composable
fun PcCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    shape: Shape = RoundedCornerShape(20.dp),
    background: Brush = SolidColor(PC.Surface),
    border: Color = PC.Line,
    padding: PaddingValues = PaddingValues(16.dp),
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier.clip(shape).background(background).border(1.dp, border, shape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(padding),
        content = content,
    )
}

/** Barra do topo das telas (fundo preto, título com ícone, ações à direita). */
@Composable
fun PcTopBar(
    title: String,
    icon: ImageVector? = null,
    navigation: (@Composable () -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    Column(Modifier.fillMaxWidth().background(PC.Bar).statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (navigation != null) navigation() else Spacer(Modifier.width(8.dp))
            if (icon != null) {
                Icon(icon, null, tint = PC.Muted, modifier = Modifier.size(22.dp))
                Spacer(Modifier.width(10.dp))
            }
            Text(title, style = MaterialTheme.typography.titleMedium, color = PC.Header, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            actions()
        }
        HorizontalDivider(color = PC.Line)
    }
}

/** Botão principal em pílula. [light] = branco com texto preto (como o "Entrar" do site). */
@Composable
fun PillButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    busy: Boolean = false,
    light: Boolean = false,
    color: Color = PC.Brand,
) {
    val bg = when { !enabled -> PC.Surface3; light -> Color.White; else -> color }
    val fg = when { !enabled -> PC.Muted; light -> Color(0xFF0B0B0C); color == PC.Brand -> PC.OnBrand; else -> Color.White }
    Row(
        modifier.heightIn(min = 52.dp).clip(CircleShape).background(bg)
            .clickable(enabled = enabled && !busy, onClick = onClick).padding(horizontal = 22.dp),
        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
    ) {
        if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = fg)
        else {
            if (icon != null) { Icon(icon, null, tint = fg, modifier = Modifier.size(20.dp)); Spacer(Modifier.width(8.dp)) }
            Text(text, color = fg, style = MaterialTheme.typography.titleMedium)
        }
    }
}

/** Botão secundário (contorno). */
@Composable
fun GhostButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null, color: Color = PC.Text) {
    Row(
        modifier.heightIn(min = 44.dp).clip(CircleShape).border(BorderStroke(1.dp, PC.LineStrong), CircleShape)
            .clickable(onClick = onClick).padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) { Icon(icon, null, tint = color, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)) }
        Text(text, color = color, style = MaterialTheme.typography.labelLarge)
    }
}

/** Campo de texto do jeito do site: rótulo em maiúsculas em cima, ícone à esquerda. */
@Composable
fun PcField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    label: String? = null,
    icon: ImageVector? = null,
    trailing: (@Composable () -> Unit)? = null,
    enabled: Boolean = true,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    singleLine: Boolean = true,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    Column(modifier) {
        if (label != null) {
            Text(label.uppercase(), style = MaterialTheme.typography.labelMedium.copy(letterSpacing = MaterialTheme.typography.labelSmall.letterSpacing), color = PC.Text)
            Spacer(Modifier.height(8.dp))
        }
        val shape = RoundedCornerShape(18.dp)
        Row(
            Modifier.fillMaxWidth().heightIn(min = 56.dp).clip(shape).background(PC.Surface)
                .border(if (focused) 1.5.dp else 1.dp, if (focused) PC.Brand else PC.LineStrong, shape)
                .padding(start = 16.dp, end = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (icon != null) { Icon(icon, null, tint = if (focused) PC.Text else PC.Muted, modifier = Modifier.size(20.dp)); Spacer(Modifier.width(12.dp)) }
            BasicTextField(
                value = value, onValueChange = onValueChange, enabled = enabled, singleLine = singleLine,
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = PC.Header),
                cursorBrush = SolidColor(PC.Brand), visualTransformation = visualTransformation,
                keyboardOptions = keyboardOptions, keyboardActions = keyboardActions, interactionSource = interaction,
                modifier = Modifier.weight(1f).padding(vertical = 14.dp),
                decorationBox = { inner ->
                    Box {
                        if (value.isEmpty()) Text(placeholder, style = MaterialTheme.typography.bodyLarge, color = PC.Faint)
                        inner()
                    }
                },
            )
            if (trailing != null) trailing() else Spacer(Modifier.width(10.dp))
        }
    }
}

/** Bolinha vermelha com número (não lidas). */
@Composable
fun CountBadge(count: Int, modifier: Modifier = Modifier, color: Color = PC.Red) {
    if (count <= 0) return
    Box(modifier.heightIn(min = 20.dp).clip(CircleShape).background(color).padding(horizontal = 6.dp), contentAlignment = Alignment.Center) {
        Text(if (count > 99) "99+" else count.toString(), color = Color.White, style = MaterialTheme.typography.labelSmall.copy(letterSpacing = MaterialTheme.typography.bodySmall.letterSpacing))
    }
}

/** Selo pequeno (ex.: "Ao vivo", "Ativo"). */
@Composable
fun Chip(text: String, color: Color, modifier: Modifier = Modifier, dot: Boolean = false) {
    Row(
        modifier.clip(CircleShape).background(color.copy(alpha = 0.16f)).padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (dot) { Box(Modifier.size(7.dp).clip(CircleShape).background(color)); Spacer(Modifier.width(6.dp)) }
        Text(text, color = color, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
    }
}

/** Quadradinho colorido com ícone (atalhos, menus). */
@Composable
fun IconTile(icon: ImageVector, color: Color, size: Dp = 40.dp, iconSize: Dp = 22.dp) {
    Box(Modifier.size(size).clip(RoundedCornerShape(size * 0.32f)).background(color.copy(alpha = 0.16f)), contentAlignment = Alignment.Center) {
        Icon(icon, null, tint = color, modifier = Modifier.size(iconSize))
    }
}

/** Logo do Project Club. */
@Composable
fun PcLogo(size: Dp, modifier: Modifier = Modifier) {
    Image(painterResource(R.drawable.logo_pc), contentDescription = "Project Club", modifier = modifier.size(size))
}

/** Tela de carregamento do app (igual à do site: logo, círculo girando e "Carregando..."). */
@Composable
fun LoadingScreen(text: String = "Carregando...") {
    val pulse = rememberInfiniteTransition(label = "pulse")
    val s by pulse.animateFloat(0.94f, 1.04f, infiniteRepeatable(tween(900, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "s")
    Column(
        Modifier.fillMaxSize().background(PC.Bg),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
    ) {
        PcLogo(84.dp, Modifier.scale(s))
        Spacer(Modifier.height(28.dp))
        CircularProgressIndicator(Modifier.size(30.dp), strokeWidth = 3.dp, color = PC.Brand, trackColor = PC.Surface3)
        Spacer(Modifier.height(16.dp))
        Text(text, color = PC.Muted, style = MaterialTheme.typography.bodyMedium)
    }
}

/** Brilho que passa pelos esqueletos de carregamento. */
@Composable
fun rememberShimmer(): Brush {
    val tr = rememberInfiniteTransition(label = "shimmer")
    val x by tr.animateFloat(-400f, 1400f, infiniteRepeatable(tween(1300, easing = LinearEasing)), label = "x")
    return Brush.linearGradient(
        listOf(PC.Surface2, PC.Surface3, PC.Surface2),
        start = androidx.compose.ui.geometry.Offset(x, 0f),
        end = androidx.compose.ui.geometry.Offset(x + 400f, 120f),
    )
}

/** Pedaço de esqueleto (retângulo arredondado que brilha). */
@Composable
fun Bone(brush: Brush, modifier: Modifier, shape: Shape = RoundedCornerShape(8.dp)) {
    Box(modifier.clip(shape).background(brush))
}

/** Esqueleto de lista (avatar + duas linhas), usado enquanto as conversas/mensagens chegam. */
@Composable
fun ListSkeleton(rows: Int = 7, avatar: Dp = 44.dp, modifier: Modifier = Modifier) {
    val b = rememberShimmer()
    Column(modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        repeat(rows) { i ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.alpha(1f - i * 0.09f)) {
                Bone(b, Modifier.size(avatar), CircleShape)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Bone(b, Modifier.fillMaxWidth(0.35f + (i % 3) * 0.12f).height(13.dp))
                    Bone(b, Modifier.fillMaxWidth(0.55f + (i % 2) * 0.25f).height(11.dp))
                }
            }
        }
    }
}

/** Mensagem curta no meio da tela (lista vazia, erro…), com ícone grande. */
@Composable
fun EmptyState(icon: ImageVector, title: String, text: String, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    Column(modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(72.dp).clip(CircleShape).background(PC.Surface2), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = PC.Muted, modifier = Modifier.size(34.dp))
        }
        Spacer(Modifier.height(16.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, color = PC.Header)
        Spacer(Modifier.height(6.dp))
        Text(text, color = PC.Muted, style = MaterialTheme.typography.bodyMedium, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        if (action != null) { Spacer(Modifier.height(18.dp)); action() }
    }
}

/** Caixa com o fundo azul dos destaques do site. */
@Composable
fun HeroBox(modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    val shape = RoundedCornerShape(24.dp)
    Box(modifier.clip(shape).background(PC.HeroGradient).border(1.dp, PC.HeroLine, shape), content = content)
}
