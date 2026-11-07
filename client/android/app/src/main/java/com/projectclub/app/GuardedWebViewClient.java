package com.projectclub.app;

import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * Mesmo cliente do Capacitor (plugins, listeners, navegação continuam
 * iguais), só que falhas da página principal passam pelo ConnectionGuard
 * em vez de trocar a tela por uma página de erro sem conferir nada.
 *
 * - Erro de rede na página principal → o guarda confere internet/servidor.
 * - Erro 5xx na página principal → idem (servidor reiniciando, por exemplo).
 * - Erro 4xx → NÃO é falta de conexão (o servidor respondeu); deixa a
 *   página como está.
 * - Falhas de imagens, scripts e iframes não mexem na tela.
 */
public class GuardedWebViewClient extends BridgeWebViewClient {
    private final ConnectionGuard guard;

    public GuardedWebViewClient(Bridge bridge, ConnectionGuard guard) {
        super(bridge);
        this.guard = guard;
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        super.onReceivedError(view, request, error);
        if (request == null || !request.isForMainFrame()) return;
        String desc = error == null ? "" : String.valueOf(error.getDescription());
        int code = error == null ? 0 : error.getErrorCode();
        guard.mainFrameFailed("rede " + code + " " + desc, String.valueOf(request.getUrl()));
    }

    // Página carregou (login/renovação podem ter trocado o cookie): grava já.
    @Override
    public void onPageFinished(WebView view, String url) {
        super.onPageFinished(view, url);
        try {
            CookieManager.getInstance().flush();
        } catch (Exception ignored) {
            // sem WebView: nada a gravar
        }
    }

    @Override
    public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
        super.onReceivedHttpError(view, request, response);
        if (request == null || !request.isForMainFrame() || response == null) return;
        int status = response.getStatusCode();
        if (status >= 500) guard.mainFrameFailed("http " + status, String.valueOf(request.getUrl()));
    }
}
