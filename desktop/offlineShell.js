// Tela offline do app de computador — a parte do processo principal.
//
// Quando o app não alcança o servidor do Project Club (sem internet, servidor
// fora, banco caído), a janela "Project Club · Conexão" (connectionWindow.js)
// vira uma tela de verdade, com o que funciona sem o servidor:
//
//   Apps       abrir os apps do ecossistema já instalados (ProjectMC,
//              PhotoProject, CutProject…) e instalar/atualizar se houver
//              internet (as releases ficam no GitHub, não no servidor)
//   Navegador  o navegador do Project Club (abas, bloqueador de anúncios,
//              mesmo perfil de favoritos/senhas)
//   VPN        reconectar nos últimos servidores usados (a lista vem do
//              servidor; sem ele, ficam os que já foram usados)
//   Praça      o Club Penguin rodando no próprio computador, com o pinguim
//              da cópia local (pracaOffline.js)
//
// A página (offline/index.html) é servida pelo esquema pcapp://offline — uma
// origem de verdade, listada como confiável em security.js, então os mesmos
// handlers de IPC do site (browser:*, vpn:*, projectmc:*) atendem a ela. Os
// handlers daqui (offline-shell:*) só respondem à própria janela offline.
const { shell, net, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const SCHEME = 'pcapp';
const HOST = 'offline';
const PAGE_DIR = path.join(__dirname, 'offline');
const PRACA_PARTITION = 'persist:pc-offline-praca';

function pageUrl(file = 'index.html') { return `${SCHEME}://${HOST}/${file}`; }

/** Registra o esquema (ANTES do app ficar pronto). */
function registerScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true } }]);
}

/** Serve desktop/offline/* em pcapp://offline/* (DEPOIS do app ficar pronto). Nada fora da pasta. */
function serveScheme() {
  protocol.handle(SCHEME, (request) => {
    let u;
    try { u = new URL(request.url); } catch { return new Response('', { status: 400 }); }
    if (u.host !== HOST) return new Response('', { status: 404 });
    const rel = decodeURIComponent(u.pathname.replace(/^\/+/, '')) || 'index.html';
    const file = path.resolve(PAGE_DIR, rel);
    if (!file.startsWith(PAGE_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response('', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function createOfflineShell({ store, praca, projectMcManager, browserEngine, vpnManager, secureHandle, browserEnabled = true }) {
  let win = null; // janela offline atual (connectionWindow.js avisa)
  let mainWindow = null;
  const isShell = (event) => !!(win && !win.isDestroyed() && event.sender === win.webContents);
  const send = (channel, payload) => { try { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); } catch { /* fechando */ } };
  const shellHandle = (channel, fn) => secureHandle(channel, (event, ...args) => { if (!isShell(event)) throw new Error('não autorizado'); return fn(event, ...args); });

  function state() {
    const account = store.getAccount();
    return {
      network: net.isOnline(),
      account,
      praca: {
        ...praca.getState(),
        summary: account ? store.pracaSummary(account.id) : null,
        disk: praca.available() ? praca.mediaOnDisk() : null,
      },
      apps: safeApps(),
      vpn: { ...vpnManager().getState(), supported: process.platform === 'win32' || process.platform === 'linux', servers: store.listVpn() },
      browser: browserEnabled,
    };
  }
  function safeApps() { try { return projectMcManager().listStatuses(); } catch { return []; } }

  // ---- IPC só da janela offline ----
  shellHandle('offline-shell:state', () => state());
  shellHandle('offline-shell:apps', () => safeApps());
  shellHandle('offline-shell:praca-start', async () => {
    const account = store.getAccount();
    if (!account) return { ok: false, error: 'Nenhuma conta entrou neste computador ainda.' };
    return { ok: true, state: await praca.start(account.id) };
  });
  shellHandle('offline-shell:praca-stop', async () => { await praca.stop(); return praca.getState(); });
  shellHandle('offline-shell:vpn-connect', async (_e, id) => {
    const saved = store.vpnConfig(String(id || ''));
    if (!saved) return { ok: false, error: 'Esse servidor não está salvo neste computador.' };
    const st = await vpnManager().connect(saved.config, { id: saved.id, country: saved.country, countryName: saved.countryName });
    return { ok: true, state: st };
  });
  shellHandle('offline-shell:open-external', (_e, url) => {
    if (!/^https?:\/\/[^\s]+$/i.test(String(url || ''))) return false;
    shell.openExternal(String(url)).catch(() => {});
    return true;
  });
  shellHandle('offline-shell:open-folder', (_e, what) => {
    const dir = what === 'praca' ? store.pracaDir : store.dir;
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir).catch(() => {});
    return true;
  });

  praca.onState((st) => send('offline-shell:praca-state', st));

  /** connectionWindow.js chama ao criar a janela offline. */
  function attach(offlineWin) {
    win = offlineWin;
    // Navegador e VPN mandam estado pra "janela principal": enquanto a tela
    // offline existe, ela é essa janela.
    try { if (browserEnabled) browserEngine().setWindow(offlineWin); } catch { /* ainda não iniciado */ }
    try { vpnManager().setWindow(offlineWin); } catch { /* ok */ }
    offlineWin.webContents.on('will-attach-webview', (event, webPreferences, params) => {
      // abas do navegador: regras do browserEngine; Praça: só a página local
      if (browserEnabled && browserEngine().onWillAttach(event, webPreferences, params)) return;
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.webviewTag = false;
      const okSrc = /^http:\/\/127\.0\.0\.1:\d+\/pc-offline\/praca\.html$/.test(String(params.src || ''));
      if (params.partition !== PRACA_PARTITION || !okSrc) event.preventDefault();
    });
    offlineWin.webContents.on('did-attach-webview', (_e, wc) => {
      if (browserEnabled && browserEngine().onDidAttach(wc)) return;
      // webview da Praça: nunca sai do servidor local
      const guard = (event, target) => { if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(String(target))) event.preventDefault(); };
      wc.on('will-navigate', guard);
      wc.on('will-redirect', guard);
      wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    });
    offlineWin.on('closed', () => {
      if (win !== offlineWin) return;
      win = null;
      praca.stop().catch(() => {});
      if (mainWindow && !mainWindow.isDestroyed()) {
        try { if (browserEnabled) browserEngine().setWindow(mainWindow); } catch { /* ok */ }
        try { vpnManager().setWindow(mainWindow); } catch { /* ok */ }
      }
    });
  }

  return {
    attach,
    /** Servidor voltou mas a Praça offline está aberta: segura a volta automática. */
    holdRestore: () => ['starting', 'running'].includes(praca.getState().status),
    setMainWindow: (w) => { mainWindow = w; },
    pageUrl,
    PRACA_PARTITION,
  };
}

module.exports = { createOfflineShell, registerScheme, serveScheme, pageUrl, SCHEME, HOST, PRACA_PARTITION };
