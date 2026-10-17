package com.projectclub.android.notify

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.projectclub.android.MainActivity
import com.projectclub.android.R

/**
 * Notificações do app nativo. Canais separados (o usuário escolhe som e
 * importância de cada um nas configurações do Android):
 * mensagens, menções, avisos, chamadas (tela cheia) e call em andamento.
 */
object Notifier {
    const val CH_MESSAGES = "mensagens"
    const val CH_MENTIONS = "mencoes"
    const val CH_NOTICES = "avisos"
    const val CH_CALLS = "chamadas"
    const val CH_ONGOING = "em_chamada"

    const val EXTRA_CONVERSATION = "conversationId"
    const val EXTRA_CHANNEL = "channelId"
    const val EXTRA_LINK = "link"
    const val EXTRA_CALL_CHANNEL = "callChannel"
    const val EXTRA_CALLER = "callerName"
    const val ACTION_OPEN = "com.projectclub.android.OPEN"
    const val ACTION_INCOMING_CALL = "com.projectclub.android.INCOMING_CALL"
    const val ACTION_ANSWER_CALL = "com.projectclub.android.ANSWER_CALL"

    const val ID_ONGOING_CALL = 7001

    fun createChannels(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val ring = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        val ringAttrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
        nm.createNotificationChannels(listOf(
            NotificationChannel(CH_MESSAGES, "Mensagens diretas", NotificationManager.IMPORTANCE_HIGH),
            NotificationChannel(CH_MENTIONS, "Menções", NotificationManager.IMPORTANCE_HIGH),
            NotificationChannel(CH_NOTICES, "Avisos do Project Club", NotificationManager.IMPORTANCE_DEFAULT),
            NotificationChannel(CH_CALLS, "Chamadas recebidas", NotificationManager.IMPORTANCE_HIGH).apply {
                setSound(ring, ringAttrs)
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 800, 600, 800, 600, 800)
            },
            NotificationChannel(CH_ONGOING, "Chamada em andamento", NotificationManager.IMPORTANCE_LOW),
        ))
    }

    private fun canNotify(ctx: Context): Boolean =
        (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            NotificationManagerCompat.from(ctx).areNotificationsEnabled()

    private fun openIntent(ctx: Context, requestCode: Int, fill: Intent.() -> Unit): PendingIntent {
        val i = Intent(ctx, MainActivity::class.java).apply {
            action = ACTION_OPEN
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            fill()
        }
        return PendingIntent.getActivity(ctx, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun post(ctx: Context, id: Int, n: android.app.Notification) {
        if (!canNotify(ctx)) return
        try { NotificationManagerCompat.from(ctx).notify(id, n) } catch (_: SecurityException) { /* sem permissão */ }
    }

    /** Depois de se atualizar o Android fecha o app: avisa e abre com um toque. */
    fun appUpdated(ctx: Context, versionName: String) {
        createChannels(ctx)
        val id = 7101
        val n = NotificationCompat.Builder(ctx, CH_NOTICES)
            .setSmallIcon(R.drawable.ic_stat_pc)
            .setContentTitle("Project Club atualizado")
            .setContentText("Versão $versionName instalada. Toque para abrir.")
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(openIntent(ctx, id) { })
            .build()
        post(ctx, id, n)
    }

    fun message(ctx: Context, conversationId: String, title: String, text: String) {
        val id = conversationId.hashCode()
        val n = NotificationCompat.Builder(ctx, CH_MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_pc)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(openIntent(ctx, id) { putExtra(EXTRA_CONVERSATION, conversationId) })
            .build()
        post(ctx, id, n)
    }

    fun mention(ctx: Context, channelId: String, title: String, text: String) {
        val id = channelId.hashCode()
        val n = NotificationCompat.Builder(ctx, CH_MENTIONS)
            .setSmallIcon(R.drawable.ic_stat_pc)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setCategory(NotificationCompat.CATEGORY_SOCIAL)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(openIntent(ctx, id) { putExtra(EXTRA_CHANNEL, channelId) })
            .build()
        post(ctx, id, n)
    }

    fun notice(ctx: Context, id: String, title: String, text: String, link: String?) {
        val nid = id.hashCode()
        val n = NotificationCompat.Builder(ctx, CH_NOTICES)
            .setSmallIcon(R.drawable.ic_stat_pc)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setAutoCancel(true)
            .setContentIntent(openIntent(ctx, nid) { putExtra(EXTRA_LINK, link ?: "/notifications") })
            .build()
        post(ctx, nid, n)
    }

    /** Chamada recebendo: toca, abre em tela cheia (inclusive com a tela bloqueada). */
    fun incomingCall(ctx: Context, conversationId: String, callChannel: String, callerName: String) {
        val id = callId(conversationId)
        val full = PendingIntent.getActivity(ctx, id, Intent(ctx, MainActivity::class.java).apply {
            action = ACTION_INCOMING_CALL
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_CONVERSATION, conversationId); putExtra(EXTRA_CALL_CHANNEL, callChannel); putExtra(EXTRA_CALLER, callerName)
        }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val answer = PendingIntent.getActivity(ctx, id + 1, Intent(ctx, MainActivity::class.java).apply {
            action = ACTION_ANSWER_CALL
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_CONVERSATION, conversationId); putExtra(EXTRA_CALL_CHANNEL, callChannel)
        }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val decline = PendingIntent.getBroadcast(ctx, id + 2, Intent(ctx, CallActionReceiver::class.java).apply {
            action = CallActionReceiver.ACTION_DECLINE
            putExtra(EXTRA_CONVERSATION, conversationId)
        }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(ctx, CH_CALLS)
            .setSmallIcon(R.drawable.ic_stat_pc)
            .setContentTitle(callerName)
            .setContentText("Chamada de voz no Project Club")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setAutoCancel(true)
            .setTimeoutAfter(45_000)
            .setFullScreenIntent(full, true)
            .setContentIntent(full)
            .addAction(0, "Recusar", decline)
            .addAction(0, "Atender", answer)
            .build()
        post(ctx, id, n)
    }

    fun cancelCall(ctx: Context, conversationId: String) {
        NotificationManagerCompat.from(ctx).cancel(callId(conversationId))
    }

    fun cancelConversation(ctx: Context, conversationId: String) {
        NotificationManagerCompat.from(ctx).cancel(conversationId.hashCode())
    }

    private fun callId(conversationId: String) = ("call:$conversationId").hashCode()
}
