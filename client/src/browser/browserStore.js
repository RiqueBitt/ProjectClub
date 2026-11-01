import { create } from 'zustand';
import { NEW_TAB, nativeBrowser, toUrl, isInternal } from './urlTools';
import { browserPlatform, androidProfile, androidEngine, engineApi } from './platform';

// Estado do navegador do Project Club: abas, favoritos, histórico, downloads
// e preferências. Abas normais, favoritos e histórico ficam neste aparelho
// (localStorage); abas privadas nunca são salvas.

const K = { tabs: 'pc.browser.tabs', bookmarks: 'pc.browser.bookmarks', history: 'pc.browser.history', ui: 'pc.browser.ui' };
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
// No app desktop (navegador v2+), tudo vai para ARQUIVOS no computador
// (pasta de dados do app → browser/perfil). localStorage só no app antigo.
const PROFILE_KEY = { [K.tabs]: 'tabs', [K.bookmarks]: 'bookmarks', [K.history]: 'history', [K.ui]: 'ui' };
// No celular (app Android), arquivos na pasta de dados do app. No site, localStorage.
const profileApi = () => nativeBrowser()?.profile || (browserPlatform() === 'android' ? androidProfile : null);
const save = (k, v) => {
  const pf = profileApi();
  if (pf && hydratedFromFiles) { pf.save(PROFILE_KEY[k], v).catch(() => {}); return; }
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* cheio/bloqueado */ }
};
let hydratedFromFiles = false;
let hydrating = false;

let seq = 0;
const newId = () => `t${Date.now().toString(36)}${(++seq).toString(36)}`;
const privSeq = () => Math.random().toString(36).slice(2, 10);

const blankTab = (url, extra = {}) => ({
  id: newId(), url: url || NEW_TAB, title: '', favicon: null, loading: !isInternal(url || NEW_TAB), canBack: false, canForward: false,
  private: false, partition: null, wcId: null, audible: false, muted: false, zoom: 1, error: null, permission: null,
  blocked: 0, pinned: false, hoverUrl: '', upgradedHost: null, nav: 0, createdAt: Date.now(), ...extra,
});

const DEFAULT_BOOKMARKS = [
  { url: 'https://www.youtube.com', title: 'YouTube' },
  { url: 'https://www.wikipedia.org', title: 'Wikipédia' },
  { url: 'https://github.com', title: 'GitHub' },
  { url: 'https://www.reddit.com', title: 'Reddit' },
  { url: 'https://www.twitch.tv', title: 'Twitch' },
  { url: 'https://store.steampowered.com', title: 'Steam' },
];

function restoreTabs() {
  const saved = load(K.tabs, null);
  if (!saved?.tabs?.length) return { tabs: [], activeId: null };
  const tabs = saved.tabs.slice(0, 40).map((t) => blankTab(t.url, { title: t.title || '', favicon: t.favicon || null, pinned: !!t.pinned, zoom: t.zoom || 1, restored: true }));
  const idx = Math.min(Math.max(0, saved.active || 0), tabs.length - 1);
  return { tabs, activeId: tabs[idx]?.id || null };
}

let persistTimer = null;
const persistTabs = (get) => {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const { tabs, activeId } = get();
    const normal = tabs.filter((t) => !t.private);
    save(K.tabs, { tabs: normal.map((t) => ({ url: t.url, title: t.title, favicon: t.favicon, pinned: t.pinned, zoom: t.zoom })), active: Math.max(0, normal.findIndex((t) => t.id === activeId)) });
  }, 400);
};

const initial = restoreTabs();
const ui = load(K.ui, {});

export const useBrowser = create((set, get) => ({
  // Funciona no app de computador, no app do celular e no site.
  available: true,
  platform: browserPlatform(),
  // Com perfil em arquivos, as abas só aparecem depois de ler os arquivos.
  hydrated: !profileApi(),
  profileDir: null,
  tabs: initial.tabs,
  activeId: initial.activeId,
  dockOpen: !!ui.dockOpen,
  dockWidth: Math.min(Math.max(Number(ui.dockWidth) || 480, 340), 1200),
  bookmarks: load(K.bookmarks, DEFAULT_BOOKMARKS.map((b) => ({ ...b, at: Date.now() }))),
  history: load(K.history, []),
  closed: [],
  downloads: [],
  prefs: { adblock: true, cookieBanners: true, httpsOnly: true, stripTracking: true, block3pCookies: true, gpc: true, trimReferrer: true, searchEngine: 'ddg' },
  engine: { state: 'off' },
  totalBlocked: 0,
  siteAllow: [],
  share: null, // { url, title, quote } → modal de compartilhar
  focusOmnibox: 0,
  findOpen: false,
  panel: null, // 'shield' | 'downloads' | 'menu' | null

  active() { const s = get(); return s.tabs.find((t) => t.id === s.activeId) || null; },

  openTab(url, opts = {}) {
    const { background = false, private: priv = false, afterId = null, reveal = false } = opts;
    const target = url ? (isInternal(url) || /^(https?|view-source):/i.test(url) ? url : toUrl(url, get().prefs.searchEngine)) : NEW_TAB;
    const s = get();
    const opener = afterId ? s.tabs.find((t) => t.id === afterId) : null;
    const isPriv = priv || !!opener?.private;
    const tab = blankTab(target, isPriv ? { private: true, partition: opener?.private ? opener.partition : `pcbrowser-private-${privSeq()}` } : {});
    const tabs = [...s.tabs];
    const at = opener ? tabs.indexOf(opener) + 1 + tabs.slice(tabs.indexOf(opener) + 1).filter((t) => t.openerId === opener.id).length : tabs.length;
    tabs.splice(at, 0, { ...tab, openerId: opener?.id || null });
    set({ tabs, activeId: background ? (s.activeId || tab.id) : tab.id, ...(reveal ? { reveal: Date.now() } : {}) });
    persistTabs(get);
    if (!url && !background) set({ focusOmnibox: Date.now() });
    return tab.id;
  },
  closeTab(id) {
    const s = get();
    const i = s.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const tab = s.tabs[i];
    const tabs = s.tabs.filter((t) => t.id !== id);
    let activeId = s.activeId;
    if (activeId === id) {
      const opener = tab.openerId && tabs.find((t) => t.id === tab.openerId);
      activeId = (opener || tabs[i] || tabs[i - 1] || null)?.id || null;
    }
    const closed = tab.private || isInternal(tab.url) ? s.closed : [{ url: tab.url, title: tab.title, at: Date.now() }, ...s.closed].slice(0, 25);
    set({ tabs, activeId, closed });
    // Última aba privada daquela sessão fechada → apaga tudo dela.
    if (tab.private && !tabs.some((t) => t.partition === tab.partition)) nativeBrowser()?.clearPrivate(tab.partition).catch(() => {});
    persistTabs(get);
  },
  reopenClosed() { const [c, ...rest] = get().closed; if (!c) return; set({ closed: rest }); get().openTab(c.url); },
  activate(id) { if (get().tabs.some((t) => t.id === id)) { set({ activeId: id, findOpen: false }); persistTabs(get); } },
  cycle(dir) {
    const { tabs, activeId } = get();
    if (tabs.length < 2) return;
    const i = tabs.findIndex((t) => t.id === activeId);
    get().activate(tabs[(i + dir + tabs.length) % tabs.length].id);
  },
  moveTab(id, toIndex) {
    const tabs = [...get().tabs];
    const i = tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const [t] = tabs.splice(i, 1);
    tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, t);
    set({ tabs }); persistTabs(get);
  },
  update(id, patch) {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
    if ('url' in patch || 'title' in patch || 'favicon' in patch || 'pinned' in patch || 'zoom' in patch) persistTabs(get);
  },
  byWc(wcId) { return get().tabs.find((t) => t.wcId === wcId) || null; },
  // Navegar a aba (texto digitado, URL ou página interna). A troca de fato no
  // <webview> é feita pelo BrowserHost ao ver "nav" mudar.
  navigate(id, input) {
    const url = toUrl(input, get().prefs.searchEngine);
    if (!url) return;
    get().update(id, { url, pendingUrl: url, nav: Date.now(), error: null, permission: null, loading: !isInternal(url), title: isInternal(url) ? '' : get().tabs.find((t) => t.id === id)?.title });
  },
  togglePin(id) {
    const t = get().tabs.find((x) => x.id === id);
    if (!t) return;
    get().update(id, { pinned: !t.pinned });
    const tabs = [...get().tabs].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    set({ tabs }); persistTabs(get);
  },

  addHistory(entry) {
    if (!entry?.url || isInternal(entry.url) || /^view-source:/.test(entry.url)) return;
    const h = get().history;
    const now = Date.now();
    // Mesma página em menos de 30 min: só atualiza (não enche o histórico).
    if (h[0] && h[0].url === entry.url && now - h[0].at < 30 * 60 * 1000) {
      const next = [{ ...h[0], title: entry.title || h[0].title, favicon: entry.favicon || h[0].favicon, at: now }, ...h.slice(1)];
      set({ history: next }); save(K.history, next); return;
    }
    const next = [{ url: entry.url, title: entry.title || '', favicon: entry.favicon || null, at: now }, ...h].slice(0, 3000);
    set({ history: next }); save(K.history, next);
  },
  setHistoryTitle(url, title, favicon) {
    const h = get().history;
    if (!h[0] || h[0].url !== url) return;
    const next = [{ ...h[0], title: title || h[0].title, favicon: favicon || h[0].favicon }, ...h.slice(1)];
    set({ history: next }); save(K.history, next);
  },
  removeHistory(at) { const next = get().history.filter((x) => x.at !== at); set({ history: next }); save(K.history, next); },
  clearHistory(sinceMs = null) { const next = sinceMs ? get().history.filter((x) => x.at < Date.now() - sinceMs) : []; set({ history: next }); save(K.history, next); },

  isBookmarked(url) { return get().bookmarks.some((b) => b.url === url); },
  toggleBookmark(url, title, favicon) {
    if (!url || isInternal(url)) return;
    const b = get().bookmarks;
    const next = b.some((x) => x.url === url) ? b.filter((x) => x.url !== url) : [{ url, title: title || url, favicon: favicon || null, at: Date.now() }, ...b].slice(0, 500);
    set({ bookmarks: next }); save(K.bookmarks, next);
  },
  renameBookmark(url, title) { const next = get().bookmarks.map((b) => (b.url === url ? { ...b, title } : b)); set({ bookmarks: next }); save(K.bookmarks, next); },

  setDock(open) { set({ dockOpen: open }); save(K.ui, { dockOpen: open, dockWidth: get().dockWidth }); },
  setDockWidth(w) { const dockWidth = Math.min(Math.max(Math.round(w), 340), 1200); set({ dockWidth }); save(K.ui, { dockOpen: get().dockOpen, dockWidth }); },
  setPanel(panel) { set((s) => ({ panel: s.panel === panel ? null : panel })); },

  // Lê favoritos, histórico, abas e preferências dos arquivos do computador.
  // Primeira vez: leva o que estava salvo no app para os arquivos e limpa o
  // armazenamento antigo (os dados passam a existir só nos arquivos).
  async hydrate() {
    const pf = profileApi();
    if (!pf || hydratedFromFiles) { set({ hydrated: true }); return; }
    if (hydrating) return;
    hydrating = true;
    let data = null;
    try { data = await pf.load(); } catch { set({ hydrated: true }); return; }
    if (browserPlatform() === 'android') await androidEngine.init(data.prefs).catch(() => {});
    const s = get();
    const patch = { profileDir: data.dir || null };
    if (Array.isArray(data.bookmarks)) patch.bookmarks = data.bookmarks;
    else await pf.save('bookmarks', s.bookmarks).catch(() => {});
    if (Array.isArray(data.history)) patch.history = data.history;
    else await pf.save('history', s.history).catch(() => {});
    if (data.ui) { patch.dockOpen = !!data.ui.dockOpen; patch.dockWidth = Math.min(Math.max(Number(data.ui.dockWidth) || 480, 340), 1200); }
    else await pf.save('ui', { dockOpen: s.dockOpen, dockWidth: s.dockWidth }).catch(() => {});
    if (data.tabs?.tabs?.length) {
      const tabs = data.tabs.tabs.slice(0, 40).map((t) => blankTab(t.url, { title: t.title || '', favicon: t.favicon || null, pinned: !!t.pinned, zoom: t.zoom || 1, restored: true }));
      const extra = s.tabs.filter((t) => !t.restored); // abas abertas antes de ler os arquivos
      patch.tabs = [...tabs, ...extra];
      patch.activeId = extra[extra.length - 1]?.id || tabs[Math.min(Math.max(0, data.tabs.active || 0), tabs.length - 1)]?.id || null;
    } else if (s.tabs.length) {
      const normal = s.tabs.filter((t) => !t.private);
      await pf.save('tabs', { tabs: normal.map((t) => ({ url: t.url, title: t.title, favicon: t.favicon, pinned: t.pinned, zoom: t.zoom })), active: Math.max(0, normal.findIndex((t) => t.id === s.activeId)) }).catch(() => {});
    }
    if (Array.isArray(data.downloads) && data.downloads.length) {
      const seen = new Set(s.downloads.map((d) => d.id));
      patch.downloads = [...data.downloads.filter((d) => !seen.has(d.id)), ...s.downloads].slice(-200);
    }
    hydratedFromFiles = true;
    for (const k of Object.values(K)) { try { localStorage.removeItem(k); } catch { /* ok */ } }
    set({ ...patch, hydrated: true });
  },

  async loadNative() {
    const nb = engineApi();
    if (!nb?.getState) return;
    try {
      const st = await nb.getState();
      const cur = get().downloads;
      const ids = new Set((st.downloads || []).map((d) => d.id));
      set({ prefs: { ...get().prefs, ...st.prefs }, engine: st.engine, totalBlocked: st.stats?.total || 0, siteAllow: st.siteAllow || [], downloads: [...cur.filter((d) => !ids.has(d.id)), ...(st.downloads || [])].slice(-200), statsSince: st.stats?.since, profileDir: st.profileDir || get().profileDir });
    } catch { /* app antigo */ }
  },
  async setPrefs(patch) {
    set((s) => ({ prefs: { ...s.prefs, ...patch } }));
    const nb = engineApi();
    if (nb?.setPrefs) { try { const p = await nb.setPrefs(patch); set({ prefs: { ...get().prefs, ...p } }); } catch { /* ignora */ } }
  },
  upsertDownload(d) {
    set((s) => {
      const i = s.downloads.findIndex((x) => x.id === d.id);
      const downloads = i < 0 ? [...s.downloads, d] : s.downloads.map((x) => (x.id === d.id ? { ...x, ...d } : x));
      return { downloads: downloads.slice(-100) };
    });
  },
}));

// Abre um link no navegador do Project Club (usado pelos links do chat,
// posts, perfis...). Retorna false quando não há navegador (site/app antigo).
export function openInBrowser(url, opts = {}) {
  const st = useBrowser.getState();
  if (!st.available) return false;
  st.openTab(url, { reveal: true, ...opts });
  return true;
}
