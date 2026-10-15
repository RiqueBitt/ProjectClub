package com.projectclub.android.voice

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.projectclub.android.App
import com.projectclub.android.MainActivity
import com.projectclub.android.R
import com.projectclub.android.notify.CallActionReceiver
import com.projectclub.android.notify.Notifier

/**
 * Serviço em primeiro plano da chamada: mantém o microfone e o áudio
 * funcionando com o app minimizado ou a tela desligada, e — quando a
 * pessoa compartilha a tela — vira também do tipo "captura de tela"
 * (exigência do Android 14+ ANTES de pegar o MediaProjection).
 */
class CallService : Service() {
    private var title = "Chamada"
    private var sharing = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                title = intent.getStringExtra(EXTRA_TITLE) ?: title
                sharing = false
                foreground()
            }
            ACTION_SCREEN -> {
                sharing = true
                foreground()
                val code = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
                @Suppress("DEPRECATION")
                val data: Intent? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java) else intent.getParcelableExtra(EXTRA_RESULT_DATA)
                val mpm = getSystemService(MediaProjectionManager::class.java)
                val projection = if (data != null) runCatching { mpm.getMediaProjection(code, data) }.getOrNull() else null
                if (projection == null) { sharing = false; foreground() }
                else (application as App).voice.startScreenShare(projection)
            }
            ACTION_SCREEN_STOPPED -> { sharing = false; foreground() }
            ACTION_STOP -> {
                ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    private fun foreground() {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            var t = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            if (sharing) t = t or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            t
        } else 0
        ServiceCompat.startForeground(this, Notifier.ID_ONGOING_CALL, notification(), type)
    }

    private fun notification(): Notification {
        val open = PendingIntent.getActivity(this, 1, Intent(this, MainActivity::class.java).apply {
            action = ACTION_OPEN_CALL
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val hangup = PendingIntent.getBroadcast(this, 2, Intent(this, CallActionReceiver::class.java).apply {
            action = CallActionReceiver.ACTION_HANGUP
        }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, Notifier.CH_ONGOING)
            .setSmallIcon(R.drawable.ic_stat_pc)
            .setContentTitle(if (sharing) "Compartilhando a tela" else "Em chamada")
            .setContentText(title)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setContentIntent(open)
            .addAction(0, "Desligar", hangup)
            .build()
    }

    companion object {
        const val ACTION_START = "com.projectclub.android.call.START"
        const val ACTION_SCREEN = "com.projectclub.android.call.SCREEN"
        const val ACTION_SCREEN_STOPPED = "com.projectclub.android.call.SCREEN_STOPPED"
        const val ACTION_STOP = "com.projectclub.android.call.STOP"
        const val ACTION_OPEN_CALL = "com.projectclub.android.OPEN_CALL"
        const val EXTRA_TITLE = "title"
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_RESULT_DATA = "resultData"

        fun start(ctx: Context, title: String) =
            ContextCompat.startForegroundService(ctx, Intent(ctx, CallService::class.java).setAction(ACTION_START).putExtra(EXTRA_TITLE, title))

        /** Depois que a pessoa autorizou a captura de tela. */
        fun startScreen(ctx: Context, resultCode: Int, data: Intent) =
            ContextCompat.startForegroundService(ctx, Intent(ctx, CallService::class.java).setAction(ACTION_SCREEN)
                .putExtra(EXTRA_RESULT_CODE, resultCode).putExtra(EXTRA_RESULT_DATA, data))

        fun screenStopped(ctx: Context) {
            runCatching { ctx.startService(Intent(ctx, CallService::class.java).setAction(ACTION_SCREEN_STOPPED)) }
        }

        fun stop(ctx: Context) {
            runCatching { ctx.startService(Intent(ctx, CallService::class.java).setAction(ACTION_STOP)) }
        }
    }
}
