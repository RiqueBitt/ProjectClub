'use strict';
// =====================================================================
// Project Club Lite — app de PC para máquinas antigas.
//
// Roda no Windows 7, 8, 8.1, 10 e 11, de 32 ou 64 bits (o instalador é de
// 32 bits, que funciona nos dois). Usa o Electron 22, o último que ainda
// roda no Windows 7/8 — por isso fica num app SEPARADO do Project Club
// completo (desktop/, Electron atual), que continua só pro Windows 10/11.
//
// É só a janela do site (chat, voz, tela, loja...) com o mínimo em volta:
// bandeja, links projectclub://, transmitir a tela, salvar
// arquivos e atualização automática pelo canal "lite" (lite.yml na release).
// Mod Manager, navegador, VPN, clipes e sobreposição ficam só no app
// completo — é isso que deixa o Lite leve (2 GB de RAM, 1 núcleo).
//
// Economia em PC fraco:
// - com até ~3 GB de RAM liga o "modo de aparelho fraco" do Chromium;
// - a placa de vídeo antiga que travar 2 vezes é desligada sozinha
//   (dá pra ligar/desligar na bandeja);
// - janela escondida reduz a CPU (menos timers e animações), menos
//   durante chamada de voz;
// - o site recebe html.is-lite-app e corta efeitos pesados (blur, sombras
//   grandes, animações longas) — ver client/src/styles/lite-mode.css.
// =====================================================================
const { app, BrowserWindow, Tray, Menu, shell, ipcMain, nativeImage, session, desktopCapturer, dialog } = require('electron');
const path = require('path');
const os = require('os');
const security = require('./shared/security');
const { DEEP_LINK_SCHEME, parseDeepLink } = require('./shared/deepLinks');
const oauthWindow = require('./shared/oauthWindow');
const { createSettings } = require('./settings');

const DEFAULT_APP_URL = 'https://projectclub.shardweb.app';
const APP_URL = (() => {
  const env = String(process.env.PROJECT_CLUB_URL || '').trim();
  return env || DEFAULT_APP_URL;
})();
security.configure({ appUrl: APP_URL });
const { isAppUrl } = security;

const settings = createSettings(app.getPath('userData'));
const APP_USER_MODEL_ID = 'com.projectclub.lite';
const ICON = path.join(__dirname, 'build', 'icon.ico');

// ---------- Ajustes pra PC fraco (antes do app ficar pronto) ----------
const totalGb = os.totalmem() / 1024 ** 3;
if (totalGb <= 3.2) app.commandLine.appendSwitch('enable-low-end-device-mode');
if (!settings.useGpu()) app.disableHardwareAcceleration();
// Menos processos de página abertos ao mesmo tempo (cada um custa RAM).
app.commandLine.appendSwitch('renderer-process-limit', '3');
// "Reduzir movimento" ligado: o CSS do site já corta as animações quando ele
// está ativo — em PC antigo é a maior economia de processador.
app.commandLine.appendSwitch('force-prefers-reduced-motion');

if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);

// Uma janela só: abrir de novo (ou um link projectclub://) traz a que já existe.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  start();
}

function start() {
  let mainWindow = null;
  let tray = null;
  let isQuitting = false;
  let voiceActive = false;
  let pendingRoute = null;

  // ---------- IPC só pra páginas do Project Club ----------
  const secureHandle = (channel, fn) => ipcMain.handle(channel, (event, ...args) => {
    if (!security.isTrustedEvent(event)) throw new Error('não autorizado');
    return fn(event, ...args);
  });
  const secureOn = (channel, fn) => ipcMain.on(channel, (event, ...args) => {
    if (security.isTrustedEvent(event)) fn(event, ...args);
  });

  // ---------- Links projectclub:// ----------
  const routeFromArgv = (argv) => {
    const link = (argv || []).find((a) => typeof a === 'string' && a.toLowerCase().startsWith(`${DEEP_LINK_SCHEME}:`));
    return link ? parseDeepLink(link) : null;
  };
  const openRoute = (route) => {
    if (!route) return;
    if (!mainWindow || mainWindow.isDestroyed()) { pendingRoute = route; return; }
    mainWindow.loadURL(new URL(route, APP_URL).toString());
    showWindow();
  };
  if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [path.resolve(process.argv[1])]);
  else app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  pendingRoute = routeFromArgv(process.argv);
  app.on('second-instance', (_e, argv) => {
    const route = routeFromArgv(argv);
    if (route) openRoute(route); else showWindow();
  });

  // ---------- Links externos ----------
  const isAllowedExternalUrl = (raw) => {
    try {
      const u = new URL(String(raw));
      if (u.protocol === 'http:' || u.protocol === 'https:') return !!u.hostname;
      return u.protocol === 'mailto:' || u.protocol === 'tel:';
    } catch { return false; }
  };
  const openExternal = (url) => { if (isAllowedExternalUrl(url)) shell.openExternal(url); };

  function showWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }

  function createWindow(startHidden) {
    // Telas antigas (1024x768, 1366x768): abre num tamanho que cabe.
    const { screen } = require('electron');
    const area = screen.getPrimaryDisplay().workAreaSize;
    mainWindow = new BrowserWindow({
      width: Math.min(1200, area.width),
      height: Math.min(760, area.height),
      minWidth: Math.min(800, area.width),
      minHeight: Math.min(540, area.height),
      show: false,
      frame: false, // a barra de título é a do site (TitleBar.jsx)
      icon: ICON,
      backgroundColor: '#313338',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'lite-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false, // dicionário custa RAM; o site funciona igual
        backgroundThrottling: true,
        additionalArguments: [`--pc-boot=${Buffer.from(JSON.stringify({ version: app.getVersion(), installPath: path.dirname(app.getPath('exe')) })).toString('base64')}`],
      },
    });
    mainWindow.once('ready-to-show', () => { if (!startHidden) mainWindow.show(); });
    mainWindow.on('maximize', () => mainWindow.webContents.send('window-maximized-changed', true));
    mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-maximized-changed', false));
    mainWindow.on('focus', () => mainWindow.flashFrame(false));

    // Fechar = vai pra bandeja (igual ao app completo). Sair: menu da bandeja.
    mainWindow.on('close', (e) => {
      if (isQuitting) return;
      e.preventDefault();
      mainWindow.hide();
    });

    const wc = mainWindow.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      if (!isAppUrl(url)) { openExternal(url); return { action: 'deny' }; }
      return { action: 'allow' };
    });
    const handleOAuthNavigation = oauthWindow.attach(mainWindow, { isAppUrl, appUrl: APP_URL });
    wc.on('will-navigate', (event, url) => {
      if (security.isTrustedUrl(url)) return;
      event.preventDefault();
      if (handleOAuthNavigation(url)) return;
      openExternal(url);
    });
    // Página do site travou ou o processo caiu: recarrega em vez de ficar branca.
    wc.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit') return;
      setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload(); }, 1500);
    });

    const route = pendingRoute || '/';
    pendingRoute = null;
    mainWindow.loadURL(new URL(route, APP_URL).toString());
  }

  // ---------- Bandeja ----------
  function buildTrayMenu() {
    const gpuOn = settings.useGpu();
    return Menu.buildFromTemplate([
      { label: 'Abrir o Project Club Lite', click: showWindow },
      { type: 'separator' },
      {
        label: 'Usar a placa de vídeo (aceleração)', type: 'checkbox', checked: gpuOn,
        click: () => {
          settings.set('gpu', !gpuOn);
          if (!gpuOn) settings.set('gpuCrashes', 0);
          dialog.showMessageBox({
            type: 'info', buttons: ['Reiniciar agora', 'Depois'], defaultId: 0,
            title: 'Project Club Lite', message: 'Vale depois de reiniciar o app.',
            detail: gpuOn ? 'Sem a placa de vídeo o app fica mais estável em PC antigo, mas um pouco mais lento pra rolar.' : 'Com a placa de vídeo o app fica mais liso, se ela for compatível.',
          }).then(({ response }) => { if (response === 0) { app.relaunch(); isQuitting = true; app.quit(); } });
        },
      },
      {
        label: 'Abrir junto com o Windows', type: 'checkbox', checked: !!app.getLoginItemSettings().openAtLogin,
        click: (item) => { app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }); },
      },
      { type: 'separator' },
      { label: 'Sair', click: () => { isQuitting = true; app.quit(); } },
    ]);
  }
  function createTray() {
    const img = nativeImage.createFromPath(path.join(__dirname, 'build', 'tray.png'));
    tray = new Tray(img.isEmpty() ? ICON : img);
    tray.setToolTip('Project Club Lite');
    tray.setContextMenu(buildTrayMenu());
    tray.on('click', showWindow);
  }

  // ---------- Transmitir a tela ----------
  function pickSource(sources) {
    return new Promise((resolve) => {
      const list = sources
        .filter((s) => (s.name || '').trim() && (s.id.startsWith('screen:') || !/^[a-zA-Z]:\\|^\//.test(s.name)))
        .map((s) => ({ id: s.id, name: s.name, screen: s.id.startsWith('screen:'), thumb: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : '' }));
      const picker = new BrowserWindow({
        width: 640, height: 520, resizable: false, minimizable: false, maximizable: false,
        parent: mainWindow, modal: true, frame: false, backgroundColor: '#2B2D31', show: false,
        webPreferences: { preload: path.join(__dirname, 'picker-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        ipcMain.removeListener('lite-picker:choice', onChoice);
        resolve(value);
        if (!picker.isDestroyed()) picker.close();
      };
      const onChoice = (event, id) => {
        if (picker.isDestroyed() || event.sender !== picker.webContents) return;
        finish(id ? sources.find((s) => s.id === id) || null : null);
      };
      ipcMain.on('lite-picker:choice', onChoice);
      picker.on('closed', () => finish(null));
      picker.once('ready-to-show', () => picker.show());
      picker.webContents.once('did-finish-load', () => { if (!picker.isDestroyed()) picker.webContents.send('lite-picker:list', list); });
      picker.loadFile(path.join(__dirname, 'picker.html'));
    });
  }
  function setupScreenShare() {
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      try {
        // Miniaturas pequenas: em PC fraco gerar imagens grandes demora.
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 192, height: 108 } });
        const chosen = await pickSource(sources);
        if (!chosen) { callback({}); return; }
        // Som do PC junto (só no Windows; o Windows 7 aceita o "loopback").
        callback(request.audioRequested && process.platform === 'win32' ? { video: chosen, audio: 'loopback' } : { video: chosen });
      } catch (err) {
        console.error('[tela] falhou:', err);
        callback({});
      }
    });
  }

  // ---------- Atualização automática (canal "lite") ----------
  const updateStatus = { current: app.getVersion(), available: false, downloaded: false, downloading: false, percent: 0, version: null, error: null };
  const emitUpdate = () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:status', { ...updateStatus }); };
  let autoUpdater = null;
  function setupUpdater() {
    if (!app.isPackaged) return;
    try {
      ({ autoUpdater } = require('electron-updater'));
    } catch (err) { console.warn('[atualização] sem electron-updater:', err); return; }
    // Procura lite.yml (o app completo usa latest.yml): o Lite nunca pega o
    // instalador do app completo, que não roda no Windows 7/8.
    autoUpdater.channel = 'lite';
    autoUpdater.allowDowngrade = false;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-available', (info) => { Object.assign(updateStatus, { available: true, downloading: true, error: null, version: info && info.version }); emitUpdate(); });
    autoUpdater.on('download-progress', (p) => { updateStatus.percent = Math.round((p && p.percent) || 0); emitUpdate(); });
    autoUpdater.on('update-downloaded', (info) => { Object.assign(updateStatus, { downloaded: true, downloading: false, percent: 100, version: info && info.version }); emitUpdate(); });
    autoUpdater.on('error', (err) => { Object.assign(updateStatus, { downloading: false, error: String((err && err.message) || err) }); emitUpdate(); });
    const check = () => autoUpdater.checkForUpdates().catch(() => {});
    setTimeout(check, 15000);
    setInterval(check, 4 * 60 * 60 * 1000);
  }
  secureHandle('update:get-status', () => ({ ...updateStatus }));
  secureHandle('update:install', () => {
    if (!autoUpdater) return { ok: false };
    if (updateStatus.downloaded) { isQuitting = true; setImmediate(() => autoUpdater.quitAndInstall(true, true)); return { ok: true }; }
    autoUpdater.checkForUpdates().catch(() => {});
    return { ok: true, checking: true };
  });

  // ---------- Pedidos do site ----------
  secureHandle('get-app-version', () => app.getVersion());
  secureHandle('get-app-install-path', () => path.dirname(app.getPath('exe')));
  secureHandle('window-minimize', () => mainWindow && mainWindow.minimize());
  secureHandle('window-maximize-toggle', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
  });
  secureHandle('window-close', () => mainWindow && mainWindow.close());
  secureHandle('window-is-maximized', () => !!(mainWindow && mainWindow.isMaximized()));
  secureHandle('focus-window', () => showWindow());
  secureHandle('open-external', (_e, url) => openExternal(url));
  secureHandle('set-unread-count', (_e, count) => {
    const n = Math.max(0, Number(count) || 0);
    if (tray) tray.setToolTip(n ? `Project Club Lite — ${n} não lida${n > 1 ? 's' : ''}` : 'Project Club Lite');
    if (n && mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true);
  });
  secureOn('window-move-by', (_e, dx, dy) => {
    if (!mainWindow || mainWindow.isMaximized()) return;
    const [x, y] = mainWindow.getPosition();
    mainWindow.setPosition(x + Math.round(Number(dx) || 0), y + Math.round(Number(dy) || 0));
  });
  // Chamada de voz: janela escondida não pode "dormir" (o áudio engasgaria).
  secureOn('voice:active', (_e, active) => {
    voiceActive = !!active;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.setBackgroundThrottling(!voiceActive);
  });
  // ---------- Placa de vídeo que trava ----------
  app.on('child-process-gone', (_e, details) => {
    if (details.type !== 'GPU' || details.reason === 'clean-exit') return;
    const crashes = settings.noteGpuCrash();
    if (crashes >= 2 && settings.get('gpu') === null) {
      console.warn('[placa de vídeo] travou de novo; o Lite vai abrir sem ela na próxima vez.');
      if (tray) tray.setContextMenu(buildTrayMenu());
    }
  });

  app.whenReady().then(() => {
    // Downloads: pergunta onde salvar (o Electron salvaria direto sem perguntar).
    session.defaultSession.on('will-download', (_e, item) => {
      item.setSaveDialogOptions({ title: 'Salvar arquivo', defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
    });
    // Microfone, câmera, notificações e tela: só pro site do Project Club.
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
      const ok = isAppUrl(details.requestingUrl || wc.getURL());
      callback(ok && ['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'display-capture'].includes(permission));
    });
    setupScreenShare();
    // "--hidden": abriu junto com o Windows — fica só na bandeja.
    createWindow(process.argv.includes('--hidden'));
    createTray();
    setupUpdater();
  });

  app.on('before-quit', () => { isQuitting = true; });
  app.on('window-all-closed', () => { /* fica na bandeja */ });
}
