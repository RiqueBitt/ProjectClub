package com.projectclub.android.notify

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.projectclub.android.App
import com.projectclub.android.data.SessionState
import kotlinx.coroutines.launch

/**
 * Notificações push (Firebase Cloud Messaging) — chegam mesmo com o app
 * fechado. Só funciona quando o projeto tem o google-services.json (o
 * servidor também precisa de FIREBASE_SERVICE_ACCOUNT_JSON). O servidor
 * manda: { notification: {title, body}, data: {conversationId, channelId} }
 * pra DMs e menções, e { data: {link} } pros avisos.
 */
class PushService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        val app = application as? App ?: return
        if (app.repo.session.value == SessionState.LoggedIn) {
            app.appScope.launch { app.repo.registerPushToken(token) }
        }
    }

    override fun onMessageReceived(msg: RemoteMessage) {
        val app = application as? App ?: return
        val data = msg.data
        val title = msg.notification?.title ?: data["title"] ?: "Project Club"
        val body = msg.notification?.body ?: data["body"] ?: ""
        val conversationId = data["conversationId"].orEmpty()
        val channelId = data["channelId"].orEmpty()
        // Já está com essa conversa aberta na tela: não precisa avisar.
        val open = app.repo.openRoom.value
        if (app.isForeground.value && (open == conversationId || open == channelId)) return
        when {
            conversationId.isNotEmpty() -> Notifier.message(this, conversationId, title, body)
            channelId.isNotEmpty() -> Notifier.mention(this, channelId, title, body)
            else -> Notifier.notice(this, msg.messageId ?: title, title, body, data["link"])
        }
    }
}
