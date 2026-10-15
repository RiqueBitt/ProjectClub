package com.projectclub.android.ui.login

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.MailOutline
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.projectclub.android.Config
import com.projectclub.android.data.LoginResult
import com.projectclub.android.data.Repository
import com.projectclub.android.ui.common.PcField
import com.projectclub.android.ui.common.PcLogo
import com.projectclub.android.ui.common.PillButton
import com.projectclub.android.ui.theme.Display
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch

/** Login no mesmo estilo do site (título grande, bichinhos, campos com rótulo). */
@Composable
fun LoginScreen(repo: Repository, notice: String?) {
    var identifier by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var needsCode by remember { mutableStateOf(false) }
    var showPassword by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf(notice) }
    val scope = rememberCoroutineScope()
    val uri = LocalUriHandler.current

    val ready = if (needsCode) code.isNotBlank() else identifier.isNotBlank() && password.isNotBlank()

    fun submit() {
        if (busy || !ready) return
        busy = true; error = null
        scope.launch {
            when (val r = repo.login(identifier.trim(), password, if (needsCode) code.trim() else null)) {
                LoginResult.Ok -> Unit
                LoginResult.NeedsTwoFactor -> { needsCode = true; error = null }
                is LoginResult.Error -> error = r.message
            }
            busy = false
        }
    }

    Box(
        Modifier.fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0xFF0A0B0E), PC.Bg, Color(0xFF0B0D12))))
            .imePadding(),
    ) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().navigationBarsPadding()
                .padding(horizontal = 22.dp).widthIn(max = 480.dp),
        ) {
            // Topo: logo + nome
            Row(Modifier.fillMaxWidth().padding(top = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                PcLogo(40.dp)
                Spacer(Modifier.width(12.dp))
                Text("Project Club", style = MaterialTheme.typography.titleLarge, color = PC.Header)
            }
            Spacer(Modifier.height(56.dp))

            // Título + bichinhos
            Box(Modifier.fillMaxWidth()) {
                Critters(Modifier.align(Alignment.TopEnd).padding(end = 4.dp).size(width = 190.dp, height = 82.dp))
                Column(Modifier.padding(top = 70.dp)) {
                    Text("▶  PROJECT CLUB", color = PC.Muted, style = MaterialTheme.typography.labelMedium.copy(letterSpacing = 4.sp))
                    Spacer(Modifier.height(10.dp))
                    AnimatedContent(needsCode, label = "title") { code2fa ->
                        Text(
                            if (code2fa) "VERIFICAÇÃO EM DUAS ETAPAS" else "BEM-VINDO DE VOLTA",
                            fontFamily = Display, fontSize = 58.sp, lineHeight = 54.sp, color = Color.White,
                        )
                    }
                    Spacer(Modifier.height(10.dp))
                    Text(
                        if (needsCode) "Digite o código de 6 dígitos do seu app autenticador, ou um código de recuperação."
                        else "Entre com seu e-mail ou ClubTag.",
                        color = PC.Muted, style = MaterialTheme.typography.bodyLarge,
                    )
                }
            }
            Spacer(Modifier.height(28.dp))

            AnimatedContent(
                needsCode, label = "form",
                transitionSpec = { (slideInHorizontally { it / 3 } + fadeIn()) togetherWith (slideOutHorizontally { -it / 3 } + fadeOut()) },
            ) { code2fa ->
                Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
                    if (!code2fa) {
                        PcField(
                            identifier, { identifier = it; error = null }, "voce@exemplo.com",
                            label = "E-mail ou ClubTag", icon = Icons.Outlined.MailOutline, enabled = !busy,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                        )
                        PcField(
                            password, { password = it; error = null }, "Sua senha",
                            label = "Senha", icon = Icons.Outlined.Lock, enabled = !busy,
                            visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                            keyboardActions = KeyboardActions(onDone = { submit() }),
                            trailing = {
                                IconButton(onClick = { showPassword = !showPassword }) {
                                    Icon(
                                        if (showPassword) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                                        if (showPassword) "Esconder senha" else "Mostrar senha", tint = PC.Muted,
                                    )
                                }
                            },
                        )
                        Text(
                            "Esqueci minha senha", color = PC.Header, fontWeight = FontWeight.Bold,
                            textDecoration = TextDecoration.Underline,
                            modifier = Modifier.clip(RoundedCornerShape(6.dp)).clickable { uri.openUri("${Config.baseUrl}/forgot-password") }.padding(vertical = 2.dp),
                        )
                    } else {
                        PcField(
                            code, { code = it.take(16); error = null }, "000000",
                            label = "Código", icon = Icons.Outlined.Key, enabled = !busy,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Done),
                            keyboardActions = KeyboardActions(onDone = { submit() }),
                        )
                    }
                }
            }

            AnimatedVisibility(error != null, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                Row(
                    Modifier.padding(top = 16.dp).fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(PC.Red.copy(alpha = 0.12f)).padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Outlined.ErrorOutline, null, tint = PC.Red, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(10.dp))
                    Text(error.orEmpty(), color = Color(0xFFFFB4B5), style = MaterialTheme.typography.bodyMedium)
                }
            }

            Spacer(Modifier.height(24.dp))
            PillButton(
                if (needsCode) "Confirmar" else "Entrar", ::submit,
                Modifier.fillMaxWidth(), enabled = ready, busy = busy, light = true,
            )
            if (needsCode) {
                Spacer(Modifier.height(12.dp))
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { needsCode = false; code = ""; error = null }.padding(10.dp),
                    horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = PC.Muted, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Voltar", color = PC.Muted, fontWeight = FontWeight.SemiBold)
                }
            }

            Spacer(Modifier.height(28.dp))
            HorizontalDivider(color = PC.Line)
            Spacer(Modifier.height(22.dp))
            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(color = PC.Muted)) { append("Ainda não é membro? ") }
                    withStyle(SpanStyle(color = PC.Header, fontWeight = FontWeight.Bold, textDecoration = TextDecoration.Underline)) { append("Fazer inscrição") }
                },
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.align(Alignment.CenterHorizontally).clip(RoundedCornerShape(8.dp))
                    .clickable { uri.openUri("${Config.baseUrl}/register") }.padding(8.dp),
            )
            Spacer(Modifier.height(32.dp))
        }
    }
}

/** Os bichinhos do Project Club (os mesmos da tela de entrar do site), balançando de leve. */
@Composable
private fun Critters(modifier: Modifier) {
    val t = rememberInfiniteTransition(label = "critters")
    val a by t.animateFloat(0f, 1f, infiniteRepeatable(tween(1600), RepeatMode.Reverse), label = "a")
    val b by t.animateFloat(1f, 0f, infiniteRepeatable(tween(1900), RepeatMode.Reverse), label = "b")
    Canvas(modifier) {
        val u = size.height / 82f
        fun dy(v: Float) = v * 3f * u
        // azul (orelhas de coelho)
        blob(Offset(10 * u, 30 * u + dy(a)), Size(56 * u, 50 * u), Color(0xFF4CC9E8), Color(0xFF8BE3F5))
        drawOval(Color(0xFF4CC9E8), Offset(20 * u, 14 * u + dy(a)), Size(9 * u, 20 * u))
        drawOval(Color(0xFF4CC9E8), Offset(40 * u, 12 * u + dy(a)), Size(9 * u, 20 * u))
        drawOval(Color(0xFFF7A8C6), Offset(22.5f * u, 18 * u + dy(a)), Size(4 * u, 11 * u))
        drawOval(Color(0xFFF7A8C6), Offset(42.5f * u, 16 * u + dy(a)), Size(4 * u, 11 * u))
        face(Offset(38 * u, 52 * u + dy(a)), u, Color(0xFF14334A))
        // verde (lacinho)
        blob(Offset(56 * u, 8 * u + dy(b)), Size(42 * u, 72 * u), Color(0xFF5FD068), Color(0xFF9BEA8F))
        drawCircle(Color(0xFFFF6B8A), 4 * u, Offset(70 * u, 8 * u + dy(b)))
        drawCircle(Color(0xFFFF6B8A), 4 * u, Offset(82 * u, 8 * u + dy(b)))
        face(Offset(77 * u, 40 * u + dy(b)), u * 0.9f, Color(0xFF1C3B20))
        // rosa (grande)
        blob(Offset(94 * u, 24 * u + dy(a * 0.6f)), Size(66 * u, 58 * u), Color(0xFFE85AA8), Color(0xFFFF9BCF))
        face(Offset(127 * u, 52 * u + dy(a * 0.6f)), u * 1.15f, Color(0xFF4A1230))
        // amarelo (pequeno com chifrinho)
        val p = Path().apply {
            moveTo(176 * u, 44 * u + dy(b)); lineTo(173 * u, 30 * u + dy(b)); lineTo(180 * u, 44 * u + dy(b)); close()
        }
        drawPath(p, Color(0xFFF5D06A))
        blob(Offset(160 * u, 44 * u + dy(b)), Size(30 * u, 36 * u), Color(0xFFF2C14E), Color(0xFFFFE08A))
        face(Offset(175 * u, 62 * u + dy(b)), u * 0.7f, Color(0xFF4A3300), surprised = true)
    }
}

private fun DrawScope.blob(topLeft: Offset, size: Size, color: Color, light: Color) {
    drawOval(Brush.radialGradient(listOf(light, color), center = Offset(topLeft.x + size.width * 0.35f, topLeft.y + size.height * 0.3f), radius = size.maxDimension * 0.8f), topLeft, size)
    // sombra no chão
    drawOval(Color(0x33000000), Offset(topLeft.x + size.width * 0.1f, topLeft.y + size.height - 3f), Size(size.width * 0.8f, 6f))
}

private fun DrawScope.face(c: Offset, s: Float, ink: Color, surprised: Boolean = false) {
    val eye = 4.2f * s
    drawCircle(Color.White, eye, Offset(c.x - 8 * s, c.y - 4 * s))
    drawCircle(Color.White, eye, Offset(c.x + 8 * s, c.y - 4 * s))
    drawCircle(ink, eye * 0.6f, Offset(c.x - 7 * s, c.y - 3.4f * s))
    drawCircle(ink, eye * 0.6f, Offset(c.x + 9 * s, c.y - 3.4f * s))
    drawCircle(Color(0x66FF7A9A), 3.2f * s, Offset(c.x - 14 * s, c.y + 3 * s))
    drawCircle(Color(0x66FF7A9A), 3.2f * s, Offset(c.x + 14 * s, c.y + 3 * s))
    if (surprised) drawCircle(ink, 2.2f * s, Offset(c.x, c.y + 5 * s))
    else drawArc(ink, 20f, 140f, false, Offset(c.x - 4 * s, c.y + 1 * s), Size(8 * s, 6 * s), style = Stroke(1.6f * s, cap = StrokeCap.Round))
}
