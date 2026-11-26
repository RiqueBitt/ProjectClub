package com.projectclub.android.gamehub.clips

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.projectclub.android.MainActivity
import com.projectclub.android.R
import com.projectclub.android.notify.Notifier

/**
 * Gravador de clipes em primeiro plano (tipo "captura de tela", exigido pelo
 * Android 14+ antes de pegar o MediaProjection). A notificação fica com os
 * botões "Salvar 30 s" e "Parar" — dá pra salvar sem sair do jogo.
 */
class ClipService : Service() {
    private val tag = "PCClipes"
    private var engine: ClipEngine? = null
    private var projection: MediaProjection? = null
    private var settings = ClipSettings()
    private var isForeground = false
    private val main = Handler(Looper.getMainLooper())
    private val autoStop = Runnable { finish(save = true) }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> begin(intent)
            ACTION_SAVE -> saveReplay()
            ACTION_STOP -> finish(save = true)
            else -> finish(save = false)
        }
        return START_NOT_STICKY
    }

    private fun begin(intent: Intent) {
        // Já gravando: só confirma o primeiro plano (o Android exige a cada startForegroundService).
        if (engine != null) { foreground(); return }
        settings = ClipSettings(
            mode = intent.getStringExtra(EXTRA_MODE) ?: ClipSettings.MODE_BUFFER,
            seconds = intent.getIntExtra(EXTRA_SECONDS, 30),
            quality = intent.getIntExtra(EXTRA_QUALITY, 720),
            audio = intent.getBooleanExtra(EXTRA_AUDIO, true),
        )
        if (!foreground()) { fail("O Android não deixou gravar agora."); return }
        val code = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
        @Suppress("DEPRECATION")
        val data: Intent? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java) else intent.getParcelableExtra(EXTRA_RESULT_DATA)
        val mpm = getSystemService(MediaProjectionManager::class.java)
        val p = data?.let { runCatching { mpm.getMediaProjection(code, it) }.getOrNull() }
        if (p == null) { fail("Sem autorização pra gravar a tela."); return }
        projection = p
        // Android 14+: o callback tem que existir antes da tela virtual.
        p.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() { main.post { finish(save = true) } }
        }, main)
        val (sw, sh, dpi) = screen()
        val (w, h) = ClipEngine.sizeFor(sw, sh, settings.quality)
        val e = ClipEngine(this, p, settings, w, h, dpi) { msg -> main.post { fail(msg, keep = true) } }
        try {
            e.start()
        } catch (err: Exception) {
            Log.w(tag, "gravador não iniciou (${w}x$h)", err)
            runCatching { e.finish() }
            fail("Este celular não conseguiu gravar a tela.")
            return
        }
        engine = e
        ClipRecorder._state.value = ClipState.Running(settings, System.currentTimeMillis(), withAudio = e.withAudio)
        if (settings.mode == ClipSettings.MODE_RECORD) main.postDelayed(autoStop, MAX_RECORD_MS)
        refresh()
    }

    private fun saveReplay() {
        // Notificação velha (o app foi fechado): não tem o que salvar.
        val e = engine ?: run { if (!isForeground) stopSelf(); return }
        val st = ClipRecorder._state.value as? ClipState.Running ?: return
        if (st.saving || settings.mode != ClipSettings.MODE_BUFFER) return
        ClipRecorder._state.value = st.copy(saving = true)
        refresh()
        e.saveReplay { ev ->
            main.post {
                (ClipRecorder._state.value as? ClipState.Running)?.let { ClipRecorder._state.value = it.copy(saving = false) }
                announce(ev)
                if (engine != null) refresh()
            }
        }
    }

    private fun finish(save: Boolean) {
        main.removeCallbacks(autoStop)
        if (!isForeground) foreground() // quem chamou pode ter usado startForegroundService
        val e = engine
        engine = null
        val p = projection
        projection = null
        ClipRecorder._state.value = ClipState.Idle
        if (e == null) { runCatching { p?.stop() }; done(); return }
        // Fecha o MP4 fora da thread principal e só depois sai do primeiro plano
        // (senão o Android pode matar o app no meio do arquivo).
        Thread({
            val ev = runCatching { e.finish() }.getOrNull()
            runCatching { p?.stop() }
            main.post {
                if (save && ev != null) announce(ev)
                done()
            }
        }, "clip-stop").start()
    }

    private fun done() {
        if (engine != null) return // começou outra gravação enquanto fechava
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        isForeground = false
        stopSelf()
    }

    private fun fail(msg: String, keep: Boolean = false) {
        ClipRecorder._events.tryEmit(ClipEvent.Failed(msg))
        finish(save = keep)
    }

    private fun announce(ev: ClipEvent) {
        ClipRecorder._events.tryEmit(ev)
        if (ev is ClipEvent.Saved) savedNotice(ev.name)
    }

    // ---------- tela ----------

    private data class Screen(val w: Int, val h: Int, val dpi: Int)

    private fun screen(): Screen {
        val wm = getSystemService(WindowManager::class.java)
        val dpi = resources.displayMetrics.densityDpi
        return if (Build.VERSION.SDK_INT >= 30) {
            val b = wm.maximumWindowMetrics.bounds
            Screen(b.width(), b.height(), dpi)
        } else {
            val dm = DisplayMetrics()
            @Suppress("DEPRECATION")
            wm.defaultDisplay.getRealMetrics(dm)
            Screen(dm.widthPixels, dm.heightPixels, dpi)
        }
    }

    // ---------- notificações ----------

    private fun channel() {
        getSystemService(NotificationManager::class.java)?.createNotificationChannel(
            NotificationChannel(CHANNEL, "Gravação de clipes", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Aparece enquanto o Project Club grava a tela"
            },
        )
    }

    private fun foreground(): Boolean {
        channel()
        val type = if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION else 0
        return try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(), type)
            isForeground = true
            true
        } catch (e: Exception) {
            Log.w(tag, "startForeground recusado", e)
            false
        }
    }

    private fun refresh() {
        if (!isForeground) return
        runCatching { getSystemService(NotificationManager::class.java)?.notify(NOTIFICATION_ID, notification()) }
    }

    private fun openApp(req: Int): PendingIntent = PendingIntent.getActivity(this, req, Intent(this, MainActivity::class.java).apply {
        action = Notifier.ACTION_OPEN
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        putExtra(Notifier.EXTRA_LINK, "/jogos/clipes?tab=celular")
    }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun action(req: Int, act: String): PendingIntent =
        PendingIntent.getService(this, req, Intent(this, ClipService::class.java).setAction(act), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun notification(): Notification {
        val st = ClipRecorder._state.value as? ClipState.Running
        val buffer = settings.mode == ClipSettings.MODE_BUFFER
        val b = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_pc)
            .setContentTitle(if (buffer) "Replay ligado · últimos ${settings.seconds} s" else "Gravando a tela")
            .setContentText(
                when {
                    st?.saving == true -> "Salvando o clipe…"
                    buffer -> "Toque em Salvar quando rolar a jogada."
                    else -> "Toque em Parar pra salvar o vídeo."
                },
            )
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(openApp(40))
        if (!buffer && st != null) b.setUsesChronometer(true).setWhen(st.sinceMs).setShowWhen(true)
        if (buffer) b.addAction(0, "Salvar ${settings.seconds} s", action(41, ACTION_SAVE))
        b.addAction(0, if (buffer) "Desligar" else "Parar e salvar", action(42, ACTION_STOP))
        return b.build()
    }

    @SuppressLint("MissingPermission")
    private fun savedNotice(name: String) {
        val allowed = (Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            NotificationManagerCompat.from(this).areNotificationsEnabled()
        if (!allowed) return
        channel()
        val n = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_pc)
            .setContentTitle("Clipe salvo")
            .setContentText("$name · Galeria → Filmes → ${ClipStore.FOLDER}")
            .setAutoCancel(true)
            .setContentIntent(openApp(43))
            .build()
        runCatching { NotificationManagerCompat.from(this).notify(SAVED_ID, n) }
    }

    override fun onDestroy() {
        main.removeCallbacks(autoStop)
        engine?.let { e -> Thread({ runCatching { e.finish() } }, "clip-stop").start() }
        engine = null
        runCatching { projection?.stop() }
        projection = null
        ClipRecorder._state.value = ClipState.Idle
        super.onDestroy()
    }

    companion object {
        const val ACTION_START = "com.projectclub.android.clips.START"
        const val ACTION_SAVE = "com.projectclub.android.clips.SAVE"
        const val ACTION_STOP = "com.projectclub.android.clips.STOP"
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_RESULT_DATA = "resultData"
        const val EXTRA_MODE = "mode"
        const val EXTRA_SECONDS = "seconds"
        const val EXTRA_QUALITY = "quality"
        const val EXTRA_AUDIO = "audio"
        private const val CHANNEL = "clipes"
        private const val NOTIFICATION_ID = 7301
        private const val SAVED_ID = 7302
        private const val MAX_RECORD_MS = 60 * 60_000L
    }
}
