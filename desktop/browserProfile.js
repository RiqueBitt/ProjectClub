// Perfil do navegador do Project Club: TUDO fica em arquivos no computador
// da pessoa, dentro da pasta de dados do app (nada vai para o servidor):
//
//   <dados do app>/browser/perfil/
//     favoritos.json   – sites salvos
//     historico.json   – páginas visitadas (abas privadas nunca entram)
//     abas.json        – abas abertas (restauradas ao abrir o app)
//     downloads.json   – lista de downloads
//     interface.json   – preferências da interface (painel lateral etc.)
//     senhas.json      – logins salvos; a senha é criptografada com a proteção
//                        do sistema (Windows DPAPI / chaveiro do macOS/Linux)
//   <dados do app>/browser/state.json – privacidade, permissões, bloqueador
//   <dados do app>/Partitions/pcbrowser – cookies e dados dos sites (Chromium)
//
// Escrita atômica (arquivo temporário + rename) para nunca corromper.

const { app, ipcMain, shell, safeStorage, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const security = require('./security');
const crypto = require('crypto');

let DIR = null;
let mainWin = null;
let isBrowserSession = () => false;

const FILES = {
  bookmarks: 'favoritos.json',
  history: 'historico.json',
  tabs: 'abas.json',
  downloads: 'downloads.json',
  ui: 'interface.json',
};
const LIMITS = { bookmarks: 1000, history: 5000, tabs: 60, downloads: 200 };

const send = (ch, data) => { try { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(ch, data); } catch { /* fechando */ } };
// Janela principal E frame do site do Project Club (ver security.js) —
// senhas e perfil nunca respondem a iframe/página de fora.
const fromMain = (e) => mainWin && !mainWin.isDestroyed() && e.sender === mainWin.webContents && security.isTrustedEvent(e);

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8')); } catch { return fallback; }
}
function writeJsonNow(name, data) {
  const target = path.join(DIR, name);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, target);
}
const timers = new Map();
const pending = new Map();
function writeJson(name, data, delay = 600) {
  pending.set(name, data);
  clearTimeout(timers.get(name));
  timers.set(name, setTimeout(() => flush(name), delay));
}
function flush(name) {
  if (!pending.has(name)) return;
  const data = pending.get(name);
  pending.delete(name);
  try { writeJsonNow(name, data); } catch (err) { console.warn('[navegador] não consegui salvar', name, err.message); }
}
function flushAll() { for (const name of [...pending.keys()]) flush(name); }

// ---------- validação (o site só manda dados no formato esperado) ----------
const str = (v, n = 2048) => (typeof v === 'string' ? v.slice(0, n) : '');
const httpUrl = (v) => { const s = str(v, 4096); return /^(https?:\/\/|pc:\/\/|view-source:)/i.test(s) ? s : ''; };
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fav = (v) => { const s = str(v, 4096); return /^(https:|data:image\/)/i.test(s) && s.length < 4096 ? s : null; };
const CLEAN = {
  bookmarks: (list) => (Array.isArray(list) ? list : []).slice(0, LIMITS.bookmarks).map((b) => ({ url: httpUrl(b?.url), title: str(b?.title, 300), favicon: fav(b?.favicon), at: num(b?.at) })).filter((b) => b.url),
  history: (list) => (Array.isArray(list) ? list : []).slice(0, LIMITS.history).map((h) => ({ url: httpUrl(h?.url), title: str(h?.title, 300), favicon: fav(h?.favicon), at: num(h?.at) })).filter((h) => h.url),
  tabs: (obj) => ({
    tabs: (Array.isArray(obj?.tabs) ? obj.tabs : []).slice(0, LIMITS.tabs).map((t) => ({ url: httpUrl(t?.url), title: str(t?.title, 300), favicon: fav(t?.favicon), pinned: !!t?.pinned, zoom: Math.min(3, Math.max(0.3, num(t?.zoom) || 1)) })).filter((t) => t.url),
    active: Math.max(0, Math.floor(num(obj?.active))),
  }),
  ui: (obj) => ({ dockOpen: !!obj?.dockOpen, dockWidth: Math.min(1200, Math.max(300, num(obj?.dockWidth) || 480)) }),
};

// ---------- downloads (o motor avisa a cada mudança) ----------
let downloadsList = [];
function recordDownload(info) {
  const i = downloadsList.findIndex((d) => d.id === info.id && d.startedAt === info.startedAt);
  const row = { id: info.id, filename: info.filename, url: info.url, total: info.total, received: info.received, state: info.state, savePath: info.savePath, startedAt: info.startedAt };
  if (info.private) return; // download de aba privada não entra na lista salva
  if (i < 0) downloadsList.push(row); else downloadsList[i] = row;
  downloadsList = downloadsList.slice(-LIMITS.downloads);
  if (info.state !== 'progressing') writeJson(FILES.downloads, downloadsList, 300);
}

// ---------- senhas ----------
let vault = { entries: [], never: [] };
let plainFallback = false; // Linux sem chaveiro → proteção básica
const vaultFile = 'senhas.json';
function encryptionInfo() {
  let available = false; let backend = '';
  try { available = safeStorage.isEncryptionAvailable(); } catch { /* ok */ }
  try { backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : (process.platform === 'win32' ? 'dpapi' : 'keychain'); } catch { /* versão antiga */ }
  return { available, backend: plainFallback ? 'basic_text' : backend, weak: plainFallback || backend === 'basic_text' };
}
// Sem chaveiro no Linux só existe a proteção básica — como o Chrome/Firefox,
// salvamos assim mesmo, mas a interface avisa.
const canSave = () => encryptionInfo().available;
function enc(text) { return safeStorage.encryptString(String(text)).toString('base64'); }
function dec(b64) { return safeStorage.decryptString(Buffer.from(b64, 'base64')); }
const saveVault = () => writeJson(vaultFile, vault, 200);
const originOf = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.origin : ''; } catch { return ''; } };
const isSecureOrigin = (o) => /^https:\/\//.test(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);

const offers = new Map(); // id → { origin, username, password, wcId, update }
const lastUser = new Map(); // wcId → { origin, username, at } (login em duas etapas)

function guestOf(e) {
  const wc = e.sender;
  if (!wc || !isBrowserSession(wc.session)) return null;
  if (e.senderFrame && wc.mainFrame && e.senderFrame !== wc.mainFrame) return null; // só a página principal
  return wc;
}

function registerIpc() {
  // ---- perfil (só a janela do app) ----
  ipcMain.handle('browser:profile-load', (e) => {
    if (!fromMain(e)) throw new Error('não autorizado');
    return {
      bookmarks: readJson(FILES.bookmarks, null),
      history: readJson(FILES.history, null),
      tabs: readJson(FILES.tabs, null),
      ui: readJson(FILES.ui, null),
      downloads: downloadsList,
      dir: DIR,
    };
  });
  ipcMain.handle('browser:profile-save', (e, key, data) => {
    if (!fromMain(e) || !CLEAN[key]) return false;
    writeJson(FILES[key], CLEAN[key](data));
    return true;
  });
  ipcMain.handle('browser:profile-open-folder', (e) => { if (fromMain(e)) shell.openPath(DIR); return true; });
  ipcMain.handle('browser:profile-clear-downloads', (e) => { if (!fromMain(e)) return false; downloadsList = []; writeJson(FILES.downloads, [], 0); return true; });

  // ---- senhas: páginas (preload do navegador) ----
  ipcMain.on('pcb:pw-username', (e, username) => {
    const wc = guestOf(e); if (!wc) return;
    const origin = originOf(wc.getURL());
    const u = str(username, 200).trim();
    if (origin && u) lastUser.set(wc.id, { origin, username: u, at: Date.now() });
  });
  ipcMain.on('pcb:pw-submit', (e, payload) => {
    const wc = guestOf(e); if (!wc) return;
    if (!wc.session.isPersistent()) return; // aba privada: nunca oferece salvar
    const origin = originOf(wc.getURL());
    const password = str(payload?.password, 500);
    let username = str(payload?.username, 200).trim();
    if (!origin || !isSecureOrigin(origin) || !password) return;
    if (!username) { const lu = lastUser.get(wc.id); if (lu && lu.origin === origin && Date.now() - lu.at < 10 * 60 * 1000) username = lu.username; }
    if (vault.never.includes(origin)) return;
    const same = vault.entries.find((x) => x.origin === origin && x.username === username);
    if (same) {
      let unchanged = false;
      try { unchanged = dec(same.password) === password; } catch { /* não decifra mais: oferece atualizar */ }
      if (unchanged) { same.lastUsed = Date.now(); saveVault(); return; }
    }
    const id = crypto.randomUUID();
    offers.set(id, { origin, username, password, wcId: wc.id, update: !!same, at: Date.now() });
    setTimeout(() => offers.delete(id), 10 * 60 * 1000);
    send('browser:pw-offer', { id, webContentsId: wc.id, origin, username, update: !!same, canSave: canSave(), weak: encryptionInfo().weak });
  });
  ipcMain.on('pcb:pw-form', (e) => {
    const wc = guestOf(e); if (!wc) return;
    const origin = originOf(wc.getURL());
    const list = vault.entries.filter((x) => x.origin === origin);
    if (list.length) send('browser:pw-available', { webContentsId: wc.id, origin, accounts: list.map((x) => ({ id: x.id, username: x.username })) });
  });

  // ---- senhas: interface do app ----
  const h = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { if (!fromMain(e)) throw new Error('não autorizado'); return fn(...a); });
  h('browser:pw-decide', (id, action) => {
    const o = offers.get(String(id));
    if (!o) return false;
    offers.delete(String(id));
    if (action === 'never') { if (!vault.never.includes(o.origin)) vault.never.push(o.origin); saveVault(); return true; }
    if (action !== 'save' || !canSave()) return false;
    const existing = vault.entries.find((x) => x.origin === o.origin && x.username === o.username);
    if (existing) { existing.password = enc(o.password); existing.updatedAt = Date.now(); existing.lastUsed = Date.now(); }
    else vault.entries.push({ id: crypto.randomUUID(), origin: o.origin, username: o.username, password: enc(o.password), createdAt: Date.now(), lastUsed: Date.now() });
    saveVault();
    return true;
  });
  h('browser:pw-fill', (wcId, entryId) => {
    const wc = webContents.fromId(Number(wcId));
    const entry = vault.entries.find((x) => x.id === entryId);
    if (!wc || !entry || !isBrowserSession(wc.session)) return false;
    // Só preenche no MESMO site em que o login foi salvo.
    if (originOf(wc.getURL()) !== entry.origin) return false;
    let password;
    try { password = dec(entry.password); } catch { return false; }
    wc.send('pcb:pw-fill', { username: entry.username, password });
    entry.lastUsed = Date.now(); saveVault();
    return true;
  });
  h('browser:pw-list', () => ({
    encryption: encryptionInfo(),
    never: [...vault.never],
    entries: vault.entries.map((x) => ({ id: x.id, origin: x.origin, username: x.username, createdAt: x.createdAt, lastUsed: x.lastUsed })).sort((a, b) => a.origin.localeCompare(b.origin)),
  }));
  h('browser:pw-reveal', (id) => { const x = vault.entries.find((y) => y.id === id); if (!x) return null; try { return dec(x.password); } catch { return null; } });
  h('browser:pw-delete', (id) => { vault.entries = vault.entries.filter((x) => x.id !== id); saveVault(); return true; });
  h('browser:pw-forget-never', (origin) => { vault.never = vault.never.filter((o) => o !== origin); saveVault(); return true; });
  h('browser:pw-delete-all', () => { vault = { entries: [], never: [] }; saveVault(); return true; });
}

function init(win, { baseDir, isBrowserSession: check }) {
  mainWin = win;
  if (DIR) return;
  DIR = path.join(baseDir, 'perfil');
  fs.mkdirSync(DIR, { recursive: true });
  isBrowserSession = check;
  downloadsList = readJson(FILES.downloads, []);
  // Download que estava em andamento quando o app fechou não vai terminar.
  downloadsList = downloadsList.map((d) => (d.state === 'progressing' ? { ...d, state: 'interrupted' } : d));
  // Linux sem chaveiro do sistema: usa a proteção básica (igual ao Chrome
  // nesse caso). A interface avisa que é básica. Windows/macOS: sem efeito.
  if (process.platform === 'linux') {
    try { if (!safeStorage.isEncryptionAvailable()) { safeStorage.setUsePlainTextEncryption(true); plainFallback = true; } } catch { /* versão sem a opção */ }
  }
  const v = readJson(vaultFile, null);
  if (v && Array.isArray(v.entries)) vault = { entries: v.entries, never: Array.isArray(v.never) ? v.never : [] };
  registerIpc();
  app.on('before-quit', flushAll);
}
function setWindow(win) { mainWin = win; }

const savedDownloads = () => downloadsList;
function removeDownload(id) { downloadsList = downloadsList.filter((d) => d.id !== id); writeJson(FILES.downloads, downloadsList, 0); }

module.exports = { init, setWindow, recordDownload, savedDownloads, removeDownload, flushAll, dir: () => DIR, _CLEAN: CLEAN };
