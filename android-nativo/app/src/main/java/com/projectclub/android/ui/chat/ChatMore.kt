package com.projectclub.android.ui.chat

import android.content.Context
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import android.speech.tts.TextToSpeech
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.projectclub.android.data.Conversation
import com.projectclub.android.data.Message
import com.projectclub.android.data.PickedFile
import com.projectclub.android.data.Repository
import com.projectclub.android.data.User
import com.projectclub.android.net.ApiException
import com.projectclub.android.ui.common.Avatar
import com.projectclub.android.ui.theme.PC
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.io.File
import java.util.Locale

/*
 * Coisas do chat do site que faltavam no app (Message.jsx, ChatWindow.jsx,
 * TipDialog.jsx, ReportDialog.jsx, EphemeralToggle.jsx, pinguEphemeral.js):
 * agradecer, gorjeta, denunciar, falar a mensagem, traduzir com o Pingu,
 * mensagem de voz, player de áudio, mensagens temporárias e sugestão de @.
 */

private fun errText(e: Throwable, fallback: String): String =
    (e as? ApiException)?.message?.takeIf { it.isNotBlank() } ?: fallback

/* ---------------- Agradecer ---------------- */

suspend fun thankMessage(repo: Repository, m: Message): String = runCatching {
    repo.api.postIgnore("/api/reputation/thanks", buildJsonObject { put("targetType", "MESSAGE"); put("targetId", m.id) })
    "Agradecimento enviado 💛"
}.getOrElse { errText(it, "Não deu pra agradecer agora.") }

/* ---------------- Falar mensagem (voz do celular) ---------------- */

object Speaker {
    private var tts: TextToSpeech? = null
    private var ready = false
    private var pending: String? = null

    fun speak(ctx: Context, text: String) {
        val clean = text.replace(Regex("https?://\\S+"), "link").replace(Regex(":[a-zA-Z0-9_]+:"), "").trim()
        if (clean.isEmpty()) return
        val t = tts
        if (t != null && ready) { t.speak(clean, TextToSpeech.QUEUE_FLUSH, null, "pc-msg"); return }
        pending = clean
        if (t == null) tts = TextToSpeech(ctx.applicationContext) { status ->
            ready = status == TextToSpeech.SUCCESS
            if (ready) {
                tts?.language = Locale.forLanguageTag("pt-BR")
                pending?.let { tts?.speak(it, TextToSpeech.QUEUE_FLUSH, null, "pc-msg") }
                pending = null
            }
        }
    }
}

/* ---------------- Traduzir com o Pingu ---------------- */

data class Translation(val loading: Boolean = false, val text: String? = null, val target: String? = null, val error: String? = null)

@Serializable
private data class TranslateResponse(val text: String? = null, val target: String? = null, val requestId: String? = null, val pending: Boolean = false)

/** Traduções desta sessão (por mensagem). O resultado demorado chega pelo socket ("pingu:ephemeral"). */
object Translations {
    val byMessage = mutableStateMapOf<String, Translation>()
    private val waiting = HashMap<String, String>() // requestId → messageId

    suspend fun request(repo: Repository, m: Message) {
        byMessage[m.id] = Translation(loading = true)
        val lang = Locale.getDefault().language.ifBlank { "pt" }
        runCatching {
            repo.api.post<TranslateResponse>("/api/pingu/translate", buildJsonObject { put("messageId", m.id); put("lang", lang) })
        }.onSuccess { r ->
            when {
                r.text != null -> byMessage[m.id] = Translation(text = r.text, target = r.target)
                r.requestId != null -> synchronized(waiting) { waiting[r.requestId] = m.id }
                else -> byMessage[m.id] = Translation(error = "O Pingu não respondeu.")
            }
        }.onFailure { byMessage[m.id] = Translation(error = errText(it, "Não deu pra traduzir agora.")) }
    }

    /** Ligado no ChatScreen: escuta as respostas do Pingu. */
    suspend fun listen(repo: Repository) {
        repo.realtime.events.collect { ev ->
            if (ev.name != "pingu:ephemeral") return@collect
            val o = runCatching { ev.data?.jsonObject }.getOrNull() ?: return@collect
            if (o["kind"]?.jsonPrimitive?.content != "translate") return@collect
            val req = o["requestId"]?.jsonPrimitive?.content ?: return@collect
            val mid = synchronized(waiting) { waiting.remove(req) } ?: o["messageId"]?.jsonPrimitive?.content ?: return@collect
            val text = o["text"]?.jsonPrimitive?.content
            byMessage[mid] = if (text != null) Translation(text = text, target = o["target"]?.jsonPrimitive?.content)
            else Translation(error = o["error"]?.jsonPrimitive?.content ?: "Não deu pra traduzir agora.")
        }
    }
}

@Composable
fun TranslationLine(messageId: String) {
    val t = Translations.byMessage[messageId] ?: return
    Column(
        Modifier.padding(top = 4.dp).widthIn(max = 420.dp).clip(RoundedCornerShape(10.dp)).background(PC.Surface)
            .border(1.dp, PC.Line, RoundedCornerShape(10.dp)).padding(horizontal = 10.dp, vertical = 6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "🐧 Tradução do Pingu" + (t.target?.let { " · ${it.uppercase()}" } ?: ""),
                color = PC.Brand, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f),
            )
            Icon(Icons.Filled.Close, "Fechar tradução", tint = PC.Muted, modifier = Modifier.size(16.dp).clickable { Translations.byMessage.remove(messageId) })
        }
        when {
            t.loading -> Text("Traduzindo…", color = PC.Muted, fontStyle = FontStyle.Italic, style = MaterialTheme.typography.bodySmall)
            t.error != null -> Text(t.error, color = PC.Red, style = MaterialTheme.typography.bodySmall)
            else -> Text(t.text.orEmpty(), color = PC.Text, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

/* ---------------- Gorjeta ---------------- */

@Serializable
private data class TipStatus(val sentToday: Int = 0, val dailyCap: Int = 0, val min: Int = 5, val max: Int = 500, val minLevel: Int = 0)

@Composable
fun TipDialog(repo: Repository, m: Message, onDone: (String?) -> Unit) {
    var status by remember { mutableStateOf<TipStatus?>(null) }
    var amount by remember { mutableStateOf("25") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        runCatching { repo.api.get<TipStatus>("/api/tips/status") }.onSuccess { status = it }.onFailure { error = errText(it, "Não deu pra carregar.") }
    }
    val left = status?.let { maxOf(0, it.dailyCap - it.sentToday) }
    AlertDialog(
        onDismissRequest = { onDone(null) },
        title = { Text("Dar gorjeta pra ${m.author?.name ?: "quem escreveu"}") },
        text = {
            Column {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(10, 25, 50, 100).forEach { v ->
                        val on = amount == v.toString()
                        Box(
                            Modifier.clip(RoundedCornerShape(10.dp)).background(if (on) PC.Brand else PC.Surface2).clickable { amount = v.toString() }
                                .padding(horizontal = 14.dp, vertical = 8.dp),
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                com.projectclub.android.ui.common.CurrencyArt(false, 16.dp)
                                Spacer(Modifier.width(5.dp))
                                Text("$v", color = if (on) PC.OnBrand else PC.Text, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(amount, { amount = it.filter(Char::isDigit).take(4) }, singleLine = true, label = { Text("Moedas") }, modifier = Modifier.fillMaxWidth())
                status?.let { Text("De ${it.min} a ${it.max} moedas por gorjeta. Hoje você ainda pode dar $left moedas.", color = PC.Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp)) }
                error?.let { Text(it, color = PC.Red, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp)) }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && (amount.toIntOrNull() ?: 0) > 0, onClick = {
                busy = true; error = null
                scope.launch {
                    runCatching { repo.api.postIgnore("/api/tips", buildJsonObject { put("messageId", m.id); put("amount", amount.toInt()) }) }
                        .onSuccess { onDone("Gorjeta de $amount moedas enviada") }
                        .onFailure { error = errText(it, "Não deu pra mandar a gorjeta.") }
                    busy = false
                }
            }) { Text(if (busy) "Enviando…" else "Dar gorjeta") }
        },
        dismissButton = { TextButton(onClick = { onDone(null) }) { Text("Cancelar") } },
        containerColor = PC.Surface,
    )
}

/* ---------------- Denunciar ---------------- */

private val REPORT_CATEGORIES = listOf(
    "spam" to "Spam", "harassment" to "Assédio ou ódio", "nsfw" to "Conteúdo impróprio/NSFW",
    "scam" to "Golpe ou phishing", "impersonation" to "Se passando por alguém", "other" to "Outro",
)

@Composable
fun ReportDialog(repo: Repository, m: Message, onDone: (String?) -> Unit) {
    var cat by remember { mutableStateOf("spam") }
    var details by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    AlertDialog(
        onDismissRequest = { onDone(null) },
        title = { Text("Denunciar mensagem") },
        text = {
            Column {
                REPORT_CATEGORIES.forEach { (k, label) ->
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable { cat = k }, verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = cat == k, onClick = { cat = k })
                        Text(label, color = PC.Text)
                    }
                }
                OutlinedTextField(details, { details = it.take(500) }, label = { Text("Detalhes (opcional)") }, modifier = Modifier.fillMaxWidth(), maxLines = 4)
                Text("A equipe vê a mensagem e o contexto. Quem escreveu não fica sabendo quem denunciou.", color = PC.Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp))
                error?.let { Text(it, color = PC.Red, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy, onClick = {
                busy = true; error = null
                scope.launch {
                    runCatching {
                        repo.api.postIgnore("/api/messages/report", buildJsonObject {
                            put("messageId", m.id); put("category", cat); if (details.isNotBlank()) put("details", details.trim())
                        })
                    }.onSuccess { onDone("Denúncia enviada. Obrigado por avisar.") }
                        .onFailure { error = errText(it, "Não deu pra enviar a denúncia.") }
                    busy = false
                }
            }) { Text(if (busy) "Enviando…" else "Denunciar", color = PC.Red) }
        },
        dismissButton = { TextButton(onClick = { onDone(null) }) { Text("Cancelar") } },
        containerColor = PC.Surface,
    )
}

/* ---------------- Mensagens temporárias (DM) ---------------- */

fun ephemeralLabel(seconds: Int?): String = when (seconds) { null, 0 -> "Desligado"; 86400 -> "24 horas"; 604800 -> "7 dias"; else -> "${seconds / 3600} h" }

@Serializable
private data class ConvResponse(val conversation: Conversation? = null)

@Composable
fun EphemeralDialog(repo: Repository, conv: Conversation, onDone: (String?) -> Unit) {
    val current = conv.ephemeralSeconds
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    AlertDialog(
        onDismissRequest = { onDone(null) },
        title = { Text("Mensagens temporárias") },
        text = {
            Column {
                Text("Vale para as mensagens novas, para todo mundo na conversa. Quem participa pode mudar — a conversa mostra quem mudou.", color = PC.Muted, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(8.dp))
                listOf("off" to null, "24h" to 86400, "7d" to 604800).forEach { (mode, secs) ->
                    val on = (current ?: 0) == (secs ?: 0)
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable(enabled = !busy && !on) {
                            busy = true; error = null
                            scope.launch {
                                runCatching { repo.api.patch<ConvResponse>("/api/conversations/${conv.id}/ephemeral", buildJsonObject { put("mode", mode) }) }
                                    .onSuccess { r -> repo.patchConversation(conv.id) { it.copy(ephemeralSeconds = r.conversation?.ephemeralSeconds ?: secs) }; onDone("Mensagens temporárias: ${ephemeralLabel(secs)}") }
                                    .onFailure { error = errText(it, "Não deu pra mudar agora.") }
                                busy = false
                            }
                        },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = on, onClick = null)
                        Text(ephemeralLabel(secs), color = PC.Text)
                    }
                }
                error?.let { Text(it, color = PC.Red, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = { TextButton(onClick = { onDone(null) }) { Text("Fechar") } },
        containerColor = PC.Surface,
    )
}

/* ---------------- Mensagem de voz ---------------- */

/** Grava áudio (AAC/m4a) no cache. Parar devolve o arquivo pra ir como anexo, igual ao site. */
class VoiceRecorder(private val ctx: Context) {
    private var rec: MediaRecorder? = null
    private var file: File? = null

    fun start(): Boolean = runCatching {
        val f = File(ctx.cacheDir, "audio-${System.currentTimeMillis()}.m4a")
        @Suppress("DEPRECATION")
        val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(ctx) else MediaRecorder()
        r.setAudioSource(MediaRecorder.AudioSource.MIC)
        r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        r.setAudioEncodingBitRate(64_000)
        r.setAudioSamplingRate(44_100)
        r.setOutputFile(f.absolutePath)
        r.prepare()
        r.start()
        rec = r; file = f
        true
    }.getOrElse { release(); false }

    fun stop(discard: Boolean): PickedFile? {
        val r = rec ?: return null
        val ok = runCatching { r.stop() }.isSuccess
        release()
        val f = file ?: return null
        file = null
        if (discard || !ok || f.length() == 0L) { f.delete(); return null }
        return PickedFile(android.net.Uri.fromFile(f), f.name, "audio/mp4", f.length())
    }

    private fun release() { runCatching { rec?.release() }; rec = null }
}

/** Faixa "Gravando…" que fica no lugar da caixa de texto. */
@Composable
fun RecordingBar(onCancel: () -> Unit, onStop: () -> Unit) {
    var secs by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) { while (true) { delay(1000); secs++ } }
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp).clip(RoundedCornerShape(26.dp)).background(PC.Surface)
            .border(1.dp, PC.Red.copy(alpha = 0.5f), RoundedCornerShape(26.dp)).padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(10.dp).clip(CircleShape).background(PC.Red))
        Spacer(Modifier.width(10.dp))
        Text("Gravando  %d:%02d".format(secs / 60, secs % 60), color = PC.Header, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        TextButton(onClick = onCancel) { Text("Cancelar", color = PC.Muted) }
        Box(Modifier.size(40.dp).clip(CircleShape).background(PC.Red).clickable(onClick = onStop), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.Stop, "Parar e anexar", tint = Color.White)
        }
    }
}

/* ---------------- Player de áudio ---------------- */

@Composable
fun AudioAttachment(url: String, name: String?) {
    var player by remember(url) { mutableStateOf<MediaPlayer?>(null) }
    var playing by remember(url) { mutableStateOf(false) }
    var progress by remember(url) { mutableFloatStateOf(0f) }
    var duration by remember(url) { mutableIntStateOf(0) }
    DisposableEffect(url) { onDispose { runCatching { player?.release() }; player = null } }
    LaunchedEffect(playing) {
        while (playing) {
            player?.let { p -> if (p.duration > 0) progress = p.currentPosition.toFloat() / p.duration }
            delay(200)
        }
    }
    fun toggle() {
        val p = player
        if (p == null) {
            val mp = MediaPlayer()
            runCatching {
                mp.setDataSource(url)
                mp.setOnPreparedListener { duration = it.duration; it.start(); playing = true }
                mp.setOnCompletionListener { playing = false; progress = 0f }
                mp.prepareAsync()
                player = mp
            }.onFailure { mp.release() }
        } else if (p.isPlaying) { p.pause(); playing = false } else { p.start(); playing = true }
    }
    Row(
        Modifier.padding(top = 6.dp).widthIn(max = 300.dp).fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(PC.Surface)
            .border(1.dp, PC.Line, RoundedCornerShape(22.dp)).padding(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(36.dp).clip(CircleShape).background(PC.Brand).clickable { toggle() }, contentAlignment = Alignment.Center) {
            Icon(if (playing) Icons.Filled.Pause else Icons.Filled.PlayArrow, if (playing) "Pausar" else "Tocar", tint = PC.OnBrand)
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f).padding(end = 10.dp)) {
            LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)), color = PC.Brand, trackColor = PC.Line)
            Text(
                if (duration > 0) "%d:%02d".format(duration / 60000, duration / 1000 % 60) else (name?.takeIf { !it.startsWith("audio-") } ?: "Mensagem de voz"),
                color = PC.Muted, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}

/* ---------------- Sugestão de @menção ---------------- */

/** O "@algo" que está sendo digitado no fim do texto (ou null). */
fun mentionQuery(text: String): String? {
    val m = Regex("(^|\\s)@([\\p{L}0-9_.]{0,32})$").find(text) ?: return null
    return m.groupValues[2]
}

@Composable
fun MentionSuggestions(users: List<User>, query: String, onPick: (User) -> Unit) {
    val q = query.lowercase()
    val list = remember(users, q) {
        users.filter { u -> u.username != null && (q.isEmpty() || u.username.lowercase().startsWith(q) || (u.displayName?.lowercase()?.contains(q) == true)) }
            .distinctBy { it.id }.take(6)
    }
    if (list.isEmpty()) return
    Column(Modifier.fillMaxWidth().padding(horizontal = 10.dp).clip(RoundedCornerShape(14.dp)).background(PC.Surface).border(1.dp, PC.Line, RoundedCornerShape(14.dp))) {
        list.forEach { u ->
            Row(Modifier.fillMaxWidth().clickable { onPick(u) }.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Avatar(u, 28.dp)
                Spacer(Modifier.width(10.dp))
                Text(u.displayName ?: u.username.orEmpty(), color = PC.Header, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                Spacer(Modifier.width(8.dp))
                Text("@${u.username}", color = PC.Muted, style = MaterialTheme.typography.labelSmall, maxLines = 1)
            }
        }
    }
}

/* ---------------- Linha "Novas mensagens" ---------------- */

@Composable
fun NewMessagesDivider() {
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f).height(1.dp).background(PC.Red))
        Text(
            "Novas mensagens", color = Color.White, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(start = 8.dp).clip(RoundedCornerShape(6.dp)).background(PC.Red).padding(horizontal = 6.dp, vertical = 1.dp),
        )
    }
}

/* ---------------- Enquete do chat ---------------- */

@Composable
fun ChatPollCard(repo: Repository, poll: com.projectclub.android.data.ChatPoll, myId: String?) {
    val options = remember(poll.options) {
        runCatching { com.projectclub.android.data.AppJson.decodeFromString<List<String>>(poll.options) }.getOrDefault(emptyList())
    }
    val expired = remember(poll.expiresAt) { poll.expiresAt?.let { runCatching { java.time.Instant.parse(it).isBefore(java.time.Instant.now()) }.getOrNull() } ?: false }
    // Voto otimista: aparece na hora; o servidor manda a mensagem atualizada pelo tempo real.
    var localVote by remember(poll.id, poll.votes) { mutableStateOf<Int?>(null) }
    val votes = poll.votes.filter { it.userId != myId || localVote == null } + (localVote?.let { listOf(com.projectclub.android.data.ChatPollVote(myId.orEmpty(), it)) } ?: emptyList())
    val total = votes.size
    val mine = votes.firstOrNull { it.userId == myId }?.optionIndex
    var showVoters by remember { mutableStateOf<Int?>(null) }
    val scope = rememberCoroutineScope()
    Column(
        Modifier.padding(top = 6.dp).widthIn(max = 380.dp).fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(PC.Surface)
            .border(1.dp, PC.Line, RoundedCornerShape(14.dp)).padding(12.dp),
    ) {
        Text("📊 " + poll.question, color = PC.Header, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        options.forEachIndexed { i, label ->
            val count = votes.count { it.optionIndex == i }
            val pct = if (total > 0) count * 100 / total else 0
            val isMine = mine == i
            Box(
                Modifier.padding(vertical = 3.dp).fillMaxWidth().height(40.dp).clip(RoundedCornerShape(10.dp)).background(PC.Surface2)
                    .border(1.dp, if (isMine) PC.Brand else PC.Line, RoundedCornerShape(10.dp))
                    .clickable(enabled = !expired) {
                        localVote = i
                        scope.launch { runCatching { repo.api.postIgnore("/api/polls/${poll.id}/vote", buildJsonObject { put("optionIndex", i) }) }.onFailure { localVote = null } }
                    },
            ) {
                Box(Modifier.fillMaxWidth(pct / 100f).height(40.dp).background(PC.Brand.copy(alpha = if (isMine) 0.32f else 0.16f)))
                Row(Modifier.fillMaxWidth().height(40.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text((if (isMine) "✓ " else "") + label, color = PC.Text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Text("$pct% ($count)", color = PC.Muted, style = MaterialTheme.typography.labelSmall, modifier = Modifier.clickable { if (count > 0) showVoters = if (showVoters == i) null else i })
                }
            }
            if (showVoters == i) {
                val names = poll.votes.filter { it.optionIndex == i }.mapNotNull { it.user?.let { u -> u.displayName ?: u.username } }
                if (names.isNotEmpty()) Text(names.joinToString(", "), color = PC.Muted, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(start = 6.dp, bottom = 2.dp))
            }
        }
        Text(
            "$total voto" + (if (total == 1) "" else "s") + (if (expired) " · encerrada" else ""),
            color = PC.Faint, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 6.dp),
        )
    }
}

private val POLL_DURATIONS = listOf("1h" to "1 hora", "4h" to "4 horas", "16h" to "16 horas", "24h" to "24 horas", "3d" to "3 dias", "1w" to "1 semana")

@Composable
fun PollComposer(busy: Boolean, onCreate: (question: String, options: List<String>, duration: String) -> Unit) {
    var question by remember { mutableStateOf("") }
    val options = remember { androidx.compose.runtime.mutableStateListOf("", "") }
    var duration by remember { mutableStateOf("24h") }
    Column(Modifier.padding(horizontal = 16.dp)) {
        OutlinedTextField(question, { question = it.take(300) }, Modifier.fillMaxWidth(), label = { Text("Pergunta") }, singleLine = true)
        Spacer(Modifier.height(6.dp))
        options.forEachIndexed { i, o ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(o, { options[i] = it.take(55) }, Modifier.weight(1f), label = { Text("Opção ${i + 1}") }, singleLine = true)
                if (options.size > 2) Icon(Icons.Filled.Close, "Tirar opção", tint = PC.Muted, modifier = Modifier.padding(start = 6.dp).size(22.dp).clickable { options.removeAt(i) })
            }
        }
        if (options.size < 7) TextButton(onClick = { options.add("") }) { Text("+ Adicionar opção") }
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            POLL_DURATIONS.forEach { (k, label) ->
                val on = duration == k
                Box(Modifier.clip(RoundedCornerShape(10.dp)).background(if (on) PC.Brand else PC.Surface2).clickable { duration = k }.padding(horizontal = 12.dp, vertical = 7.dp)) {
                    Text(label, color = if (on) PC.OnBrand else PC.Text, style = MaterialTheme.typography.labelMedium)
                }
            }
        }
        val clean = options.map { it.trim() }.filter { it.isNotEmpty() }
        val can = !busy && question.isNotBlank() && clean.size >= 2
        Box(
            Modifier.padding(top = 6.dp).fillMaxWidth().height(48.dp).clip(RoundedCornerShape(14.dp)).background(if (can) PC.Brand else PC.Surface2)
                .clickable(enabled = can) { onCreate(question.trim(), clean, duration) },
            contentAlignment = Alignment.Center,
        ) { Text(if (busy) "Criando…" else "Criar enquete", color = if (can) PC.OnBrand else PC.Muted, fontWeight = FontWeight.Bold) }
    }
}

/* ---------------- Moderação: advertir e silenciar ---------------- */

private val TIMEOUTS = listOf(10 to "10 minutos", 60 to "1 hora", 360 to "6 horas", 1440 to "1 dia", 10080 to "1 semana")

@Composable
fun ModerationDialog(repo: Repository, m: Message, kind: String, onDone: (String?) -> Unit) {
    val userId = m.authorId ?: return
    val who = m.author?.name ?: "quem escreveu"
    var reason by remember { mutableStateOf("") }
    var minutes by remember { mutableIntStateOf(10) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val warn = kind == "warn"
    AlertDialog(
        onDismissRequest = { onDone(null) },
        title = { Text(if (warn) "Advertir $who" else "Silenciar $who") },
        text = {
            Column {
                if (!warn) TIMEOUTS.forEach { (min, label) ->
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable { minutes = min }, verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = minutes == min, onClick = { minutes = min })
                        Text(label, color = PC.Text)
                    }
                }
                OutlinedTextField(
                    reason, { reason = it.take(500) }, Modifier.fillMaxWidth(), maxLines = 4,
                    label = { Text(if (warn) "Motivo da advertência" else "Motivo (opcional)") },
                )
                error?.let { Text(it, color = PC.Red, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && (!warn || reason.isNotBlank()), onClick = {
                busy = true; error = null
                scope.launch {
                    runCatching {
                        if (warn) repo.api.postIgnore("/api/community/members/$userId/warnings", buildJsonObject { put("reason", reason.trim()) })
                        else repo.api.postIgnore("/api/community/members/$userId/timeout", buildJsonObject {
                            put("minutes", minutes); if (reason.isNotBlank()) put("reason", reason.trim())
                        })
                    }.onSuccess { onDone(if (warn) "$who foi advertido." else "$who foi silenciado.") }
                        .onFailure { error = errText(it, "Não deu certo.") }
                    busy = false
                }
            }) { Text(if (busy) "Enviando…" else if (warn) "Advertir" else "Silenciar", color = PC.Red) }
        },
        dismissButton = { TextButton(onClick = { onDone(null) }) { Text("Cancelar") } },
        containerColor = PC.Surface,
    )
}
