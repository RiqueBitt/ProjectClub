package com.projectclub.android.gamehub.clips

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow

/** Como o celular grava (escolhido na aba Clipes → Neste celular). */
data class ClipSettings(
    /** buffer = guarda os últimos segundos e salva quando pedir; record = grava até parar. */
    val mode: String = MODE_BUFFER,
    /** Tamanho do replay no modo buffer. */
    val seconds: Int = 30,
    /** Lado menor do vídeo: 720 ou 1080. */
    val quality: Int = 720,
    /** Som do jogo (Android 10+). */
    val audio: Boolean = true,
) {
    companion object {
        const val MODE_BUFFER = "buffer"
        const val MODE_RECORD = "record"
        val SECONDS = listOf(15, 30, 60)
        val QUALITIES = listOf(720, 1080)
        private const val PREFS = "gamehub_clips"

        fun load(ctx: Context): ClipSettings {
            val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            return ClipSettings(
                mode = p.getString("mode", MODE_BUFFER)?.takeIf { it == MODE_BUFFER || it == MODE_RECORD } ?: MODE_BUFFER,
                seconds = p.getInt("seconds", 30).takeIf { it in SECONDS } ?: 30,
                quality = p.getInt("quality", 720).takeIf { it in QUALITIES } ?: 720,
                audio = p.getBoolean("audio", true),
            )
        }

        fun save(ctx: Context, s: ClipSettings) {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("mode", s.mode).putInt("seconds", s.seconds).putInt("quality", s.quality).putBoolean("audio", s.audio)
                .apply()
        }
    }
}

sealed interface ClipState {
    data object Idle : ClipState
    /** Gravando (desde [sinceMs]); [saving] = salvando um replay agora. */
    data class Running(val settings: ClipSettings, val sinceMs: Long, val saving: Boolean = false, val withAudio: Boolean = false) : ClipState
}

sealed interface ClipEvent {
    data class Saved(val uri: Uri, val name: String) : ClipEvent
    data class Failed(val message: String) : ClipEvent
}

/**
 * Porta de entrada do gravador: a tela pede a autorização de captura e chama
 * [start]; o [ClipService] faz o resto e publica o estado aqui.
 */
object ClipRecorder {
    internal val _state = MutableStateFlow<ClipState>(ClipState.Idle)
    val state: StateFlow<ClipState> = _state

    internal val _events = MutableSharedFlow<ClipEvent>(extraBufferCapacity = 8)
    val events: SharedFlow<ClipEvent> = _events

    fun start(ctx: Context, resultCode: Int, data: Intent, settings: ClipSettings) {
        val i = Intent(ctx, ClipService::class.java).setAction(ClipService.ACTION_START)
            .putExtra(ClipService.EXTRA_RESULT_CODE, resultCode)
            .putExtra(ClipService.EXTRA_RESULT_DATA, data)
            .putExtra(ClipService.EXTRA_MODE, settings.mode)
            .putExtra(ClipService.EXTRA_SECONDS, settings.seconds)
            .putExtra(ClipService.EXTRA_QUALITY, settings.quality)
            .putExtra(ClipService.EXTRA_AUDIO, settings.audio)
        runCatching { ContextCompat.startForegroundService(ctx, i) }
            .onFailure { Log.w("PCClipes", "não deu pra iniciar o gravador", it); _events.tryEmit(ClipEvent.Failed("Não deu pra começar a gravar.")) }
    }

    /** Modo buffer: salva os últimos segundos. */
    fun saveReplay(ctx: Context) = send(ctx, ClipService.ACTION_SAVE)

    /** Para (no modo gravar, salva o vídeo). */
    fun stop(ctx: Context) = send(ctx, ClipService.ACTION_STOP)

    private fun send(ctx: Context, action: String) {
        if (_state.value is ClipState.Idle) return
        runCatching { ctx.startService(Intent(ctx, ClipService::class.java).setAction(action)) }
            .onFailure { Log.w("PCClipes", "gravador não respondeu", it) }
    }
}
