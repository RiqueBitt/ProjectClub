package com.projectclub.android.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.projectclub.android.App
import com.projectclub.android.MainActivity
import com.projectclub.android.R
import com.projectclub.android.data.SessionState
import com.projectclub.android.net.isCancellation
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Widget da tela inicial "Project Club — quem está online": quantos amigos
 * estão online e quem está em call (até 3 nomes). Tocar abre o app.
 *
 * Atualiza a cada 30 min (updatePeriodMillis, o mínimo do Android — o app
 * não usa WorkManager) e também quando o app abre/vai pro fundo/entra na
 * conta. Usa a MESMA sessão do app (App.api, com a renovação em fila do
 * Api.kt) — nunca guarda token próprio. O que fica salvo no aparelho é só
 * o último resumo (números + nomes), apagado ao sair da conta.
 */
class OnlineWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        val pending = goAsync()
        OnlineWidget.refresh(context.applicationContext, appWidgetIds, force = true) { pending.finish() }
    }

    override fun onDisabled(context: Context) {
        // Último widget removido da tela: não precisa mais guardar nada.
        OnlineWidget.clearCache(context.applicationContext)
    }
}

object OnlineWidget {
    private const val PREFS = "online_widget"
    private const val KEY_JSON = "summary"
    private const val KEY_SAVED_AT = "savedAt"
    private const val PATH = "/api/mobile/widget-summary"
    // Tudo precisa caber nos ~10 s que um BroadcastReceiver com goAsync() tem.
    private const val SESSION_WAIT_MS = 5_000L
    private const val FETCH_WAIT_MS = 3_500L
    // Abrir/fechar o app várias vezes seguidas não vira várias buscas.
    private const val MIN_GAP_MS = 30_000L

    @Volatile private var lastFetchAt = 0L

    private fun ids(context: Context): IntArray =
        runCatching {
            AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, OnlineWidgetProvider::class.java))
        }.getOrNull() ?: IntArray(0)

    /** O app abriu, foi pro fundo ou entrou na conta: atualiza se tiver widget na tela. */
    fun requestUpdate(context: Context) {
        val ctx = context.applicationContext
        val list = ids(ctx)
        if (list.isEmpty()) return
        refresh(ctx, list, force = false) {}
    }

    /** Saiu da conta: some com os nomes salvos e mostra "Entre no Project Club". */
    fun onLoggedOut(context: Context) {
        val ctx = context.applicationContext
        clearCache(ctx)
        val list = ids(ctx)
        if (list.isNotEmpty()) render(ctx, list, null, 0L, loggedOut = true)
    }

    fun clearCache(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }

    fun refresh(context: Context, widgetIds: IntArray, force: Boolean, done: () -> Unit) {
        val ctx = context.applicationContext
        // Mostra na hora o que já tinha (ou o estado inicial) enquanto busca.
        val (cached, savedAt) = loadCache(ctx)
        render(ctx, widgetIds, cached, savedAt, loggedOut = false)
        val app = ctx as? App
        val now = System.currentTimeMillis()
        if (app == null || (!force && now - lastFetchAt < MIN_GAP_MS)) { done(); return }
        lastFetchAt = now
        app.appScope.launch {
            try {
                val session = withTimeoutOrNull(SESSION_WAIT_MS) { app.repo.session.first { it !is SessionState.Loading } }
                when (session) {
                    is SessionState.LoggedOut -> {
                        clearCache(ctx)
                        render(ctx, widgetIds, null, 0L, loggedOut = true)
                    }
                    is SessionState.LoggedIn -> {
                        // A busca roda à parte: se passar do tempo do widget,
                        // ela termina sozinha e desenha quando chegar.
                        val job = app.appScope.async(Dispatchers.IO) {
                            runCatching { app.api.get<WidgetSummary>(PATH) }.getOrNull()
                        }
                        val fresh = withTimeoutOrNull(FETCH_WAIT_MS) { job.await() }
                        if (fresh != null) show(ctx, fresh)
                        else app.appScope.launch { job.await()?.let { show(ctx, it) } }
                    }
                    else -> Unit // ainda abrindo a sessão: fica o que já estava
                }
            } catch (t: Throwable) {
                if (!t.isCancellation()) android.util.Log.w("PCWidget", "falha ao atualizar o widget", t)
            } finally {
                done()
            }
        }
    }

    private fun show(ctx: Context, summary: WidgetSummary) {
        val savedAt = System.currentTimeMillis()
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_JSON, OnlineWidgetLogic.encode(summary))
            .putLong(KEY_SAVED_AT, savedAt)
            .apply()
        val list = ids(ctx)
        if (list.isNotEmpty()) render(ctx, list, summary, savedAt, loggedOut = false)
    }

    private fun loadCache(ctx: Context): Pair<WidgetSummary?, Long> {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return OnlineWidgetLogic.decode(p.getString(KEY_JSON, null)) to p.getLong(KEY_SAVED_AT, 0L)
    }

    private fun render(ctx: Context, widgetIds: IntArray, summary: WidgetSummary?, savedAt: Long, loggedOut: Boolean) {
        if (widgetIds.isEmpty()) return
        val t = OnlineWidgetLogic.texts(summary, savedAt, loggedOut)
        val views = RemoteViews(ctx.packageName, R.layout.widget_online)
        views.setTextViewText(R.id.widget_online_count, t.count)
        views.setTextViewText(R.id.widget_online_label, t.label)
        views.setTextViewText(R.id.widget_voice, t.voice)
        views.setTextViewText(R.id.widget_updated, t.updated)
        views.setOnClickPendingIntent(R.id.widget_root, openAppIntent(ctx))
        runCatching { AppWidgetManager.getInstance(ctx).updateAppWidget(widgetIds, views) }
    }

    private fun openAppIntent(ctx: Context): PendingIntent {
        val i = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        return PendingIntent.getActivity(ctx, 7301, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
}
