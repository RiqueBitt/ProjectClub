package com.projectclub.android.ui.voice

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import com.projectclub.android.Config
import com.projectclub.android.data.Repository
import com.projectclub.android.data.User
import com.projectclub.android.ui.praca.Handoff
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/** Quanto espaço a camada de atividades pede na tela da chamada. */
data class ActivityLayout(val mode: String = "hidden", val heightDp: Int = 0) {
    val full get() = mode == "full"
    val stage get() = mode == "stage" && heightDp > 0
}

/**
 * Atividades da call (vídeo e música juntos, dados, soundboard) no app:
 * um WebView TRANSPARENTE por cima da tela nativa da chamada, carregando
 * /embed/atividades-call/<canal> — os mesmos componentes do PC, então o
 * visual (inclusive a rolagem dos dados) é idêntico e tudo fica sincronizado
 * com quem está no PC. A voz continua no app nativo; a página só acompanha
 * a sala (ver client/src/pages/embed/CallActivitiesEmbed.jsx).
 *
 * Login: igual à SiteActivity — sessão própria do WebView; sem ela, entra
 * com um código de uso único do app (/api/auth/app-handoff).
 */
@SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
class CallActivitiesWeb(context: Context, private val repo: Repository, val channelId: String) {
    val layout: MutableState<ActivityLayout> = mutableStateOf(ActivityLayout())
    private val main = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var handoffTried = false
    private var pendingViewers: String? = null
    private val path = "/embed/atividades-call/${Uri.encode(channelId)}"

    val web: WebView = WebView(context).apply {
        setBackgroundColor(Color.TRANSPARENT)
        with(settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(false)
            userAgentString = Config.userAgent
        }
        addJavascriptInterface(Bridge(), "PcCall")
        webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                if (m.messageLevel() == ConsoleMessage.MessageLevel.ERROR) android.util.Log.w("CallActivities", "${m.message()} (${m.sourceId()}:${m.lineNumber()})")
                return true
            }
            override fun onPermissionRequest(request: PermissionRequest) { request.deny() }
        }
        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                // Só o próprio site (e o player do YouTube, que roda em iframe).
                return request.isForMainFrame && u.host != Uri.parse(Config.baseUrl).host
            }
            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                if (Uri.parse(url).path.orEmpty().startsWith("/login") && !handoffTried) { handoffTried = true; viaHandoff() }
            }
            override fun onPageFinished(view: WebView, url: String) { pendingViewers?.let { sendViewers(it) } }
        }
    }

    fun load() {
        CookieManager.getInstance().apply { setAcceptCookie(true); setAcceptThirdPartyCookies(web, false) }
        val cookies = CookieManager.getInstance().getCookie("${Config.baseUrl}/api/auth/refresh").orEmpty()
        if (cookies.contains("refreshToken=")) web.loadUrl(Config.baseUrl + path)
        else { handoffTried = true; viaHandoff() }
    }

    private fun viaHandoff() {
        scope.launch {
            try {
                val h: Handoff = repo.api.post("/api/auth/app-handoff")
                web.loadUrl("${Config.baseUrl}/api/auth/app-handoff/${Uri.encode(h.code)}?to=${Uri.encode(path)}")
            } catch (_: Exception) { /* sem atividades agora; tenta de novo na próxima abertura */ }
        }
    }

    /** Abre o menu Atividades (ou direto uma: youtube, music, dice, soundboard). */
    fun open(kind: String = "menu") = js("window.__pcActivities&&window.__pcActivities.open(${JSONObject.quote(kind)})")
    fun closePanel() = js("window.__pcActivities&&window.__pcActivities.close()")

    /** Quem está na call (avatares no palco do vídeo, igual ao PC). */
    fun setViewers(users: List<User>) {
        val arr = JSONArray()
        users.forEach { u ->
            arr.put(JSONObject().put("id", u.id).put("displayName", u.displayName ?: u.username ?: "").put("username", u.username ?: "")
                .put("avatarUrl", u.avatarUrl ?: JSONObject.NULL).put("avatarDecoration", u.avatarDecoration ?: JSONObject.NULL))
        }
        val json = arr.toString()
        pendingViewers = json
        sendViewers(json)
    }
    private fun sendViewers(json: String) = js("window.__pcActivities&&window.__pcActivities.setViewers($json)")

    private fun js(code: String) = main.post { runCatching { web.evaluateJavascript(code, null) } }

    fun destroy() {
        scope.cancel()
        runCatching { web.evaluateJavascript("window.__pcActivities&&window.__pcActivities.close()", null) }
        runCatching { web.loadUrl("about:blank"); web.removeJavascriptInterface("PcCall"); web.destroy() }
    }

    private inner class Bridge {
        /** A página diz quanto espaço precisa: {"mode":"full|stage|hidden","height":px}. */
        @JavascriptInterface fun layout(json: String) {
            val o = runCatching { JSONObject(json) }.getOrNull() ?: return
            val l = ActivityLayout(o.optString("mode", "hidden"), o.optInt("height", 0))
            main.post { layout.value = l }
        }
    }
}
