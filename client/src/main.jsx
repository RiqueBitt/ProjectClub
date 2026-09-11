import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './styles/global.css';
// Correção de responsividade mobile da barra lateral de Configurações —
// mantida em arquivo próprio (ver o comentário completo no topo do
// arquivo) em vez de dentro de global.css, que já está com ~400KB.
// Precisa vir DEPOIS do import acima para vencer no cascata do CSS.
import './styles/settings-mobile-fix.css';
import './i18n/index.js';

// BUG CORRIGIDO ("zoom deixa uma sobra preta enorme, conteúdo não
// preenche a janela"): o CSS "zoom: 0.9" aplicado no <html> (ver
// global.css) reescala visualmente o conteúdo, mas isso não é uma
// propriedade CSS padrão — window.innerWidth/innerHeight e unidades
// como 100vh continuam refletindo o tamanho FÍSICO real da janela, não
// o "tamanho aparente" depois do zoom. No navegador normal isso quase
// sempre passa despercebido, mas no app desktop (Electron), onde a
// janela pode ser redimensionada/maximizada livremente, esse
// descompasso vira uma sobra vazia visível — exatamente o bug
// relatado. A correção certa pra um app desktop é usar o zoom NATIVO
// do Chromium (webFrame.setZoomFactor, aplicado do lado do processo
// principal — ver desktop/main.js) em vez de CSS: ele reajusta a
// viewport inteira de um jeito consistente, sem esse problema. Essa
// classe desliga o zoom CSS só quando é o app Electron (onde o zoom
// nativo já assume — o navegador/Android continuam usando o CSS
// normalmente, sem mudança nenhuma pra eles).
if (window.electronAPI) {
  document.documentElement.classList.add('is-electron-app');
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* BUG CORRIGIDO ("mudar zoom/configuração desloga o usuário"): o
        ErrorBoundary global ficava ACIMA do AuthProvider — qualquer
        erro de render capturado em QUALQUER lugar dentro de <App/>
        (uma tela específica travando por qualquer motivo) desmontava
        a árvore inteira, incluindo o AuthProvider junto, perdendo
        user/token da memória mesmo sem nenhum logout de verdade ter
        acontecido — e o próprio botão "Recarregar" do boundary
        (window.location.reload()) reforçava a sensação de sessão
        perdida. Trocada a ordem: o AuthProvider agora fica FORA do
        boundary — um erro de render em qualquer tela ainda é
        capturado e mostra a tela de recuperação normalmente, mas
        nunca mais desmonta a sessão em memória enquanto isso. */}
    <BrowserRouter>
      <AuthProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);

// One-time cleanup: an earlier build of this app registered a service
// worker (/sw.js) that no longer exists. Anyone who visited before may
// still have it installed, silently serving whatever it cached at install
// time forever — including old, buggy layouts — regardless of how many
// times the site is redeployed. This unregisters any such leftover worker
// so the browser goes back to loading the real, current files.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => reg.unregister());
  }).catch(() => {});
}
