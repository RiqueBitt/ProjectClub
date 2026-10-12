import { useEffect, useRef, useState } from 'react';
import { useBrowser } from './browserStore';
import { isInternal, nativeBrowser } from './urlTools';

// ============================================================
// Páginas do navegador do Project Club. Cada aba tem um <webview> criado
// UMA vez (mover um webview no DOM recarrega a página), todos dentro de um
// contêiner fixo que se encaixa sobre a área de visualização visível
// (.pcb-viewport): a página /navegador ou o painel ao lado do chat.
// Abas paradas há muito tempo "dormem" (o webview sai da memória e volta
// quando a aba é aberta de novo).
// ============================================================

const SLEEP_AFTER_MS = 25 * 60 * 1000;
const SSL_OR_CONN = new Set([-100, -101, -102, -104, -105, -106, -107, -109, -111, -112, -113, -117, -118, -125, -130, -131, -137, -324, -200, -201, -202, -203, -204, -205, -206, -207, -208, -210, -211, -212, -213, -501]);
const blockedByWc = new Map();

// Elementos dos webviews (id da aba → elemento), para a interface chamar
// métodos (voltar, achar na página, zoom...).
export const webviews = new Map();
export const wvOf = (tabId) => webviews.get(tabId) || null;

function TabView({ tab, active, visible }) {
  const boxRef = useRef(null);
  const elRef = useRef(null);
  const [mounted, setMounted] = useState(false);
  const needsView = !isInternal(tab.url) || !!elRef.current;
  const asleep = tab.sleeping && !active;

  // Cria (ou recria depois de dormir) o webview quando a aba precisa dele.
  useEffect(() => {
    if (asleep || !needsView || elRef.current || !boxRef.current) return undefined;
    const st = useBrowser.getState();
    const t = st.tabs.find((x) => x.id === tab.id);
    if (!t || isInternal(t.url)) return undefined;
    const el = document.createElement('webview');
    el.className = 'pcb-webview';
    el.setAttribute('partition', t.private ? t.partition : 'persist:pcbrowser');
    el.setAttribute('allowpopups', 'true');
    el.setAttribute('webpreferences', 'contextIsolation=yes,sandbox=yes,spellcheck=yes');
    el.setAttribute('src', t.url);
    const up = (patch) => useBrowser.getState().update(tab.id, patch);
    const nav = () => { try { up({ canBack: el.canGoBack(), canForward: el.canGoForward() }); } catch { /* ainda não pronto */ } };
    const on = (ev, fn) => el.addEventListener(ev, fn);
    on('dom-ready', () => {
      try {
        const wcId = el.getWebContentsId();
        const cur = useBrowser.getState().tabs.find((x) => x.id === tab.id);
        up({ wcId, blockedBase: cur?.wcId === wcId ? cur.blockedBase : (blockedByWc.get(wcId) || 0) });
        if (cur?.zoom && cur.zoom !== 1) el.setZoomFactor(cur.zoom);
        if (cur?.muted) el.setAudioMuted(true);
      } catch { /* ok */ }
      nav();
    });
    on('did-start-loading', () => up({ loading: true }));
    on('did-stop-loading', () => { up({ loading: false }); nav(); });
    on('did-navigate', (e) => {
      const cur = useBrowser.getState().tabs.find((x) => x.id === tab.id);
      const wcId = cur?.wcId;
      up({ url: e.url, error: null, permission: null, hoverUrl: '', pwAccounts: cur?.pwOrigin && e.url.startsWith(cur.pwOrigin) ? cur.pwAccounts : null, blockedBase: wcId ? (blockedByWc.get(wcId) || 0) : 0, blocked: 0, upgradedHost: cur?.upgradedHost && e.url.startsWith(`https://${cur.upgradedHost}`) ? null : cur?.upgradedHost });
      nav();
      if (!cur?.private) useBrowser.getState().addHistory({ url: e.url, title: '', favicon: null });
    });
    on('did-navigate-in-page', (e) => {
      if (!e.isMainFrame) return;
      up({ url: e.url }); nav();
      const cur = useBrowser.getState().tabs.find((x) => x.id === tab.id);
      if (!cur?.private) useBrowser.getState().addHistory({ url: e.url, title: cur?.title, favicon: cur?.favicon });
    });
    on('page-title-updated', (e) => {
      up({ title: e.title });
      const cur = useBrowser.getState().tabs.find((x) => x.id === tab.id);
      if (!cur?.private) useBrowser.getState().setHistoryTitle(cur?.url, e.title, cur?.favicon);
    });
    on('page-favicon-updated', (e) => {
      const f = (e.favicons || []).find((x) => /^(https:|data:image\/)/.test(x));
      if (!f) return;
      up({ favicon: f });
      const cur = useBrowser.getState().tabs.find((x) => x.id === tab.id);
      if (!cur?.private) useBrowser.getState().setHistoryTitle(cur?.url, cur?.title, f);
    });
    on('did-fail-load', (e) => {
      if (!e.isMainFrame || e.errorCode === -3) return; // -3 = cancelado (ex.: nova navegação)
      const cur = useBrowser.getState().tabs.find((x) => x.id === tab.id);
      let host = '';
      try { host = new URL(e.validatedURL).hostname; } catch { /* ok */ }
      const https = cur?.upgradedHost && host === cur.upgradedHost && SSL_OR_CONN.has(e.errorCode);
      up({ loading: false, url: e.validatedURL || cur?.url, title: host || cur?.title, favicon: null, error: { kind: https ? 'https' : 'net', code: e.errorCode, desc: e.errorDescription, url: e.validatedURL, host } });
    });
    on('update-target-url', (e) => up({ hoverUrl: e.url || '' }));
    on('media-started-playing', () => up({ audible: true }));
    on('media-paused', () => up({ audible: false }));
    on('found-in-page', (e) => up({ find: { active: e.result.activeMatchOrdinal, total: e.result.matches } }));
    on('render-process-gone', () => up({ loading: false, error: { kind: 'crash', url: useBrowser.getState().tabs.find((x) => x.id === tab.id)?.url } }));
    on('enter-html-full-screen', () => document.documentElement.classList.add('pcb-html-fullscreen'));
    on('leave-html-full-screen', () => document.documentElement.classList.remove('pcb-html-fullscreen'));
    boxRef.current.appendChild(el);
    elRef.current = el;
    webviews.set(tab.id, el);
    setMounted(true);
    return undefined;
  }, [asleep, needsView, tab.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dormir: tira o webview da memória (a aba guarda o endereço).
  useEffect(() => {
    if (!asleep || !elRef.current) return;
    elRef.current.remove();
    elRef.current = null;
    webviews.delete(tab.id);
    setMounted(false);
    useBrowser.getState().update(tab.id, { wcId: null, loading: false });
  }, [asleep, tab.id]);

  // Remove de vez quando a aba fecha.
  useEffect(() => () => { const el = elRef.current; if (el) { el.remove(); webviews.delete(tab.id); } }, [tab.id]);

  // Navegação pedida pela interface (barra de endereço, links do app...).
  useEffect(() => {
    if (!tab.nav || !tab.pendingUrl || isInternal(tab.pendingUrl)) return;
    const el = elRef.current;
    if (!el) return; // o efeito de criação usa tab.url
    // loadURL rejeita quando a página falha; o erro já chega pelo did-fail-load.
    try { el.loadURL(tab.pendingUrl)?.catch?.(() => {}); } catch { el.setAttribute('src', tab.pendingUrl); }
  }, [tab.nav]); // eslint-disable-line react-hooks/exhaustive-deps

  const show = active && visible && !isInternal(tab.url) && !tab.error;
  return (
    <div ref={boxRef} className={`pcb-tabview${show ? ' is-shown' : ''}`} data-tab={tab.id} aria-hidden={!show} data-mounted={mounted ? '1' : '0'} />
  );
}

// Encaixa o contêiner sobre a área visível (.pcb-viewport).
function useViewportRect() {
  const [rect, setRect] = useState(null);
  useEffect(() => {
    let raf = 0;
    let last = '';
    const tick = () => {
      const el = document.querySelector('.pcb-viewport');
      const r = el?.getBoundingClientRect();
      const z = Number(document.documentElement.currentCSSZoom) || 1;
      const next = r && r.width > 0 && r.height > 0 ? { top: r.top / z, left: r.left / z, width: r.width / z, height: r.height / z } : null;
      const key = next ? `${Math.round(next.top)}|${Math.round(next.left)}|${Math.round(next.width)}|${Math.round(next.height)}` : '';
      if (key !== last) { last = key; setRect(next); }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);
  return rect;
}

export default function BrowserHost() {
  const available = useBrowser((s) => s.available);
  const tabs = useBrowser((s) => s.tabs);
  const hydrated = useBrowser((s) => s.hydrated);
  const activeId = useBrowser((s) => s.activeId);
  const rect = useViewportRect();

  // Eventos do processo principal (bloqueios, downloads, permissões...).
  useEffect(() => {
    const nb = nativeBrowser();
    if (!nb) return undefined;
    const st = () => useBrowser.getState();
    st().hydrate().finally(() => st().loadNative());
    const offs = [
      nb.on('blocked', ({ tabs: map, total }) => {
        for (const [k, v] of Object.entries(map || {})) blockedByWc.set(Number(k), v);
        const s = st();
        useBrowser.setState({
          totalBlocked: total,
          tabs: s.tabs.map((t) => (t.wcId && blockedByWc.has(t.wcId) ? { ...t, blocked: Math.max(0, blockedByWc.get(t.wcId) - (t.blockedBase || 0)) } : t)),
        });
      }),
      nb.on('download', (d) => st().upsertDownload(d)),
      nb.on('engine', (engine) => useBrowser.setState({ engine })),
      nb.on('permission', (p) => {
        const t = st().byWc(p.webContentsId);
        if (t) st().update(t.id, { permission: p });
        else nb.permissionReply(p.id, false, false);
      }),
      nb.on('https-upgraded', ({ webContentsId, host }) => { const t = st().byWc(webContentsId); if (t) st().update(t.id, { upgradedHost: host }); }),
      nb.on('dangerous', ({ webContentsId, url, host }) => { const t = st().byWc(webContentsId); if (t) st().update(t.id, { loading: false, url, title: 'Site perigoso bloqueado', favicon: null, error: { kind: 'danger', url, host } }); }),
      nb.on('crashed', ({ webContentsId }) => { const t = st().byWc(webContentsId); if (t) st().update(t.id, { loading: false, error: { kind: 'crash', url: t.url } }); }),
      nb.on('external', ({ url }) => { if (/^(mailto|tel):/i.test(url)) window.electronAPI?.openExternal?.(url); }),
      // Senhas: oferta de salvar depois de um login e logins salvos para a página.
      nb.on('pw-offer', (o) => { const t = st().byWc(o.webContentsId); if (t) st().update(t.id, { pwOffer: o }); }),
      nb.on('pw-available', ({ webContentsId, origin, accounts }) => { const t = st().byWc(webContentsId); if (t) st().update(t.id, { pwAccounts: accounts, pwOrigin: origin }); }),
    ];
    return () => offs.forEach((off) => off && off());
  }, []);

  // Dorme abas paradas (não a ativa, nem fixadas, nem tocando áudio).
  useEffect(() => {
    const iv = setInterval(() => {
      const s = useBrowser.getState();
      const now = Date.now();
      for (const t of s.tabs) {
        if (t.id === s.activeId) { if (!t.lastActive || now - t.lastActive > 60000) s.update(t.id, { lastActive: now, sleeping: false }); continue; }
        if (!t.sleeping && !t.pinned && !t.audible && t.wcId && now - (t.lastActive || t.createdAt) > SLEEP_AFTER_MS) s.update(t.id, { sleeping: true });
      }
    }, 60000);
    return () => clearInterval(iv);
  }, []);

  // Aba restaurada da sessão anterior começa dormindo até ser aberta.
  useEffect(() => {
    const s = useBrowser.getState();
    for (const t of s.tabs) if (t.restored && t.id !== s.activeId && !t.sleeping) s.update(t.id, { sleeping: true, restored: false });
  }, []);
  useEffect(() => {
    const s = useBrowser.getState();
    const t = s.tabs.find((x) => x.id === activeId);
    if (t && (t.sleeping || t.restored)) s.update(t.id, { sleeping: false, restored: false, lastActive: Date.now() });
    else if (t) s.update(t.id, { lastActive: Date.now() });
  }, [activeId]);

  if (!available) return null;
  const visible = !!rect;
  const style = rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : undefined;
  return (
    <div className={`pcb-host${visible ? ' is-visible' : ''}`} style={style} aria-hidden={!visible}>
      {hydrated && tabs.map((t) => <TabView key={t.id} tab={t} active={t.id === activeId} visible={visible} />)}
    </div>
  );
}
