package com.projectclub.android.notify

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.projectclub.android.App
import com.projectclub.android.data.NoticesResponse
import com.projectclub.android.data.SessionState
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.TimeUnit

/**
 * Avisos do Project Club como notificação do celular, mesmo com o app
 * fechado e sem o Firebase do servidor.
 *
 * Com o app aberto (ou no fundo com a conexão viva) o aviso já chega na hora
 * pelo socket (App.onAlert → Notifier.notice). Com o app FECHADO só o push
 * (FCM) chegaria — e ele depende do FIREBASE_SERVICE_ACCOUNT_JSON no servidor.
 * Este trabalho de fundo cobre esse buraco: o Android acorda o app a cada
 * ~15 minutos (com internet), ele busca /api/notices e mostra como
 * notificação os avisos não lidos que ainda não mostrou.
 *
 * [NoticeSeen] guarda quais avisos já viraram notificação (por qualquer um
 * dos caminhos: socket, push ou este trabalho), pra nunca repetir.
 */
class NoticeCheckWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as? App ?: return Result.success()
        // App acabou de ser aberto pelo sistema: espera a sessão voltar (cookie salvo).
        val session = withTimeoutOrNull(45_000) { app.repo.session.first { it != SessionState.Loading } }
        if (session != SessionState.LoggedIn) return Result.success()
        val list = runCatching { app.repo.api.get<NoticesResponse>("/api/notices") }.getOrElse { return Result.retry() }
        val unread = list.notices.filter { it.readAt == null }
        val ctx = applicationContext
        if (!NoticeSeen.hasBaseline(ctx)) {
            // Primeira vez: não despeja os avisos antigos de uma vez, só marca.
            NoticeSeen.markAll(ctx, list.notices.map { it.id })
            return Result.success()
        }
        if (!app.isForeground.value) {
            unread.filter { !NoticeSeen.seen(ctx, it.id) }.take(5).reversed().forEach { n ->
                Notifier.notice(ctx, n.id, n.title ?: "Project Club", n.body.orEmpty(), n.link)
            }
        }
        NoticeSeen.markAll(ctx, unread.map { it.id })
        return Result.success()
    }

    companion object {
        private const val NAME = "avisos-em-segundo-plano"

        /** Agenda a checagem periódica (chamado no início do app; não duplica). */
        fun schedule(ctx: Context) {
            val req = PeriodicWorkRequestBuilder<NoticeCheckWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            runCatching { WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, req) }
        }

        /** Saiu da conta: para de checar (volta a agendar no próximo login). */
        fun cancel(ctx: Context) {
            runCatching { WorkManager.getInstance(ctx).cancelUniqueWork(NAME) }
            NoticeSeen.clear(ctx)
        }
    }
}

/** Avisos que já viraram notificação (os 200 mais recentes). */
object NoticeSeen {
    private const val PREFS = "notice_seen"
    private const val KEY = "ids"
    private const val MAX = 200

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun ids(ctx: Context): List<String> = prefs(ctx).getString(KEY, null)?.split('\n')?.filter { it.isNotBlank() }.orEmpty()

    fun hasBaseline(ctx: Context) = prefs(ctx).contains(KEY)
    fun seen(ctx: Context, id: String) = id in ids(ctx)

    @Synchronized
    fun markAll(ctx: Context, newIds: Collection<String>) {
        val cur = ids(ctx)
        val merged = (newIds.filter { it !in cur } + cur).take(MAX)
        prefs(ctx).edit().putString(KEY, merged.joinToString("\n")).apply()
    }

    fun mark(ctx: Context, id: String) = markAll(ctx, listOf(id))
    fun clear(ctx: Context) { prefs(ctx).edit().clear().apply() }
}
