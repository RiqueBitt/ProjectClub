package com.projectclub.android.ui.praca

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.lifecycle.lifecycleScope
import com.projectclub.android.App
import com.projectclub.android.Config
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

@Serializable
internal data class BlackoutSession(val ticket: String = "", val ready: Boolean = true)

/**
 * Compêndio do RPG BLACKOUT (instância BLACKOUT), em tela cheia.
 *
 * Não abre a casca do site: o app (já logado) pede um passe de uso único em
 * POST /api/blackout/session e o WebView abre /blackout/?t=<passe> — o
 * servidor troca pelo cookie do compêndio (ver server/src/routes/blackoutSite.js).
 * Sem acesso à instância, o servidor recusa e a tela mostra o aviso.
 * "Baixar PDF", "Backup .json" e "Abrir ficha" usam o suporte a arquivos da SiteActivity.
 */
class BlackoutActivity : SiteActivity() {
    override val path: String get() = "/blackout/"
    override val loadingText: String get() = "Abrindo o BLACKOUT…"

    override fun open() {
        showLoading(loadingText)
        lifecycleScope.launch {
            try {
                val s: BlackoutSession = (application as App).repo.api.post("/api/blackout/session")
                web.loadUrl("${Config.baseUrl}/blackout/?t=${Uri.encode(s.ticket)}")
            } catch (e: Exception) {
                showLoadingError(e.message ?: "Sem acesso ao BLACKOUT.")
            }
        }
    }

    companion object {
        fun open(context: Context) =
            context.startActivity(Intent(context, BlackoutActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
