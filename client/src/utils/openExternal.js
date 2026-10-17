// Abre um link no NAVEGADOR/APP EXTERNO de verdade, nunca dentro da
// própria janela do app — usado pelo botão "Baixar agora" do aviso de
// atualização (a página de download nunca é mostrada dentro do app
// nativo, ver RootGate em App.jsx, então precisa mandar pra fora de
// propósito) e por qualquer outro link externo clicado a partir do app.
export function openExternal(url) {
  if (typeof window === 'undefined') return;
  if (window.electronAPI?.openExternal) {
    window.electronAPI.openExternal(url);
    return;
  }
  // Convenção do Capacitor/Cordova — '_system' força abrir no navegador
  // padrão do celular (Chrome/etc), não na WebView do próprio app.
  if (window.Capacitor?.isNativePlatform?.()) {
    window.open(url, '_system');
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
