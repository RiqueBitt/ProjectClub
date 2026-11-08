import { Component } from 'react';
import { useLocation } from 'react-router-dom';
import { isChunkLoadError, reloadForNewVersion } from '../utils/lazyWithRetry';

// Versão do site no relatório de erro (definida pelo Vite — vite.config.js).
// eslint-disable-next-line no-undef
const WEB_VERSION = typeof __WEB_VERSION__ !== 'undefined' ? __WEB_VERSION__ : '';

// Recuperação automática da tela inteira ("[tela]" no relatório): muitos
// travamentos são passageiros (um dado que chegou incompleto por um
// instante, a sessão sendo renovada...). Na 1ª queda tenta montar de novo
// sozinho depois de um instante; se cair de novo logo em seguida, para e
// deixa a pessoa decidir (Tentar de novo / Recarregar) — nunca entra em loop.
// Doc do React: https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary
export const AUTO_RETRY_DELAY_MS = 1500;
export const AUTO_RETRY_WINDOW_MS = 30000;
export function shouldAutoRetry(lastAutoRetryAt, now = Date.now()) {
  return !lastAutoRetryAt || now - lastAutoRetryAt > AUTO_RETRY_WINDOW_MS;
}

// Bug fix: "the page goes totally black after some hours, have to refresh"
// — this app had no error boundary anywhere, so ANY uncaught error during
// a render (e.g. a stale-session edge case a few hours in, where a
// component briefly reads a null `user` right before the redirect to
// /login kicks in) unmounted the entire React tree with nothing left in
// its place — since the page background itself is dark, an empty DOM
// looks exactly like a solid black screen. This catches that instead and
// offers a one-click recovery, rather than leaving the person stuck until
// they think to hard-refresh.
//
// `compact` renders a small inline fallback instead of a full-screen one,
// and "try again" just resets this boundary's own state (remounting only
// the subtree underneath it) instead of reloading the whole page — meant
// for wrapping one specific risky panel (e.g. the voice-call view) so a
// crash there doesn't take out chat/sidebar/everything else too, and
// doesn't force leaving a call just to recover from it.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, autoRetrying: false };
    this.lastAutoRetryAt = 0;
    this.autoRetryTimer = null;
    this.reset = () => {
      clearTimeout(this.autoRetryTimer);
      this.autoRetryTimer = null;
      this.setState({ hasError: false, autoRetrying: false });
    };
  }

  componentWillUnmount() {
    clearTimeout(this.autoRetryTimer);
  }

  static getDerivedStateFromError() {
    return { hasError: true, autoRetrying: false };
  }

  componentDidCatch(error, info) {
    // Arquivo de uma versão antiga do site (logo depois de atualizar):
    // recarrega uma vez em vez de mostrar "Essa parte travou".
    // Inclui "Cannot read properties of undefined (reading 'default')" —
    // o sintoma de um pedaço lazy que veio vazio depois de um deploy.
    if (isChunkLoadError(error) && reloadForNewVersion()) return;
    // eslint-disable-next-line no-console
    console.error('Unhandled render error, caught by ErrorBoundary:', error, info);
    // Manda o erro pro servidor (só a mensagem/pilha e a página) pra
    // dar pra descobrir a causa de verdade e corrigir.
    try {
      fetch('/api/system/client-error', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        body: JSON.stringify({
          where: this.props.compact ? 'parte' : 'tela',
          path: window.location.pathname,
          message: String(error?.message || error),
          stack: String(error?.stack || '').slice(0, 1500),
          componentStack: String(info?.componentStack || '').slice(0, 1500),
          version: navigator.userAgent.match(/project-club-desktop\/[\d.]+/)?.[0] || WEB_VERSION,
        }),
      }).catch(() => {});
    } catch { /* sem rede */ }
    // Tela inteira: tenta se recuperar sozinha uma vez (ver shouldAutoRetry).
    if (!this.props.compact && shouldAutoRetry(this.lastAutoRetryAt)) {
      this.lastAutoRetryAt = Date.now();
      clearTimeout(this.autoRetryTimer);
      this.autoRetryTimer = setTimeout(this.reset, AUTO_RETRY_DELAY_MS);
      this.setState({ autoRetrying: true });
    }
  }

  // BUG CORRIGIDO ("só algumas partes voltam ao normal, outras ficam
  // travadas"): ao mudar de página/canal (resetKey), a área volta a
  // tentar renderizar — antes ficava presa no aviso até clicar em
  // "Tentar de novo", mesmo trocando de canal.
  componentDidUpdate(prevProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) this.reset();
  }

  render() {
    if (this.state.hasError) {
      if (this.props.compact) {
        return (
          <div className="error-boundary-inline">
            <span>⚠️ Essa parte travou de um jeito inesperado.</span>
            <button className="btn-link" onClick={this.reset}>Tentar de novo</button>
          </div>
        );
      }
      return (
        <div className="error-boundary-screen">
          <div className="error-boundary-card">
            <div className="error-boundary-icon">⚠️</div>
            <h1>Algo deu errado</h1>
            {/* "Tentar de novo" remonta só a tela, sem recarregar a página
                (a sessão fica em memória); "Recarregar" é o F5 de sempre. */}
            <p>{this.state.autoRetrying ? 'Essa tela travou de um jeito inesperado. Tentando abrir de novo…' : 'Essa tela travou de um jeito inesperado. Tente de novo — se continuar, recarregue a página.'}</p>
            <div className="error-boundary-actions">
              <button className="btn-primary" onClick={this.reset}>Tentar de novo</button>
              <button className="btn-secondary" onClick={() => window.location.reload()}>Recarregar</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Boundary global (main.jsx): também volta a tentar quando a página muda
// (botão Voltar do navegador/celular), em vez de ficar presa no aviso.
export function RouteErrorBoundary({ children }) {
  const location = useLocation();
  return <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>;
}
