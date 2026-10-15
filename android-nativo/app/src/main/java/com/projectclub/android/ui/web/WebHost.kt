package com.projectclub.android.ui.web

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.MutableContextWrapper
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import com.projectclub.android.Config
import com.projectclub.android.net.Api
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONObject

/**
 * O site do Project Club (partes que não são nativas) num WebView ÚNICO,
 * que fica vivo enquanto o app está aberto.
 *
 * Antes, cada item do menu criava um WebView novo: o site inteiro iniciava
 * do zero (tela "Carregando...") toda vez. Agora o site carrega UMA vez
 * (já em segundo plano, logo depois do login) e trocar de menu só muda a
 * página dentro dele — na hora, sem tela de carregamento.
 *
 * Falha de rede não mostra mais a página de erro do Android: o app mostra
 * o aviso dele e tenta de novo sozinho quando a internet volta.
 */
class WebHost(private val appContext: Context, private val api: Api) {
    private val context = MutableContextWrapper(appContext)
    private val main = Handler(Looper.getMainLooper())
    private var web: WebView? = null

    /** O site já iniciou (dá pra trocar de página sem recarregar). */
    private var ready = false
    private var failedUrl: String? = null
    private var baseHistoryIndex = 0

    private val _title = MutableStateFlow("Project Club")
    val title: StateFlow<String> = _title
    private val _progress = MutableStateFlow(0f)
    val progress: StateFlow<Float> = _progress
    /** Mostra a capa nativa até o site estar pronto (sem piscar a tela do site). */
    private val _booting = MutableStateFlow(true)
    val booting: StateFlow<Boolean> = _booting
    private val _offline = MutableStateFlow(false)
    val offline: StateFlow<Boolean> = _offline

    /** Quem está mostrando o site cuida do seletor de arquivos. */
    var fileChooser: ((ValueCallback<Array<Uri>>, WebChromeClient.FileChooserParams) -> Boolean)? = null

    private val host = Uri.parse(Config.baseUrl).host.orEmpty()

    init {
        // Internet voltou: se a página tinha falhado, carrega de novo sozinho.
        runCatching {
            val cm = appContext.getSystemService(ConnectivityManager::class.java)
            cm?.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) { main.postDelayed({ if (_offline.value) retry() }, 800) }
            })
        }
    }

    /** Carrega o site em segundo plano (chamado logo depois do login). */
    fun preload() = main.post { if (web == null) { view(); load("/inicio") } }

    /** O WebView, pronto pra entrar na tela (tira de onde estava antes). */
    fun attach(activityContext: Context): WebView {
        context.baseContext = activityContext
        val v = view()
        (v.parent as? ViewGroup)?.removeView(v)
        v.onResume()
        return v
    }

    /** A tela [frame] saiu: tira o WebView dela (se ele ainda estiver ali). */
    fun detach(frame: ViewGroup) {
        val v = web ?: return
        if (v.parent === frame) {
            frame.removeView(v)
            context.baseContext = appContext
        }
    }

    /** Abre um endereço do site. Se ele já iniciou, troca de página na hora. */
    fun open(path: String) {
        val p = if (path.startsWith("/")) path else "/$path"
        val v = view()
        if (!ready || _offline.value) { load(p); return }
        val js = "(function(p){try{if(window.__pcNavigate){window.__pcNavigate(p);return 'ok'}" +
            "history.pushState(null,'',p);dispatchEvent(new PopStateEvent('popstate',{state:null}));return 'ok'}catch(e){return 'erro'}})(${JSONObject.quote(p)})"
        v.evaluateJavascript(js) { r -> if (r?.contains("ok") != true) load(p) }
        // Voltar a partir daqui sai pro app (não volta pras páginas de antes).
        main.postDelayed({ baseHistoryIndex = v.copyBackForwardList().currentIndex }, 150)
    }

    /** Botão voltar: volta dentro do site enquanto der; senão devolve false. */
    fun back(): Boolean {
        val v = web ?: return false
        if (v.copyBackForwardList().currentIndex > baseHistoryIndex && v.canGoBack()) { v.goBack(); return true }
        return false
    }

    fun reload() {
        if (_offline.value) retry() else web?.reload()
    }

    fun retry() {
        val url = failedUrl ?: return
        _offline.value = false
        web?.loadUrl(url)
    }

    fun onAppBackground() { web?.onPause() }
    fun onAppForeground() { web?.onResume() }

    /** Saiu da conta: o site e o login dele vão embora junto. */
    fun reset() = main.post {
        web?.let { (it.parent as? ViewGroup)?.removeView(it); it.destroy() }
        web = null; ready = false; failedUrl = null; _offline.value = false; _booting.value = true
        CookieManager.getInstance().removeAllCookies(null)
        CookieManager.getInstance().flush()
    }

    private fun load(path: String) {
        shareLogin(api)
        ready = false
        _booting.value = true
        view().loadUrl(Config.baseUrl + path)
    }

    private fun isSite(url: Uri?) = url?.host.equals(host, ignoreCase = true)

    @SuppressLint("SetJavaScriptEnabled")
    private fun view(): WebView = web ?: WebView(context).also { v ->
        web = v
        v.setBackgroundColor(android.graphics.Color.parseColor("#111318"))
        v.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mediaPlaybackRequiresUserGesture = false
            userAgentString = "$userAgentString ProjectClubNativo"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(v, true)
        v.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (isSite(request.url)) return false
                // Fora do Project Club: abre no navegador do celular.
                runCatching { view.context.startActivity(Intent(Intent.ACTION_VIEW, request.url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                return true
            }
            override fun onPageFinished(view: WebView, url: String?) {
                CookieManager.getInstance().flush()
                if (_offline.value) return
                ready = true
                baseHistoryIndex = view.copyBackForwardList().currentIndex
                // Dá um instante pro site montar antes de tirar a capa.
                main.postDelayed({ _booting.value = false }, 250)
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!request.isForMainFrame) return
                failedUrl = request.url.toString()
                ready = false
                _offline.value = true
            }
            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                if (!request.isForMainFrame || response.statusCode < 500) return
                failedUrl = request.url.toString()
                ready = false
                _offline.value = true
            }
        }
        v.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) { _progress.value = newProgress / 100f }
            override fun onReceivedTitle(view: WebView, t: String?) { if (!t.isNullOrBlank() && !t.startsWith("http")) _title.value = t }
            override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean =
                fileChooser?.invoke(cb, params) ?: run { cb.onReceiveValue(null); false }
            override fun onPermissionRequest(request: PermissionRequest) {
                // Só o próprio site pode pedir microfone/câmera.
                if (request.origin.host.equals(host, ignoreCase = true)) request.grant(request.resources) else request.deny()
            }
        }
    }
}

/** Dá ao site o "lembrar login" do app, pra ele abrir já logado (com sessão própria). */
internal fun shareLogin(api: Api) {
    val cm = CookieManager.getInstance()
    cm.setAcceptCookie(true)
    val existing = cm.getCookie(Config.baseUrl + "/api/auth/refresh").orEmpty()
    if (existing.contains("refreshToken=")) return // o site já tem a sessão dele
    val keep = api.cookies.find("pcKeep") ?: return
    val maxAge = ((keep.expiresAt - System.currentTimeMillis()) / 1000).coerceAtLeast(60)
    cm.setCookie(Config.baseUrl, "pcKeep=${keep.value}; Path=/api/auth; Max-Age=$maxAge; Secure; HttpOnly; SameSite=Lax")
    cm.flush()
}
