// Navegador do Project Club (app desktop) — o "motor" no processo principal.
//
// As páginas são <webview> dentro do próprio site do Project Club (abas no
// layout do app, lado a lado com o chat). Aqui fica tudo que precisa de
// privilégio nativo: a sessão isolada do navegador, o bloqueio de anúncios e
// rastreadores, as proteções de privacidade, permissões, downloads, menu de
// contexto e atalhos de teclado.
//
// Privacidade inspirada no LibreWolf (Firefox endurecido):
//   - mesmas listas que o LibreWolf liga no uBlock Origin (uBlock filtros,
//     privacidade, malware, correções; EasyList; EasyPrivacy; remoção de
//     parâmetros; URLhaus; phishing; Peter Lowe; atalhos de URL legítimos),
//     mais a regional PT/ES e as de avisos de cookies — motor @ghostery/adblocker;
//   - modo só-HTTPS (com exceção por site), remoção de parâmetros de rastreio,
//     cookies de terceiros bloqueados, Referer cortado entre sites
//     (network.http.referer.XOriginPolicy), Sec-GPC/DNT, WebRTC sem vazar IP
//     local, User-Agent de Chrome comum (sem "Electron"), zero telemetria.
//
// O site só fala com isto via IPC (preload.js → window.electronAPI.browser),
// e todo IPC confere se veio da janela principal do app.

const { app, session, ipcMain, shell, net, Menu, clipboard, webContents, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
// Perfil em arquivos no computador (favoritos, histórico, abas, senhas...).
const profile = require('./browserProfile');
const GUEST_PRELOAD = path.join(__dirname, 'browserGuestPreload.js');

let tldts = null;
let ElectronBlocker = null;
let fromElectronDetails = null;
let PRELOAD_PATH = null;
try {
  ({ ElectronBlocker, fromElectronDetails } = require('@ghostery/adblocker-electron'));
  tldts = require('tldts-experimental');
  PRELOAD_PATH = require.resolve('@ghostery/adblocker-electron-preload');
} catch (err) {
  console.warn('[navegador] bloqueador indisponível:', err.message);
}

const PERSIST_PARTITION = 'persist:pcbrowser';
const PRIVATE_RE = /^pcbrowser-private-[a-z0-9]{1,16}$/;
const isBrowserPartition = (p) => p === PERSIST_PARTITION || PRIVATE_RE.test(String(p || ''));

// ---------------- listas de filtros ----------------
// Último espelho de cada lista: o próprio repositório do uBlock no GitHub.
const LIST = (...urls) => urls;
const BASE_LISTS = {
  'ublock-filters': LIST('https://ublockorigin.github.io/uAssetsCDN/filters/filters.min.txt', 'https://ublockorigin.pages.dev/filters/filters.min.txt', 'https://raw.githubusercontent.com/uBlockOrigin/uAssetsCDN/main/filters/filters.min.txt'),
  'ublock-badware': LIST('https://ublockorigin.github.io/uAssetsCDN/filters/badware.min.txt', 'https://ublockorigin.pages.dev/filters/badware.min.txt', 'https://raw.githubusercontent.com/uBlockOrigin/uAssetsCDN/main/filters/badware.min.txt'),
  'ublock-privacy': LIST('https://ublockorigin.github.io/uAssetsCDN/filters/privacy.min.txt', 'https://ublockorigin.pages.dev/filters/privacy.min.txt', 'https://raw.githubusercontent.com/uBlockOrigin/uAssetsCDN/main/filters/privacy.min.txt'),
  'ublock-unbreak': LIST('https://ublockorigin.github.io/uAssetsCDN/filters/unbreak.min.txt', 'https://ublockorigin.pages.dev/filters/unbreak.min.txt', 'https://raw.githubusercontent.com/uBlockOrigin/uAssetsCDN/main/filters/unbreak.min.txt'),
  'ublock-quick-fixes': LIST('https://ublockorigin.github.io/uAssetsCDN/filters/quick-fixes.min.txt', 'https://ublockorigin.pages.dev/filters/quick-fixes.min.txt', 'https://raw.githubusercontent.com/uBlockOrigin/uAssetsCDN/main/filters/quick-fixes.min.txt'),
  easylist: LIST('https://cdn.jsdelivr.net/gh/uBlockOrigin/uAssetsCDN@main/thirdparties/easylist.txt', 'https://cdn.statically.io/gh/uBlockOrigin/uAssetsCDN/main/thirdparties/easylist.txt', 'https://raw.githubusercontent.com/uBlockOrigin/uAssetsCDN/main/thirdparties/easylist.txt'),
  easyprivacy: LIST('https://cdn.jsdelivr.net/gh/uBlockOrigin/uAssetsCDN@main/thirdparties/easyprivacy.txt', 'https://cdn.statically.io/gh/uBlockOrigin/uAssetsCDN/main/thirdparties/easyprivacy.txt', 'https://raw.githubusercontent.com/uBlockOrigin/uAssetsCDN/main/thirdparties/easyprivacy.txt'),
  'adguard-spyware-url': LIST('https://ublockorigin.github.io/uAssetsCDN/filters/privacy-removeparam.txt', 'https://ublockorigin.pages.dev/filters/privacy-removeparam.txt', 'https://raw.githubusercontent.com/uBlockOrigin/uAssetsCDN/main/filters/privacy-removeparam.txt'),
  'urlhaus-1': LIST('https://curbengh.github.io/malware-filter/urlhaus-filter-ag-online.txt', 'https://malware-filter.gitlab.io/urlhaus-filter/urlhaus-filter-ag-online.txt'),
  'curben-phishing': LIST('https://curbengh.github.io/phishing-filter/phishing-filter.txt', 'https://malware-filter.gitlab.io/phishing-filter/phishing-filter.txt'),
  'plowe-0': LIST('https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=1&mimetype=plaintext'),
  'adguard-pt-es': LIST('https://filters.adtidy.org/extension/ublock/filters/9.txt'),
};
const COOKIE_LISTS = {
  'ublock-cookies-adguard': LIST('https://ublockorigin.github.io/uAssetsCDN/filters/annoyances-cookies.txt', 'https://ublockorigin.pages.dev/filters/annoyances-cookies.txt', 'https://raw.githubusercontent.com/uBlockOrigin/uAssetsCDN/main/filters/annoyances-cookies.txt'),
  'fanboy-cookiemonster': LIST('https://ublockorigin.github.io/uAssetsCDN/thirdparties/easylist-cookies.txt', 'https://ublockorigin.pages.dev/thirdparties/easylist-cookies.txt', 'https://raw.githubusercontent.com/uBlockOrigin/uAssetsCDN/main/thirdparties/easylist-cookies.txt'),
};
// Só ameaças (sites inteiros de malware/phishing): conferidas na navegação principal.
const DANGER_LISTS = ['ublock-badware', 'urlhaus-1', 'curben-phishing'];
const LIST_MAX_AGE = 4 * 24 * 3600 * 1000; // igual ao uBO: listas renovadas a cada ~4 dias

// Parâmetros de rastreio removidos dos links (complementa o removeparam das listas).
const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'mc_eid', 'mc_cid', 'igshid', 'yclid', 'twclid', 'ttclid', 'li_fat_id',
  '_hsenc', '_hsmi', '__hssc', '__hstc', '__hsfp', 'hsctatracking', 'mkt_tok', 'vero_conv', 'vero_id', 'wickedid', 'oly_anon_id', 'oly_enc_id',
  'rb_clickid', 's_cid', 'ef_id', 'srsltid', 'spm', 'scm', 'ns_mchannel', 'ns_source', 'ns_campaign', 'ns_linkname', 'ns_fee', 'pk_campaign', 'pk_kwd',
]);
const isTrackingParam = (k) => TRACKING_PARAMS.has(k) || /^utm_[a-z_]+$/i.test(k) || /^(pk|mtm)_(source|medium|campaign|content|keyword)$/i.test(k);

function stripTracking(raw) {
  let u;
  try { u = new URL(raw); } catch { return raw; }
  if (!/^https?:$/.test(u.protocol) || !u.search) return raw;
  let changed = false;
  for (const k of [...u.searchParams.keys()]) if (isTrackingParam(k)) { u.searchParams.delete(k); changed = true; }
  return changed ? u.toString() : raw;
}

const LOCAL_HOST_RE = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^.]+\.local|[^.]+\.localhost)$/i;

// ---------------- estado persistido ----------------
const DEFAULT_PREFS = {
  adblock: true, cookieBanners: true, httpsOnly: true, stripTracking: true, block3pCookies: true, gpc: true, trimReferrer: true, searchEngine: 'ddg',
};
const S = {
  dir: null,
  prefs: { ...DEFAULT_PREFS },
  siteAllow: {}, // { host: true } → bloqueador desligado nesse site
  permissions: {}, // { "origin|perm": true|false }
  httpOk: new Set(), // hosts liberados do modo só-HTTPS (só nesta execução, como o Firefox)
  dangerOk: new Set(), // hosts perigosos que a pessoa decidiu abrir mesmo assim (só nesta execução)
  stats: { total: 0, since: Date.now() },
};
let mainWin = null;
let blocker = null;
let dangerBlocker = null;
let engineInfo = { state: 'off', lists: 0, updatedAt: null, error: null };
const tabBlocked = new Map(); // webContentsId -> contador
const preparedSessions = new WeakSet();
const pendingPerms = new Map(); // id -> callback
let permSeq = 0;
const downloads = new Map(); // id -> { item?, info }
let dlSeq = Date.now(); // ids únicos entre execuções (a lista fica salva em arquivo)

const stateFile = () => path.join(S.dir, 'state.json');
function loadState() {
  try {
    const j = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    S.prefs = { ...DEFAULT_PREFS, ...(j.prefs || {}) };
    S.siteAllow = j.siteAllow || {};
    S.permissions = j.permissions || {};
    S.stats = { total: 0, since: Date.now(), ...(j.stats || {}) };
  } catch { /* primeira vez */ }
}
let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(stateFile(), JSON.stringify({ prefs: S.prefs, siteAllow: S.siteAllow, permissions: S.permissions, stats: S.stats })); } catch { /* disco cheio etc */ }
  }, 800);
}

const send = (channel, payload) => { try { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, payload); } catch { /* janela fechando */ } };

// ---------------- motor de bloqueio ----------------
async function fetchText(urls) {
  for (const u of urls) {
    try {
      const r = await net.fetch(u, { signal: AbortSignal.timeout(20000) });
      if (r.ok) { const t = await r.text(); if (t.length > 50) return t; }
    } catch { /* tenta o espelho */ }
  }
  throw new Error('lista indisponível');
}

function listCachePath(name) { return path.join(S.dir, 'lists', `${name}.txt`); }

// Busca cada lista (ou usa a cópia local se ainda estiver nova / se a rede falhar).
async function getLists(force) {
  fs.mkdirSync(path.join(S.dir, 'lists'), { recursive: true });
  const wanted = { ...BASE_LISTS, ...(S.prefs.cookieBanners ? COOKIE_LISTS : {}) };
  const texts = {};
  await Promise.all(Object.entries(wanted).map(async ([name, urls]) => {
    const p = listCachePath(name);
    let fresh = false;
    try { fresh = !force && Date.now() - fs.statSync(p).mtimeMs < LIST_MAX_AGE; } catch { /* sem cópia */ }
    if (!fresh) {
      try { const t = await fetchText(urls); fs.writeFileSync(p, t); texts[name] = t; return; } catch { /* usa a cópia velha abaixo */ }
    }
    try { texts[name] = fs.readFileSync(p, 'utf8'); } catch { /* sem cópia nenhuma: segue sem essa lista */ }
  }));
  return texts;
}

const ENGINE_CONFIG = { loadCosmeticFilters: true, loadNetworkFilters: true, enableCompression: true, enableHtmlFiltering: false, guessRequestTypeFromUrl: true };
const engineFile = () => path.join(S.dir, `engine-${S.prefs.cookieBanners ? 'c' : 'n'}.bin`);
const dangerFile = () => path.join(S.dir, 'engine-danger.bin');
const DANGER_CONFIG = { loadCosmeticFilters: false, loadNetworkFilters: true, enableCompression: true };

async function buildEngine({ force = false } = {}) {
  if (!ElectronBlocker) { engineInfo = { state: 'off', lists: 0, updatedAt: null, error: 'indisponível' }; return; }
  engineInfo = { ...engineInfo, state: 'loading' };
  send('browser:engine', engineInfo);
  try {
    // Testes: lista local no lugar das listas da internet.
    if (process.env.PC_BROWSER_FILTERS) {
      blocker = ElectronBlocker.parse(fs.readFileSync(process.env.PC_BROWSER_FILTERS, 'utf8'), ENGINE_CONFIG);
      if (process.env.PC_BROWSER_DANGER) dangerBlocker = ElectronBlocker.parse(fs.readFileSync(process.env.PC_BROWSER_DANGER, 'utf8'), DANGER_CONFIG);
      engineInfo = { state: 'on', lists: 1, updatedAt: Date.now(), error: null };
      send('browser:engine', engineInfo);
      return;
    }
    // Motor já compilado e recente: liga na hora, renova em segundo plano.
    if (!force) {
      try {
        const st = fs.statSync(engineFile());
        blocker = ElectronBlocker.deserialize(new Uint8Array(fs.readFileSync(engineFile())));
        try { dangerBlocker = ElectronBlocker.deserialize(new Uint8Array(fs.readFileSync(dangerFile()))); } catch { /* recompila abaixo */ }
        engineInfo = { state: 'on', lists: Object.keys(BASE_LISTS).length + (S.prefs.cookieBanners ? 2 : 0), updatedAt: st.mtimeMs, error: null };
        send('browser:engine', engineInfo);
        if (Date.now() - st.mtimeMs < LIST_MAX_AGE) return;
      } catch { /* versão do motor mudou ou arquivo corrompido: recompila */ }
    }
    const texts = await getLists(force);
    const names = Object.keys(texts);
    if (!names.length) throw new Error('nenhuma lista disponível');
    const next = ElectronBlocker.parse(names.map((n) => texts[n]).join('\n'), ENGINE_CONFIG);
    const danger = ElectronBlocker.parse(DANGER_LISTS.filter((n) => texts[n]).map((n) => texts[n]).join('\n'), DANGER_CONFIG);
    blocker = next;
    dangerBlocker = danger;
    try { fs.writeFileSync(engineFile(), Buffer.from(next.serialize())); fs.writeFileSync(dangerFile(), Buffer.from(danger.serialize())); } catch { /* sem cache em disco */ }
    engineInfo = { state: 'on', lists: names.length, updatedAt: Date.now(), error: null };
  } catch (err) {
    engineInfo = { ...engineInfo, state: blocker ? 'on' : 'error', error: err.message };
  }
  send('browser:engine', engineInfo);
}

// ---------------- ajudantes de domínio ----------------
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
const siteOf = (host) => (tldts ? (tldts.getDomain(host) || host) : host.split('.').slice(-2).join('.'));
function topUrlOf(details) {
  if (details.resourceType === 'mainFrame') return details.url;
  try { const wc = details.webContentsId ? webContents.fromId(details.webContentsId) : null; return wc ? wc.getURL() : (details.referrer || ''); } catch { return details.referrer || ''; }
}
const isAllowedSite = (topHost) => !!(topHost && (S.siteAllow[topHost] || S.siteAllow[siteOf(topHost)]));

function countBlocked(wcId) {
  S.stats.total += 1;
  if (!wcId) return;
  tabBlocked.set(wcId, (tabBlocked.get(wcId) || 0) + 1);
  scheduleBlockedPush();
  saveState();
}
let blockedPushTimer = null;
function scheduleBlockedPush() {
  if (blockedPushTimer) return;
  blockedPushTimer = setTimeout(() => {
    blockedPushTimer = null;
    send('browser:blocked', { tabs: Object.fromEntries(tabBlocked), total: S.stats.total });
  }, 400);
}

// ---------------- sessão do navegador ----------------
function cleanUserAgent(ua) {
  return String(ua).replace(/\s(Electron|project-club-desktop|ProjectClub)\/[\w.\-]+/gi, '').replace(/\s{2,}/g, ' ').trim();
}

function prepareSession(ses) {
  if (preparedSessions.has(ses)) return ses;
  preparedSessions.add(ses);
  ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));
  try { ses.setSpellCheckerLanguages(['pt-BR', 'en-US']); } catch { /* sem dicionário */ }
  // Preloads das páginas: login salvo (sempre) + filtros cosméticos (se houver).
  try {
    const mine = [GUEST_PRELOAD, PRELOAD_PATH].filter(Boolean);
    ses.setPreloads([...ses.getPreloads().filter((p) => !mine.includes(p)), ...mine]);
  } catch { /* sem preload: só bloqueio de rede */ }

  const filter = { urls: ['<all_urls>'] };
  ses.webRequest.onBeforeRequest(filter, (details, cb) => {
    const { url, resourceType } = details;
    const isFrame = resourceType === 'mainFrame' || resourceType === 'subFrame';
    // 1) Modo só-HTTPS (navegação principal), menos endereços locais e exceções.
    if (resourceType === 'mainFrame' && S.prefs.httpsOnly && url.startsWith('http://')) {
      const host = hostOf(url);
      if (host && !LOCAL_HOST_RE.test(host) && !S.httpOk.has(host)) {
        send('browser:https-upgraded', { webContentsId: details.webContentsId, host, url });
        return cb({ redirectURL: `https://${url.slice(7)}` });
      }
    }
    // 2) Parâmetros de rastreio fora dos links.
    if (isFrame && S.prefs.stripTracking) {
      const clean = stripTracking(url);
      if (clean !== url) return cb({ redirectURL: clean });
    }
    // 3) Anúncios, rastreadores, malware e phishing.
    if (resourceType === 'mainFrame') {
      // Página inteira de malware/phishing (listas de ameaças, como o
      // "strict blocking" do uBO): para antes de carregar e avisa.
      const host = hostOf(url);
      if (dangerBlocker && fromElectronDetails && S.prefs.adblock && !S.dangerOk.has(host)) {
        try {
          const { match } = dangerBlocker.match(fromElectronDetails(details));
          if (match) {
            countBlocked(details.webContentsId);
            send('browser:dangerous', { webContentsId: details.webContentsId, url, host });
            return cb({ cancel: true });
          }
        } catch { /* segue */ }
      }
      return cb({});
    }
    if (!blocker || !S.prefs.adblock || isAllowedSite(hostOf(topUrlOf(details)))) return cb({});
    try {
      blocker.onBeforeRequest(details, (res) => {
        if (res && (res.cancel || res.redirectURL)) countBlocked(details.webContentsId);
        cb(res || {});
      });
    } catch { cb({}); }
  });

  ses.webRequest.onBeforeSendHeaders(filter, (details, cb) => {
    const h = details.requestHeaders || {};
    if (S.prefs.gpc) { h['Sec-GPC'] = '1'; h.DNT = '1'; }
    const type = details.resourceType;
    if (type !== 'mainFrame') {
      const top = hostOf(topUrlOf(details));
      const reqHost = hostOf(details.url);
      const crossSite = top && reqHost && siteOf(top) !== siteOf(reqHost);
      if (crossSite) {
        // Cookies de terceiros: fora em recursos (imagem, script, xhr...); frames
        // (logins incorporados, players) continuam funcionando.
        if (S.prefs.block3pCookies && type !== 'subFrame') { delete h.Cookie; delete h.cookie; }
        // Referer entre sites só com a origem (LibreWolf: XOriginPolicy).
        if (S.prefs.trimReferrer) {
          const ref = h.Referer || h.referer;
          if (ref) { try { const o = new URL(ref).origin; delete h.referer; h.Referer = `${o}/`; } catch { delete h.Referer; delete h.referer; } }
        }
      }
    }
    cb({ requestHeaders: h });
  });

  ses.webRequest.onHeadersReceived(filter, (details, cb) => {
    const finish = (extra) => {
      let headers = extra?.responseHeaders || details.responseHeaders;
      if (S.prefs.block3pCookies && details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame') {
        const top = hostOf(topUrlOf(details));
        const reqHost = hostOf(details.url);
        if (top && reqHost && siteOf(top) !== siteOf(reqHost) && headers) {
          headers = { ...headers };
          for (const k of Object.keys(headers)) if (k.toLowerCase() === 'set-cookie') delete headers[k];
          return cb({ responseHeaders: headers });
        }
      }
      cb(extra?.responseHeaders ? { responseHeaders: extra.responseHeaders } : {});
    };
    if (blocker && S.prefs.adblock && (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') && !isAllowedSite(hostOf(topUrlOf(details)))) {
      try { blocker.onHeadersReceived(details, (res) => finish(res)); return; } catch { /* segue sem CSP extra */ }
    }
    finish(null);
  });

  // Permissões: o Project Club pergunta dentro da aba (barra de permissão).
  const AUTO_ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'window-management']);
  const ASK = new Set(['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'clipboard-read', 'display-capture', 'idle-detection', 'storage-access', 'top-level-storage-access', 'openExternal', 'keyboardLock']);
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (AUTO_ALLOW.has(permission)) return callback(true);
    if (!ASK.has(permission)) return callback(false);
    const origin = (() => { try { return new URL(details.requestingUrl || wc.getURL()).origin; } catch { return ''; } })();
    let extra = '';
    if (permission === 'media') extra = (details.mediaTypes || []).join(',');
    if (permission === 'openExternal') {
      extra = String(details.externalURL || '');
      if (!/^(mailto|tel|sms|steam|discord|spotify|zoommtg|msteams|whatsapp|tg|magnet|ms-windows-store|slack|nxm):/i.test(extra)) return callback(false);
    }
    const key = `${origin}|${permission}${permission === 'media' ? `:${extra}` : ''}`;
    if (permission !== 'openExternal' && key in S.permissions) return callback(!!S.permissions[key]);
    const id = ++permSeq;
    pendingPerms.set(id, { callback, key, permission, extra, persist: ses.isPersistent() });
    send('browser:permission', { id, webContentsId: wc.id, origin, permission, extra });
    setTimeout(() => { const p = pendingPerms.get(id); if (p) { pendingPerms.delete(id); p.callback(false); } }, 120000);
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => {
    if (AUTO_ALLOW.has(permission)) return true;
    const k = Object.keys(S.permissions).find((x) => x.startsWith(`${origin}|${permission}`));
    return k ? !!S.permissions[k] : false;
  });

  // Downloads: vão pra pasta Downloads, com progresso no Project Club.
  ses.on('will-download', (_e, item, wc) => {
    const id = ++dlSeq;
    const dir = app.getPath('downloads');
    const base = item.getFilename().replace(/[\\/:*?"<>|]+/g, '_') || 'download';
    let target = path.join(dir, base);
    const ext = path.extname(base);
    for (let n = 1; fs.existsSync(target) && n < 500; n++) target = path.join(dir, `${path.basename(base, ext)} (${n})${ext}`);
    item.setSavePath(target);
    const info = { id, filename: path.basename(target), url: item.getURL(), total: item.getTotalBytes(), received: 0, state: 'progressing', savePath: target, startedAt: Date.now(), private: !ses.isPersistent(), webContentsId: wc?.id || null };
    downloads.set(id, { item, info });
    send('browser:download', info); profile.recordDownload(info);
    item.on('updated', (_ev, state) => {
      info.received = item.getReceivedBytes(); info.total = item.getTotalBytes();
      info.state = state === 'interrupted' ? 'interrupted' : (item.isPaused() ? 'paused' : 'progressing');
      send('browser:download', info);
      profile.recordDownload(info);
    });
    item.once('done', (_ev, state) => {
      info.received = item.getReceivedBytes();
      info.state = state; // completed | cancelled | interrupted
      downloads.set(id, { item: null, info });
      send('browser:download', info);
      profile.recordDownload(info);
    });
  });
  return ses;
}

function sessionFor(partition) { return prepareSession(session.fromPartition(partition)); }

// ---------------- webview: endurecimento, popups, menu, atalhos ----------------
function hardenWebPreferences(webPreferences) {
  delete webPreferences.preload;
  delete webPreferences.preloadURL;
  webPreferences.nodeIntegration = false;
  webPreferences.nodeIntegrationInSubFrames = false;
  webPreferences.contextIsolation = true;
  webPreferences.sandbox = true;
  webPreferences.webviewTag = false;
  webPreferences.webSecurity = true;
  webPreferences.allowRunningInsecureContent = false;
  webPreferences.spellcheck = true;
}

// Chamado pelo will-attach-webview da janela principal. Retorna true se o
// webview é do navegador (e então já foi aprovado/endurecido aqui).
function onWillAttach(event, webPreferences, params) {
  if (!isBrowserPartition(params.partition)) return false;
  hardenWebPreferences(webPreferences);
  const src = String(params.src || '');
  if (src && src !== 'about:blank' && !/^(view-source:)?https?:\/\//i.test(src)) { event.preventDefault(); return true; }
  sessionFor(params.partition);
  return true;
}

const SHORTCUT_KEYS = new Set(['t', 'w', 'l', 'f', 'r', 'd', 'h', 'j', 'p', 'tab', '=', '+', '-', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'n', 'k']);
function onDidAttach(wc) {
  const ses = wc.session;
  if (!preparedSessions.has(ses)) return false;
  try { wc.setWebRTCIPHandlingPolicy('default_public_interface_only'); } catch { /* versão antiga */ }

  wc.setWindowOpenHandler(({ url, disposition, features }) => {
    if (!/^https?:\/\//i.test(url) && url !== 'about:blank') {
      if (/^(mailto|tel):/i.test(url)) send('browser:external', { webContentsId: wc.id, url });
      return { action: 'deny' };
    }
    // Popup de verdade (login OAuth com window.opener): janela pequena do
    // próprio Project Club, mesma sessão. O resto vira aba nova.
    if (disposition === 'new-window' && features) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520, height: 700, autoHideMenuBar: true, parent: mainWin || undefined, backgroundColor: '#ffffff', title: 'Project Club',
          webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false },
        },
      };
    }
    send('browser:open-tab', { url, background: disposition === 'background-tab', openerId: wc.id, private: !ses.isPersistent() });
    return { action: 'deny' };
  });
  wc.on('did-create-window', (win) => { try { win.webContents.setWebRTCIPHandlingPolicy('default_public_interface_only'); } catch { /* ok */ } });

  // Sair da página nunca trava a aba (beforeunload sem diálogo).
  wc.on('will-prevent-unload', (e) => e.preventDefault());

  wc.on('render-process-gone', (_e, details) => send('browser:crashed', { webContentsId: wc.id, reason: details?.reason }));

  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = String(input.key || '').toLowerCase();
    const mod = input.control || input.meta;
    // F12 / Ctrl+Shift+I: ferramentas de desenvolvedor da aba.
    if (key === 'f12' || (mod && input.shift && key === 'i')) { event.preventDefault(); if (wc.isDevToolsOpened()) wc.closeDevTools(); else wc.openDevTools({ mode: 'detach' }); return; }
    const hit = (mod && SHORTCUT_KEYS.has(key)) || key === 'f5' || key === 'f6' || key === 'f11'
      || (input.alt && (key === 'arrowleft' || key === 'arrowright' || key === 'home')) || (key === 'escape');
    if (!hit) return;
    if (key !== 'escape') event.preventDefault();
    send('browser:shortcut', { webContentsId: wc.id, key, shift: !!input.shift, alt: !!input.alt, mod: !!mod });
  });

  wc.on('context-menu', (_e, p) => buildContextMenu(wc, p).popup({ window: mainWin || undefined }));
  return true;
}

function buildContextMenu(wc, p) {
  const t = [];
  const act = (action, data) => send('browser:context-action', { webContentsId: wc.id, action, ...data });
  if (p.linkURL && /^https?:/i.test(p.linkURL)) {
    t.push({ label: 'Abrir link em nova aba', click: () => act('open-tab', { url: p.linkURL }) });
    t.push({ label: 'Abrir link em segundo plano', click: () => act('open-tab', { url: p.linkURL, background: true }) });
    t.push({ label: 'Abrir link em aba privada', click: () => act('open-private', { url: p.linkURL }) });
    t.push({ label: 'Compartilhar link no Project Club…', click: () => act('share', { url: p.linkURL, title: p.linkText || '' }) });
    t.push({ label: 'Copiar endereço do link', click: () => clipboard.writeText(stripTracking(p.linkURL)) });
    t.push({ type: 'separator' });
  }
  if (p.mediaType === 'image' && p.srcURL) {
    t.push({ label: 'Abrir imagem em nova aba', click: () => act('open-tab', { url: p.srcURL }) });
    t.push({ label: 'Salvar imagem…', click: () => wc.downloadURL(p.srcURL) });
    t.push({ label: 'Copiar imagem', click: () => wc.copyImageAt(p.x, p.y) });
    t.push({ label: 'Copiar endereço da imagem', click: () => clipboard.writeText(p.srcURL) });
    t.push({ label: 'Compartilhar imagem no Project Club…', click: () => act('share', { url: p.srcURL, title: '' }) });
    t.push({ type: 'separator' });
  }
  if ((p.mediaType === 'video' || p.mediaType === 'audio') && p.srcURL && /^https?:/i.test(p.srcURL)) {
    t.push({ label: 'Salvar mídia…', click: () => wc.downloadURL(p.srcURL) });
    t.push({ label: 'Picture-in-picture', enabled: p.mediaType === 'video', click: () => wc.executeJavaScript(`(()=>{const v=[...document.querySelectorAll('video')].find(v=>v.currentSrc===${JSON.stringify(p.srcURL)})||document.querySelector('video');v&&v.requestPictureInPicture&&v.requestPictureInPicture().catch(()=>{})})()`, true) });
    t.push({ type: 'separator' });
  }
  if (p.isEditable) {
    if (p.misspelledWord && p.dictionarySuggestions?.length) {
      for (const s of p.dictionarySuggestions.slice(0, 5)) t.push({ label: s, click: () => wc.replaceMisspelling(s) });
      t.push({ label: 'Adicionar ao dicionário', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
      t.push({ type: 'separator' });
    }
    t.push({ label: 'Desfazer', role: 'undo', enabled: p.editFlags.canUndo });
    t.push({ label: 'Refazer', role: 'redo', enabled: p.editFlags.canRedo });
    t.push({ type: 'separator' });
    t.push({ label: 'Recortar', role: 'cut', enabled: p.editFlags.canCut });
    t.push({ label: 'Copiar', role: 'copy', enabled: p.editFlags.canCopy });
    t.push({ label: 'Colar', role: 'paste', enabled: p.editFlags.canPaste });
    t.push({ label: 'Selecionar tudo', role: 'selectAll' });
  } else if (p.selectionText && p.selectionText.trim()) {
    const sel = p.selectionText.trim().slice(0, 300);
    t.push({ label: 'Copiar', role: 'copy' });
    t.push({ label: `Pesquisar “${sel.length > 28 ? `${sel.slice(0, 27)}…` : sel}”`, click: () => act('search', { text: sel }) });
    t.push({ label: 'Enviar trecho no Project Club…', click: () => act('share', { url: wc.getURL(), title: wc.getTitle(), quote: sel }) });
  }
  if (!t.length || (!p.isEditable && !p.selectionText)) {
    if (t.length) t.push({ type: 'separator' });
    t.push({ label: 'Voltar', enabled: wc.canGoBack(), click: () => wc.goBack() });
    t.push({ label: 'Avançar', enabled: wc.canGoForward(), click: () => wc.goForward() });
    t.push({ label: 'Recarregar', click: () => wc.reload() });
    t.push({ type: 'separator' });
    t.push({ label: 'Compartilhar página no Project Club…', click: () => act('share', { url: wc.getURL(), title: wc.getTitle() }) });
    t.push({ label: 'Salvar página como PDF…', click: () => act('pdf', {}) });
    t.push({ label: 'Imprimir…', click: () => wc.print() });
    t.push({ label: 'Ver código-fonte', click: () => act('open-tab', { url: `view-source:${wc.getURL()}` }) });
  }
  t.push({ type: 'separator' });
  t.push({ label: 'Inspecionar', click: () => { wc.inspectElement(p.x, p.y); if (wc.isDevToolsOpened()) wc.devToolsWebContents?.focus(); } });
  return Menu.buildFromTemplate(t);
}

// ---------------- IPC com o site ----------------
function fromMain(e) { return mainWin && !mainWin.isDestroyed() && e.sender === mainWin.webContents; }
function handle(channel, fn) {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!fromMain(e)) throw new Error('não autorizado');
    return fn(...args);
  });
}

const SEARCH_SUGGEST = {
  ddg: (q) => `https://duckduckgo.com/ac/?type=list&kl=br-pt&q=${encodeURIComponent(q)}`,
  google: (q) => `https://suggestqueries.google.com/complete/search?client=firefox&hl=pt-BR&q=${encodeURIComponent(q)}`,
  brave: (q) => `https://search.brave.com/api/suggest?q=${encodeURIComponent(q)}`,
};

function registerIpc() {
  // Filtros cosméticos (esconder caixas de anúncio): pedidos vêm das próprias
  // páginas (preload do bloqueador), só das sessões do navegador.
  ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (e, url, msg) => {
    if (!blocker || !S.prefs.adblock || !preparedSessions.has(e.sender.session)) return undefined;
    if (isAllowedSite(hostOf(url))) return undefined;
    return blocker.onInjectCosmeticFilters(e, url, msg);
  });
  ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', (e) => !!(blocker && S.prefs.adblock && preparedSessions.has(e.sender.session) && blocker.config.enableMutationObserver !== false));

  handle('browser:get-state', () => ({
    version: 1,
    prefs: S.prefs,
    siteAllow: Object.keys(S.siteAllow),
    stats: { ...S.stats, tabs: Object.fromEntries(tabBlocked) },
    engine: engineInfo,
    downloads: [...downloads.values()].map((d) => d.info).slice(-100),
    profileDir: profile.dir(),
    partition: PERSIST_PARTITION,
  }));
  handle('browser:set-prefs', async (patch = {}) => {
    const allowed = Object.keys(DEFAULT_PREFS);
    const prevCookies = S.prefs.cookieBanners;
    for (const [k, v] of Object.entries(patch)) if (allowed.includes(k)) S.prefs[k] = k === 'searchEngine' ? String(v).slice(0, 20) : !!v;
    saveState();
    if (prevCookies !== S.prefs.cookieBanners) buildEngine();
    return S.prefs;
  });
  handle('browser:site-adblock', (host, enabled) => {
    const h = String(host || '').toLowerCase().slice(0, 253);
    if (!h) return false;
    if (enabled) { delete S.siteAllow[h]; delete S.siteAllow[siteOf(h)]; } else S.siteAllow[siteOf(h)] = true;
    saveState();
    return !isAllowedSite(h);
  });
  handle('browser:permission-reply', (id, allow, remember) => {
    const p = pendingPerms.get(Number(id));
    if (!p) return false;
    pendingPerms.delete(Number(id));
    if (remember && p.persist && p.permission !== 'openExternal') { S.permissions[p.key] = !!allow; saveState(); }
    if (allow && p.permission === 'openExternal' && p.extra) { p.callback(false); shell.openExternal(p.extra).catch(() => {}); return true; }
    p.callback(!!allow);
    return true;
  });
  handle('browser:forget-permissions', (origin) => {
    for (const k of Object.keys(S.permissions)) if (!origin || k.startsWith(`${origin}|`)) delete S.permissions[k];
    saveState();
    return true;
  });
  handle('browser:list-permissions', () => Object.entries(S.permissions).map(([k, v]) => { const [origin, perm] = k.split('|'); return { origin, permission: perm, allow: v }; }));
  handle('browser:allow-http', (host) => { const h = String(host || '').toLowerCase(); if (h) S.httpOk.add(h); return true; });
  handle('browser:allow-dangerous', (host) => { const h = String(host || '').toLowerCase(); if (h) S.dangerOk.add(h); return true; });
  handle('browser:suggest', async (q) => {
    const text = String(q || '').trim().slice(0, 120);
    const mk = SEARCH_SUGGEST[S.prefs.searchEngine] || SEARCH_SUGGEST.ddg;
    if (!text) return [];
    try {
      const r = await net.fetch(mk(text), { signal: AbortSignal.timeout(2500) });
      const j = await r.json();
      const list = Array.isArray(j) && Array.isArray(j[1]) ? j[1] : Array.isArray(j) ? j.map((x) => x?.phrase).filter(Boolean) : [];
      return list.filter((s) => typeof s === 'string').slice(0, 8);
    } catch { return []; }
  });
  handle('browser:clear-data', async ({ cookies = true, cache = true, storage = true } = {}) => {
    const ses = session.fromPartition(PERSIST_PARTITION);
    if (cache) await ses.clearCache();
    const storages = [];
    if (cookies) storages.push('cookies');
    if (storage) storages.push('localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage', 'filesystem', 'shadercache');
    if (storages.length) await ses.clearStorageData({ storages });
    if (cookies || storage) { S.permissions = {}; saveState(); }
    return true;
  });
  handle('browser:clear-private', async (partition) => {
    if (!PRIVATE_RE.test(String(partition || ''))) return false;
    const ses = session.fromPartition(partition);
    await ses.clearStorageData(); await ses.clearCache();
    return true;
  });
  handle('browser:download-action', async (id, action) => {
    let d = downloads.get(Number(id));
    if (!d) {
      // Download de uma execução anterior (lista salva em arquivo).
      const saved = (profile.savedDownloads?.() || []).find((x) => x.id === Number(id));
      if (!saved) return false;
      if (action === 'remove') { profile.removeDownload?.(Number(id)); return true; }
      if (!fs.existsSync(saved.savePath)) return false;
      d = { item: null, info: saved };
    }
    const { item, info } = d;
    if (action === 'cancel' && item) item.cancel();
    else if (action === 'pause' && item) item.pause();
    else if (action === 'resume' && item?.canResume()) item.resume();
    else if (action === 'show') shell.showItemInFolder(info.savePath);
    else if (action === 'open' && info.state === 'completed') {
      // Nunca executa programas direto do navegador: só mostra na pasta.
      if (/\.(exe|msi|bat|cmd|com|scr|ps1|vbs|js|jar|appimage|sh|lnk|reg|hta)$/i.test(info.savePath)) shell.showItemInFolder(info.savePath);
      else await shell.openPath(info.savePath);
    } else if (action === 'remove') downloads.delete(Number(id));
    return true;
  });
  handle('browser:update-lists', () => buildEngine({ force: true }).then(() => engineInfo));
  handle('browser:open-system', (url) => { if (/^https?:\/\//i.test(String(url))) shell.openExternal(String(url)); return true; });
  handle('browser:pdf', async (wcId) => {
    const wc = webContents.fromId(Number(wcId));
    if (!wc || !preparedSessions.has(wc.session)) return false;
    const data = await wc.printToPDF({ printBackground: true });
    const name = (wc.getTitle() || 'pagina').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'pagina';
    let target = path.join(app.getPath('downloads'), `${name}.pdf`);
    for (let n = 1; fs.existsSync(target) && n < 500; n++) target = path.join(app.getPath('downloads'), `${name} (${n}).pdf`);
    fs.writeFileSync(target, data);
    shell.showItemInFolder(target);
    return path.basename(target);
  });
}

function init(win) {
  mainWin = win;
  if (S.dir) return; // já iniciado (janela recriada)
  S.dir = path.join(app.getPath('userData'), 'browser');
  fs.mkdirSync(S.dir, { recursive: true });
  loadState();
  registerIpc();
  profile.init(win, { baseDir: S.dir, isBrowserSession: (ses) => preparedSessions.has(ses) });
  sessionFor(PERSIST_PARTITION);
  // Liga o bloqueador sem atrasar a abertura do app.
  setTimeout(() => buildEngine().catch(() => {}), 1500);
  setInterval(() => buildEngine().catch(() => {}), 12 * 3600 * 1000).unref?.();
}
function setWindow(win) { mainWin = win; profile.setWindow(win); }

module.exports = {
  init, setWindow, onWillAttach, onDidAttach, isBrowserPartition, BrowserWindow,
  // puros (testes)
  stripTracking, cleanUserAgent, isTrackingParam, LOCAL_HOST_RE,
};
