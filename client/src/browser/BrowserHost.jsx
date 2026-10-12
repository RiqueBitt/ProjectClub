import { useEffect, useRef, useState } from 'react';
import { useBrowser } from './browserStore';
import { isInternal, nativeBrowser, hostOf, faviconFor } from './urlTools';
import { browserPlatform, PcBrowser, checkFramable } from './platform';

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

// Soneca das abas paradas e abas restauradas (todas as plataformas).
function useTabLifecycle(activeId) {
  // Dorme abas paradas (não a ativa, nem fixadas, nem tocando áudio).
  useEffect(() => {
    const iv = setInterval(() => {
      const s = useBrowser.getState();
      const now = Date.now();
      for (const t of s.tabs) {
        if (t.id === s.activeId) { if (!t.lastActive || now - t.lastActive > 60000) s.update(t.id, { lastActive: now, sleeping: false }); continue; }
        if (!t.sleeping && !t.pinned && !t.audible && (t.wcId || t.live) && now - (t.lastActive || t.createdAt) > SLEEP_AFTER_MS) s.update(t.id, { sleeping: true });
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

}

export default function BrowserHost() {
  const platform = browserPlatform();
  if (platform === 'android') return <AndroidHost />;
  return <FrameHost web={platform === 'web'} />;
}

function FrameHost({ web }) {
  const available = useBrowser((s) => s.available);
  const tabs = useBrowser((s) => s.tabs);
  const hydrated = useBrowser((s) => s.hydrated);
  const activeId = useBrowser((s) => s.activeId);
  const rect = useViewportRect();

  // Eventos do processo principal (bloqueios, downloads, permissões...).
  useEffect(() => {
    const nb = nativeBrowser();
    const st = () => useBrowser.getState();
    if (!nb) { st().hydrate().finally(() => st().loadNative()); return undefined; }
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

  useTabLifecycle(activeId);

  if (!available) return null;
  const visible = !!rect;
  const style = rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : undefined;
  return (
    <div className={`pcb-host${visible ? ' is-visible' : ''}`} style={style} aria-hidden={!visible}>
      {hydrated && tabs.map((t) => (web
        ? <WebTabView key={t.id} tab={t} active={t.id === activeId} visible={visible} />
        : <TabView key={t.id} tab={t} active={t.id === activeId} visible={visible} />))}
    </div>
  );
}

// ============================================================
// Versão site (navegador comum): cada aba é um <iframe> isolado.
// Antes de abrir, o servidor confere se o site PERMITE ser aberto dentro de
// outro site; se não permitir, a aba mostra o aviso e o site abre numa guia
// nova do seu navegador (automaticamente quando foi você que pediu).
// O iframe não pode navegar o Project Club (sem allow-top-navigation).
// ============================================================
const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-presentation allow-pointer-lock allow-storage-access-by-user-activation';

function WebTabView({ tab, active, visible }) {
  const boxRef = useRef(null);
  const frameRef = useRef(null);
  const stack = useRef({ list: [], idx: -1 });
  const seq = useRef(0);
  const asleep = tab.sleeping && !active;
  const up = (patch) => useBrowser.getState().update(tab.id, patch);
  const cur = () => useBrowser.getState().tabs.find((x) => x.id === tab.id);
  const navState = () => ({ canBack: stack.current.idx > 0, canForward: stack.current.idx < stack.current.list.length - 1 });

  const dropFrame = () => { if (frameRef.current) { frameRef.current.remove(); frameRef.current = null; } };
  const showFrame = (url) => {
    dropFrame();
    if (!boxRef.current) return;
    const f = document.createElement('iframe');
    f.className = 'pcb-webview pcb-iframe';
    f.setAttribute('sandbox', SANDBOX);
    f.setAttribute('allow', 'fullscreen; autoplay; encrypted-media; picture-in-picture; clipboard-write; web-share');
    f.setAttribute('allowfullscreen', 'true');
    f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    f.setAttribute('title', 'Página');
    f.addEventListener('load', () => up({ loading: false }));
    f.src = url;
    boxRef.current.appendChild(f);
    frameRef.current = f;
  };

  // Abre um endereço na aba. push=false: andando no próprio histórico da aba.
  const load = async (url, { push = true, user = false } = {}) => {
    const my = ++seq.current;
    if (!url || isInternal(url)) { dropFrame(); return; }
    let u;
    try { u = new URL(url); } catch { return; }
    const host = u.hostname;
    const record = (final) => {
      const st = stack.current;
      if (push) { st.list = [...st.list.slice(0, st.idx + 1), final].slice(-50); st.idx = st.list.length - 1; } else st.list[st.idx] = final;
    };
    if (u.origin === window.location.origin) {
      record(url); dropFrame();
      up({ loading: false, live: false, url, title: 'Project Club', favicon: null, ...navState(), error: { kind: 'noframe', reason: 'self', url, host } });
      return;
    }
    // Ainda dentro do clique? Então dá para abrir uma guia nova sem bloqueio de pop-up.
    const userActive = user && !!navigator.userActivation?.isActive;
    up({ loading: true, error: null, permission: null, url, title: cur()?.title || host, favicon: faviconFor(url) });
    let info = null;
    try { info = await checkFramable(url); } catch { info = null; } // servidor fora: tenta abrir mesmo assim
    if (my !== seq.current) return;
    if (info && !info.ok) {
      record(url); dropFrame();
      const net = info.error === 'unreachable' || info.error === 'timeout';
      up({ loading: false, live: false, title: host, ...navState(), error: net ? { kind: 'net', code: info.error === 'timeout' ? -118 : -105, url, host } : { kind: 'noframe', reason: 'blocked', url, host } });
      return;
    }
    const final = info?.finalUrl || url;
    const fhost = hostOf(final);
    const title = info?.title || fhost;
    record(final);
    if (!cur()?.private) useBrowser.getState().addHistory({ url: final, title, favicon: faviconFor(final) });
    if (info && !info.framable) {
      dropFrame();
      const prefs = useBrowser.getState().prefs;
      let opened = false;
      if (userActive && prefs.webAutoNewTab !== false) {
        const w = window.open(final, '_blank');
        if (w) { try { w.opener = null; } catch { /* ok */ } opened = true; }
      }
      up({ loading: false, live: false, url: final, title, favicon: faviconFor(final), ...navState(), error: { kind: 'noframe', reason: info.reason, url: final, host: new URL(final).hostname, opened } });
      return;
    }
    showFrame(final);
    up({ loading: true, live: true, url: final, title, favicon: faviconFor(final), ...navState() });
  };

  // "Controle" da aba com a mesma cara do <webview> do app de computador.
  useEffect(() => {
    const go = (dir) => {
      const st = stack.current;
      const i = st.idx + dir;
      if (i < 0 || i >= st.list.length) return;
      st.idx = i;
      load(st.list[i], { push: false });
    };
    const ctl = {
      kind: 'web',
      canGoBack: () => stack.current.idx > 0,
      canGoForward: () => stack.current.idx < stack.current.list.length - 1,
      goBack: () => go(-1),
      goForward: () => go(1),
      reload: () => { const u = stack.current.list[stack.current.idx] || cur()?.url; if (u) load(u, { push: false }); },
      reloadIgnoringCache() { this.reload(); },
      stop: () => { seq.current++; up({ loading: false }); },
      loadURL: (u) => { load(u, { push: !stack.current.list.length }); return Promise.resolve(); },
      getURL: () => stack.current.list[stack.current.idx] || '',
      focus: () => { try { frameRef.current?.focus(); } catch { /* ok */ } },
    };
    webviews.set(tab.id, ctl);
    return () => { webviews.delete(tab.id); dropFrame(); };
  }, [tab.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Primeira abertura / acordar da soneca.
  useEffect(() => {
    if (asleep) { if (frameRef.current) { dropFrame(); up({ live: false, loading: false }); } return; }
    const t = cur();
    if (!t || isInternal(t.url) || frameRef.current || t.error) return;
    const u = stack.current.list[stack.current.idx] || t.url;
    load(u, { push: !stack.current.list.length });
  }, [asleep, tab.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Navegação pedida pela interface.
  useEffect(() => {
    if (!tab.nav || !tab.pendingUrl) return;
    if (isInternal(tab.pendingUrl)) { seq.current++; return; } // a página interna aparece por cima
    load(tab.pendingUrl, { push: true, user: true });
  }, [tab.nav]); // eslint-disable-line react-hooks/exhaustive-deps

  const show = active && visible && !isInternal(tab.url) && !tab.error;
  return <div ref={boxRef} className={`pcb-tabview${show ? ' is-shown' : ''}`} data-tab={tab.id} aria-hidden={!show} />;
}

// ============================================================
// App do celular (Android): as abas são WebViews nativos do próprio
// aparelho (PcBrowserPlugin.java). Esta parte só diz ao Android ONDE fica a
// área da página (retângulo da .pcb-viewport) e quando escondê-la (menus,
// janelas e páginas internas por cima) e repassa os eventos para as abas.
// ============================================================
const ANDROID_NET = { '-2': -105, '-6': -102, '-8': -118, '-11': -200, '-200': -200, '-7': -109, '-1': -109, '-12': -105, '-15': -21 };
const androidLastUrl = new Map();

function androidCtl(tabId) {
  const tabOf = () => useBrowser.getState().tabs.find((x) => x.id === tabId);
  return {
    kind: 'android',
    canGoBack: () => !!tabOf()?.canBack,
    canGoForward: () => !!tabOf()?.canForward,
    goBack: () => PcBrowser.back({ tabId }).catch(() => {}),
    goForward: () => PcBrowser.forward({ tabId }).catch(() => {}),
    reload: () => PcBrowser.reload({ tabId }).catch(() => {}),
    reloadIgnoringCache() { this.reload(); },
    stop: () => PcBrowser.stop({ tabId }).catch(() => {}),
    loadURL: (url) => PcBrowser.navigate({ tabId, url }).catch(() => {}),
    getURL: () => androidLastUrl.get(tabId) || '',
    focus: () => {},
    findInPage: (text, opts) => PcBrowser.find({ tabId, text, next: !!opts?.findNext, forward: opts?.forward !== false }).catch(() => {}),
    stopFindInPage: () => PcBrowser.clearFind({ tabId }).catch(() => {}),
    pauseMedia: () => PcBrowser.pauseMedia({ tabId }).catch(() => {}),
  };
}

function AndroidHost() {
  const tabs = useBrowser((s) => s.tabs);
  const activeId = useBrowser((s) => s.activeId);
  const hydrated = useBrowser((s) => s.hydrated);
  const opened = useRef(new Map()); // tabId → nav já aplicada
  useTabLifecycle(activeId);

  // Eventos das abas nativas + botão voltar do celular.
  useEffect(() => {
    const st = () => useBrowser.getState();
    st().hydrate().finally(() => st().loadNative());
    const find = (id) => st().tabs.find((t) => t.id === id);
    const handles = [];
    PcBrowser.addListener('browserEvent', (e) => {
      const t = e?.tabId ? find(e.tabId) : null;
      const up = (patch) => t && st().update(t.id, patch);
      switch (e?.type) {
        case 'engine': useBrowser.setState({ engine: { state: e.state, lists: 3, domains: e.domains } }); break;
        case 'start': up({ loading: true, error: null, permission: null, live: true, url: e.url, blocked: 0 }); break;
        case 'navigate':
          if (!t) break;
          androidLastUrl.set(t.id, e.url);
          up({ url: e.url, canBack: !!e.canBack, canForward: !!e.canForward, hoverUrl: '', upgradedHost: t.upgradedHost && e.url.startsWith(`https://${t.upgradedHost}`) ? null : t.upgradedHost });
          if (!t.error) st().addHistory({ url: e.url, title: t.title, favicon: t.favicon });
          break;
        case 'stop':
          up({ loading: false, canBack: !!e.canBack, canForward: !!e.canForward, ...(e.title && !t?.error ? { title: e.title } : {}) });
          if (t && e.title && !t.error) st().setHistoryTitle(e.url, e.title, t.favicon);
          break;
        case 'title': if (t && !t.error && e.title) { up({ title: e.title }); st().setHistoryTitle(t.url, e.title, t.favicon); } break;
        case 'favicon': up({ favicon: e.favicon }); break;
        case 'progress': if (e.progress < 100) up({ loading: true }); break;
        case 'error': {
          if (!t) break;
          let host = e.host || '';
          try { host = host || new URL(e.url).hostname; } catch { /* ok */ }
          const code = ANDROID_NET[String(e.code)] ?? e.code;
          const https = t.upgradedHost && host === t.upgradedHost && [-102, -118, -200, -109].includes(code);
          up({ loading: false, title: host || t.title, favicon: null, error: { kind: https ? 'https' : 'net', code, desc: e.desc, url: e.url, host } });
          break;
        }
        case 'dangerous': up({ loading: false, url: e.url, title: 'Site perigoso bloqueado', favicon: null, error: { kind: 'danger', url: e.url, host: e.host } }); break;
        case 'httpsUpgraded': up({ upgradedHost: e.host }); break;
        case 'blocked': up({ blocked: e.count }); useBrowser.setState({ totalBlocked: e.total }); break;
        case 'openTab': st().openTab(e.url, { afterId: t?.id || null }); break;
        case 'permission': if (t) up({ permission: { id: e.id, permission: e.permission, origin: e.origin, extra: e.extra } }); else PcBrowser.permissionReply({ id: e.id, allow: false }).catch(() => {}); break;
        case 'find': up({ find: { active: e.active, total: e.total } }); break;
        case 'download':
          st().upsertDownload({ id: `a${Date.now().toString(36)}`, url: e.url, filename: e.filename || hostOf(e.url), state: e.state === 'started' ? 'system' : 'interrupted', startedAt: Date.now() });
          break;
        default: break;
      }
    }).then((h) => handles.push(h)).catch(() => {});
    import('@capacitor/app').then(({ App }) => App.addListener('backButton', async ({ canGoBack }) => {
      const r = await PcBrowser.handleBack().catch(() => null);
      if (r?.handled) return;
      if (canGoBack) window.history.back();
    })).then((h) => handles.push(h)).catch(() => {});
    return () => handles.forEach((h) => h?.remove?.());
  }, []);

  // Abas: abrir/navegar/fechar/dormir os WebViews nativos.
  useEffect(() => {
    if (!hydrated) return;
    const live = opened.current;
    const ids = new Set(tabs.map((t) => t.id));
    for (const id of [...live.keys()]) {
      const t = tabs.find((x) => x.id === id);
      if (!ids.has(id) || (t?.sleeping && id !== activeId)) {
        live.delete(id); webviews.delete(id); androidLastUrl.delete(id);
        PcBrowser.close({ tabId: id }).catch(() => {});
        if (t) useBrowser.getState().update(id, { live: false, loading: false });
      }
    }
    for (const t of tabs) {
      const web = !isInternal(t.url);
      if (!live.has(t.id)) {
        if (t.id !== activeId || !web || t.error) continue; // só abre quando for usada
        live.set(t.id, t.nav || 0);
        webviews.set(t.id, androidCtl(t.id));
        PcBrowser.open({ tabId: t.id, url: t.url, activate: true }).catch(() => {});
        useBrowser.getState().update(t.id, { live: true, sleeping: false });
        continue;
      }
      if (t.nav && live.get(t.id) !== t.nav) {
        live.set(t.id, t.nav);
        if (t.pendingUrl && !isInternal(t.pendingUrl)) PcBrowser.navigate({ tabId: t.id, url: t.pendingUrl }).catch(() => {});
      }
    }
    if (activeId && live.has(activeId)) PcBrowser.activate({ tabId: activeId }).catch(() => {});
  }, [tabs, activeId, hydrated]);

  // Onde a página aparece (em pixels da tela) e se está coberta por algo.
  useEffect(() => {
    let raf = 0;
    let last = '';
    let frame = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (++frame % 2) return;
      const s = useBrowser.getState();
      const tab = s.tabs.find((t) => t.id === s.activeId);
      const vp = document.querySelector('.pcb-viewport');
      const r = vp?.getBoundingClientRect();
      let visible = !!(r && r.width > 20 && r.height > 20 && tab && !isInternal(tab.url) && !tab.error && opened.current.has(tab.id) && !document.hidden);
      if (visible && (s.panel || s.share || document.querySelector('.pcb-sugg, .pcb-pop, .modal-overlay'))) visible = false;
      if (visible) {
        // Algo do app por cima da página (menu lateral, janelas)? Esconde.
        for (const fx of [0.08, 0.5, 0.92]) {
          for (const fy of [0.06, 0.5, 0.94]) {
            const el = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
            if (el && !vp.contains(el)) { visible = false; break; }
          }
          if (!visible) break;
        }
      }
      const d = window.devicePixelRatio || 1;
      const rect = r ? { x: Math.round(r.left * d), y: Math.round(r.top * d), width: Math.round(r.width * d), height: Math.round(r.height * d) } : { x: 0, y: 0, width: 0, height: 0 };
      const key = `${visible ? 1 : 0}|${rect.x}|${rect.y}|${rect.width}|${rect.height}`;
      if (key === last) return;
      last = key;
      PcBrowser.setRect({ ...rect, visible }).catch(() => {});
    };
    tick();
    return () => { cancelAnimationFrame(raf); PcBrowser.setRect({ x: 0, y: 0, width: 0, height: 0, visible: false }).catch(() => {}); };
  }, []);

  return null;
}
