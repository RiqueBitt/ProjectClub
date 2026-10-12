import { useEffect, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import BrowserHost from '../browser/BrowserHost.jsx';
import BrowserChrome, { B, Ico } from '../browser/BrowserChrome.jsx';
import { BrowserBridge } from '../browser/BrowserShell.jsx';
import { isFeatureEnabled } from '../utils/features';

const BROWSER_ON = isFeatureEnabled('browser');

// ============================================================
// Modo offline do app desktop: o servidor do Project Club não respondeu,
// então o app abre esta cópia do navegador que vem DENTRO do instalador.
// Mesmas abas, favoritos, histórico e senhas (arquivos no computador).
// Quando o Project Club volta, aparece o botão para voltar a ele.
// ============================================================

const api = () => window.electronAPI || {};

function moveDrag(e) {
  const a = api();
  if (e.button !== 0 || !a.windowMoveBy) return;
  let lx = e.screenX; let ly = e.screenY;
  const move = (ev) => { a.windowMoveBy(ev.screenX - lx, ev.screenY - ly); lx = ev.screenX; ly = ev.screenY; };
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

function TitleBar({ online, retrying, onRetry }) {
  const [max, setMax] = useState(false);
  useEffect(() => {
    api().windowIsMaximized?.().then(setMax).catch(() => {});
    return api().onWindowMaximizedChanged?.(setMax);
  }, []);
  const reason = new URLSearchParams(window.location.search).get('motivo');
  return (
    <div className="pco-bar">
      <div className="pco-drag" onDoubleClick={() => api().windowMaximizeToggle?.()} onMouseDown={moveDrag}>
        <span className="pco-brand"><Ico d={B.globe} size={14} /> {BROWSER_ON ? 'Project Club · Navegador' : 'Project Club'}</span>
        {online ? (
          <span className="pco-status is-online">O Project Club voltou!</span>
        ) : (
          <span className="pco-status" title={reason === 'server' ? 'O servidor respondeu com erro' : reason === 'timeout' ? 'O servidor não respondeu a tempo' : 'Sem conexão com o servidor'}>
            <i /> {BROWSER_ON ? 'Project Club fora do ar — o navegador continua funcionando' : 'Project Club fora do ar — reconectando sozinho'}
          </span>
        )}
      </div>
      <div className="pco-actions">
        <button type="button" className={`pco-retry${online ? ' is-online' : ''}`} onClick={onRetry} disabled={retrying}>
          {online ? 'Voltar ao Project Club' : retrying ? 'Conectando…' : 'Tentar reconectar'}
        </button>
        <button type="button" className="pco-win" aria-label="Minimizar" onClick={() => api().windowMinimize?.()}><svg width="10" height="10" viewBox="0 0 10 10"><rect y="4.5" width="10" height="1" fill="currentColor" /></svg></button>
        <button type="button" className="pco-win" aria-label={max ? 'Restaurar' : 'Maximizar'} onClick={() => api().windowMaximizeToggle?.()}><svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" /></svg></button>
        <button type="button" className="pco-win is-close" aria-label="Fechar" onClick={() => api().windowClose?.()}><svg width="10" height="10" viewBox="0 0 10 10"><line x1="0.5" y1="0.5" x2="9.5" y2="9.5" stroke="currentColor" strokeWidth="1.2" /><line x1="9.5" y1="0.5" x2="0.5" y2="9.5" stroke="currentColor" strokeWidth="1.2" /></svg></button>
      </div>
    </div>
  );
}

export default function OfflineApp() {
  const [online, setOnline] = useState(false);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => api().offline?.onOnline?.(() => setOnline(true)), []);
  const retry = async () => {
    setRetrying(true);
    try { await api().offline?.retry?.(); } finally { setTimeout(() => setRetrying(false), 1500); }
  };
  // Navegador desligado (utils/features.js): só a tela de reconexão.
  if (!BROWSER_ON) {
    return (
      <div className="pco">
        <TitleBar online={online} retrying={retrying} onRetry={retry} />
        <div className="pco-main pco-wait">
          <div className="pco-wait-card">
            <span className="pco-wait-dot" aria-hidden="true" />
            <h1>{online ? 'O Project Club voltou!' : 'Sem conexão com o Project Club'}</h1>
            <p>{online ? 'Clique em “Voltar ao Project Club” para continuar.' : 'Assim que o servidor responder, o app avisa aqui. Você também pode tentar agora.'}</p>
            <button type="button" className={`pco-retry${online ? ' is-online' : ''}`} onClick={retry} disabled={retrying}>{online ? 'Voltar ao Project Club' : retrying ? 'Conectando…' : 'Tentar reconectar'}</button>
          </div>
        </div>
      </div>
    );
  }
  if (!api().browser) {
    return <div className="pco-fail">O Project Club está fora do ar. Tente de novo em instantes.</div>;
  }
  return (
    <MemoryRouter initialEntries={['/navegador']}>
      <div className="pco">
        <TitleBar online={online} retrying={retrying} onRetry={retry} />
        <div className="pco-main"><BrowserChrome /></div>
        <BrowserHost />
        <BrowserBridge />
      </div>
    </MemoryRouter>
  );
}
