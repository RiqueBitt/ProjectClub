package com.projectclub.android.voice

import android.content.Context
import android.util.Log
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * "Caixa-preta" da chamada: as últimas ~80 coisas que aconteceram na voz
 * (entrou, transporte caiu, reconectando, desmontou...). Fica num arquivo
 * pequeno, então sobrevive ao app fechar sozinho — o CrashReporter manda
 * junto com o motivo da queda, e o VoiceManager manda quando reconecta.
 */
object VoiceTrace {
    private const val MAX = 80
    private val lines = ArrayDeque<String>()
    private var file: File? = null
    private val fmt = SimpleDateFormat("HH:mm:ss.SSS", Locale.US)

    @Synchronized fun init(ctx: Context) {
        if (file != null) return
        file = File(ctx.applicationContext.filesDir, "voz-trace.txt")
        runCatching { file?.takeIf { it.exists() }?.readLines()?.takeLast(MAX)?.forEach { lines.addLast(it) } }
    }

    @Synchronized fun add(msg: String) {
        Log.i("PCVozTrace", msg)
        lines.addLast("${fmt.format(Date())} [${Thread.currentThread().name}] ${msg.take(200)}")
        while (lines.size > MAX) lines.removeFirst()
        runCatching { file?.writeText(lines.joinToString("\n")) }
    }

    @Synchronized fun dump(last: Int = MAX): String = lines.toList().takeLast(last).joinToString("\n")
}
