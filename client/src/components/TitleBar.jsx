import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useLiveRefresh } from '../utils/liveRefresh';

// "1.10.2" > "1.9.9"
function isNewer(a, b) {
  const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

// Item pedido: "ícone de download verde do lado do minimizar; ao clicar
// fecha o Project Club e atualiza pra versão nova". Aparece só quando
// existe versão mais nova que a deste app.
function UpdateButton() {
  const bridge = window.electronAPI?.update;
  const [current, setCurrent] = useState(null);
  const [latest, setLatest] = useState(null);
  const [status, setStatus] = useState(null); // estado vindo do app (versões novas)
  const [working, setWorking] = useState(false);
  const [askOld, setAskOld] = useState(false); // explicação pro app antigo

  useEffect(() => {
    window.electronAPI?.getAppVersion?.().then(setCurrent).catch(() => {});
    if (!bridge) return undefined;
    bridge.getStatus().then(setStatus).catch(() => {});
    return bridge.onStatus?.(setStatus);
  }, [bridge]);

  const checkLatest = () => api.get('/system/desktop-latest').then((r) => setLatest(r.data?.version || null)).catch(() => {});
  useEffect(() => { checkLatest(); }, []);
  useLiveRefresh(checkLatest, { interval: 5 * 60 * 1000 });


  const hasUpdate = (status?.available) || (current && latest && isNewer(latest, current));
  if (!hasUpdate) return null;
  const downloading = working && status && !status.downloaded;
  const label = status?.downloaded || !bridge
    ? `Atualizar para ${status?.version || latest || 'a versão nova'} (fecha e reabre o Project Club)`
    : `Baixar e instalar ${status?.version || latest || 'a versão nova'}`;

  const INSTALLER_URL = 'https://github.com/RiqueBitt/ProjectClub-Downloads/releases/latest/download/ProjectClub-Setup-Windows.exe';

  const run = async () => {
    if (working) return;
    if (!bridge) { setAskOld((v) => !v); return; } // app antigo: explica e oferece o instalador
    setWorking(true);
    const r = await bridge.install().catch(() => null);
    if (!r?.success) setWorking(false);
  };

  // App antigo (sem atualização por clique): ele só sabe instalar o que já
  // baixou ao FECHAR de verdade, e não reabre sozinho — às vezes uma versão
  // intermediária. O caminho certo é o instalador da versão nova.
  const downloadInstaller = () => {
    window.electronAPI?.openExternal?.(INSTALLER_URL);
    setAskOld(false);
  };
  const closeAndInstall = () => {
    window.electronAPI?.updateSettings?.({ minimizeToTray: false, confirmOnExit: false });
    setTimeout(() => window.electronAPI.windowClose(), 200);
  };

  return (
    <div className="app-title-bar-update-wrap">
    {askOld && (
      <div className="app-update-pop" role="dialog" aria-label="Atualizar o Project Club">
        <strong>Atualizar para a {latest || 'versão nova'}</strong>
        <p>Sua versão ({current}) ainda não atualiza com um clique. Baixe o instalador da versão nova e abra o arquivo — ele fecha o Project Club, instala e abre de novo. Depois disso, as próximas atualizações são automáticas e por este botão.</p>
        <div className="app-update-pop-actions">
          <button type="button" className="app-update-pop-btn primary" onClick={downloadInstaller}>Baixar instalador</button>
          <button type="button" className="app-update-pop-btn" onClick={closeAndInstall} title="Instala a atualização que o app já baixou (pode ser uma versão intermediária) e fecha — abra de novo depois de alguns segundos">Fechar e instalar o que já baixou</button>
        </div>
      </div>
    )}
    <button
      type="button"
      className={`app-title-bar-btn app-title-bar-btn--update ${working ? 'is-working' : ''}`}
      aria-label={label}
      title={downloading ? `Baixando atualização… ${status?.percent || 0}%` : label}
      onClick={run}
    >
      {downloading ? (
        <span className="app-title-bar-update-pct">{status?.percent || 0}%</span>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
        </svg>
      )}
    </button>
    </div>
  );
}

// Item pedido: "no app do Project Club, faça igual ao launcher, e crie
// uma barra que não seja do Windows, de fechar aba, minimizar, aumentar
// etc" — mesmo padrão visual/funcional do ProjectMC (launcher de
// Minecraft, AppSystemBar.vue: 3 botões simples com hover semi-
// transparente, o de fechar com hover vermelho). Só renderiza de
// verdade dentro do app desktop (window.electronAPI existe) — no
// navegador normal ou no app mobile a janela continua com a moldura
// nativa de sempre, então não faz sentido nenhum mostrar isso ali.
export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.windowMinimize;

  useEffect(() => {
    if (!isElectron) return;
    window.electronAPI.windowIsMaximized().then(setIsMaximized).catch(() => {});
    // O estado também pode mudar por outro caminho além dos botões
    // daqui (duplo-clique na barra, Win+Up, arrastar pro topo da tela)
    // — sem esse listener, o ícone maximizar/restaurar ficaria
    // dessincronizado do estado real da janela nesses casos.
    const unsubscribe = window.electronAPI.onWindowMaximizedChanged?.(setIsMaximized);
    return () => unsubscribe?.();
  }, [isElectron]);

  if (!isElectron) return null;

  return (
    <div className="app-title-bar">
      <div className="app-title-bar-drag" onDoubleClick={() => window.electronAPI.windowMaximizeToggle()} />
      <div className="app-title-bar-controls">
        <UpdateButton />
        <button
          type="button"
          className="app-title-bar-btn"
          aria-label="Minimizar"
          onClick={() => window.electronAPI.windowMinimize()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10"><rect y="4.5" width="10" height="1" fill="currentColor" /></svg>
        </button>
        <button
          type="button"
          className="app-title-bar-btn"
          aria-label={isMaximized ? 'Restaurar' : 'Maximizar'}
          onClick={() => window.electronAPI.windowMaximizeToggle()}
        >
          {isMaximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="1.5" y="0" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" />
              <rect x="0" y="2" width="8" height="8" fill="var(--bg-primary, #1a1a1a)" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
          )}
        </button>
        <button
          type="button"
          className="app-title-bar-btn app-title-bar-btn--close"
          aria-label="Fechar"
          onClick={() => window.electronAPI.windowClose()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="0.5" y1="0.5" x2="9.5" y2="9.5" stroke="currentColor" strokeWidth="1.2" />
            <line x1="9.5" y1="0.5" x2="0.5" y2="9.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
