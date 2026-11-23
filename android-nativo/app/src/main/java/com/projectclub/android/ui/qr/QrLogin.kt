package com.projectclub.android.ui.qr

import android.content.Context
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.projectclub.android.data.Repository
import com.projectclub.android.data.User
import com.projectclub.android.net.ApiException
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/*
 * "Entrar no computador com o celular" (login por QR Code, igual a
 * QrApprovePage.jsx do site): o PC mostra um QR com /entrar-qr?c=<code>;
 * o app lê o código, mostra de onde vem o pedido e você aprova ou recusa.
 */
object QrLogin {
    /** Código lido/aberto esperando a confirmação (a caixa fica na raiz do app). */
    val pending = MutableStateFlow<String?>(null)
    val error = MutableStateFlow<String?>(null)

    /** Tira o código de um link do QR (aceita o link inteiro ou só o código). */
    fun codeFrom(raw: String?): String? {
        val t = raw?.trim().orEmpty()
        if (t.isEmpty()) return null
        if (Regex("^[A-Za-z0-9_-]{20,128}$").matches(t)) return t
        val u = runCatching { Uri.parse(t) }.getOrNull() ?: return null
        if (u.path?.trimEnd('/')?.endsWith("/entrar-qr") != true) return null
        return u.getQueryParameter("c")?.takeIf { Regex("^[A-Za-z0-9_-]{20,128}$").matches(it) }
    }

    /** Abre a câmera do Google (sem pedir permissão de câmera pro app). */
    fun scan(ctx: Context) {
        val opts = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        GmsBarcodeScanning.getClient(ctx, opts).startScan()
            .addOnSuccessListener { b ->
                val c = codeFrom(b.rawValue)
                if (c != null) pending.value = c else error.value = "Esse QR Code não é de entrar no Project Club. No PC, toque em \"Entrar com o celular\"."
            }
            .addOnFailureListener { error.value = "Não deu pra abrir o leitor de QR Code neste celular." }
    }
}

@Serializable
private data class QrInfo(
    val device: String? = null,
    val network: String? = null,
    val requestedAt: String? = null,
    val expiresAt: String? = null,
    val account: User? = null,
)

private fun msgOf(e: Throwable, fallback: String) = (e as? ApiException)?.message?.takeIf { it.isNotBlank() } ?: fallback

/** Caixa de confirmação; fica na raiz do app. */
@Composable
fun QrLoginHost(repo: Repository) {
    val code by QrLogin.pending.collectAsState()
    val err by QrLogin.error.collectAsState()
    err?.let { e ->
        AlertDialog(
            onDismissRequest = { QrLogin.error.value = null },
            title = { Text("QR Code") }, text = { Text(e) },
            confirmButton = { TextButton(onClick = { QrLogin.error.value = null }) { Text("Ok") } },
            containerColor = PC.Surface,
        )
    }
    val c = code ?: return
    var phase by remember(c) { mutableStateOf("loading") }
    var info by remember(c) { mutableStateOf<QrInfo?>(null) }
    var error by remember(c) { mutableStateOf<String?>(null) }
    var left by remember(c) { mutableIntStateOf(0) }
    var busy by remember(c) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(c) {
        runCatching { repo.api.post<QrInfo>("/api/auth/qr/scan", buildJsonObject { put("code", c) }) }
            .onSuccess { info = it; phase = "confirm" }
            .onFailure { error = msgOf(it, "Não foi possível ler este QR Code."); phase = "error" }
    }
    LaunchedEffect(info?.expiresAt, phase) {
        val exp = info?.expiresAt?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() } ?: return@LaunchedEffect
        while (phase == "confirm") {
            left = maxOf(0, ((exp - System.currentTimeMillis()) / 1000).toInt())
            if (left == 0) { phase = "error"; error = "Este QR Code expirou. Gere um novo no computador." }
            delay(1000)
        }
    }
    fun close() { QrLogin.pending.value = null }
    fun decide(approve: Boolean) {
        busy = true
        scope.launch {
            runCatching { repo.api.postIgnore(if (approve) "/api/auth/qr/approve" else "/api/auth/qr/deny", buildJsonObject { put("code", c) }) }
                .onSuccess { phase = if (approve) "approved" else "denied" }
                .onFailure { error = msgOf(it, "Não foi possível concluir. Gere um novo QR Code no computador."); phase = "error" }
            busy = false
        }
    }
    AlertDialog(
        onDismissRequest = { if (!busy) close() },
        title = {
            Text(
                when (phase) { "approved" -> "Acesso aprovado"; "denied" -> "Acesso recusado"; "error" -> "QR Code"; else -> "Entrar no computador?" },
                fontWeight = FontWeight.Bold,
            )
        },
        text = {
            Column {
                when (phase) {
                    "loading" -> Row { CircularProgressIndicator(Modifier.width(20.dp).height(20.dp), strokeWidth = 2.dp); Spacer(Modifier.width(10.dp)); Text("Conferindo o QR Code…") }
                    "confirm" -> {
                        val i = info
                        Column(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(PC.Red.copy(alpha = 0.12f))
                                .border(1.dp, PC.Red.copy(alpha = 0.4f), RoundedCornerShape(12.dp)).padding(10.dp),
                        ) {
                            Text("Só aprove se você está na frente desse computador agora.", color = PC.Header, fontWeight = FontWeight.Bold)
                            Text(
                                "Se alguém te mandou este QR Code (por mensagem, e-mail, \"suporte\", sorteio…), toque em Recusar: quem aprovar entrega a sua conta para aquele computador.",
                                color = PC.Text, style = MaterialTheme.typography.bodySmall,
                            )
                        }
                        Spacer(Modifier.height(10.dp))
                        Line("Aparelho", i?.device ?: "Desconhecido")
                        Line("Rede", i?.network ?: "Desconhecida")
                        i?.requestedAt?.let { r ->
                            runCatching { java.time.format.DateTimeFormatter.ofPattern("HH:mm").format(java.time.Instant.parse(r).atZone(java.time.ZoneId.systemDefault())) }.getOrNull()
                        }?.let { Line("Pedido às", it) }
                        Line("Vai entrar como", (i?.account?.displayName ?: "") + (i?.account?.username?.let { " @$it" } ?: ""))
                        if (left > 0) Text("Expira em %d:%02d".format(left / 60, left % 60), color = PC.Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp))
                    }
                    "approved" -> Text("Pronto! O computador vai entrar na sua conta em instantes. Se não foi você, abra Configurações → Aparelhos conectados e saia desse dispositivo.")
                    "denied" -> Text("Tudo certo: o computador não entrou na sua conta.")
                    else -> Text(error ?: "Algo deu errado.", color = PC.Red)
                }
            }
        },
        confirmButton = {
            if (phase == "confirm") TextButton(enabled = !busy, onClick = { decide(true) }) { Text(if (busy) "…" else "Aprovar", fontWeight = FontWeight.Bold) }
            else TextButton(onClick = ::close) { Text("Fechar") }
        },
        dismissButton = { if (phase == "confirm") TextButton(enabled = !busy, onClick = { decide(false) }) { Text("Recusar", color = PC.Red) } },
        containerColor = PC.Surface,
    )
}

@Composable
private fun Line(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
        Text(label, color = PC.Muted, modifier = Modifier.width(120.dp))
        Text(value, color = PC.Header, fontWeight = FontWeight.SemiBold)
    }
}
