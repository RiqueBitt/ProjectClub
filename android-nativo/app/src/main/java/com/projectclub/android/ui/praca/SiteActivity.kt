package com.projectclub.android.ui.praca

import android.annotation.SuppressLint
import android.content.ContentValues
import android.os.Build
import android.provider.MediaStore
import android.util.Base64
import android.webkit.ValueCallback
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
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
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
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
import androidx.core.view.ViewCompat
import androidx.lifecycle.lifecycleScope
import com.projectclub.android.App
import com.projectclub.android.Config
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

@Serializable
internal data class Handoff(val code: String = "")

/**
 * Uma página do site dentro do app, JÁ LOGADA — é por aqui que entram o
 * Painel da Equipe (/admin) e tudo que ainda não tem tela nativa.
 *
 * Login: o WebView não pode usar o cookie de sessão do app (o refresh token
 * é rotativo e de uso único — a sessão do app morreria). Na primeira vez o
 * app pede um código de uso único (POST /api/auth/app-handoff) e o WebView
 * abre /api/auth/app-handoff/<código>, que cria uma sessão própria pro
 * WebView (cookie dele, persistente) e redireciona pra página. Das próximas
 * vezes o cookie do WebView já está lá e a página abre direto.
 *
 * Telas filhas podem mudar path, modo imersivo e texto de carregando.
 */
open class SiteActivity : ComponentActivity() {
    protected lateinit var web: WebView
    private lateinit var loading: View
    private lateinit var status: TextView
    private var handoffTried = false

    // Arquivos: o WebView sozinho não baixa nada gerado pela página (blob:/data:,
    // ex.: "Baixar PDF") nem abre o seletor de <input type="file">.
    private var pendingSave: Pair<String, ByteArray>? = null
    private val createDoc = registerForActivityResult(ActivityResultContracts.CreateDocument("*/*")) { uri ->
        val p = pendingSave; pendingSave = null
        if (uri != null && p != null) {
            runCatching { contentResolver.openOutputStream(uri)?.use { it.write(p.second) } ?: error("sem saída") }
                .onSuccess { toast("Arquivo salvo.") }.onFailure { toast("Não deu pra salvar o arquivo.") }
        }
    }
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val pickFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data))
        fileCallback = null
    }

    /** Caminho no site (extra "path"); as subclasses podem fixar. */
    protected open val path: String get() = intent?.getStringExtra(EXTRA_PATH)?.takeIf { it.startsWith("/") } ?: "/inicio"
    protected open val immersive: Boolean get() = false
    protected open val keepScreenOn: Boolean get() = false
    protected open val loadingText: String get() = "Abrindo…"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (immersive) { WindowCompat.setDecorFitsSystemWindows(window, false); applyImmersive() }
        if (keepScreenOn) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val root = FrameLayout(this).apply { setBackgroundColor(BG) }
        web = WebView(this).apply {
            setBackgroundColor(BG)
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        loading = layoutLoading()
        root.addView(web)
        root.addView(loading)
        setContentView(root)
        if (!immersive) {
            // barra de status/navegação do sistema fora do conteúdo
            ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
                val sb = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
                v.setPadding(sb.left, sb.top, sb.right, sb.bottom); insets
            }
        }

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
        web.addJavascriptInterface(Bridge(), "PracaApp")
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, false)
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                if (m.messageLevel() == ConsoleMessage.MessageLevel.ERROR) android.util.Log.w("SiteWeb", "${m.message()} (${m.sourceId()}:${m.lineNumber()})")
                return true
            }
            override fun onPermissionRequest(request: PermissionRequest) { request.deny() }
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try { pickFile.launch(params.createIntent()); true } catch (_: Exception) { fileCallback = null; false }
            }
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                val base = Uri.parse(Config.baseUrl)
                // links pra fora do site abrem no navegador do aparelho
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
            override fun onPageFinished(view: WebView, url: String) { hideLoading(); view.evaluateJavascript(DOWNLOAD_JS, null) }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) showError("Não deu pra abrir (${error.description}). Confira a conexão.")
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (!immersive && web.canGoBack()) web.goBack() else finish() }
        })

        open()
    }

    /** Já tem sessão própria no WebView? Vai direto; senão, entra pelo app. */
    protected open fun open() {
        val cookies = CookieManager.getInstance().getCookie("${Config.baseUrl}/api/auth/refresh").orEmpty()
        if (cookies.contains("refreshToken=")) web.loadUrl(Config.baseUrl + path)
        else { handoffTried = true; openViaHandoff() }
    }

    private fun openViaHandoff() {
        status.text = "Entrando com sua conta…"
        lifecycleScope.launch {
            try {
                val h: Handoff = (application as App).repo.api.post("/api/auth/app-handoff")
                web.loadUrl("${Config.baseUrl}/api/auth/app-handoff/${Uri.encode(h.code)}?to=${Uri.encode(path)}")
            } catch (e: Exception) {
                showError(e.message ?: "Não deu pra entrar. Tente de novo.")
            }
        }
    }

    private fun layoutLoading(): View {
        val box = FrameLayout(this).apply { setBackgroundColor(BG) }
        val bar = ProgressBar(this).apply {
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { gravity = android.view.Gravity.CENTER; bottomMargin = 48 }
        }
        status = TextView(this).apply {
            text = loadingText
            setTextColor(Color.WHITE)
            textSize = 15f
            gravity = android.view.Gravity.CENTER
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { gravity = android.view.Gravity.CENTER; topMargin = 72 }
        }
        box.addView(bar); box.addView(status)
        box.setOnClickListener { if (status.tag == "error") { status.tag = null; loading.visibility = View.VISIBLE; status.text = loadingText; handoffTried = false; open() } }
        return box
    }

    private fun hideLoading() { loading.visibility = View.GONE }
    protected fun showLoading(text: String) { loading.visibility = View.VISIBLE; status.tag = null; status.text = text }
    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

    /** Salva em Downloads (Android 10+); sem isso, pergunta onde salvar. */
    private fun saveDownload(name: String, mime: String, bytes: ByteArray) {
        val safe = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").take(120).ifBlank { "arquivo" }
        if (Build.VERSION.SDK_INT >= 29) {
            val ok = runCatching {
                val v = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, safe)
                    put(MediaStore.Downloads.MIME_TYPE, mime.ifBlank { "application/octet-stream" })
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v) ?: error("sem pasta")
                contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: error("sem saída")
                v.clear(); v.put(MediaStore.Downloads.IS_PENDING, 0)
                contentResolver.update(uri, v, null, null)
            }.isSuccess
            if (ok) { toast("Salvo em Downloads: $safe"); return }
        }
        pendingSave = safe to bytes
        runCatching { createDoc.launch(safe) }.onFailure { pendingSave = null; toast("Não deu pra salvar o arquivo.") }
    }

    protected fun showLoadingError(msg: String) = showError(msg)
    private fun showError(msg: String) {
        loading.visibility = View.VISIBLE
        status.tag = "error"
        status.text = "$msg\nToque para tentar de novo."
    }

    private fun applyImmersive() {
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) { super.onWindowFocusChanged(hasFocus); if (hasFocus && immersive) applyImmersive() }
    override fun onResume() { super.onResume(); web.onResume(); web.resumeTimers() }
    override fun onPause() { web.pauseTimers(); web.onPause(); super.onPause() }
    override fun onDestroy() { web.loadUrl("about:blank"); web.destroy(); super.onDestroy() }

    /** window.PracaApp na página: "Sair" fecha esta tela. */
    inner class Bridge {
        @JavascriptInterface fun exit() { runOnUiThread { finish() } }
        /** Arquivo gerado pela página (ver DOWNLOAD_JS), em base64. */
        @JavascriptInterface fun saveFile(name: String, mime: String, base64: String) {
            val bytes = runCatching { Base64.decode(base64, Base64.DEFAULT) }.getOrNull()
            runOnUiThread { if (bytes != null) saveDownload(name, mime, bytes) else toast("Não deu pra salvar o arquivo.") }
        }
        @JavascriptInterface fun saveFailed(@Suppress("UNUSED_PARAMETER") msg: String) { runOnUiThread { toast("Não deu pra salvar o arquivo.") } }
    }

    companion object {
        const val EXTRA_PATH = "path"
        // Links de download da página (<a download> com blob:/data:, inclusive os
        // criados por script e clicados com a.click()) → arquivo pelo app.
        private const val DOWNLOAD_JS = """(function(){if(window.__pcDl||!window.PracaApp||!PracaApp.saveFile)return;window.__pcDl=1;
function grab(a){var h=a.href||'';if(!/^(blob:|data:)/.test(h))return false;var n=a.getAttribute('download')||'arquivo';
fetch(h).then(function(r){return r.blob()}).then(function(b){var f=new FileReader();f.onload=function(){var s=String(f.result);PracaApp.saveFile(n,b.type||'application/octet-stream',s.slice(s.indexOf(',')+1))};f.readAsDataURL(b)}).catch(function(e){PracaApp.saveFailed(String(e))});return true}
var o=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.hasAttribute('download')&&grab(this))return;return o.apply(this,arguments)};
document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[download]');if(a&&grab(a))e.preventDefault()},true);})();"""
        private val BG = Color.parseColor("#0B0D12")
        /** Abre um caminho do site (ex.: "/admin") numa tela própria, logado. */
        fun open(context: Context, path: String) =
            context.startActivity(Intent(context, SiteActivity::class.java).putExtra(EXTRA_PATH, path).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
