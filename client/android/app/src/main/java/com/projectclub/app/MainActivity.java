package com.projectclub.app;

import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  private ConnectionGuard connectionGuard;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Item pedido: compartilhamento de tela no Android — registra o
    // plugin nativo criado especificamente pra isso (ScreenSharePlugin.
    // java + ScreenCaptureService.java, nesta mesma pasta).
    registerPlugin(ScreenSharePlugin.class);
    // Navegador do Project Club (abas WebView dentro do app) — PcBrowserPlugin.java.
    registerPlugin(PcBrowserPlugin.class);
    super.onCreate(savedInstanceState);
    // Falha da página principal passa pelo guarda de conexão (confere
    // internet e servidor antes de mostrar a tela "sem conexão", que agora
    // é um app à parte — ConexaoActivity). Ver ConnectionGuard.java.
    if (getBridge() == null) return; // aparelho sem WebView: o Capacitor já mostra o aviso dele
    connectionGuard = new ConnectionGuard(this);
    getBridge().setWebViewClient(new GuardedWebViewClient(getBridge(), connectionGuard));
  }

  @Override
  public void onResume() {
    super.onResume();
    // Voltou da tela de conexão: recarrega o Project Club.
    if (ConnectionGuard.reloadWhenBack && connectionGuard != null && getBridge() != null) {
      ConnectionGuard.reloadWhenBack = false;
      WebView webView = getBridge().getWebView();
      if (webView != null) webView.loadUrl(connectionGuard.appUrl() + "/");
    }
  }

  // Grava os cookies (sessão/login) no disco ao sair da tela. O WebView só
  // grava de tempos em tempos; fechar o app logo depois de a sessão ser
  // renovada perdia o cookie novo e mandava pra tela de login.
  @Override
  public void onPause() {
    flushCookies();
    super.onPause();
  }

  @Override
  public void onStop() {
    flushCookies();
    super.onStop();
  }

  private static void flushCookies() {
    try {
      CookieManager.getInstance().flush();
    } catch (Exception ignored) {
      // WebView indisponível: nada a gravar
    }
  }

  @Override
  public void onDestroy() {
    flushCookies();
    if (connectionGuard != null) connectionGuard.shutdown();
    super.onDestroy();
  }
}
