package com.projectclub.android.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.projectclub.android.App
import org.json.JSONObject

/** Botões das notificações de chamada: Recusar e Desligar. */
class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext as? App ?: return
        when (intent.action) {
            ACTION_DECLINE -> {
                val conversationId = intent.getStringExtra(Notifier.EXTRA_CONVERSATION) ?: return
                app.repo.realtime.emit("dm-call:reject", JSONObject().put("conversationId", conversationId))
                Notifier.cancelCall(context, conversationId)
            }
            ACTION_HANGUP -> app.voice.leave()
        }
    }

    companion object {
        const val ACTION_DECLINE = "com.projectclub.android.DECLINE_CALL"
        const val ACTION_HANGUP = "com.projectclub.android.HANGUP"
    }
}
