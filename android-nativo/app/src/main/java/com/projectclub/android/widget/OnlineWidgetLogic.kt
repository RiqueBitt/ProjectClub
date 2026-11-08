package com.projectclub.android.widget

import com.projectclub.android.data.AppJson
import kotlinx.serialization.Serializable
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Resposta de GET /api/mobile/widget-summary (ver server/src/services/widgetSummary.js):
 * só contagens e nomes de exibição de amigos — nada de id, foto ou canal.
 */
@Serializable
data class WidgetSummary(
    val onlineCount: Int = 0,
    val friendCount: Int = 0,
    val inVoiceCount: Int = 0,
    val inVoice: List<String> = emptyList(),
    val generatedAt: String? = null,
)

/** O que o widget mostra (textos já prontos) — separado do Android pra testar em JVM puro. */
data class WidgetTexts(val count: String, val label: String, val voice: String, val updated: String)

/** Regras de texto e do cache do widget "quem está online" (testadas em OnlineWidgetLogicTest). */
object OnlineWidgetLogic {
    const val MAX_NAMES = 3

    fun countLabel(online: Int): String = if (online == 1) "amigo online" else "amigos online"

    /** "Em call: Ana, Beto, Caio +2" / "Ninguém em call agora". */
    fun voiceLine(s: WidgetSummary): String {
        val names = s.inVoice.map { it.trim() }.filter { it.isNotEmpty() }.take(MAX_NAMES)
        val total = maxOf(s.inVoiceCount, names.size)
        if (total == 0 || names.isEmpty()) return "Ninguém em call agora"
        val extra = total - names.size
        return "Em call: " + names.joinToString(", ") + (if (extra > 0) " +$extra" else "")
    }

    fun updatedLine(savedAtMs: Long, locale: Locale = Locale("pt", "BR")): String {
        if (savedAtMs <= 0L) return ""
        return "Atualizado às " + SimpleDateFormat("HH:mm", locale).format(Date(savedAtMs))
    }

    /** Textos pra cada situação: sem login, sem dados ainda, ou com o resumo salvo. */
    fun texts(summary: WidgetSummary?, savedAtMs: Long, loggedOut: Boolean): WidgetTexts = when {
        loggedOut -> WidgetTexts("—", "Entre no Project Club", "Toque para abrir o app", "")
        summary == null -> WidgetTexts("—", "amigos online", "Toque para abrir o app", "")
        summary.friendCount == 0 -> WidgetTexts("0", "amigos online", "Adicione amigos no app", updatedLine(savedAtMs))
        else -> WidgetTexts(summary.onlineCount.coerceAtLeast(0).toString(), countLabel(summary.onlineCount), voiceLine(summary), updatedLine(savedAtMs))
    }

    fun encode(s: WidgetSummary): String = AppJson.encodeToString(WidgetSummary.serializer(), s)

    fun decode(json: String?): WidgetSummary? =
        json?.takeIf { it.isNotBlank() }?.let { runCatching { AppJson.decodeFromString(WidgetSummary.serializer(), it) }.getOrNull() }
}
