package com.projectclub.android.ui.login

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.projectclub.android.Config
import com.projectclub.android.R
import com.projectclub.android.data.LoginResult
import com.projectclub.android.data.Repository
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch

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

    fun submit() {
        if (busy) return
        if (identifier.isBlank() || password.isBlank()) { error = "Informe usuário/e-mail e senha."; return }
        if (needsCode && code.isBlank()) { error = "Digite o código do app autenticador."; return }
        busy = true; error = null
        scope.launch {
            when (val r = repo.login(identifier, password, if (needsCode) code else null)) {
                LoginResult.Ok -> Unit
                LoginResult.NeedsTwoFactor -> { needsCode = true; error = null }
                is LoginResult.Error -> error = r.message
            }
            busy = false
        }
    }

    Box(Modifier.fillMaxSize().background(PC.Bg).imePadding(), contentAlignment = Alignment.Center) {
        Column(
            Modifier.widthIn(max = 420.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(Modifier.size(84.dp).clip(RoundedCornerShape(24.dp)).background(PC.Surface), contentAlignment = Alignment.Center) {
                androidx.compose.foundation.Image(painterResource(R.mipmap.ic_launcher_foreground), contentDescription = null, modifier = Modifier.size(84.dp))
            }
            Text("Project Club", style = MaterialTheme.typography.titleLarge)
            Text(
                if (needsCode) "Digite o código de 6 dígitos do seu app autenticador (ou um código de recuperação)."
                else "Entre com a sua conta para conversar, entrar nas calls e receber notificações.",
                color = PC.Muted, textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(4.dp))
            if (!needsCode) {
                OutlinedTextField(
                    value = identifier, onValueChange = { identifier = it },
                    label = { Text("Usuário ou e-mail") }, singleLine = true, enabled = !busy,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = password, onValueChange = { password = it },
                    label = { Text("Senha") }, singleLine = true, enabled = !busy,
                    visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                    trailingIcon = {
                        IconButton(onClick = { showPassword = !showPassword }) {
                            Icon(if (showPassword) Icons.Filled.VisibilityOff else Icons.Filled.Visibility, contentDescription = if (showPassword) "Esconder senha" else "Mostrar senha")
                        }
                    },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { submit() }),
                    modifier = Modifier.fillMaxWidth(),
                )
            } else {
                OutlinedTextField(
                    value = code, onValueChange = { code = it.take(16) },
                    label = { Text("Código") }, singleLine = true, enabled = !busy,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { submit() }),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            error?.let { Text(it, color = PC.Red, textAlign = TextAlign.Center) }
            Button(onClick = ::submit, enabled = !busy, modifier = Modifier.fillMaxWidth().height(50.dp), shape = RoundedCornerShape(12.dp)) {
                if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                else Text(if (needsCode) "Confirmar" else "Entrar", fontWeight = FontWeight.Bold)
            }
            if (needsCode) TextButton(onClick = { needsCode = false; code = "" }) { Text("Voltar") }
            else {
                TextButton(onClick = { uri.openUri("${Config.baseUrl}/forgot-password") }) { Text("Esqueci minha senha") }
                TextButton(onClick = { uri.openUri("${Config.baseUrl}/register") }) { Text("Ainda não tem conta? Inscreva-se") }
            }
        }
    }
}
