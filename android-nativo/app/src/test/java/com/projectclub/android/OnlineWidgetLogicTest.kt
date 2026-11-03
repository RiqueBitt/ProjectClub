package com.projectclub.android

import com.projectclub.android.widget.OnlineWidgetLogic
import com.projectclub.android.widget.WidgetSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Calendar
import java.util.Locale

/** Widget "quem está online": textos e cache (JVM puro). */
class OnlineWidgetLogicTest {
    @Test fun countLabelSingularPlural() {
        assertEquals("amigo online", OnlineWidgetLogic.countLabel(1))
        assertEquals("amigos online", OnlineWidgetLogic.countLabel(0))
        assertEquals("amigos online", OnlineWidgetLogic.countLabel(7))
    }

    @Test fun voiceLineShowsUpToThreeNamesAndTheRest() {
        assertEquals("Ninguém em call agora", OnlineWidgetLogic.voiceLine(WidgetSummary()))
        assertEquals("Em call: Ana", OnlineWidgetLogic.voiceLine(WidgetSummary(inVoiceCount = 1, inVoice = listOf("Ana"))))
        assertEquals(
            "Em call: Ana, Beto, Caio +2",
            OnlineWidgetLogic.voiceLine(WidgetSummary(inVoiceCount = 5, inVoice = listOf("Ana", "Beto", "Caio", "Duda"))),
        )
        // Contagem menor que a lista (resposta antiga/estranha): não mostra "+-1".
        assertEquals("Em call: Ana, Beto", OnlineWidgetLogic.voiceLine(WidgetSummary(inVoiceCount = 1, inVoice = listOf("Ana", " ", "Beto"))))
    }

    @Test fun textsForEachSituation() {
        val out = OnlineWidgetLogic.texts(null, 0L, loggedOut = true)
        assertEquals("Entre no Project Club", out.label)
        assertEquals("—", OnlineWidgetLogic.texts(null, 0L, loggedOut = false).count)
        assertEquals("Adicione amigos no app", OnlineWidgetLogic.texts(WidgetSummary(), 0L, loggedOut = false).voice)
        val ok = OnlineWidgetLogic.texts(WidgetSummary(onlineCount = 3, friendCount = 9), 0L, loggedOut = false)
        assertEquals("3", ok.count)
        assertEquals("amigos online", ok.label)
        assertEquals("", ok.updated)
    }

    @Test fun updatedLineUsesLocalTime() {
        val c = Calendar.getInstance().apply { set(2026, Calendar.NOVEMBER, 2, 14, 3, 0) }
        assertEquals("Atualizado às 14:03", OnlineWidgetLogic.updatedLine(c.timeInMillis, Locale("pt", "BR")))
        assertEquals("", OnlineWidgetLogic.updatedLine(0L))
    }

    @Test fun cacheRoundTripAndBadJson() {
        val s = WidgetSummary(onlineCount = 2, friendCount = 4, inVoiceCount = 1, inVoice = listOf("Ana"), generatedAt = "2026-11-02T17:00:00Z")
        assertEquals(s, OnlineWidgetLogic.decode(OnlineWidgetLogic.encode(s)))
        assertNull(OnlineWidgetLogic.decode("{quebrado"))
        assertNull(OnlineWidgetLogic.decode(null))
        // Campos novos do servidor são ignorados.
        assertEquals(1, OnlineWidgetLogic.decode("{\"onlineCount\":1,\"novo\":true}")?.onlineCount)
    }
}
