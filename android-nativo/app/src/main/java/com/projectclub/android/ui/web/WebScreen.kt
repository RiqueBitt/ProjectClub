package com.projectclub.android.ui.web

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.viewinterop.AndroidView
import com.projectclub.android.Config
import com.projectclub.android.net.Api
import com.projectclub.android.ui.theme.PC

/**
 * Partes do Project Club que ainda não são nativas: abre o site dentro do app.
 *
 * Login: o site ganha uma sessão SEPARADA (a partir do "lembrar login" —
 * cookie pcKeep). Nunca compartilha o cookie de renovação do app nativo:
 * os dois renovando o mesmo cookie seria tratado como roubo de sessão.
 */
@OptIn(ExperimentalMaterial3Api::class)
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebScreen(api: Api, path: String, onBack: () -> Unit) {
    var title by remember { mutableStateOf("Project Club") }
    var progress by remember { mutableFloatStateOf(0f) }
    var webView by remember { mutableStateOf<WebView?>(null) }
    var fileCallback by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }

    val chooser = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data))
        fileCallback = null
    }

    BackHandler { webView?.let { if (it.canGoBack()) it.goBack() else onBack() } ?: onBack() }
    DisposableEffect(Unit) { onDispose { CookieManager.getInstance().flush(); webView?.destroy() } }

    Scaffold(
        containerColor = PC.Bg,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(containerColor = PC.Surface),
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Voltar") } },
                title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                actions = { IconButton(onClick = { webView?.reload() }) { Icon(Icons.Filled.Refresh, "Recarregar") } },
            )
        },
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    shareLogin(api)
                    WebView(ctx).apply {
                        setBackgroundColor(android.graphics.Color.parseColor("#111318"))
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        settings.mediaPlaybackRequiresUserGesture = false
                        settings.userAgentString = settings.userAgentString + " ProjectClubNativo"
                        CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                        webViewClient = object : WebViewClient() {
                            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                                val url = request.url
                                if (url.host.equals(Uri.parse(Config.baseUrl).host, ignoreCase = true)) return false
                                // Fora do Project Club: abre no navegador do celular.
                                runCatching { view.context.startActivity(Intent(Intent.ACTION_VIEW, url)) }
                                return true
                            }
                            override fun onPageFinished(view: WebView, url: String?) {
                                CookieManager.getInstance().flush()
                            }
                        }
                        webChromeClient = object : WebChromeClient() {
                            override fun onProgressChanged(view: WebView, newProgress: Int) { progress = newProgress / 100f }
                            override fun onReceivedTitle(view: WebView, t: String?) { if (!t.isNullOrBlank()) title = t }
                            override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                                fileCallback?.onReceiveValue(null)
                                fileCallback = cb
                                return try { chooser.launch(params.createIntent()); true } catch (_: Exception) { fileCallback = null; false }
                            }
                            override fun onPermissionRequest(request: PermissionRequest) {
                                // Só o próprio site pode pedir microfone/câmera.
                                if (request.origin.host.equals(Uri.parse(Config.baseUrl).host, ignoreCase = true)) request.grant(request.resources) else request.deny()
                            }
                        }
                        loadUrl(Config.baseUrl + path)
                        webView = this
                    }
                },
            )
            if (progress in 0.01f..0.99f) LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth().align(Alignment.TopCenter))
        }
    }
}

/** Dá ao site o "lembrar login" do app, pra ele abrir já logado (com sessão própria). */
private fun shareLogin(api: Api) {
    val cm = CookieManager.getInstance()
    cm.setAcceptCookie(true)
    val existing = cm.getCookie(Config.baseUrl + "/api/auth/refresh").orEmpty()
    if (existing.contains("refreshToken=")) return // o site já tem a sessão dele
    val keep = api.cookies.find("pcKeep") ?: return
    val maxAge = ((keep.expiresAt - System.currentTimeMillis()) / 1000).coerceAtLeast(60)
    cm.setCookie(Config.baseUrl, "pcKeep=${keep.value}; Path=/api/auth; Max-Age=$maxAge; Secure; HttpOnly; SameSite=Lax")
    cm.flush()
}
