package com.projectclub.android.ui.praca

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import com.projectclub.android.App
import com.projectclub.android.Config
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

/**
 * Club Penguin (a Praça) dentro do app nativo.
 *
 * O jogo é Flash (cliente de 2012) rodando no Ruffle, então só existe como
 * página web: esta tela é um WebView em tela cheia, deitado, carregando
 * /praca/app — a versão da página sem o resto do site (só o jogo).
 *
 * Login: o WebView não pode usar o cookie de sessão do app (o refresh token
 * é rotativo e de uso único — a sessão do app morreria). Na primeira vez o
 * app pede um código de uso único (POST /api/auth/app-handoff) e o WebView
 * abre /api/auth/app-handoff/<código>, que cria uma sessão própria pro
 * WebView (cookie dele, persistente) e redireciona pro jogo. Das próximas
 * vezes o cookie do WebView já está lá e o jogo abre direto.
 *
 * O jogo completo (~340 MB) é guardado pelo service worker do site no
 * armazenamento do WebView — igual ao navegador: baixa uma vez, depois abre
 * do aparelho.
 */
@Serializable
internal data class Handoff(val code: String = "")

class PracaActivity : ComponentActivity() {
    private lateinit var web: WebView
    private lateinit var loading: View
    private lateinit var status: TextView
    private var handoffTried = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        immersive()

        val root = FrameLayout(this).apply { setBackgroundColor(Color.parseColor("#061A30")) }
        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#061A30"))
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        loading = layoutLoading()
        root.addView(web)
        root.addView(loading)
        setContentView(root)

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = true
            useWideViewPort = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(false)
            // Mesmo User-Agent do app: a sessão do WebView aparece como o mesmo
            // aparelho e não dispara aviso de "login em aparelho novo".
            userAgentString = Config.userAgent
        }
        // Botão "Sair" da HUD do jogo (página) → fecha esta tela.
        web.addJavascriptInterface(Bridge(), "PracaApp")
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, false)
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                if (m.messageLevel() == ConsoleMessage.MessageLevel.ERROR) android.util.Log.w("Praca", "${m.message()} (${m.sourceId()}:${m.lineNumber()})")
                return true
            }
            override fun onPermissionRequest(request: PermissionRequest) { request.deny() }
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                val base = Uri.parse(Config.baseUrl)
                // links pra fora do site abrem no navegador; o jogo fica aqui
                if (!url.host.equals(base.host, ignoreCase = true)) {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                    return true
                }
                return false
            }
            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                // Sessão do WebView morreu (90 dias / revogada): entra de novo pelo app, uma vez.
                if (Uri.parse(url).path.orEmpty().startsWith("/login") && !handoffTried) { handoffTried = true; openViaHandoff() }
            }
            override fun onPageFinished(view: WebView, url: String) { hideLoading() }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) showError("Não deu pra abrir o jogo (${error.description}). Confira a conexão.")
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { finish() }
        })

        open()
    }

    /** Já tem sessão própria no WebView? Vai direto; senão, entra pelo app. */
    private fun open() {
        val cookies = CookieManager.getInstance().getCookie("${Config.baseUrl}/api/auth/refresh").orEmpty()
        if (cookies.contains("refreshToken=")) web.loadUrl("${Config.baseUrl}$GAME_PATH")
        else { handoffTried = true; openViaHandoff() }
    }

    private fun openViaHandoff() {
        status.text = "Entrando com sua conta…"
        lifecycleScope.launch {
            try {
                val h: Handoff = (application as App).repo.api.post("/api/auth/app-handoff")
                web.loadUrl("${Config.baseUrl}/api/auth/app-handoff/${Uri.encode(h.code)}?to=${Uri.encode(GAME_PATH)}")
            } catch (e: Exception) {
                showError(e.message ?: "Não deu pra entrar no jogo. Tente de novo.")
            }
        }
    }

    private fun layoutLoading(): View {
        val box = FrameLayout(this).apply { setBackgroundColor(Color.parseColor("#061A30")) }
        val bar = ProgressBar(this).apply {
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { gravity = android.view.Gravity.CENTER; bottomMargin = 48 }
        }
        status = TextView(this).apply {
            text = "Abrindo o Club Penguin…"
            setTextColor(Color.WHITE)
            textSize = 15f
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { gravity = android.view.Gravity.CENTER; topMargin = 72 }
        }
        box.addView(bar); box.addView(status)
        box.setOnClickListener { if (status.tag == "error") { status.tag = null; loading.visibility = View.VISIBLE; status.text = "Abrindo o Club Penguin…"; handoffTried = false; open() } }
        return box
    }

    private fun hideLoading() { loading.visibility = View.GONE }
    private fun showError(msg: String) {
        loading.visibility = View.VISIBLE
        status.tag = "error"
        status.text = "$msg\nToque para tentar de novo."
    }

    private fun immersive() {
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) { super.onWindowFocusChanged(hasFocus); if (hasFocus) immersive() }
    override fun onResume() { super.onResume(); web.onResume(); web.resumeTimers() }
    override fun onPause() { web.pauseTimers(); web.onPause(); super.onPause() }
    override fun onDestroy() { web.loadUrl("about:blank"); web.destroy(); super.onDestroy() }

    /** window.PracaApp na página do jogo. */
    inner class Bridge {
        @JavascriptInterface fun exit() { runOnUiThread { finish() } }
    }

    companion object {
        const val GAME_PATH = "/praca/app"
        fun start(context: Context) = context.startActivity(Intent(context, PracaActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
