package com.projectclub.android.ui.home

import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.projectclub.android.data.Repository
import com.projectclub.android.data.Room
import com.projectclub.android.net.ApiException
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/*
 * "Primeiros passos" (checklist com moedas) e tour de boas-vindas — iguais ao
 * site (conforto/FirstStepsWidget.jsx e WelcomeTour.jsx), com a mesma API
 * /api/onboarding. O tour aparece uma vez por conta (o site e o app
 * compartilham o "já vi").
 */

@Serializable
data class OnboardingStep(
    val key: String = "",
    val title: String = "",
    val description: String? = null,
    val action: String? = null,
    val coins: Int = 0,
    val done: Boolean = false,
    val claimed: Boolean = false,
)

@Serializable
data class OnboardingData(
    val eligible: Boolean = false,
    val tourSeenAt: String? = null,
    val dismissedAt: String? = null,
    val allClaimed: Boolean = false,
    val earnedCoins: Int = 0,
    val steps: List<OnboardingStep> = emptyList(),
)

@Serializable
private data class ClaimResponse(val coins: Int? = null)

private suspend fun setMeta(repo: Repository, key: String) =
    runCatching { repo.api.postIgnore("/api/onboarding/meta/$key", buildJsonObject { put("on", true) }) }

@Composable
fun OnboardingHost(repo: Repository, actions: HomeActions, nav: com.projectclub.android.ui.nav.AppNav, voiceChannel: Pair<String, String>?, chatRoom: Room?) {
    var data by remember { mutableStateOf<OnboardingData?>(null) }
    var tour by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        data = runCatching { repo.api.get<OnboardingData>("/api/onboarding") }.getOrNull()
        val d = data
        if (d != null && d.eligible && d.tourSeenAt == null) tour = true
    }
    val d = data ?: return
    if (tour) WelcomeTour {
        tour = false
        data = d.copy(tourSeenAt = d.tourSeenAt ?: java.time.Instant.now().toString())
        scope.launch { setMeta(repo, "tour") }
    }
    if (!d.eligible || d.dismissedAt != null || d.allClaimed) return
    FirstStepsCard(
        repo, d, onChange = { data = it },
        onAction = { step ->
            when (step.action) {
                "profile", "profileTheme" -> nav.editProfile()
                "chat" -> chatRoom?.let(actions.openRoom)
                "voice" -> voiceChannel?.let { (id, name) -> actions.joinVoice(id, name) }
                "notifications" -> nav.settings()
                else -> {}
            }
        },
        onDismiss = {
            data = d.copy(dismissedAt = java.time.Instant.now().toString())
            scope.launch { setMeta(repo, "dismiss") }
        },
    )
}

@Composable
private fun FirstStepsCard(
    repo: Repository, d: OnboardingData, onChange: (OnboardingData) -> Unit,
    onAction: (OnboardingStep) -> Unit, onDismiss: () -> Unit,
) {
    var open by rememberSaveable { mutableStateOf(true) }
    var busy by remember { mutableStateOf<String?>(null) }
    var msg by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val done = d.steps.count { it.claimed }
    val total = d.steps.size
    val shape = RoundedCornerShape(18.dp)
    Column(Modifier.fillMaxWidth().clip(shape).background(PC.Surface).border(1.dp, PC.Line, shape)) {
        Row(Modifier.fillMaxWidth().clickable { open = !open }.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(38.dp).clip(CircleShape).background(PC.Brand.copy(alpha = 0.18f)), contentAlignment = Alignment.Center) {
                Text("$done/$total", color = PC.Brand, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelMedium)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("Primeiros passos", color = PC.Header, fontWeight = FontWeight.Bold)
                Text("Complete e ganhe moedas pra usar na Loja", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
            }
            Icon(if (open) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, if (open) "Recolher" else "Abrir", tint = PC.Muted)
        }
        LinearProgressIndicator(
            progress = { if (total > 0) done.toFloat() / total else 0f },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp).height(4.dp).clip(RoundedCornerShape(2.dp)), color = PC.Brand, trackColor = PC.Line,
        )
        AnimatedVisibility(open) {
            Column(Modifier.padding(horizontal = 8.dp, vertical = 8.dp)) {
                d.steps.forEach { s ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier.size(24.dp).clip(CircleShape).background(if (s.claimed) PC.Green else Color.Transparent)
                                .border(2.dp, if (s.claimed) PC.Green else if (s.done) PC.Brand else PC.Line, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) { if (s.claimed) Icon(Icons.Filled.Check, null, tint = Color.White, modifier = Modifier.size(15.dp)) }
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(s.title, color = if (s.claimed) PC.Muted else PC.Header, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
                            Text("${s.coins} moedas" + (s.description?.let { " · $it" } ?: ""), color = PC.Faint, style = MaterialTheme.typography.labelSmall, maxLines = 2)
                        }
                        when {
                            s.claimed -> {}
                            s.done -> TextButton(enabled = busy == null, onClick = {
                                busy = s.key
                                scope.launch {
                                    runCatching { repo.api.post<ClaimResponse>("/api/onboarding/claim/${s.key}") }
                                        .onSuccess { r ->
                                            val steps = d.steps.map { if (it.key == s.key) it.copy(done = true, claimed = true) else it }
                                            val coins = r.coins ?: s.coins
                                            msg = "+$coins moedas: ${s.title}"
                                            onChange(d.copy(steps = steps, earnedCoins = d.earnedCoins + coins, allClaimed = steps.all { it.claimed }))
                                        }
                                        .onFailure { e ->
                                            msg = (e as? ApiException)?.message ?: "Não foi possível resgatar agora."
                                            runCatching { repo.api.get<OnboardingData>("/api/onboarding") }.onSuccess(onChange)
                                        }
                                    busy = null
                                }
                            }) { Text(if (busy == s.key) "…" else "Resgatar", color = PC.Brand, fontWeight = FontWeight.Bold) }
                            s.action != null -> TextButton(onClick = { onAction(s) }) { Text("Fazer", color = PC.Muted) }
                        }
                    }
                }
                msg?.let { Text(it, color = PC.Brand, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 6.dp)) }
                TextButton(onClick = onDismiss) { Text("Esconder", color = PC.Faint) }
            }
        }
    }
}

/* Mesmo texto do site (tourSteps.js), ajustado pro celular. */
private val TOUR = listOf(
    "Boas-vindas ao Project Club!" to "Em menos de um minuto, um passeio rápido pelas partes principais. Dá pra pular quando quiser e rever depois em Configurações.",
    "Abas lá embaixo" to "Início, Comunidade, Social, Avisos e Você. É por elas que você anda pelo app.",
    "Canais da comunidade" to "Na aba Comunidade ficam os canais de texto, organizados em categorias. Os que têm novidade aparecem em destaque.",
    "Canais de voz" to "Toque em um canal de voz para entrar na call. Você vê quem está falando e pode ligar a câmera.",
    "Você" to "Sua foto e seu status. Toque para mudar o status, ver seu perfil, sua carteira e as configurações.",
    "Moedas, Loja e missões" to "Ganhe moedas com missões e com os Primeiros passos, e troque na Loja por molduras, efeitos e temas de perfil.",
    "Chat" to "Segure uma mensagem para responder, reagir, criar tópico, traduzir e mais. O botão de dado na caixa de texto abre as Atividades.",
)

@Composable
fun WelcomeTour(onClose: () -> Unit) {
    var i by remember { mutableIntStateOf(0) }
    val (title, body) = TOUR[i]
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text(title, fontWeight = FontWeight.Bold) },
        text = {
            Column {
                Text(body, color = PC.Text)
                Spacer(Modifier.height(16.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                    TOUR.indices.forEach { k ->
                        Box(Modifier.padding(3.dp).size(if (k == i) 18.dp else 7.dp, 7.dp).clip(CircleShape).background(if (k == i) PC.Brand else PC.Line))
                    }
                }
                Text("${i + 1} de ${TOUR.size}", color = PC.Faint, style = MaterialTheme.typography.labelSmall, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 6.dp))
            }
        },
        confirmButton = {
            TextButton(onClick = { if (i < TOUR.lastIndex) i++ else onClose() }) { Text(if (i < TOUR.lastIndex) "Próximo" else "Começar", fontWeight = FontWeight.Bold) }
        },
        dismissButton = {
            Row {
                if (i > 0) TextButton(onClick = { i-- }) { Text("Voltar") }
                TextButton(onClick = onClose) { Text("Pular", color = PC.Muted) }
            }
        },
        containerColor = PC.Surface,
    )
}
