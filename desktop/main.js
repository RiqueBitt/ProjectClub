// Project Club — app de desktop (Windows). Não reimplementa nada do site:
// é uma janela do Chromium (Electron) carregando a MESMA versão web já
// hospedada, com o "a mais" que só um app nativo de verdade consegue dar:
// ícone na bandeja do sistema, iniciar sozinho com o Windows, e continuar
// rodando em segundo plano mesmo com a janela fechada — exatamente como
// Discord/Slack fazem.
const { app, BrowserWindow, Tray, Menu, shell, ipcMain, globalShortcut, nativeImage, session, desktopCapturer, screen, dialog } = require('electron');
const path = require('path');

const { autoUpdater } = require('electron-updater');
const fs = require('fs');

// Ajustes conservadores do Chromium (só desligam extras que um app de uma
// página só não usa; nada de GPU/flags experimentais que quebram em PC
// fraco). PROJECT_CLUB_NO_SWITCHES=1 desliga tudo, pra diagnóstico.
//  - SpareRendererForSitePerProcess: o Chromium deixa um processo de
//    renderização "reserva" aquecido pra próxima navegação — aqui a janela
//    nunca navega pra outro site, então era só ~30-50MB de RAM parados.
//  - HardwareMediaKeyHandling: o app não "rouba" as teclas de mídia
//    (play/pause) do Spotify/player do sistema.
if (!process.env.PROJECT_CLUB_NO_SWITCHES) {
  app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess,HardwareMediaKeyHandling');
}
const security = require('./security');
const oauthWindow = require('./oauthWindow');

// Abertura mais rápida: os módulos pesados (detector de jogos com o banco de
// processos, gerenciador de mods com os perfis de instalação, ProjectMC,
// Steam, navegador com o bloqueador de anúncios) só são carregados na
// primeira vez que algo usa de verdade — antes, todos eram lidos do disco e
// executados antes mesmo da janela aparecer. Os handlers de IPC continuam
// registrados logo no início (abaixo); só o módulo em si é que espera.
function lazy(modulePath) {
  let mod = null;
  return () => { if (!mod) mod = require(modulePath); return mod; };
}
const activityDetector = lazy('./activityDetector');
const projectMcManager = lazy('./projectMcManager');
// Sistema de Mods (Apps → Mods) — detecção de Steam e instalação local de
// mods (ver steamDetector.js/modsManager.js). Só o processo principal
// mexe com disco/registro; o site fala com esses módulos só via IPC.
const steamDetector = lazy('./steamDetector');
const modsManager = lazy('./modsManager');
// Navegador do Project Club (abas <webview> dentro do app): sessão isolada,
// bloqueio de anúncios/rastreadores e privacidade ao estilo LibreWolf.
const browserEngine = lazy('./browserEngine');

// URL do site hospedado — trocar aqui se o domínio mudar um dia. Fica só
// nesse único lugar de propósito.
// Endereço do site: Shard Cloud. A Square Cloud foi desativada — se alguma
// configuração antiga ainda apontar pra ela, ignora e usa a Shard Cloud.
const DEFAULT_APP_URL = 'https://projectclub.shardweb.app';
const APP_URL = (() => {
  const env = String(process.env.PROJECT_CLUB_URL || '').trim();
  if (!env || /squareweb\.app|squarecloud/i.test(env)) return DEFAULT_APP_URL;
  return env;
})();
security.configure({ appUrl: APP_URL });
const { isAppUrl } = security;
// Sem conexão: tela própria e separada do Project Club ("Project Club ·
// Conexão" — connectionWindow.js), aberta só depois de confirmar que a
// internet ou o servidor estão mesmo fora.
const connectionGuard = require('./connectionWindow').createConnectionGuard({
  appUrl: APP_URL, isAppUrl, icon: path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'tray.png'),
});
// Mostra o app: a janela do Project Club, ou a de conexão se o servidor estiver fora.
function showApp() {
  if (connectionGuard.show()) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ---------- IPC protegido ----------
// Todo pedido do site passa por aqui: só é atendido se veio de um frame da
// origem do Project Club (ou da cópia offline do app). Qualquer outra
// página — outro domínio, iframe de terceiro, um link que escapou — recebe
// "não autorizado" (handle) ou é ignorada (on).
function secureHandle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!security.isTrustedEvent(event)) {
      console.warn(`[segurança] IPC "${channel}" recusado de ${event?.senderFrame?.url || 'origem desconhecida'}`);
      throw new Error('não autorizado');
    }
    return fn(event, ...args);
  });
}
function secureOn(channel, fn) {
  ipcMain.on(channel, (event, ...args) => {
    if (!security.isTrustedEvent(event)) {
      console.warn(`[segurança] IPC "${channel}" ignorado de ${event?.senderFrame?.url || 'origem desconhecida'}`);
      return;
    }
    fn(event, ...args);
  });
}

// ---------- Estado local do app (arquivo em userData) ----------
// Pequeno JSON com o que o app de desktop precisa lembrar entre aberturas
// sem depender da conta: se a inicialização automática já foi configurada
// na primeira execução e as pastas de jogo escolhidas manualmente.
const STATE_FILE = () => path.join(app.getPath('userData'), 'desktop-state.json');
// Ícone alternativo escolhido em Configurações → Aparência: salvo em disco
// pra já abrir com ele da próxima vez (janela, barra de tarefas e bandeja).
const CUSTOM_ICON_FILE = () => path.join(app.getPath('userData'), 'app-icon.png');
function customIconImage() {
  try {
    const f = CUSTOM_ICON_FILE();
    if (!fs.existsSync(f)) return null;
    const img = nativeImage.createFromPath(f);
    return img.isEmpty() ? null : img;
  } catch { return null; }
}
let localStateCache = null;
function readLocalState() {
  if (localStateCache) return localStateCache;
  try { localStateCache = JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')) || {}; } catch { localStateCache = {}; }
  if (typeof localStateCache !== 'object' || Array.isArray(localStateCache)) localStateCache = {};
  return localStateCache;
}
function writeLocalState(patch) {
  const next = { ...readLocalState(), ...patch };
  localStateCache = next;
  try {
    fs.mkdirSync(path.dirname(STATE_FILE()), { recursive: true });
    const tmp = `${STATE_FILE()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmp, STATE_FILE());
  } catch (err) {
    console.warn('[estado] não deu pra salvar:', err.message);
  }
  return next;
}

// ---------- Links externos permitidos ----------
// "open-external" só abre o que o site usa de verdade: páginas web, e-mail,
// telefone e os dois atalhos da Steam (abrir jogo / página do Workshop).
// Qualquer outro esquema (file:, ms-settings:, smb:, programas
// registrados...) é recusado — antes, qualquer URL era repassada ao sistema.
function isAllowedExternalUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return false; }
  if (u.protocol === 'http:' || u.protocol === 'https:') return !!u.hostname;
  if (u.protocol === 'mailto:' || u.protocol === 'tel:') return true;
  if (u.protocol === 'steam:') {
    const rest = String(raw).slice('steam://'.length);
    return /^run\/\d{1,10}\/?$/i.test(rest) || /^url\/CommunityFilePage\/\d{1,20}\/?$/i.test(rest);
  }
  return false;
}

// ---------- Pastas de jogo conhecidas (config de mods) ----------
// mods:write-config-file só escreve dentro da pasta de config de um jogo que
// o app conhece: detectado na Steam, escolhido pela pessoa no diálogo de
// pastas, ou que já tem mods instalados pelo Project Club (manifesto).
const knownGameDirs = new Set();
const normDir = (p) => {
  const r = path.resolve(String(p));
  return process.platform === 'win32' ? r.toLowerCase() : r;
};
function rememberGameDir(p, persist) {
  if (!p) return;
  knownGameDirs.add(normDir(p));
  if (persist) {
    const list = Array.isArray(readLocalState().pickedGameDirs) ? readLocalState().pickedGameDirs : [];
    if (!list.some((x) => normDir(x) === normDir(p))) writeLocalState({ pickedGameDirs: [...list, path.resolve(String(p))].slice(-200) });
  }
}
function isKnownGameDir(p) {
  if (typeof p !== 'string' || !p || !path.isAbsolute(p)) return false;
  try { if (!fs.statSync(p).isDirectory()) return false; } catch { return false; }
  const n = normDir(p);
  if (knownGameDirs.has(n)) return true;
  const picked = readLocalState().pickedGameDirs;
  if (Array.isArray(picked) && picked.some((x) => normDir(x) === n)) { knownGameDirs.add(n); return true; }
  try { if (modsManager().hasManifest(p)) { knownGameDirs.add(n); return true; } } catch { /* sem manifesto */ }
  try {
    const { games = [] } = steamDetector().detectInstalledSteamGames() || {};
    for (const g of games) if (g?.installPath) knownGameDirs.add(normDir(g.installPath));
  } catch { /* Steam indisponível */ }
  return knownGameDirs.has(n);
}

// ---------- Links projectclub:// ----------
// projectclub://invite/<código>   → sala de convite da Guerra das Cartas
// projectclub://post/<id>         → /posts/<id>
// projectclub://user/<id>         → /u/<id> (DeepLinkPage abre o perfil)
// projectclub://channel/<id>      → /channels/<id>
// Os ids são validados à risca (só letras, números e hífen) — nada do link
// vai parar na URL sem passar por aqui.
const DEEP_LINK_SCHEME = 'projectclub';
const DEEP_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const DEEP_INVITE_RE = /^[A-Za-z0-9]{3,12}$/;
function parseDeepLink(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return null; }
  if (u.protocol !== `${DEEP_LINK_SCHEME}:`) return null;
  // projectclub://post/123 → host "post", pathname "/123" (e também aceita
  // projectclub:///post/123 ou projectclub:post/123).
  const parts = `${u.host}/${u.pathname}`.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return ''; } });
  if (parts.length !== 2) return null;
  const [kind, id] = [parts[0].toLowerCase(), parts[1]];
  if (kind === 'invite' && DEEP_INVITE_RE.test(id)) return `/cartas?sala=${encodeURIComponent(id.toUpperCase())}`;
  if (!DEEP_ID_RE.test(id)) return null;
  if (kind === 'post') return `/posts/${id}`;
  if (kind === 'user') return `/u/${id}`;
  if (kind === 'channel') return `/channels/${id}`;
  return null;
}
const findDeepLinkArg = (argv) => (argv || []).find((a) => typeof a === 'string' && a.toLowerCase().startsWith(`${DEEP_LINK_SCHEME}:`));
// Link que abriu o app (Windows/Linux: vem no argv) — vira a primeira página.
let pendingDeepLinkRoute = parseDeepLink(findDeepLinkArg(process.argv));
function openDeepLink(raw) {
  const route = parseDeepLink(raw);
  if (!route) { if (raw) console.warn('[link] projectclub:// inválido ignorado'); return; }
  if (!mainWindow || mainWindow.isDestroyed()) { pendingDeepLinkRoute = route; return; }
  // Sem servidor: guarda o destino pra quando voltar e mostra a tela de conexão.
  if (connectionGuard.isActive()) { pendingDeepLinkRoute = route; connectionGuard.show(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  const wc = mainWindow.webContents;
  if (isAppUrl(wc.getURL()) && !wc.isLoading()) {
    // Navega dentro do site (React Router escuta popstate) sem recarregar —
    // não derruba chamada de voz nem nada aberto. route é montada só a
    // partir de ids validados, e vai como string JSON.
    wc.executeJavaScript(`(function(r){window.history.pushState({}, '', r);window.dispatchEvent(new PopStateEvent('popstate',{state:{}}));})(${JSON.stringify(route)})`)
      .catch(() => mainWindow.loadURL(new URL(route, APP_URL).toString()));
  } else {
    mainWindow.loadURL(new URL(route, APP_URL).toString());
  }
}
function setDeepLinkHandler() {
  try {
    // Em desenvolvimento (electron .) precisa passar o caminho do script.
    if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [path.resolve(process.argv[1])]);
    else app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  } catch (err) {
    console.warn('[link] não deu pra registrar projectclub://:', err.message);
  }
}

// Notificações do Windows: sem o AppUserModelID igual ao appId do instalador
// (package.json → build.appId), o Windows não associa as notificações ao
// atalho do Menu Iniciar e elas podem não aparecer (ou aparecer como
// "electron.app.Electron").
const APP_USER_MODEL_ID = (() => {
  try { return require('./package.json').build.appId || 'com.projectclub.desktop'; } catch { return 'com.projectclub.desktop'; }
})();
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);

let mainWindow = null;
let tray = null;
let isQuitting = false;
// Guarda a função de callback usada da última vez, pra poder LIGAR a
// detecção de novo se a pessoa reativar gameDetectionEnabled no meio da
// sessão (ver ipcMain.on('settings:update') abaixo) sem precisar
// reiniciar o app inteiro pra isso valer.
let activityCallback = null;
let activityDetectionRunning = false;

// ---------- Abertura em etapas ----------
// Tarefas que não precisam rodar antes da janela aparecer (checar
// atualização, detector de jogos...) esperam STARTUP_DEFER_MS depois que a
// janela foi mostrada — assim não competem com o carregamento do site.
const STARTUP_DEFER_MS = 4000;
let startupDone = false;
const startupQueue = [];
function runAfterStartup(fn) {
  if (startupDone) { setTimeout(fn, 0); return; }
  startupQueue.push(fn);
}
function scheduleDeferredStartup() {
  if (startupDone || scheduleDeferredStartup.scheduled) return;
  scheduleDeferredStartup.scheduled = true;
  setTimeout(() => {
    startupDone = true;
    for (const fn of startupQueue.splice(0)) {
      try { fn(); } catch (err) { console.error('[abertura] tarefa adiada falhou:', err?.message || err); }
    }
  }, STARTUP_DEFER_MS);
}

// ---------- Estrangulamento em segundo plano ----------
// Ligado por padrão (economiza CPU com a janela escondida); desligado
// enquanto tem chamada de voz (aviso do site) ou som tocando.
let voiceCallActive = false;
let audioPlaying = false;
function applyThrottling() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try { mainWindow.webContents.setBackgroundThrottling(!(voiceCallActive || audioPlaying)); } catch { /* janela fechando */ }
}
// Item pedido: "Sobreposição no jogo (overlay)... Mostra mensagens e
// notificações por cima do jogo enquanto você joga" — a notificação da
// overlay só deve aparecer enquanto a pessoa está DE VERDADE dentro de
// um jogo (não em qualquer app comum, nem sem nada aberto) — guardado
// aqui pra showOverlayNotification poder checar isso na hora.
let currentActivity = null;

// Item pedido: "Sistema... Geral... Iniciar com o sistema... Minimizar
// para bandeja... Abrir links no aplicativo... Confirmar saída" e
// "Jogos e apps... Detecção automática de jogos... Sobreposição no
// jogo... Notificações na sobreposição" — os valores de verdade vêm do
// UserSettings da conta (ver settingsController.js no backend +
// UserSettingsModal.jsx no site), enviados aqui via IPC (ver
// preload.js: window.electronAPI.updateSettings) toda vez que a tela
// de Configurações carrega ou muda algo. Os padrões abaixo só valem
// ANTES do primeiro aviso chegar (login ainda carregando) — depois
// disso, sempre reflete o que a pessoa escolheu de verdade na conta.
let desktopSettings = {
  // BUG CORRIGIDO: estes 3 valores estavam diferentes do padrão de
  // verdade definido no schema (UserSettings, server/prisma/schema.prisma)
  // — startWithSystem e openLinksInApp/overlayNotifications não
  // batiam com o @default de cada campo lá. Nunca ficam muito tempo
  // "errados" na prática (a sincronização real chega logo após o
  // login), mas ficar consistente com o schema evita qualquer
  // comportamento estranho na primeira fração de segundo antes dela
  // chegar, e evita esse tipo de desalinhamento se algo novo passar a
  // ler esses valores mais cedo no futuro.
  startWithSystem: false,
  minimizeToTray: true,
  openLinksInApp: true,
  confirmOnExit: false,
  gameDetectionEnabled: true,
  overlayEnabled: false,
  overlayNotifications: true,
};

// Só uma cópia do app rodando por vez — clicar duas vezes no atalho (ou o
// Windows tentando abrir de novo no login enquanto já tá aberto) só traz
// a janela existente pra frente, em vez de abrir uma segunda instância.
// ---------- Links nxm:// da Nexus Mods (os mesmos do Vortex) ----------
// Item pedido: "adicione a API de mods e o Vortex". Quando a pessoa liga
// "Baixar da Nexus pelo Project Club", o app vira o programa que abre
// os links nxm:// do botão "Mod Manager Download" do site. Cada link
// traz a chave temporária que libera o download pra conta grátis.
const pendingNxmLinks = [];
function parseNxmLink(raw) {
  try {
    const u = new URL(String(raw));
    if (u.protocol !== 'nxm:') return null;
    const m = u.pathname.match(/^\/?\/?mods\/(\d+)\/files\/(\d+)/) || `${u.host}${u.pathname}`.match(/mods\/(\d+)\/files\/(\d+)/);
    if (!m) return null;
    return {
      domain: u.host.toLowerCase(), modId: Number(m[1]), fileId: Number(m[2]),
      key: u.searchParams.get('key') || null, expires: u.searchParams.get('expires') || null,
      userId: u.searchParams.get('user_id') || null,
    };
  } catch { return null; }
}
function deliverNxmLink(link) {
  if (!link) return;
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('nexus:nxm-link', link);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    pendingNxmLinks.push(link);
  }
}
// ---------- Janela de download (login uma vez só) ----------
// Item pedido: "baixar direto pelo Project Club, sem abrir o navegador
// pedindo login toda vez". Abre a página do arquivo numa janela do
// próprio app com sessão PERSISTENTE (o login fica salvo); quando a
// pessoa clica no botão de download do gerenciador, o link nxm:// é
// pego aqui dentro (nunca vai pro sistema/Vortex), a janela fecha e o
// app instala sozinho, igual a qualquer outro mod.
const DOWNLOAD_PARTITION = 'persist:mods-download';
let downloadWindow = null;
const recentNxm = new Map(); // evita instalar duas vezes o mesmo clique

function catchNxm(url) {
  if (!String(url || '').toLowerCase().startsWith('nxm://')) return false;
  const link = parseNxmLink(url);
  if (!link) return true;
  const key = `${link.domain}:${link.modId}:${link.fileId}:${link.key}`;
  const now = Date.now();
  if (!(recentNxm.get(key) > now - 15000)) {
    recentNxm.set(key, now);
    deliverNxmLink(link);
  }
  if (downloadWindow && !downloadWindow.isDestroyed()) setTimeout(() => { try { downloadWindow.close(); } catch { /* já fechou */ } }, 150);
  return true;
}

let downloadSessionReady = false;
function downloadSession() {
  const ses = session.fromPartition(DOWNLOAD_PARTITION);
  if (!downloadSessionReady) {
    downloadSessionReady = true;
    try {
      // Pedido de nxm:// dentro dessa janela vira instalação no app.
      ses.protocol.handle('nxm', (request) => {
        catchNxm(request.url);
        return new Response('<html><body style="background:#111;color:#ddd;font-family:sans-serif;display:grid;place-items:center;height:100vh">Download enviado pro Project Club.</body></html>', { headers: { 'content-type': 'text/html' } });
      });
    } catch { /* versão sem protocol.handle: os eventos abaixo resolvem */ }
    // BUG CORRIGIDO ("o Windows abriu 'este arquivo não tem um aplicativo
    // associado' com o link nxm://"): links de protocolo desconhecido não
    // passam por will-navigate — o Chromium manda direto pro sistema. Esse
    // pedido de "abrir app externo" passa por aqui: pega o nxm:// e
    // nunca deixa chegar no Windows.
    ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
      if (permission === 'openExternal') {
        const target = details?.externalURL || '';
        if (catchNxm(target)) { callback(false); return; }
        callback(false);
        if (/^https?:/i.test(target)) shell.openExternal(target);
        return;
      }
      callback(permission === 'clipboard-sanitized-write' || permission === 'fullscreen');
    });
    ses.setPermissionCheckHandler((_wc, permission) => permission !== 'openExternal');
  }
  return ses;
}

const DOWNLOAD_ALLOWED_HOSTS = /(^|\.)(nexusmods\.com|nexus-cdn\.com|google\.com|gstatic\.com|googleusercontent\.com|discord\.com|apple\.com|steamcommunity\.com|steampowered\.com|facebook\.com|twitch\.tv|cloudflare\.com|challenges\.cloudflare\.com)$/i;
function isAllowedDownloadUrl(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && DOWNLOAD_ALLOWED_HOSTS.test(u.hostname); } catch { return false; }
}

// YouTube completo dentro da chamada (app desktop): a página pode criar um
// <webview> só com partition persist:youtube e src no youtube.com. Sem
// preload, sem node, sandbox; navegação presa a YouTube/login Google.
const YT_WEBVIEW_HOSTS = /(^|\.)(youtube\.com|youtu\.be|google\.com|google\.com\.br|gstatic\.com|googleusercontent\.com|ytimg\.com|ggpht\.com)$/i;
function isAllowedYouTubeUrl(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && YT_WEBVIEW_HOSTS.test(u.hostname); } catch { return false; }
}
// Navegador do Project Club (browserEngine.js): desligado a pedido. O código
// fica no app para religar depois — basta trocar para true (e ligar
// `browser` em client/src/utils/features.js e server/src/config/features.js).
const BROWSER_ENABLED = false;

function hardenYouTubeWebview(contents) {
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    // Abas do navegador do Project Club: regras próprias (browserEngine.js).
    if (BROWSER_ENABLED && browserEngine().onWillAttach(event, webPreferences, params)) return;
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webviewTag = false;
    let okSrc = false;
    try { okSrc = /^(www\.|m\.)?youtube\.com$/i.test(new URL(params.src).hostname) && params.src.startsWith('https://'); } catch { okSrc = false; }
    if (params.partition !== 'persist:youtube' || !okSrc) event.preventDefault();
  });
  contents.on('did-attach-webview', (_e, wc) => {
    if (BROWSER_ENABLED && browserEngine().onDidAttach(wc)) return;
    const guard = (event, target) => { if (!isAllowedYouTubeUrl(target)) { event.preventDefault(); if (/^https?:/i.test(String(target))) shell.openExternal(target); } };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.setWindowOpenHandler(({ url: target }) => {
      if (isAllowedYouTubeUrl(target)) wc.loadURL(target);
      else if (/^https?:/i.test(target)) shell.openExternal(target);
      return { action: 'deny' };
    });
  });
}

function openDownloadWindow(url) {
  if (!isAllowedDownloadUrl(url)) return { success: false, error: 'Endereço de download inválido.' };
  // Rede de segurança: se mesmo assim o link sair pro sistema, o próprio
  // Project Club é quem abre (volta pelo second-instance → instala).
  try { if (!app.isDefaultProtocolClient('nxm')) setNxmHandler(true); } catch { /* sem permissão: segue */ }
  if (downloadWindow && !downloadWindow.isDestroyed()) {
    downloadWindow.loadURL(url);
    downloadWindow.show();
    downloadWindow.focus();
    return { success: true };
  }
  downloadWindow = new BrowserWindow({
    width: 1180, height: 820, minWidth: 760, minHeight: 560,
    title: 'Baixar mod — Project Club',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    autoHideMenuBar: true,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    backgroundColor: '#111214',
    webPreferences: { session: downloadSession(), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const wc = downloadWindow.webContents;
  const guard = (event, target) => {
    if (catchNxm(target)) { event.preventDefault(); return; }
    if (!/^https?:/i.test(String(target))) { event.preventDefault(); return; }
    if (!isAllowedDownloadUrl(target)) { event.preventDefault(); shell.openExternal(target); }
  };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', guard);
  wc.on('will-frame-navigate', (event) => { if (catchNxm(event.url)) event.preventDefault(); });
  wc.setWindowOpenHandler(({ url: target }) => {
    if (catchNxm(target)) return { action: 'deny' };
    // Janelinhas de login (Google, Discord...) abrem dentro do app; o resto vai pro navegador.
    if (isAllowedDownloadUrl(target)) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, parent: downloadWindow, webPreferences: { session: downloadSession(), contextIsolation: true, nodeIntegration: false, sandbox: true } } };
    }
    if (/^https?:/i.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  downloadWindow.on('closed', () => { downloadWindow = null; });
  downloadWindow.loadURL(url);
  return { success: true };
}

function queueNxmFromArgv(argv) {
  for (const a of argv || []) if (typeof a === 'string' && a.toLowerCase().startsWith('nxm://')) deliverNxmLink(parseNxmLink(a));
}
// macOS entrega o link por evento, não por argumento.
app.on('open-url', (event, url) => {
  const lower = String(url).toLowerCase();
  if (lower.startsWith(`${DEEP_LINK_SCHEME}:`)) {
    event.preventDefault();
    if (app.isReady()) openDeepLink(url);
    else pendingDeepLinkRoute = parseDeepLink(url) || pendingDeepLinkRoute;
    return;
  }
  if (!lower.startsWith('nxm://')) return;
  event.preventDefault();
  deliverNxmLink(parseNxmLink(url));
});
function setNxmHandler(enabled) {
  // Em desenvolvimento (electron .) precisa passar o caminho do script.
  const args = process.defaultApp && process.argv.length >= 2 ? [process.execPath, [path.resolve(process.argv[1])]] : [];
  return enabled ? app.setAsDefaultProtocolClient('nxm', ...args) : app.removeAsDefaultProtocolClient('nxm', ...args);
}
// Links que vieram junto com a abertura do app (Windows/Linux).
for (const a of process.argv) if (typeof a === 'string' && a.toLowerCase().startsWith('nxm://')) { const l = parseNxmLink(a); if (l) pendingNxmLinks.push(l); }

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    queueNxmFromArgv(argv);
    // projectclub:// clicado com o app já aberto (Windows/Linux): o sistema
    // abre uma segunda cópia com o link no argv, que cai aqui.
    const deepLink = findDeepLinkArg(argv);
    if (deepLink) { openDeepLink(deepLink); return; }
    if (mainWindow) showApp();
  });

  // Item pedido: "Confirmar antes de sair... Pede confirmação ao
  // tentar fechar o aplicativo" — ponto único de saída de verdade,
  // usado tanto pelo botão "Sair" da bandeja quanto pelo "X" da janela
  // quando "Minimizar para a bandeja" está desligado. Só pergunta se
  // confirmOnExit estiver ligado — senão sai direto, como sempre foi.
  async function confirmAndQuit() {
    if (desktopSettings.confirmOnExit) {
      const result = await dialog.showMessageBox(mainWindow || undefined, {
        type: 'question',
        buttons: ['Cancelar', 'Sair'],
        defaultId: 1,
        cancelId: 0,
        title: 'Sair do Project Club',
        message: 'Tem certeza que quer sair do Project Club?',
      });
      if (result.response !== 1) return;
    }
    isQuitting = true;
    app.quit();
  }

  // Item pedido: "Detecção automática de jogos... Só tem efeito no
  // aplicativo '.exe'" — liga/desliga o laço de verdade
  // (activityDetector.js já tinha start/stop prontos, só nunca eram
  // chamados condicionalmente). Chamada tanto no carregamento inicial
  // quanto sempre que a pessoa muda o toggle no meio da sessão.
  function applyGameDetectionSetting() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const shouldRun = desktopSettings.gameDetectionEnabled !== false;
    if (shouldRun && !activityDetectionRunning && activityCallback) {
      activityDetectionRunning = true;
      activityDetector().startActivityDetection(activityCallback);
    } else if (!shouldRun && activityDetectionRunning) {
      activityDetectionRunning = false;
      activityDetector().stopActivityDetection();
      currentActivity = null;
      // Avisa o site que a atividade parou (senão o "jogando X" antigo
      // continuaria aparecendo pro resto da comunidade até expirar
      // sozinho no servidor).
      mainWindow.webContents.send('activity:detected', null);
    }
  }

  // Item pedido: "Sobreposição no jogo (overlay)... Mostra mensagens e
  // notificações por cima do jogo enquanto você joga... Nova mensagem,
  // menção, convite, pedido de amizade e entrada em chamada aparecem
  // na overlay." — janelinha própria, transparente, sempre no topo, que
  // NÃO rouba o foco (showInactive) nem intercepta clique nenhum
  // (setIgnoreMouseEvents), pra nunca atrapalhar o jogo por baixo dela.
  // Só aparece quando: 1) a pessoa ligou overlayEnabled E
  // overlayNotifications, e 2) a detecção de atividade confirma que um
  // JOGO de verdade está rodando agora (não qualquer app, nem nada) —
  // fora disso, a notificação comum da bandeja/nativa já dá conta
  // (ver SocketContext.jsx).
  function showOverlayNotification(payload) {
    if (!desktopSettings.overlayEnabled || !desktopSettings.overlayNotifications) return;
    if (!currentActivity || currentActivity.type !== 'game') return;

    const display = screen.getPrimaryDisplay();
    const width = 320;
    const height = 76;
    const overlayWindow = new BrowserWindow({
      width, height, resizable: false, minimizable: false, maximizable: false,
      focusable: false, frame: false, transparent: true, alwaysOnTop: true,
      skipTaskbar: true, hasShadow: false,
      x: display.workArea.x + display.workArea.width - width - 24,
      y: display.workArea.y + 24,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    // 'screen-saver' é o nível mais alto do Electron pra always-on-top —
    // sem isso, muitos jogos em tela cheia exclusiva (não "sem bordas")
    // continuam desenhando por cima de QUALQUER janela comum do Windows,
    // overlay incluído.
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setIgnoreMouseEvents(true);

    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').slice(0, 200);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; }
      body {
        margin: 0; background: transparent; font-family: -apple-system, 'Segoe UI', Roboto, sans-serif;
        display: flex; align-items: flex-start; justify-content: flex-end;
      }
      .toast {
        background: rgba(30, 31, 34, 0.94); color: #f2f3f5; border-radius: 10px; padding: 12px 14px;
        border: 1px solid rgba(255,255,255,0.08); width: 100%; box-shadow: 0 6px 18px rgba(0,0,0,0.4);
        animation: fadeIn .15s ease;
      }
      @keyframes fadeIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
      .title { font-size: 13px; font-weight: 700; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .body { font-size: 12px; color: #b5bac1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    </style></head><body>
      <div class="toast">
        <div class="title">${esc(payload.title)}</div>
        ${payload.body ? `<div class="body">${esc(payload.body)}</div>` : ''}
      </div>
    </body></html>`;

    const htmlPath = path.join(app.getPath('temp'), `project-club-overlay-${Date.now()}.html`);
    fs.writeFileSync(htmlPath, html, 'utf-8');
    overlayWindow.loadFile(htmlPath).then(() => {
      overlayWindow.showInactive();
    });

    // BUG CORRIGIDO (vazamento de arquivos): o .html temporário criado
    // acima nunca era apagado — só a JANELA fechava depois de alguns
    // segundos, o arquivo em si ficava esquecido na pasta temp pra
    // sempre. Com o app recebendo notificação após notificação ao
    // longo de uma sessão longa, isso ia acumulando um arquivo novo
    // por notificação, sem limite, na pasta temp do sistema. Apagado
    // aqui, no mesmo lugar que já fecha a janela — o arquivo só
    // precisava existir o tempo de loadFile() ler ele uma vez.
    setTimeout(() => {
      if (!overlayWindow.isDestroyed()) overlayWindow.close();
      fs.unlink(htmlPath, () => {});
    }, 5000);
  }

  // Abre uma janelinha própria de seleção de tela/janela pra compartilhar
  // — mostra uma miniatura de cada opção disponível (telas inteiras +
  // janelas de outros programas abertos), a pessoa clica na que quer, e
  // essa promise resolve com a fonte escolhida (ou null se ela fechar a
  // janela/cancelar sem escolher nada).
  function showScreenPickerWindow(rawSources) {
    return new Promise((resolve) => {
      // BUG CORRIGIDO ("aparecem telas sem sentido tipo C:/Users/etc"):
      // o Windows Explorer e alguns outros programas usam o CAMINHO DA
      // PASTA como título da janela — sem nenhum filtro, isso aparecia
      // como uma opção pra compartilhar igual qualquer outra, mas sem
      // fazer sentido nenhum pra pessoa escolher. Filtra fora janelas
      // sem nome de verdade, ou cujo nome parece um caminho de arquivo
      // (letra de unidade tipo "C:\\" ou "/", típico do Explorer/
      // gerenciador de arquivos) — telas inteiras nunca são filtradas.
      const sources = rawSources.filter((s) => {
        const name = (s.name || '').trim();
        if (!name) return false;
        if (s.id.startsWith('screen:')) return true;
        if (/^[a-zA-Z]:\\|^\//.test(name)) return false;
        return true;
      });

      const screens = sources.filter((s) => s.id.startsWith('screen:'));
      const windows = sources.filter((s) => !s.id.startsWith('screen:'));

      const picker = new BrowserWindow({
        width: 820, height: 620, resizable: false, minimizable: false, maximizable: false,
        frame: false,
        parent: mainWindow, modal: true, backgroundColor: '#232428',
        webPreferences: {
          preload: path.join(__dirname, 'screenPickerPreload.js'),
          contextIsolation: true, nodeIntegration: false,
        },
      });

      let resolved = false;
      // Só a própria janelinha do seletor pode responder (página local
      // file:// — não passa pelo secureOn, que só aceita o site).
      const onChoice = (event, sourceId) => {
        if (picker.isDestroyed() || event.sender !== picker.webContents) return;
        finish(rawSources.find((s) => s.id === sourceId) || null);
      };
      const finish = (value) => {
        if (resolved) return;
        resolved = true;
        ipcMain.removeListener('screen-picker:choice', onChoice);
        resolve(value);
        if (!picker.isDestroyed()) picker.close();
      };

      ipcMain.on('screen-picker:choice', onChoice);
      picker.on('closed', () => finish(null));

      // Item pedido: "adicione no topo do menu opção Aplicativos,
      // Monitor (se tiver mais de 1 monitor)" — igual o Discord/Zoom já
      // fazem, duas abas em vez de tudo misturado numa lista só. A aba
      // "Tela" só numera os monitores (Tela 1, Tela 2...) quando existe
      // mais de um — com um só, o nome fica simplesmente "Tela inteira".
      const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      const cardsFor = (list, isScreen) => list.map((s, i) => {
        const label = isScreen ? (list.length > 1 ? `Tela ${i + 1}` : 'Tela inteira') : (s.name || 'Sem nome').slice(0, 60);
        const icon = !isScreen && s.appIcon && !s.appIcon.isEmpty() ? `<img class="app-icon" src="${s.appIcon.toDataURL()}" alt="" />` : '';
        return `
        <button class="card" data-source-id="${esc(s.id)}" title="${esc(label)}">
          <div class="card-thumb"><img src="${s.thumbnail.toDataURL()}" alt="" /></div>
          <span class="card-label">${icon}<span>${esc(label)}</span></span>
        </button>`;
      }).join('');

      const screensHtml = screens.length
        ? `<div class="grid">${cardsFor(screens, true)}</div>`
        : `<div class="empty">Nenhuma tela detectada.</div>`;
      const windowsHtml = windows.length
        ? `<div class="grid">${cardsFor(windows, false)}</div>`
        : `<div class="empty">Nenhuma janela aberta para transmitir agora.</div>`;

      // Repaginado: mesmo visual do app (azul da marca, cantos arredondados,
      // abas em pílula). Clique seleciona, "Transmitir" confirma; clique
      // duplo transmite direto; Esc cancela. Sem -webkit-app-region: drag
      // (ele "roubava" os cliques dos botões no Windows).
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        * { box-sizing: border-box; }
        body {
          margin: 0; height: 100vh; display: flex; flex-direction: column;
          background: #1e1f22; color: #f2f3f5; overflow: hidden; user-select: none;
          font-family: 'Segoe UI', -apple-system, Roboto, 'Noto Sans', sans-serif;
          border: 1px solid #34363c; border-radius: 0;
        }
        header { display: flex; align-items: center; gap: 12px; padding: 18px 20px 14px; }
        .head-icon { width: 40px; height: 40px; border-radius: 12px; background: #4c9fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        h1 { margin: 0; font-size: 17px; font-weight: 700; }
        header p { margin: 2px 0 0; font-size: 12.5px; color: #949ba4; }
        .x { margin-left: auto; width: 34px; height: 34px; border: 0; border-radius: 10px; background: transparent; color: #b5bac1; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .x:hover { background: #2e3035; color: #fff; }
        .tabs { display: inline-flex; gap: 2px; padding: 3px; margin: 0 20px; border-radius: 11px; background: #2b2d31; align-self: flex-start; }
        .tab { border: 0; background: none; color: #949ba4; font: inherit; font-size: 13px; font-weight: 600; padding: 7px 16px; border-radius: 8px; cursor: pointer; }
        .tab:hover { color: #dbdee1; }
        .tab.active { background: #383a40; color: #fff; }
        .panel { display: none; flex: 1; min-height: 0; overflow-y: auto; padding: 14px 20px 6px; }
        .panel.active { display: block; }
        .panel::-webkit-scrollbar { width: 8px; } .panel::-webkit-scrollbar-thumb { background: #3a3c42; border-radius: 4px; }
        .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .card {
          display: flex; flex-direction: column; gap: 8px; padding: 8px; border-radius: 14px; cursor: pointer; text-align: left;
          background: #2b2d31; border: 2px solid transparent; color: #f2f3f5; font: inherit;
          transition: border-color .12s ease, background .12s ease, transform .12s ease;
        }
        .card:hover { background: #313338; transform: translateY(-1px); }
        .card.selected { border-color: #4c9fff; background: #2a3445; }
        .card-thumb { aspect-ratio: 16/10; border-radius: 9px; background: #111214; display: flex; align-items: center; justify-content: center; overflow: hidden; pointer-events: none; }
        .card-thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .card-label { display: flex; align-items: center; gap: 7px; min-width: 0; padding: 0 4px 2px; font-size: 12.5px; font-weight: 600; pointer-events: none; }
        .card-label span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .app-icon { width: 16px; height: 16px; flex-shrink: 0; }
        .empty { color: #949ba4; font-size: 13px; padding: 48px 0; text-align: center; }
        footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 20px 16px; border-top: 1px solid #2b2d31; }
        footer small { color: #949ba4; font-size: 12px; }
        .actions { display: flex; gap: 8px; }
        .btn { border: 0; border-radius: 10px; padding: 9px 18px; font: inherit; font-size: 13.5px; font-weight: 700; cursor: pointer; }
        .btn.ghost { background: #2e3035; color: #f2f3f5; } .btn.ghost:hover { background: #383a40; }
        .btn.go { background: #4c9fff; color: #fff; } .btn.go:hover { filter: brightness(1.08); }
        .btn.go:disabled { opacity: .45; cursor: not-allowed; filter: none; }
        .error-banner { display: none; margin: 0 20px 10px; padding: 8px 12px; border-radius: 8px; background: #f23f42; color: #fff; font-size: 12.5px; }
      </style></head><body>
        <header>
          <span class="head-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18v11H3zM8 20h8M12 16v4"/></svg></span>
          <div><h1>O que você quer transmitir?</h1><p>Escolha uma tela ou uma janela aberta.</p></div>
          <button class="x" id="x-btn" aria-label="Fechar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        </header>
        <div class="error-banner" id="error-banner"></div>
        <div class="tabs">
          <button class="tab active" data-target="panel-screen">Telas${screens.length > 1 ? ` (${screens.length})` : ''}</button>
          <button class="tab" data-target="panel-window">Janelas${windows.length ? ` (${windows.length})` : ''}</button>
        </div>
        <div class="panel active" id="panel-screen">${screensHtml}</div>
        <div class="panel" id="panel-window">${windowsHtml}</div>
        <footer>
          <small id="hint">Clique para selecionar · clique duplo transmite</small>
          <div class="actions">
            <button class="btn ghost" id="cancel-btn">Cancelar</button>
            <button class="btn go" id="go-btn" disabled>Transmitir</button>
          </div>
        </footer>
        <script>
          var selected = null;
          function showError(msg) { var el = document.getElementById('error-banner'); el.textContent = msg; el.style.display = 'block'; }
          function choose(sourceId) {
            try {
              if (!window.screenPickerAPI) { showError('Falha interna: a ponte com o app não carregou. Feche e tente de novo.'); return; }
              window.screenPickerAPI.choose(sourceId);
            } catch (err) { showError('Erro ao escolher: ' + err.message); }
          }
          try {
            var go = document.getElementById('go-btn');
            document.getElementById('cancel-btn').addEventListener('click', function () { choose(null); });
            document.getElementById('x-btn').addEventListener('click', function () { choose(null); });
            go.addEventListener('click', function () { if (selected) choose(selected); });
            document.querySelectorAll('.card').forEach(function (card) {
              card.addEventListener('click', function () {
                document.querySelectorAll('.card').forEach(function (c) { c.classList.remove('selected'); });
                card.classList.add('selected');
                selected = card.getAttribute('data-source-id');
                go.disabled = false;
              });
              card.addEventListener('dblclick', function () { choose(card.getAttribute('data-source-id')); });
            });
            document.querySelectorAll('.tab').forEach(function (tab) {
              tab.addEventListener('click', function () {
                document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
                document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
                tab.classList.add('active');
                document.getElementById(tab.getAttribute('data-target')).classList.add('active');
              });
            });
            document.addEventListener('keydown', function (e) {
              if (e.key === 'Escape') choose(null);
              if (e.key === 'Enter' && selected) choose(selected);
            });
            // Com uma tela só, já deixa ela selecionada.
            var first = document.querySelector('#panel-screen .card');
            if (first && document.querySelectorAll('#panel-screen .card').length === 1) first.click();
          } catch (err) { showError('Não foi possível carregar a lista: ' + err.message); }
        </script>
      </body></html>`;

      const htmlPath = path.join(app.getPath('temp'), 'project-club-screen-picker.html');
      fs.writeFileSync(htmlPath, html, 'utf-8');
      picker.loadFile(htmlPath);
    });
  }

  function createWindow(startHidden) {
    mainWindow = new BrowserWindow({
      ...(customIconImage() ? { icon: customIconImage() } : {}),
      width: 1280,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      // Só aparece quando o primeiro quadro já está pintado (ready-to-show
      // abaixo) — sem o "flash" de janela vazia/branca na abertura.
      show: false,
      icon: path.join(__dirname, 'build', 'icon.ico'),
      autoHideMenuBar: true,
      // Item pedido: "crie uma barra que não seja do Windows, de fechar
      // aba, minimizar, aumentar etc" — mesmo padrão do launcher de
      // Minecraft (ProjectMC/goldapple-launcher, já usa frame: false
      // com uma AppSystemBar.vue própria). Sem moldura nativa do
      // Windows — a barra de título fica inteiramente por conta do
      // componente TitleBar.jsx no React, com os 3 botões de janela.
      frame: false,
      // BUG CORRIGIDO ("tela azul escuro aparece antes até da tela de
      // carregamento"): #080a14 nunca combinou com a cor de fundo real
      // do app (--bg-primary do tema escuro em global.css, #313338) —
      // essa cor aparece na janela por uma fração de segundo antes do
      // HTML/CSS carregarem de verdade, criando um "flash" visualmente
      // desconectado do resto do app. Mesma cor agora, consistente com
      // a splash nativa do Android (ver colors.xml) e o app em si.
      backgroundColor: '#313338',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        // O preload.js só usa contextBridge/ipcRenderer/webFrame e
        // process.platform — tudo disponível com sandbox. Ligado: o
        // renderer do site fica isolado do sistema como num navegador.
        sandbox: true,
        // <webview> só pro "YouTube completo" do Assistir juntos (ver
        // hardenYouTubeWebview): só youtube.com, sem preload/node.
        webviewTag: true,
        // Janela escondida/minimizada economiza CPU (timers/animações mais
        // lentos). Desligado só durante chamada de voz — ver
        // setVoiceCallActive/audio-state-changed abaixo.
        backgroundThrottling: true,
        // Dados que o site pedia por IPC logo ao abrir (versão, caminho do
        // .exe) já vão junto na criação — o preload responde na hora, sem
        // ida e volta ao processo principal.
        additionalArguments: [`--pc-boot=${Buffer.from(JSON.stringify({
          version: app.getVersion(),
          installPath: app.getPath('exe'),
        })).toString('base64')}`],
      },
    });
    // Mostra assim que o primeiro quadro estiver pronto (mesma cor de fundo
    // do app = sem flash). Rede de segurança: se o site demorar demais pra
    // pintar (servidor lento), mostra mesmo assim depois de 4s.
    let shownOnce = false;
    const revealWindow = () => {
      if (shownOnce || !mainWindow || mainWindow.isDestroyed()) return;
      shownOnce = true;
      if (!startHidden) mainWindow.show();
      scheduleDeferredStartup();
    };
    mainWindow.once('ready-to-show', revealWindow);
    setTimeout(revealWindow, 4000);

    // Estado de maximizado pro TitleBar.jsx (antes isso era registrado
    // antes da janela existir — mainWindow ainda era null — e nunca ligava).
    mainWindow.on('maximize', () => mainWindow?.webContents.send('window-maximized-changed', true));
    mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window-maximized-changed', false));

    // Chamada de voz em segundo plano não pode ter o áudio/timers
    // estrangulados: tocando som (chamada, música) => sem throttling;
    // 30s depois de ficar em silêncio volta ao normal (a não ser que o
    // site tenha avisado que a chamada continua, via setVoiceCallActive).
    let audibleOffTimer = null;
    mainWindow.webContents.on('audio-state-changed', (event) => {
      const audible = !!(event?.audible ?? mainWindow.webContents.isCurrentlyAudible());
      clearTimeout(audibleOffTimer);
      if (audible) { audioPlaying = true; applyThrottling(); return; }
      audibleOffTimer = setTimeout(() => { audioPlaying = false; applyThrottling(); }, 30000);
    });
    hardenYouTubeWebview(mainWindow.webContents);
    if (BROWSER_ENABLED) browserEngine().init(mainWindow);

    // Aberto por um link projectclub:// → já começa na página certa.
    const startRoute = pendingDeepLinkRoute;
    pendingDeepLinkRoute = null;
    mainWindow.loadURL(startRoute ? new URL(startRoute, APP_URL).toString() : APP_URL);
    connectionGuard.attach(mainWindow);

    // Item pedido: "Rich Presence" (jogo/Spotify) — só começa a detectar
    // depois que a janela terminar de carregar o site de verdade, senão
    // a primeira detecção (que roda na hora, sem esperar o primeiro
    // temporizador de 15s) tentaria mandar pro site antes dele sequer
    // existir. mainWindow.webContents.send manda direto pro JS da
    // página, sem precisar de handle/invoke — é só um aviso, não uma
    // pergunta que espera resposta.
    //
    // Item pedido: "Detecção automática de jogos... Só tem efeito no
    // aplicativo '.exe'" — só liga de verdade se a preferência (vinda
    // da conta, ver applyGameDetectionSetting acima) permitir; guarda o
    // callback pra poder ligar/desligar depois sem reiniciar o app.
    // Também guarda a atividade atual (currentActivity) — é isso que
    // showOverlayNotification usa pra saber se um JOGO de verdade está
    // rodando agora, antes de decidir mostrar a overlay.
    mainWindow.webContents.once('did-finish-load', () => {
      activityCallback = (activity) => {
        currentActivity = activity;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('activity:detected', activity);
        }
      };
      // Abertura mais leve: o detector de jogos (lê a lista de processos do
      // sistema) só começa alguns segundos depois da janela aparecer.
      runAfterStartup(() => applyGameDetectionSetting());
    });

    // Item pedido: "Abrir links no aplicativo... Links clicados dentro
    // do Project Club abrem numa janela do próprio app em vez do
    // navegador padrão" — quando openLinksInApp está ligado, deixa o
    // Electron abrir a própria janela nova dele (comportamento padrão,
    // 'allow') em vez de mandar pro navegador do sistema. Links que já
    // apontam pro próprio site sempre abrem dentro, independente dessa
    // configuração — só é sobre links EXTERNOS.
    // Navegador do Project Club: com "Abrir links no aplicativo" ligado, o
    // link externo vira uma aba do navegador interno (dentro do app, ao lado
    // do chat) em vez de uma janela solta.
    const openExternalLink = (url) => {
      if (!/^https?:\/\//i.test(url)) { if (/^(mailto|tel):/i.test(url)) shell.openExternal(url); return; }
      if (BROWSER_ENABLED && desktopSettings.openLinksInApp) mainWindow.webContents.send('browser:open-tab', { url, reveal: true });
      else shell.openExternal(url);
    };
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (!isAppUrl(url)) {
        openExternalLink(url);
        return { action: 'deny' };
      }
      return { action: 'allow' };
    });
    // Entrar com Discord/GitHub: a página do provedor abre numa janelinha
    // própria do app (ver oauthWindow.js), não no navegador do sistema.
    const handleOAuthNavigation = oauthWindow.attach(mainWindow, { isAppUrl, appUrl: APP_URL });
    // Link externo clicado sem target (navegaria a janela do app pra fora).
    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (security.isTrustedUrl(url)) return;
      event.preventDefault();
      if (handleOAuthNavigation(url)) return;
      openExternalLink(url);
    });

    // Item pedido: "Minimizar para bandeja... Ao fechar a janela, o
    // app continua rodando na bandeja do sistema em vez de encerrar" —
    // com a configuração LIGADA (padrão), fechar só esconde. Desligada,
    // o "X" da janela passa a encerrar o app de verdade (respeitando
    // "Confirmar antes de sair", se também estiver ligado).
    mainWindow.on('close', (e) => {
      if (isQuitting) return;
      if (desktopSettings.minimizeToTray === false) {
        e.preventDefault();
        confirmAndQuit();
        return;
      }
      e.preventDefault();
      mainWindow.hide();
    });
  }

  function createTray() {
    // .ico só funciona de verdade na bandeja do Windows; Linux/macOS usam .png.
    const trayIcon = process.platform === 'win32' ? 'icon.ico' : 'tray.png';
    const savedIcon = customIconImage();
    tray = new Tray(savedIcon ? savedIcon.resize({ width: 32, height: 32 }) : path.join(__dirname, 'build', trayIcon));
    tray.setToolTip('Project Club');
    const menu = Menu.buildFromTemplate([
      { label: 'Abrir Project Club', click: () => { showApp(); } },
      { type: 'separator' },
      {
        label: 'Iniciar com o Windows',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true });
          desktopSettings.startWithSystem = item.checked;
        },
      },
      { type: 'separator' },
      { label: 'Sair', click: () => { confirmAndQuit(); } },
    ]);
    tray.setContextMenu(menu);
    tray.on('click', () => { showApp(); });
  }

  // Item pedido: o site (rodando dentro da janela) precisa saber "qual
  // versão do app nativo está instalada" pra comparar com a mais
  // recente publicada e avisar quando tem atualização — ver preload.js
  // e client/src/utils/nativeUpdateCheck.js. app.getVersion() lê direto
  // do package.json empacotado (o CI grava a versão certa ali antes de
  // gerar o instalador, ver .github/workflows/build-apps.yml).
  secureHandle('get-app-version', () => app.getVersion());
  // O site avisa quando entra/sai de uma chamada de voz — durante a
  // chamada a janela não é estrangulada em segundo plano (ver
  // applyThrottling). Fire and forget.
  secureOn('voice:active', (_e, active) => {
    voiceCallActive = !!active;
    applyThrottling();
  });
  // Item pedido: verificar todos os sistemas de Configurações e afins —
  // diagnóstico de "instalações duplicadas confundindo qual versão está
  // rodando de verdade". Mostra o caminho exato do executável em uso
  // (app.getPath('exe')) na tela de Configurações, pra alguém conseguir
  // confirmar se está rodando a instalação "para todos os usuários"
  // (Program Files) ou "só para mim" (AppData\Local\Programs) quando
  // tiver as duas ao mesmo tempo — sem isso, não tinha como saber qual
  // das duas o atalho clicado realmente abre.
  secureHandle('get-app-install-path', () => app.getPath('exe'));
  // Item pedido: "crie uma barra que não seja do Windows, de fechar
  // aba, minimizar, aumentar etc" — controles de janela pro TitleBar.jsx
  // customizado no React, já que sem frame nativo (frame: false acima)
  // não existe mais nenhum jeito padrão do sistema operacional de
  // minimizar/maximizar/fechar a janela.
  secureHandle('window-minimize', () => mainWindow?.minimize());
  // Arrastar a janela pela barra de título via JS — reserva pro caso de o
  // -webkit-app-region:drag não pegar (zoom da interface, camadas por cima).
  secureOn('window-move-by', (_e, dx, dy) => {
    if (!mainWindow || mainWindow.isMaximized() || mainWindow.isFullScreen()) return;
    const x = Number(dx) || 0; const y = Number(dy) || 0;
    if (!x && !y) return;
    const [wx, wy] = mainWindow.getPosition();
    mainWindow.setPosition(Math.round(wx + x), Math.round(wy + y));
  });
  secureHandle('window-maximize-toggle', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  secureHandle('window-close', () => mainWindow?.close());
  secureHandle('window-is-maximized', () => mainWindow?.isMaximized() ?? false);
  // O React precisa saber quando o estado maximizado muda por OUTRO
  // caminho além do próprio botão (ex: duplo-clique na barra, atalho de
  // teclado do Windows tipo Win+Up, ou arrastar a janela pro topo da
  // tela) — sem isso, o ícone do botão maximizar/restaurar ficaria
  // dessincronizado do estado real da janela nesses casos.
  // (os avisos de maximize/unmaximize agora são ligados em createWindow.)
  // Item pedido: botão "Baixar agora" no aviso de atualização precisa
  // abrir a página de download no NAVEGADOR de verdade — o app nativo
  // nunca mostra a página de marketing/download dentro dele mesmo (ver
  // RootGate em App.jsx), então "navegar pra lá" dentro da própria janela
  // não funcionaria. shell.openExternal manda pro navegador padrão do
  // sistema, de verdade.
  // Só esquemas usados de verdade pelo site (ver isAllowedExternalUrl):
  // http/https, mailto/tel e steam://run|url/CommunityFilePage.
  secureHandle('open-external', (_event, url) => {
    if (!isAllowedExternalUrl(url)) {
      console.warn('[segurança] open-external recusado para um link não permitido');
      return false;
    }
    return shell.openExternal(String(url));
  });
  // Item pedido: clicar numa notificação nativa traz a janela de volta
  // pra frente (mesmo vindo da bandeja) — ver o onclick da notificação
  // em SocketContext.jsx.
  secureHandle('focus-window', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  // Item pedido: bolinha vermelha de não lidas sobreposta no ícone da
  // barra de tarefas do Windows (setOverlayIcon é a API certa pra isso
  // — diferente de macOS/Linux, o Windows não tem "badge count" nativo
  // com número, só ícones sobrepostos; por isso é uma bolinha simples,
  // igual pedido, não um número). Fica só ligado/desligado — não some
  // sozinho, alguém precisa realmente ler as mensagens novas.
  const badgeIcon = nativeImage.createFromPath(path.join(__dirname, 'build', 'badge-dot.png'));
  // Ícone alternativo do app (Configurações → Aparência → Ícone do app).
  // Só aceita PNG em data URL de até ~1 MB; null volta pro ícone padrão.
  secureHandle('set-app-icon', (_event, dataUrl) => {
    try {
      if (!dataUrl) {
        try { fs.unlinkSync(CUSTOM_ICON_FILE()); } catch { /* não tinha */ }
        const def = nativeImage.createFromPath(path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'));
        if (!def.isEmpty()) mainWindow?.setIcon(def);
        try { tray?.setImage(path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'tray.png')); } catch { /* sem bandeja */ }
        return true;
      }
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > 1400000) return false;
      const img = nativeImage.createFromDataURL(dataUrl);
      if (img.isEmpty()) return false;
      fs.writeFileSync(CUSTOM_ICON_FILE(), img.toPNG());
      mainWindow?.setIcon(img);
      try { tray?.setImage(img.resize({ width: 32, height: 32 })); } catch { /* sem bandeja */ }
      return true;
    } catch { return false; }
  });
  secureHandle('set-unread-count', (_event, count) => {
    if (!mainWindow) return;
    mainWindow.setOverlayIcon(count > 0 ? badgeIcon : null, count > 0 ? `${count} não lida(s)` : '');
  });

  // Item pedido: "criar uma nova integração... ProjectMC... o usuário
  // poderá visualizar e baixar o launcher... o Project Club deve
  // conseguir detectar a atualização... o launcher também deve poder
  // ser iniciado separadamente através do próprio Project Club" — toda
  // a lógica de verdade mora em desktop/projectMcManager.js; aqui é só
  // a ponte de IPC pro site (ver client/src/utils/projectMc.js). O 'id'
  // do módulo vem do próprio site (hoje só 'projectmc' existe) — não
  // precisa de nenhum handler NOVO quando um segundo jogo/app futuro
  // for adicionado ao catálogo MODULES, só uma nova entrada lá.
  secureHandle('projectmc:get-status', (_event, id) => projectMcManager().getStatus(id || 'projectmc'));
  secureHandle('projectmc:check-update', async (_event, id) => {
    try {
      return await projectMcManager().checkForUpdate(id || 'projectmc');
    } catch (err) {
      return { error: err.message };
    }
  });
  secureHandle('projectmc:install', async (event, id) => {
    const moduleId = id || 'projectmc';
    try {
      const result = await projectMcManager().installOrUpdate(moduleId, (progress) => {
        event.sender.send('projectmc:progress', { id: moduleId, ...progress });
      });
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  secureHandle('projectmc:launch', async (_event, id) => {
    try {
      await projectMcManager().launch(id || 'projectmc');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  secureHandle('projectmc:uninstall', async (_event, id) => {
    try {
      await projectMcManager().uninstall(id || 'projectmc');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ---------- Sistema de Mods (Apps → Mods) ----------
  // Item pedido 2/3/4: detecção automática dos jogos instalados via
  // Steam — roda 100% localmente (steamDetector.js), o site só recebe o
  // resultado já pronto (AppID/nome/pasta), nunca lê registro/disco
  // diretamente.
  secureHandle('mods:detect-steam-games', () => {
    try {
      const result = steamDetector().detectInstalledSteamGames();
      for (const g of result?.games || []) if (g?.installPath) rememberGameDir(g.installPath, false);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message, steamFound: false, games: [] };
    }
  });

  // Item pedido 29: jogo não encontrado automaticamente — deixa a pessoa
  // escolher a pasta manualmente pelo diálogo nativo do Windows/Linux.
  secureHandle('mods:select-game-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow || undefined, {
      title: 'Selecione a pasta do jogo',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return { success: false, canceled: true };
    if (!steamDetector().looksLikeGameFolder(result.filePaths[0])) return { success: false, error: 'Pasta inválida.' };
    // Escolhida pela própria pessoa no diálogo nativo: vira pasta de jogo
    // conhecida (lembrada entre aberturas, ver isKnownGameDir).
    rememberGameDir(result.filePaths[0], true);
    return { success: true, path: result.filePaths[0] };
  });

  // Item pedido 12: instalação automática — baixa da URL assinada que o
  // backend devolveu (ver server: POST /api/mods/.../download), instala
  // na pasta certa e nunca envia o arquivo de volta pro servidor.
  secureHandle('mods:install', async (event, payload) => {
    try {
      const result = await modsManager().installMod(payload, (progress) => {
        event.sender.send('mods:progress', { modioModId: payload.modioModId, ...progress });
      });
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Item pedido: "pegue a interface e tudo do Gale [Thunderstore Mod
  // Manager] e funda com o que eu já tenho" — instala UM pacote do
  // Thunderstore por vez; o ModsPage.jsx chama isso em sequência pra
  // cada item da árvore de dependência já resolvida pelo backend (ver
  // thunderstoreService.js), na ordem certa, antes do mod pedido em si
  // — é isso que faz a instalação "de um clique só" funcionar, sem
  // nenhuma lógica nova aqui além de repassar pro modsManager (ver
  // installThunderstorePackage lá, que sabe diferenciar o framework
  // BepInEx em si — isLoader: true, vai pra raiz do jogo — de um mod
  // comum, que vai pra BepInEx/plugins como qualquer outra fonte).
  secureHandle('mods:install-thunderstore', async (event, payload) => {
    try {
      const result = await modsManager().installThunderstorePackage(payload, (progress) => {
        event.sender.send('mods:progress', { modioModId: payload.fullName, ...progress });
      });
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  secureHandle('mods:uninstall', (_event, payload) => {
    try {
      return { success: true, ...modsManager().uninstallMod(payload) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Aceita o caminho (formato antigo) ou { gameInstallPath, steamAppId }.
  secureHandle('mods:list-installed', (_event, arg) => {
    try {
      const { gameInstallPath, steamAppId } = typeof arg === 'string' ? { gameInstallPath: arg } : (arg || {});
      return { success: true, ...modsManager().listInstalledMods(gameInstallPath, steamAppId) };
    } catch (err) {
      return { success: false, error: err.message, enabled: [], disabled: [] };
    }
  });

  // Item pedido: "identificar mods JÁ instalados nos arquivos do jogo" —
  // varre as pastas de mods do perfil do jogo (só leitura, nunca move
  // nem apaga nada) e devolve detectados + instalados pelo Project Club,
  // junto com o estado do loader (BepInEx/MelonLoader/SMAPI...).
  secureHandle('mods:scan-installed', (_event, { gameInstallPath, steamAppId } = {}) => {
    try {
      return { success: true, ...modsManager().scanInstalled({ gameInstallPath, steamAppId }) };
    } catch (err) {
      return { success: false, error: err.message, items: [] };
    }
  });

  // "Como este jogo usa mods": loader, pastas, tipos de arquivo, avisos.
  // Nexus Mods / Vortex: quem abre os links nxm:// e links pendentes.
  secureHandle('nexus:get-link-handler', () => {
    try { return { success: true, enabled: app.isDefaultProtocolClient('nxm') }; } catch (err) { return { success: false, error: err.message }; }
  });
  secureHandle('nexus:set-link-handler', (_event, enabled) => {
    try {
      const ok = setNxmHandler(!!enabled);
      return { success: ok !== false, enabled: app.isDefaultProtocolClient('nxm') };
    } catch (err) { return { success: false, error: err.message }; }
  });
  secureHandle('nexus:open-download', (_event, url) => {
    try { return openDownloadWindow(String(url || '')); } catch (err) { return { success: false, error: err.message }; }
  });
  // "Sair da conta" da janela de download (apaga o login salvo).
  secureHandle('nexus:clear-download-login', async () => {
    try { await session.fromPartition(DOWNLOAD_PARTITION).clearStorageData(); return { success: true }; } catch (err) { return { success: false, error: err.message }; }
  });
  secureHandle('nexus:consume-pending', () => pendingNxmLinks.splice(0, pendingNxmLinks.length));

  secureHandle('mods:get-install-profile', (_event, { gameInstallPath, steamAppId } = {}) => {
    try {
      return { success: true, profile: modsManager().getInstallProfile({ gameInstallPath, steamAppId }) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Item pedido 15: ativar/desativar um mod específico sem desinstalar,
  // e aplicar um perfil inteiro de uma vez (troca vários de uma vez —
  // usado pelo botão "Ativar este perfil"/"▶ Jogar com este perfil").
  secureHandle('mods:set-enabled', (_event, payload) => {
    try {
      return { success: true, ...modsManager().setModEnabled(payload) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  secureHandle('mods:apply-profile', (_event, payload) => {
    try {
      return { success: true, ...modsManager().applyProfileMods(payload) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Item pedido: integração com Steam Workshop — só lê o que já foi
  // inscrito/baixado (ver steamDetector.listInstalledWorkshopItems); a
  // inscrição em si é feita pela própria Steam quando a pessoa clica
  // "Inscrever-se" (abre steam://url/CommunityFilePage/<id> via
  // openExternal, já existente — não precisa de handler novo pra isso).
  secureHandle('mods:list-workshop-items', (_event, { gameInstallPath, workshopAppId }) => {
    try {
      return { success: true, items: steamDetector().listInstalledWorkshopItems(gameInstallPath, workshopAppId) };
    } catch (err) {
      return { success: false, error: err.message, items: [] };
    }
  });

  // Item pedido: "abrir a pasta... igual no r2modmanPlus" — abre a
  // pasta de mods do jogo no explorador de arquivos do sistema
  // (Explorer/Finder/Nautilus, o que a pessoa já usa normalmente),
  // pra quem quiser mexer nos arquivos na mão.
  secureHandle('mods:open-folder', (_event, arg) => {
    try {
      const { gameInstallPath, steamAppId } = typeof arg === 'string' ? { gameInstallPath: arg } : (arg || {});
      const strategy = modsManager().detectInstallStrategy(gameInstallPath, steamAppId);
      require('fs').mkdirSync(strategy.targetRoot, { recursive: true });
      shell.openPath(strategy.targetRoot);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Item pedido: "adicionar mods de um arquivo local" — abre o diálogo
  // nativo pra escolher um .zip/.dll do computador da pessoa, sem
  // precisar vir de nenhuma das fontes online.
  secureHandle('mods:pick-local-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow || undefined, {
      title: 'Selecione o arquivo do mod',
      properties: ['openFile'],
      // Qualquer formato que o instalador por jogo sabe encaminhar
      // (.zip/.7z extraídos; .pak/.esp/.tmod/... copiados pro lugar certo).
      filters: [
        { name: 'Arquivos de mod', extensions: ['zip', '7z', 'dll', 'pak', 'utoc', 'ucas', 'esp', 'esm', 'esl', 'bsa', 'ba2', 'vpk', 'gma', 'tmod', 'archive', 'reds', 'asi', 'package', 'ts4script', 'scs', 'jar', 'pack', 'crp'] },
        { name: 'Todos os arquivos', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return { success: false, canceled: true };
    return { success: true, path: result.filePaths[0], name: require('path').basename(result.filePaths[0]) };
  });

  secureHandle('mods:install-local', async (event, payload) => {
    try {
      const result = await modsManager().installLocalFile(payload, (progress) => {
        event.sender.send('mods:progress', { modioModId: payload.modioModId || 'local', ...progress });
      });
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  const UNKNOWN_GAME_DIR = 'Pasta do jogo não reconhecida. Selecione a pasta do jogo de novo em Jogos → Mods.';
  // Item pedido: "poder configurar mods" — lê/escreve os .cfg do
  // BepInEx/config como texto puro (ver modsManager.js pra entender
  // por que é assim, não como formulário).
  secureHandle('mods:list-config-files', (_event, gameInstallPath) => {
    try {
      return { success: true, files: modsManager().listConfigFiles(gameInstallPath) };
    } catch (err) {
      return { success: false, error: err.message, files: [] };
    }
  });

  secureHandle('mods:read-config-file', (_event, { gameInstallPath, filename } = {}) => {
    try {
      if (!isKnownGameDir(gameInstallPath)) return { success: false, error: UNKNOWN_GAME_DIR };
      return { success: true, content: modsManager().readConfigFile(gameInstallPath, filename) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Escrita só dentro da pasta de config de um jogo conhecido, só .cfg que já
  // existe lá (o editor só edita os arquivos listados) e com tamanho limitado.
  secureHandle('mods:write-config-file', (_event, { gameInstallPath, filename, content } = {}) => {
    try {
      if (!isKnownGameDir(gameInstallPath)) return { success: false, error: UNKNOWN_GAME_DIR };
      if (typeof filename !== 'string' || typeof content !== 'string') return { success: false, error: 'Dados inválidos.' };
      if (content.length > 5 * 1024 * 1024) return { success: false, error: 'Arquivo de configuração grande demais.' };
      if (!modsManager().listConfigFiles(gameInstallPath).includes(filename)) return { success: false, error: 'Arquivo de configuração não encontrado.' };
      return { success: true, ...modsManager().writeConfigFile(gameInstallPath, filename, content) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Item pedido: pasta própria do Project Club (não do jogo) onde os
  // modpacks ficam salvos como arquivo, independente do servidor.
  secureHandle('mods:save-modpack-local', (_event, payload) => {
    try {
      return { success: true, ...modsManager().saveModpackLocally(payload) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  secureHandle('mods:list-local-modpacks', (_event, gameKey) => {
    try {
      return { success: true, modpacks: modsManager().listLocalModpacks(gameKey) };
    } catch (err) {
      return { success: false, error: err.message, modpacks: [] };
    }
  });

  secureHandle('mods:delete-local-modpack', (_event, { gameKey, packName }) => {
    try {
      return { success: true, ...modsManager().deleteLocalModpack(gameKey, packName) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Item pedido: "Sistema... Iniciar com o sistema... Minimizar para
  // bandeja... Abrir links no aplicativo... Confirmar saída" e "Jogos e
  // apps... Detecção automática de jogos" — recebe o UserSettings de
  // verdade da conta (ver preload.js/useStore.js) e aplica na hora.
  // startWithSystem já mexe no login item do Windows assim que chega
  // (não precisa esperar reiniciar o app pra valer); minimizeToTray/
  // openLinksInApp/confirmOnExit só mudam o COMPORTAMENTO de coisas que
  // só acontecem depois (fechar a janela, abrir um link, sair);
  // gameDetectionEnabled já liga/desliga o laço de detecção na hora,
  // via applyGameDetectionSetting. overlayEnabled/overlayNotifications
  // não precisam de nenhuma ação imediata aqui — só são lidos na hora
  // que showOverlayNotification é chamada.
  secureOn('settings:update', (_event, settings) => {
    if (!settings || typeof settings !== 'object') return;
    desktopSettings = { ...desktopSettings, ...settings };
    if (typeof settings.startWithSystem === 'boolean') {
      app.setLoginItemSettings({ openAtLogin: settings.startWithSystem, openAsHidden: true });
    }
    if (typeof settings.gameDetectionEnabled === 'boolean') {
      applyGameDetectionSetting();
    }
  });

  // Item pedido: "Sobreposição no jogo (overlay)... Nova mensagem,
  // menção, convite, pedido de amizade e entrada em chamada aparecem
  // na overlay" — o site chama isso (ver window.electronAPI.
  // showOverlayNotification em preload.js, disparado pelo mesmo
  // notifyUser() de SocketContext.jsx que já mostra a notificação
  // nativa comum) toda vez que uma dessas notificações acontece;
  // showOverlayNotification decide sozinha se deve aparecer de
  // verdade (overlayEnabled + overlayNotifications ligados, E um jogo
  // de verdade detectado agora).
  secureOn('overlay:notify', (_event, payload) => {
    if (payload && typeof payload === 'object') showOverlayNotification(payload);
  });

  // Item pedido: "compartilhar tela não funciona no .exe" — o Electron
  // (diferente de um navegador comum) NÃO tem embutido o pedido nativo
  // de "escolher uma tela/janela pra compartilhar" — sem isso configurado
  // aqui, getDisplayMedia() do site (usado pelo engine de voz) simplesmente nunca
  // teria de onde escolher nada. session.setDisplayMediaRequestHandler é
  // o gancho oficial do Electron pra isso: sempre que o site pede
  // getDisplayMedia(), esse handler roda aqui no processo principal,
  // lista as telas/janelas disponíveis via desktopCapturer, abre uma
  // telinha própria de seleção com miniaturas (o seletor NATIVO do
  // sistema operacional só existe no macOS 15+, não ajuda no Windows/
  // Linux, que é o público real desse app), e devolve pro site a escolha
  // feita. 'loopback' no áudio já captura o som do sistema de brinde no
  // Windows, sem precisar de nada a mais.
  //
  // Precisa ficar dentro do app.whenReady() — session.defaultSession só
  // fica disponível de verdade depois que o Electron termina de
  // inicializar, diferente de ipcMain.handle (que pode ser registrado a
  // qualquer momento).
  function setupScreenShareHandler() {
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 300, height: 200 },
          fetchWindowIcons: true,
        });
        const chosen = await showScreenPickerWindow(sources);
        if (!chosen) { callback({}); return; } // pessoa cancelou — devolve vazio, o site trata como "cancelado" normalmente
        // Só manda o som do PC quando o site pediu áudio (a pessoa pode
        // desligar "Incluir som do computador" no menu de transmitir tela).
        callback(request.audioRequested ? { video: chosen, audio: 'loopback' } : { video: chosen });
      } catch (err) {
        console.error('[compartilhar tela] falhou:', err);
        callback({});
      }
    }, { useSystemPicker: false });
  }

  // Item pedido: "quando clicar para baixar algumas imagens, vídeo,
  // áudio etc... vai abrir já a aba onde você quer colocar esse
  // arquivo no PC e no Linux" — sem nenhum tratamento, o Electron
  // salva DIRETO na pasta de downloads padrão do sistema, sem
  // perguntar nada (diferente de um navegador comum, que costuma ter
  // uma opção "perguntar onde salvar" — o Electron não tem essa
  // configuração por padrão nenhuma). setSaveDialogOptions é a API
  // oficial do Electron pra isso: abre o diálogo NATIVO "Salvar como"
  // do sistema operacional (o mesmo que qualquer outro programa usa),
  // deixando a pessoa escolher a pasta antes de cada download —
  // funciona igual no Windows e no Linux, sem precisar de nenhum
  // código diferente pra cada um. Não mexe em nada na versão web nem
  // no app mobile — isso é específico do Electron (session.
  // defaultSession só existe aqui).
  function setupDownloadHandler() {
    session.defaultSession.on('will-download', (event, item) => {
      item.setSaveDialogOptions({
        title: 'Salvar arquivo',
        defaultPath: path.join(app.getPath('downloads'), item.getFilename()),
      });
    });
  }

  // Item pedido: "cansei de ter que ir no site/GitHub baixar a versão
  // nova toda vez, faça um sistema de atualização" — usa o
  // electron-updater (biblioteca oficial do mesmo time do
  // electron-builder, que este projeto já usa pra gerar o .exe — não é
  // nada inventado do zero, é o padrão realmente usado por apps
  // Electron de verdade, inclusive confirmei que o GoldApple Launcher
  // usa exatamente essa mesma biblioteca, olhando o formato dos
  // arquivos publicados nas releases dele no GitHub).
  //
  // Item pedido (revisão posterior): "faça atualizações em segundo
  // plano do Project Club... deixe ele atualizando em segundo plano
  // que o usuário não fica vendo pra não atrapalhar ele" — a janelinha
  // própria de progresso/aviso (que existiu aqui antes desta revisão)
  // já era pequena e discreta comparada à caixa nativa do sistema
  // operacional que existia antes dela, mas ainda era uma interrupção
  // visual — removida por completo agora: baixa e aplica tudo sozinho,
  // sem mostrar nada nunca, ver setupAutoUpdater abaixo.

  // Estado da atualização (pro botão verde da barra do app).
  // `downloading` = há um download em andamento (mesmo que o
  // 'download-progress' ainda não tenha chegado); `error` = última falha,
  // pra barra conseguir mostrar um estado de erro em vez de fingir que
  // ainda está em 0%.
  const updateStatus = { current: app.getVersion(), available: false, downloaded: false, downloading: false, percent: 0, version: null, error: null };
  // Avisa o renderer (barra do app) do estado atual. Definida aqui, no
  // mesmo escopo de updateStatus, pra que tanto installLatest (abaixo)
  // quanto setupAutoUpdater consigam emitir — antes só setupAutoUpdater
  // tinha um sendUpdateStatus local, então um clique que começava o
  // download não conseguia avisar a tela na hora.
  const emitUpdateStatus = () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:status', { ...updateStatus });
  };
  secureHandle('update:get-status', () => ({ ...updateStatus }));
  // Clique no botão verde: se já baixou, fecha e instala (reabre sozinho);
  // senão, pede pra procurar/baixar agora e instala quando terminar.
  let installWhenReady = false;
  // BUG CORRIGIDO ("vai de atualização em atualização: 1.3 → 1.4 → … em vez
  // de ir direto pra 1.7"): quando uma versão já tinha sido baixada e saíam
  // outras depois, o app instalava a que estava guardada (velha), reabria,
  // achava a próxima, e assim por diante. Agora, antes de instalar, sempre
  // confere qual é a versão MAIS NOVA publicada; se for mais nova que a
  // baixada, baixa essa e instala direto ela.
  const newerVersion = (a, b) => {
    const pa = String(a || '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
    const pb = String(b || '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    }
    return false;
  };
  let installing = false;
  // Garante que um download realmente comece ao clicar, mesmo que o
  // autoDownload não tenha disparado (ou esteja desligado) — sem isso o
  // clique podia deixar a barra "presa" em 0% esperando um download que
  // nunca começou. electron-updater ignora chamadas repetidas enquanto já
  // está baixando, mas guardamos um flag mesmo assim pra não emitir ruído.
  let downloadingNow = false;
  function startDownload() {
    installWhenReady = true;
    updateStatus.downloaded = false;
    updateStatus.downloading = true;
    updateStatus.error = null;
    emitUpdateStatus();
    if (downloadingNow) return;
    downloadingNow = true;
    Promise.resolve()
      .then(() => autoUpdater.downloadUpdate())
      .catch((err) => {
        const msg = String(err?.message || err || '');
        console.error('[atualização] downloadUpdate:', msg);
        // "já está baixando" não é erro de verdade; o resto é (antes a
        // barra ficava girando pra sempre).
        if (/already|em andamento|in progress/i.test(msg)) return;
        failUpdate(`O download não começou (${msg || 'erro desconhecido'}).`);
      });
  }
  // Linux fora de AppImage (ex.: extraído à mão) não tem como se
  // atualizar sozinho — o electron-updater só troca o próprio .AppImage.
  const canSelfUpdate = () => process.platform !== 'linux' || !!process.env.APPIMAGE;
  const withTimeout = (p, ms, what) => Promise.race([
    p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} demorou demais`)), ms)),
  ]);
  function failUpdate(msg) {
    installing = false;
    downloadingNow = false;
    installWhenReady = false;
    Object.assign(updateStatus, { downloading: false, error: msg });
    emitUpdateStatus();
  }
  // BUG CORRIGIDO ("clico no botão de atualizar e não acontece nada"):
  //  - se a conferência/instalação falhava, o erro sumia só no log e o
  //    flag `installing` ficava preso: todo clique seguinte voltava "busy"
  //    sem fazer nada;
  //  - downloadUpdate() sem uma conferência válida antes rejeitava em
  //    silêncio e a barra ficava "baixando" pra sempre;
  //  - o fechamento pra instalar podia ser barrado pela janela (bandeja /
  //    confirmar ao sair).
  // Agora toda falha vira `error` no status (a barra mostra e oferece o
  // instalador manual) e nada fica preso.
  async function installLatest() {
    if (installing) return 'busy';
    if (!canSelfUpdate()) { failUpdate('Esta instalação não se atualiza sozinha — baixe a versão nova.'); return 'manual'; }
    let latest = null;
    try {
      const r = await withTimeout(autoUpdater.checkForUpdates(), 20000, 'a conferência da versão nova');
      latest = r?.updateInfo?.version || null;
      if (latest) updateStatus.available = newerVersion(latest, app.getVersion()) || updateStatus.available;
    } catch (err) {
      console.error('[atualização] não deu pra conferir a mais nova antes de instalar:', err?.message || err);
      if (!updateStatus.downloaded) { failUpdate(`Não deu pra falar com o servidor de atualizações (${err?.message || 'sem conexão'}).`); return 'error'; }
    }
    if (latest && !newerVersion(latest, app.getVersion()) && !updateStatus.downloaded) {
      failUpdate('Você já está na versão mais nova publicada.');
      return 'uptodate';
    }
    if (latest && updateStatus.downloaded && newerVersion(latest, updateStatus.version || app.getVersion())) {
      // Tem uma mais nova que a baixada: baixa essa e instala quando terminar.
      startDownload();
      return 'downloading';
    }
    if (!updateStatus.downloaded) { startDownload(); return 'downloading'; }
    installing = true;
    isQuitting = true;
    // Nada pode segurar o fechamento: bandeja e "confirmar ao sair" ficam de fora.
    try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.removeAllListeners('close'); } catch { /* ok */ }
    try { if (tray) { tray.destroy(); tray = null; } } catch { /* ok */ }
    setImmediate(() => {
      try { autoUpdater.quitAndInstall(true, true); } catch (err) { failUpdate(`Não deu pra abrir o instalador (${err?.message || err}).`); }
    });
    // Se em 20s o app ainda estiver aberto, o instalador não rodou.
    setTimeout(() => { if (installing) { isQuitting = false; failUpdate('O instalador não abriu. Baixe a versão nova pelo botão abaixo.'); } }, 20000);
    return 'installing';
  }
  secureHandle('update:install', async () => {
    const r = await installLatest();
    if (r === 'installing') return { success: true, installing: true };
    if (r === 'downloading' || r === 'busy') return { success: true, downloading: true };
    return { success: false, reason: r, error: updateStatus.error };
  });
  autoUpdater.on('update-downloaded', () => {
    if (!installWhenReady) return;
    installWhenReady = false;
    installLatest();
  });

  function setupAutoUpdater() {
    autoUpdater.autoDownload = true;
    // Ao fechar de verdade, instala o pacote já baixado. Como o app confere
    // a cada 30 min e baixa sempre a versão mais nova, esse pacote é a
    // última versão (antes ficava preso numa velha — ver installLatest).
    autoUpdater.autoInstallOnAppQuit = true;

    // Item pedido: "faça atualizações em segundo plano do Project Club
    // e/ou outros apps que tiver baixados junto... deixe ele
    // atualizando em segundo plano que o usuário não fica vendo pra
    // não atrapalhar ele" — antes disso, mesmo com o download já sendo
    // automático (autoDownload=true), uma janelinha aparecia no canto
    // da tela pra avisar que tinha atualização disponível e depois
    // pronta pra reiniciar — pequena e discreta (360x130, sem barra de
    // tarefas), mas ainda assim uma interrupção visual que o pedido
    // quer eliminar por completo. Agora só registra no log — o app
    // continua baixando sozinho em segundo plano (autoDownload) e
    // aplicando a atualização sozinho na próxima vez que for fechado
    // normalmente (autoInstallOnAppQuit), sem nunca precisar mostrar
    // nada nem interromper quem está usando.
    // Estado pro botão verde de atualizar da barra do app (TitleBar.jsx).
    const sendUpdateStatus = emitUpdateStatus;
    autoUpdater.on('update-available', (info) => {
      console.log('[atualização] nova versão disponível, baixando em segundo plano:', info?.version);
      // autoDownload=true: o download já começou em segundo plano aqui.
      Object.assign(updateStatus, { available: true, downloading: true, error: null, version: info?.version || null });
      sendUpdateStatus();
    });
    autoUpdater.on('download-progress', (p) => {
      updateStatus.percent = Math.round(p?.percent || 0);
      updateStatus.downloading = true;
      updateStatus.error = null;
      sendUpdateStatus();
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('[atualização] baixada e pronta:', info?.version);
      updateReady = true;
      downloadingNow = false;
      Object.assign(updateStatus, { available: true, downloaded: true, downloading: false, percent: 100, error: null, version: info?.version || updateStatus.version });
      sendUpdateStatus();
      maybeInstallUpdate();
    });

    // BUG CORRIGIDO (o app ficava semanas na mesma versão): com "minimizar
    // pra bandeja" o app nunca fecha de verdade, então o "instalar ao
    // fechar" nunca acontecia. Agora aplica sozinho (e reabre) quando a
    // janela está escondida/minimizada, sem som tocando e o PC sem uso há 5
    // minutos — nunca no meio de quem está usando ou numa chamada de voz.
    let updateReady = false;
    function maybeInstallUpdate() {
      if (!updateReady) return;
      const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
      const hidden = !win || !win.isVisible() || win.isMinimized();
      let idle = 0;
      try { idle = require('electron').powerMonitor.getSystemIdleTime(); } catch { /* sem powerMonitor */ }
      // Tocando áudio = provavelmente numa chamada: espera.
      const audible = !!win && win.webContents.isCurrentlyAudible();
      if (hidden && !audible && idle > 300) installLatest();
    }
    setInterval(maybeInstallUpdate, 60 * 1000);

    // Erro de rede/servidor fora do ar é normal e não deveria assustar
    // ninguém com uma caixa de diálogo — só registra no log; a próxima
    // tentativa automática resolve sozinha quando a conexão voltar.
    autoUpdater.on('error', (err) => {
      console.error('[atualização] falha ao verificar/baixar:', err?.message || err);
      // Deixa a barra sair do estado "baixando" (senão ficaria presa numa
      // porcentagem parada) e mostrar que algo deu errado — o clique
      // seguinte tenta de novo.
      downloadingNow = false;
      updateStatus.downloading = false;
      updateStatus.error = String(err?.message || err || 'falha na atualização');
      sendUpdateStatus();
    });

    const check = () => autoUpdater.checkForUpdates().catch((err) => {
      console.error('[atualização] falha ao verificar:', err?.message || err);
    });

    // Primeira checagem alguns segundos depois de abrir (não compete
    // com o carregamento inicial do site) — depois, verifica de novo a
    // cada 4 horas enquanto o app continuar aberto/rodando em segundo
    // plano.
    runAfterStartup(check);
    setInterval(check, 30 * 60 * 1000); // a cada 30 min (antes 4 h)

    // Item pedido: "outros apps que tiver baixados junto com o Project
    // Club" — checa e atualiza sozinho, em segundo plano, qualquer
    // módulo (ProjectMC, PhotoProject, futuros...) que já esteja
    // instalado — sem nenhum indicador visual, sem interromper quem
    // está usando. Só módulos JÁ instalados são considerados (não faz
    // sentido "atualizar" algo que a pessoa nunca baixou); ver
    // checkAndUpdateInstalledModules em projectMcManager.js.
    const checkModules = () => projectMcManager().checkAndUpdateInstalledModules().catch((err) => {
      console.error('[atualização de apps] falha ao verificar/atualizar:', err?.message || err);
    });
    setTimeout(checkModules, 20000);
    setInterval(checkModules, 4 * 60 * 60 * 1000);
  }

  app.whenReady().then(() => {
    setupScreenShareHandler();
    setupDownloadHandler();
    // BUG CORRIGIDO — CAUSA RAIZ CONFIRMADA de "no PC eu falo e não sai
    // áudio nenhum, mas eu escuto todo mundo": faltava isto aqui. Um
    // comentário antigo (removido) dizia que `sandbox: false` resolvia a
    // permissão de microfone do Electron — não resolve, são coisas
    // completamente diferentes (sandbox é sobre isolamento de processo,
    // não sobre permissão de mídia). Sem um handler de permissão
    // explícito, o Electron NUNCA mostra o popup nativo "permitir
    // microfone?" que um navegador normal mostra — ele só nega o pedido
    // de getUserMedia() por baixo dos panos, silenciosamente. O
    // resultado bate 100% com o relatado: a chamada conecta normal (o
    // WebRTC em si nunca teve erro nenhum), a pessoa CONTINUA ouvindo
    // todo mundo (só o RECEBER áudio é afetado por isso), mas o próprio
    // áudio dela nunca chega a ninguém — porque o microfone nunca foi
    // liberado de verdade pro app, em NENHUMA rede, o que também explica
    // por que testar com o celular no wifi ou nos dados móveis dava
    // exatamente no mesmo resultado: o problema nunca esteve na rede.
    // Microfone/câmera/tela/notificações: SÓ pro site do Project Club (mesma
    // origem de APP_URL). Iframes de terceiros e qualquer página que não seja
    // o app nunca ganham acesso. Tela cheia continua liberada pra qualquer
    // frame (player do YouTube na chamada) — não dá acesso a nada sensível.
    const APP_ONLY_PERMISSIONS = ['media', 'microphone', 'camera', 'display-capture', 'notifications'];
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      if (permission === 'fullscreen') { callback(true); return; }
      const requestingUrl = details?.requestingUrl || webContents?.getURL?.() || '';
      callback(APP_ONLY_PERMISSIONS.includes(permission) && isAppUrl(requestingUrl));
    });
    // Mesma liberação, mas pra checagem SÍNCRONA que alguns navegadores/
    // versões do Electron fazem antes mesmo de chegar no handler acima
    // (checkPermission, não requestPermission) — sem isso, em algumas
    // versões o pedido nem chega a acionar o handler de cima, e cai
    // direto numa negação silenciosa de qualquer jeito.
    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
      if (permission === 'fullscreen') return true;
      return APP_ONLY_PERMISSIONS.includes(permission) && isAppUrl(requestingOrigin || webContents?.getURL?.() || '');
    });

    // "openAsHidden" é o que faz a inicialização automática cumprir o
    // pedido de "rodar em segundo plano sem precisar deixar uma janela
    // aberta" — abre direto minimizado na bandeja, não em cima de tudo.
    const startedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin;
    // Aberto por um link projectclub:// → mostra a janela mesmo vindo do login.
    createWindow(startedAtLogin && !pendingDeepLinkRoute);
    setDeepLinkHandler();
    createTray();
    setupAutoUpdater();

    // Configura a inicialização automática só na PRIMEIRA execução — a
    // pessoa não precisa achar isso em nenhum menu escondido. Isso é só
    // o valor PADRÃO até o primeiro settings:update chegar de verdade
    // da conta (ver ipcMain.on('settings:update') acima) — uma vez que
    // a pessoa mexer na configuração de verdade, aquele valor manda.
    // BUG CORRIGIDO: antes religava o openAtLogin em TODA abertura, então
    // quem desligava "Iniciar com o Windows" (bandeja ou Gerenciador de
    // Tarefas) via o app voltar a iniciar sozinho no dia seguinte. Agora
    // fica gravado em desktop-state.json que a configuração inicial já foi
    // feita, e daí em diante só a escolha da pessoa vale.
    if (!readLocalState().autoStartInitialized) {
      try {
        if (!app.getLoginItemSettings().openAtLogin) app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
      } catch (err) { console.warn('[inicialização] não deu pra configurar:', err.message); }
      writeLocalState({ autoStartInitialized: true });
    }
    // Saiu de "Arquivos de Programas" pra instalação por usuário (sem aviso do
    // Windows nas atualizações — ver build/installer.nsh): o "Iniciar com o
    // Windows" apontava pro .exe antigo; passa pro novo, se estava ligado.
    if (process.platform === 'win32') {
      try {
        const { execFileSync } = require('child_process');
        const out = execFileSync('reg', ['query', 'HKCU\\Software\\ProjectClub', '/v', 'OldExe'], { encoding: 'utf8', windowsHide: true });
        const m = out.match(/OldExe\s+REG_SZ\s+(.+)/);
        const oldExe = m && m[1].trim();
        if (oldExe && oldExe.toLowerCase() !== process.execPath.toLowerCase()) {
          if (app.getLoginItemSettings({ path: oldExe }).openAtLogin) {
            app.setLoginItemSettings({ openAtLogin: false, path: oldExe });
            app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
          }
        }
        execFileSync('reg', ['delete', 'HKCU\\Software\\ProjectClub', '/v', 'OldExe', '/f'], { windowsHide: true });
      } catch { /* nada pra migrar */ }
    }

    // Item pedido: atalho de teclado global (funciona mesmo com o app em
    // segundo plano/sem foco, diferente de um atalho comum) pra abrir o
    // app rapidamente. Ctrl+Shift+P — escolhido por ser raro de colidir
    // com outros programas comuns (P de "Project Club").
    globalShortcut.register('CommandOrControl+Shift+P', () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.hide(); // aperta de novo pra esconder — alterna, como o Discord faz
      } else {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });
  });

  app.on('window-all-closed', () => {
    // Não faz nada — no Windows/Linux isso normalmente encerraria o app,
    // mas aqui a janela só se ESCONDE (ver mainWindow.on('close') acima),
    // então esse evento só dispara de verdade quando a pessoa realmente
    // pediu pra sair (confirmAndQuit já definiu isQuitting/chamou
    // app.quit() antes disso rodar).
  });

  app.on('before-quit', () => { isQuitting = true; });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); if (activityDetectionRunning) activityDetector().stopActivityDetection(); });
}
