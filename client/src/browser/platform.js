import { Capacitor, registerPlugin } from '@capacitor/core';
import { nativeBrowser } from './urlTools';
import { api } from '../api/client';

// ============================================================
// Onde o navegador do Project Club está rodando e o que cada lugar permite:
//  - desktop: app para computador (Electron) — <webview> com tudo
//    (bloqueador completo, senhas, downloads, abas privadas);
//  - android: app do celular — abas WebView nativas (PcBrowserPlugin.java)
//    encaixadas no layout, bloqueador por domínio, só HTTPS, downloads pelo
//    Android, câmera/microfone com permissão;
//  - web: site em navegador comum — páginas que deixam ser abertas dentro
//    de outro site aparecem aqui (iframe isolado); as outras abrem numa
//    guia nova do seu navegador.
// ============================================================

export const PcBrowser = registerPlugin('PcBrowser');

let cached = null;
export function browserPlatform() {
  if (cached) return cached;
  if (nativeBrowser()) cached = 'desktop';
  else if (Capacitor.isNativePlatform?.() && Capacitor.getPlatform?.() === 'android' && Capacitor.isPluginAvailable?.('PcBrowser')) cached = 'android';
  else cached = 'web';
  return cached;
}

const FEATURES = {
  desktop: { private: true, shield: true, adblockFull: true, downloads: true, passwords: true, dock: true, zoom: true, print: true, find: true, mute: true, permissionsList: true, profileFolder: true, shortcuts: true },
  android: { private: false, shield: true, adblockFull: false, downloads: false, passwords: false, dock: false, zoom: false, print: false, find: true, mute: false, permissionsList: false, profileFolder: false, shortcuts: false },
  web: { private: false, shield: false, adblockFull: false, downloads: false, passwords: false, dock: true, zoom: false, print: false, find: false, mute: false, permissionsList: false, profileFolder: false, shortcuts: true },
};
export const feat = (k) => !!FEATURES[browserPlatform()]?.[k];

// ---------------- perfil em arquivos no celular ----------------
// Mesmo formato do app de computador: favoritos, histórico, abas e
// preferências em arquivos JSON na pasta de dados do app (só no aparelho).
const ANDROID_FILES = { tabs: 'abas.json', bookmarks: 'favoritos.json', history: 'historico.json', ui: 'interface.json', prefs: 'preferencias.json', downloads: 'downloads.json' };
let fsMod = null;
const fs = async () => { if (!fsMod) fsMod = await import('@capacitor/filesystem'); return fsMod; };
const writeQueue = new Map();

export const androidProfile = {
  async load() {
    const { Filesystem, Directory, Encoding } = await fs();
    const out = { dir: 'Armazenamento do app › navegador' };
    await Filesystem.mkdir({ path: 'navegador', directory: Directory.Data, recursive: true }).catch(() => {});
    await Promise.all(Object.entries(ANDROID_FILES).map(async ([k, f]) => {
      try {
        const r = await Filesystem.readFile({ path: `navegador/${f}`, directory: Directory.Data, encoding: Encoding.UTF8 });
        out[k] = JSON.parse(r.data);
      } catch { /* ainda não existe */ }
    }));
    return out;
  },
  // Escritas em sequência por arquivo; a última vence.
  save(key, value) {
    const f = ANDROID_FILES[key];
    if (!f) return Promise.resolve(false);
    const prev = writeQueue.get(f) || Promise.resolve();
    const next = prev.then(async () => {
      const { Filesystem, Directory, Encoding } = await fs();
      await Filesystem.writeFile({ path: `navegador/${f}`, directory: Directory.Data, encoding: Encoding.UTF8, data: JSON.stringify(value), recursive: true });
      return true;
    }).catch(() => false);
    writeQueue.set(f, next);
    return next;
  },
};

// ---------------- sugestões da barra (celular e site) ----------------
export async function remoteSuggest(q) {
  try {
    const { data } = await api.get('/browser/suggest', { params: { q } });
    return Array.isArray(data?.list) ? data.list : [];
  } catch { return []; }
}

// O site deixa ser aberto dentro do Project Club? (versão site)
export async function checkFramable(url) {
  const { data } = await api.get('/browser/check', { params: { url, origin: window.location.origin } });
  return data;
}

// ---------------- motor do Android (mesma "cara" do app de computador) ----------------
const androidState = { prefs: null, siteAllow: [], engine: { state: 'loading' }, total: 0 };
const pushAndroidPrefs = () => {
  const p = androidState.prefs || {};
  return PcBrowser.setPrefs({ adblock: p.adblock !== false, httpsOnly: p.httpsOnly !== false, stripTracking: p.stripTracking !== false, block3pCookies: p.block3pCookies !== false, siteAllow: androidState.siteAllow }).catch(() => {});
};

const ANDROID_PREF_KEYS = ['adblock', 'httpsOnly', 'stripTracking', 'block3pCookies', 'searchEngine'];

export const androidEngine = {
  async init(saved) {
    androidState.prefs = saved?.prefs || {};
    androidState.siteAllow = Array.isArray(saved?.siteAllow) ? saved.siteAllow : [];
    await pushAndroidPrefs();
  },
  persist() { return androidProfile.save('prefs', { prefs: androidState.prefs, siteAllow: androidState.siteAllow }); },
  async getState() {
    const s = await PcBrowser.getState().catch(() => ({}));
    const engine = { state: s.engine || 'loading', lists: 3, domains: s.domains || 0 };
    return { prefs: androidState.prefs || {}, siteAllow: androidState.siteAllow, engine, stats: { total: s.total || 0 } };
  },
  async setPrefs(patch) {
    const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => ANDROID_PREF_KEYS.includes(k)));
    androidState.prefs = { ...(androidState.prefs || {}), ...clean };
    await pushAndroidPrefs();
    this.persist();
    return androidState.prefs;
  },
  async setSiteAdblock(host, enable) {
    const set = new Set(androidState.siteAllow);
    if (enable) set.delete(host); else set.add(host);
    androidState.siteAllow = [...set].slice(0, 500);
    await pushAndroidPrefs();
    this.persist();
  },
  allowDangerous: (host) => PcBrowser.allowHost({ host, kind: 'danger' }),
  allowHttp: (host) => PcBrowser.allowHost({ host, kind: 'http' }),
  openSystem: (url) => PcBrowser.openExternal({ url }).catch(() => {}),
  permissionReply: (id, allow) => PcBrowser.permissionReply({ id, allow: !!allow }).catch(() => {}),
  // Só os sites visitados no navegador (lista do histórico e das abas): os
  // dados do WebView são do app inteiro e o login do Project Club fica intacto.
  async clearData(opts) {
    const { useBrowser } = await import('./browserStore');
    const st = useBrowser.getState();
    const hosts = new Set();
    for (const x of [...st.history, ...st.tabs]) { try { const h = new URL(x.url).hostname; if (h) hosts.add(h); } catch { /* interna */ } }
    return PcBrowser.clearData({ ...(opts || {}), hosts: [...hosts].slice(0, 3000) }).catch(() => {});
  },
  async updateLists() { await PcBrowser.updateLists().catch(() => {}); return (await this.getState()).engine; },
  suggest: remoteSuggest,
};

// ---------------- versão site ----------------
const WEB_PREFS = 'pc.browser.webprefs';
export const webEngine = {
  getState() {
    let prefs = {};
    try { prefs = JSON.parse(localStorage.getItem(WEB_PREFS)) || {}; } catch { /* vazio */ }
    return Promise.resolve({ prefs, siteAllow: [], engine: { state: 'off' }, stats: { total: 0 } });
  },
  async setPrefs(patch) {
    const cur = (await this.getState()).prefs;
    const next = { ...cur, ...patch };
    try { localStorage.setItem(WEB_PREFS, JSON.stringify(next)); } catch { /* ok */ }
    return next;
  },
  openSystem: (url) => { window.open(url, '_blank', 'noopener,noreferrer'); },
  suggest: remoteSuggest,
};

// API do "motor" atual — a interface chama sempre por aqui.
export function engineApi() {
  const p = browserPlatform();
  if (p === 'desktop') return nativeBrowser();
  if (p === 'android') return androidEngine;
  return webEngine;
}
