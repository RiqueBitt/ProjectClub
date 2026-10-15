import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isFeatureEnabled } from '../utils/features';
import { api } from '../api/client';
import { useLiveRefresh } from '../utils/liveRefresh';
import { updateDisplay } from '../utils/updateProgress';
import { proxyImage } from '../utils/imageProxy';
import { listAppCatalog } from '../api/endpoints';
import {
  isProjectMcAvailable, getProjectMcStatus, installProjectMc,
  launchProjectMc, onProjectMcProgress,
} from '../utils/projectMc';

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
  const [now, setNow] = useState(() => Date.now()); // relógio pra detectar progresso travado
  const lastProgressRef = useRef(0); // ms da última mudança real de porcentagem
  const lastPercentRef = useRef(-1);

  useEffect(() => {
    window.electronAPI?.getAppVersion?.().then(setCurrent).catch(() => {});
    if (!bridge) return undefined;
    bridge.getStatus().then(setStatus).catch(() => {});
    return bridge.onStatus?.(setStatus);
  }, [bridge]);

  // Marca QUANDO a porcentagem muda de verdade — é isso que diferencia
  // "baixando devagar" de "travado em 0%" (ver updateProgress.js).
  useEffect(() => {
    const p = Number(status?.percent) || 0;
    if (p !== lastPercentRef.current) { lastPercentRef.current = p; lastProgressRef.current = Date.now(); }
  }, [status?.percent]);

  // Enquanto está baixando, mantém um "relógio" andando pra reavaliar se o
  // progresso travou (e então mostrar a barra indeterminada em vez de 0%).
  const downloadingRaw = working && status && !status.downloaded && !status.error;
  useEffect(() => {
    if (!downloadingRaw) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [downloadingRaw]);

  // Saiu do estado "trabalhando" quando o app reporta erro: o clique
  // seguinte tenta de novo (não deixa o botão preso em "progresso").
  useEffect(() => {
    if (status?.error && working) setWorking(false);
  }, [status?.error]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkLatest = () => api.get('/system/desktop-latest').then((r) => setLatest(r.data?.version || null)).catch(() => {});
  useEffect(() => { checkLatest(); }, []);
  useLiveRefresh(checkLatest, { interval: 5 * 60 * 1000 });


  const hasUpdate = (status?.available) || (current && latest && isNewer(latest, current));
  if (!hasUpdate) return null;
  const disp = updateDisplay({ status, working, lastProgressAt: lastProgressRef.current, now, stallMs: 4000 });
  const downloading = disp.mode === 'downloading';
  const hadError = !!status?.error;
  const label = status?.downloaded || !bridge
    ? `Atualizar para ${status?.version || latest || 'a versão nova'} (fecha e reabre o Project Club)`
    : hadError
      ? `A última tentativa falhou. Clique pra tentar baixar ${status?.version || latest || 'a versão nova'} de novo.`
      : `Baixar e instalar ${status?.version || latest || 'a versão nova'}`;

  const INSTALLER_URL = 'https://github.com/RiqueBitt/ProjectClub/releases/latest/download/ProjectClub-Setup-Windows.exe';

  const run = async () => {
    if (working) return;
    if (!bridge) { setAskOld((v) => !v); return; } // app antigo: explica e oferece o instalador
    lastProgressRef.current = 0; lastPercentRef.current = -1; setNow(Date.now());
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
      className={`app-title-bar-btn app-title-bar-btn--update ${working ? 'is-working' : ''} ${hadError && !working ? 'has-error' : ''}`}
      aria-label={label}
      aria-busy={downloading}
      title={downloading
        ? (disp.indeterminate ? 'Baixando atualização…' : `Baixando atualização… ${disp.percent}%`)
        : label}
      onClick={run}
    >
      {downloading ? (
        disp.indeterminate ? (
          // Sem progresso ainda (ou travado): barra/rodinha animada em vez
          // de um 0% congelado — mostra que algo está acontecendo.
          <span className="app-title-bar-update-spin" aria-hidden="true" />
        ) : (
          <span className="app-title-bar-update-pct">{disp.percent}%</span>
        )
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
// Reserva: se o arrasto nativo da barra não pegar (o evento só chega aqui
// quando o -webkit-app-region:drag NÃO funcionou), move a janela por JS.
export function startManualDrag(e) {
  const api = window.electronAPI;
  if (e.button !== 0 || !api?.windowMoveBy) return;
  let lx = e.screenX; let ly = e.screenY; let raf = 0; let px = 0; let py = 0;
  const flush = () => { raf = 0; if (px || py) api.windowMoveBy(px, py); px = 0; py = 0; };
  const move = (ev) => {
    px += ev.screenX - lx; py += ev.screenY - ly; lx = ev.screenX; ly = ev.screenY;
    if (!raf) raf = requestAnimationFrame(flush);
  };
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); if (raf) cancelAnimationFrame(raf); flush(); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

// ---------------------------------------------------------------------
// Lançador DISCRETO de apps na barra de título (item pedido).
//
// Naquele cantinho vazio da barra (à esquerda) ficam 4 ícones pequenos e
// apagados — projectMC, CanvasProject, ForgeProject, GameProject — que
// "passam batido". Uma setinha ao lado abre um menuzinho com o resto dos
// apps do catálogo. Clicar num app ABRE ele (se já instalado) ou BAIXA na
// hora (sem precisar abrir a aba Apps): enquanto baixa, o ícone ganha uma
// BORDA VERDE animada e um indicador de download por cima.
//
// Usa a mesma ponte dos apps (window.electronAPI.projectMc, ver
// utils/projectMc.js + JogosPage.jsx), então só aparece no app desktop.
// ---------------------------------------------------------------------
const TB_MAIN_APPS = ['projectmc', 'canvasproject', 'forgeproject', 'gameproject'];

// A ponte (preload) registra o onProgress pra SEMPRE (não devolve um jeito
// de remover). Como os ícones do menuzinho montam/desmontam ao abrir/fechar,
// registrar um listener por ícone vazaria. Então registramos UM só listener
// global e distribuímos por id; cada ícone se inscreve/desinscreve sozinho.
const tbProgressSubs = new Map(); // id -> Set<fn>
let tbProgressInit = false;
function subscribeAppProgress(id, fn) {
  if (!tbProgressInit) {
    tbProgressInit = true;
    onProjectMcProgress((data) => {
      if (!data) return;
      const subs = tbProgressSubs.get(data.id);
      if (subs) subs.forEach((f) => { try { f(data); } catch { /* ignora */ } });
    });
  }
  let set = tbProgressSubs.get(id);
  if (!set) { set = new Set(); tbProgressSubs.set(id, set); }
  set.add(fn);
  return () => { set.delete(fn); };
}

// Estado leve de um app (instalado? baixando? progresso?) + a ação de
// abrir/baixar. Espelha o useModuleState do JogosPage, enxuto pro ícone.
function useAppLaunch(moduleId) {
  const [status, setStatus] = useState(null);
  const [progress, setProgress] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    if (!isProjectMcAvailable()) return;
    getProjectMcStatus(moduleId).then(setStatus).catch(() => {});
  }, [moduleId]);

  useEffect(() => {
    refresh();
    const off = subscribeAppProgress(moduleId, (data) => {
      if (data.phase === 'done') { setBusy(false); setProgress(null); refresh(); }
      else { setBusy(true); setProgress(data); }
    });
    return off;
  }, [moduleId, refresh]);

  const activate = useCallback(async () => {
    if (busy) return;
    if (status?.installed) { launchProjectMc(moduleId).catch(() => {}); return; }
    setBusy(true); setProgress({ phase: 'downloading', percent: 0 });
    const r = await installProjectMc(moduleId).catch(() => null);
    if (!r?.success) { setBusy(false); setProgress(null); }
  }, [busy, status, moduleId]);

  return { installed: !!status?.installed, busy, progress, activate };
}

function AppLauncherIcon({ item }) {
  const { installed, busy, progress, activate } = useAppLaunch(item.moduleId);
  const pct = Number(progress?.percent);
  const showPct = busy && Number.isFinite(pct) && pct > 0;
  const title = busy
    ? `Baixando ${item.name}…${showPct ? ` ${Math.round(pct)}%` : ''}`
    : installed ? `Abrir ${item.name}` : `Baixar e abrir ${item.name}`;
  return (
    <button
      type="button"
      className={`tb-app${installed ? ' is-installed' : ''}${busy ? ' is-downloading' : ''}`}
      title={title}
      aria-label={title}
      aria-busy={busy || undefined}
      onClick={activate}
    >
      <span className="tb-app-ic">
        {item.iconUrl
          ? <img src={proxyImage(item.iconUrl)} alt="" draggable="false" />
          : <span className="tb-app-fallback">{(item.name || '?').trim().slice(0, 1).toUpperCase()}</span>}
      </span>
      {busy && (
        <span className="tb-app-dl" aria-hidden="true">
          {showPct
            ? <span className="tb-app-dl-pct">{Math.round(pct)}</span>
            : (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
              </svg>
            )}
        </span>
      )}
    </button>
  );
}

// Globo ao lado da setinha dos apps: abre o Navegador do Project Club.
// Só existe no app de Windows/Linux (a barra de título só aparece lá).
function TitleBarBrowserButton() {
  const navigate = useNavigate();
  const location = useLocation();
  if (!isFeatureEnabled('browser')) return null;
  const active = location.pathname.startsWith('/navegador');
  return (
    <button
      type="button"
      className={`tb-web${active ? ' is-active' : ''}`}
      title="Navegador"
      aria-label="Abrir o navegador"
      onClick={() => { if (!active) navigate('/navegador'); }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.6 2.6 3.8 5.7 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.7-3.8-9S9.4 5.6 12 3z" />
      </svg>
    </button>
  );
}

function TitleBarAppLauncher() {
  const [catalog, setCatalog] = useState(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!isProjectMcAvailable()) { setCatalog([]); return; }
    listAppCatalog().then((d) => setCatalog(d?.items || [])).catch(() => setCatalog([]));
  }, []);

  // Fecha o menuzinho ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  if (!catalog || catalog.length === 0) return <div className="tb-apps"><TitleBarBrowserButton /></div>;
  const byId = Object.fromEntries(catalog.map((c) => [c.moduleId, c]));
  const main = TB_MAIN_APPS.map((id) => byId[id]).filter(Boolean);
  const rest = catalog.filter((c) => !TB_MAIN_APPS.includes(c.moduleId));
  if (main.length === 0 && rest.length === 0) return <div className="tb-apps"><TitleBarBrowserButton /></div>;

  return (
    <div className="tb-apps" ref={wrapRef}>
      {main.map((it) => <AppLauncherIcon key={it.moduleId} item={it} />)}
      {rest.length > 0 && (
        <div className="tb-apps-more">
          <button
            type="button"
            className={`tb-apps-chevron${open ? ' is-open' : ''}`}
            aria-label="Mais apps"
            aria-expanded={open}
            title="Mais apps"
            onClick={() => setOpen((o) => !o)}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {open && (
            <div className="tb-apps-pop" role="menu">
              {rest.map((it) => <AppLauncherIcon key={it.moduleId} item={it} />)}
            </div>
          )}
        </div>
      )}
      <TitleBarBrowserButton />
    </div>
  );
}

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
      <TitleBarAppLauncher />
      <div className="app-title-bar-drag" onDoubleClick={() => window.electronAPI.windowMaximizeToggle()} onMouseDown={startManualDrag} />
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
