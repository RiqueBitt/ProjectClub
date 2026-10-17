package com.projectclub.android

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Quando o app fecha sozinho ("o app continua parando"), guarda o motivo e
 * manda pro servidor na próxima abertura — aparece nos logs como
 * [erro-de-tela] android-nativo:fechou. Pega erro do Kotlin/Java (pilha) e,
 * no Android 11+, também queda do código nativo (motivo do sistema).
 */
object CrashReporter {
    private const val PREFS = "pc_crash"

    fun install(context: Context) {
        val app = context.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching {
                app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                    .putString("stack", "${thread.name}: ${error.stackTraceToString()}".take(4000))
                    .putString("message", (error.message ?: error.javaClass.name).take(400))
                    .commit()
            }
            previous?.uncaughtException(thread, error)
        }
    }

    /** Trechos legíveis do tombstone (sinal, bibliotecas .so e funções da pilha). */
    @androidx.annotation.RequiresApi(Build.VERSION_CODES.R)
    private fun tombstoneHints(e: ApplicationExitInfo): String {
        val bytes = e.traceInputStream?.use { it.readNBytes(256 * 1024) } ?: return ""
        val out = LinkedHashSet<String>()
        val sb = StringBuilder()
        fun flush() {
            val t = sb.toString(); sb.setLength(0)
            if (t.length >= 5 && (t.contains(".so") || t.startsWith("SIG") || t.contains("Abort") || t.contains("abort") ||
                    t.contains("::") || t.contains("Java_") || t.contains("signal") || t.contains("fault"))) out += t.take(160)
        }
        for (b in bytes) { val c = b.toInt() and 0xff; if (c in 32..126) sb.append(c.toChar()) else flush() }
        flush()
        return out.take(40).joinToString("\n")
    }

    /** Manda (uma vez) o que fez o app fechar da última vez. */
    suspend fun sendPending(context: Context) = withContext(Dispatchers.IO) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val reports = mutableListOf<Pair<String, String>>()
        prefs.getString("message", null)?.let { msg -> reports += msg to prefs.getString("stack", "").orEmpty() }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) runCatching {
            val am = context.getSystemService(ActivityManager::class.java)
            val last = prefs.getLong("exitSeen", 0L)
            val exits = am.getHistoricalProcessExitReasons(context.packageName, 0, 5)
                .filter { it.timestamp > last && (it.reason == ApplicationExitInfo.REASON_CRASH_NATIVE || it.reason == ApplicationExitInfo.REASON_ANR) }
            exits.forEach { e ->
                val kind = if (e.reason == ApplicationExitInfo.REASON_ANR) "travou (ANR)" else "queda nativa"
                // Queda nativa: o Android guarda o "tombstone" (Android 12+). Ele é
                // binário (protobuf), mas os nomes das bibliotecas/funções da pilha
                // aparecem como texto — já dá pra saber onde quebrou.
                val trace = runCatching { tombstoneHints(e) }.getOrNull().orEmpty()
                reports += "$kind: ${e.description ?: "sem descrição"} (Android ${Build.VERSION.RELEASE}, ${Build.MANUFACTURER} ${Build.MODEL})" to "pid ${e.pid} · ${e.timestamp}\n$trace"
            }
            exits.maxOfOrNull { it.timestamp }?.let { prefs.edit().putLong("exitSeen", it).apply() }
        }
        if (reports.isEmpty()) return@withContext

        val http = OkHttpClient.Builder().callTimeout(10, TimeUnit.SECONDS).build()
        var ok = true
        for ((message, stack) in reports) {
            val body = JSONObject()
                .put("where", "android-nativo:fechou")
                .put("path", "/app")
                .put("message", message.take(400))
                .put("stack", stack.take(6000))
                .put("version", BuildConfig.VERSION_NAME)
                .toString().toRequestBody("application/json".toMediaType())
            ok = ok && runCatching {
                http.newCall(Request.Builder().url("${Config.baseUrl}/api/system/client-error")
                    .header("User-Agent", Config.userAgent).post(body).build()).execute().use { it.isSuccessful }
            }.getOrDefault(false)
        }
        if (ok) prefs.edit().remove("message").remove("stack").apply()
    }
}
