package com.projectclub.android.ui.praca

import android.content.Context
import android.content.Intent

/**
 * Club Penguin (a Praça) dentro do app nativo.
 *
 * O jogo é Flash (cliente de 2012) rodando no Ruffle, então só existe como
 * página web: esta tela é a [SiteActivity] em modo jogo — deitada, imersiva,
 * tela sempre ligada — carregando /praca/app (a página só com o jogo). O
 * jogo completo (~340 MB) é guardado pelo service worker do site no
 * armazenamento do WebView: baixa uma vez, depois abre do aparelho. O botão
 * "Sair" da HUD do jogo chama window.PracaApp.exit() e fecha esta tela.
 */
class PracaActivity : SiteActivity() {
    override val path: String get() = GAME_PATH
    override val immersive: Boolean get() = true
    override val keepScreenOn: Boolean get() = true
    override val loadingText: String get() = "Abrindo o Club Penguin…"

    companion object {
        const val GAME_PATH = "/praca/app"
        fun start(context: Context) = context.startActivity(Intent(context, PracaActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
