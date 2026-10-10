// Project Club — app de desktop (Windows). Não reimplementa nada do site:
// é uma janela do Chromium (Electron) carregando a MESMA versão web já
// hospedada, com o "a mais" que só um app nativo de verdade consegue dar:
// ícone na bandeja do sistema, iniciar sozinho com o Windows, e continuar
// rodando em segundo plano mesmo com a janela fechada — exatamente como
// Discord/Slack fazem.
const { app, BrowserWindow, Tray, Menu, shell, ipcMain, globalShortcut, nativeImage, session, desktopCapturer, screen, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { startActivityDetection, stopActivityDetection } = require('./activityDetector');
const projectMcManager = require('./projectMcManager');
// Sistema de Mods (Apps → Mods) — detecção de Steam e instalação local de
// mods (ver steamDetector.js/modsManager.js). Só o processo principal
// mexe com disco/registro; o site fala com esses módulos só via IPC.
const steamDetector = require('./steamDetector');
const modsManager = require('./modsManager');

// URL do site hospedado — trocar aqui se o domínio mudar um dia. Fica só
// nesse único lugar de propósito.
const APP_URL = process.env.PROJECT_CLUB_URL || 'https://projectclub.squareweb.app';

let mainWindow = null;
let tray = null;
let isQuitting = false;
// Guarda a função de callback usada da última vez, pra poder LIGAR a
// detecção de novo se a pessoa reativar gameDetectionEnabled no meio da
// sessão (ver ipcMain.on('settings:update') abaixo) sem precisar
// reiniciar o app inteiro pra isso valer.
let activityCallback = null;
let activityDetectionRunning = false;
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
  if (!String(url).toLowerCase().startsWith('nxm://')) return;
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
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
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
      startActivityDetection(activityCallback);
    } else if (!shouldRun && activityDetectionRunning) {
      activityDetectionRunning = false;
      stopActivityDetection();
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
      const onChoice = (_event, sourceId) => {
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
      width: 1280,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      show: !startHidden,
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
        sandbox: false,
      },
    });

    mainWindow.loadURL(APP_URL);

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
      applyGameDetectionSetting();
    });

    // Item pedido: "Abrir links no aplicativo... Links clicados dentro
    // do Project Club abrem numa janela do próprio app em vez do
    // navegador padrão" — quando openLinksInApp está ligado, deixa o
    // Electron abrir a própria janela nova dele (comportamento padrão,
    // 'allow') em vez de mandar pro navegador do sistema. Links que já
    // apontam pro próprio site sempre abrem dentro, independente dessa
    // configuração — só é sobre links EXTERNOS.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (!url.startsWith(APP_URL)) {
        if (desktopSettings.openLinksInApp) {
          return { action: 'allow' };
        }
        shell.openExternal(url);
        return { action: 'deny' };
      }
      return { action: 'allow' };
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
    tray = new Tray(path.join(__dirname, 'build', 'icon.ico'));
    tray.setToolTip('Project Club');
    const menu = Menu.buildFromTemplate([
      { label: 'Abrir Project Club', click: () => { mainWindow.show(); mainWindow.focus(); } },
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
    tray.on('click', () => { mainWindow.show(); mainWindow.focus(); });
  }

  // Item pedido: o site (rodando dentro da janela) precisa saber "qual
  // versão do app nativo está instalada" pra comparar com a mais
  // recente publicada e avisar quando tem atualização — ver preload.js
  // e client/src/utils/nativeUpdateCheck.js. app.getVersion() lê direto
  // do package.json empacotado (o CI grava a versão certa ali antes de
  // gerar o instalador, ver .github/workflows/build-apps.yml).
  ipcMain.handle('get-app-version', () => app.getVersion());
  // Item pedido: verificar todos os sistemas de Configurações e afins —
  // diagnóstico de "instalações duplicadas confundindo qual versão está
  // rodando de verdade". Mostra o caminho exato do executável em uso
  // (app.getPath('exe')) na tela de Configurações, pra alguém conseguir
  // confirmar se está rodando a instalação "para todos os usuários"
  // (Program Files) ou "só para mim" (AppData\Local\Programs) quando
  // tiver as duas ao mesmo tempo — sem isso, não tinha como saber qual
  // das duas o atalho clicado realmente abre.
  ipcMain.handle('get-app-install-path', () => app.getPath('exe'));
  // Item pedido: "crie uma barra que não seja do Windows, de fechar
  // aba, minimizar, aumentar etc" — controles de janela pro TitleBar.jsx
  // customizado no React, já que sem frame nativo (frame: false acima)
  // não existe mais nenhum jeito padrão do sistema operacional de
  // minimizar/maximizar/fechar a janela.
  ipcMain.handle('window-minimize', () => mainWindow?.minimize());
  ipcMain.handle('window-maximize-toggle', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle('window-close', () => mainWindow?.close());
  ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false);
  // O React precisa saber quando o estado maximizado muda por OUTRO
  // caminho além do próprio botão (ex: duplo-clique na barra, atalho de
  // teclado do Windows tipo Win+Up, ou arrastar a janela pro topo da
  // tela) — sem isso, o ícone do botão maximizar/restaurar ficaria
  // dessincronizado do estado real da janela nesses casos.
  mainWindow?.on('maximize', () => mainWindow?.webContents.send('window-maximized-changed', true));
  mainWindow?.on('unmaximize', () => mainWindow?.webContents.send('window-maximized-changed', false));
  // Item pedido: botão "Baixar agora" no aviso de atualização precisa
  // abrir a página de download no NAVEGADOR de verdade — o app nativo
  // nunca mostra a página de marketing/download dentro dele mesmo (ver
  // RootGate em App.jsx), então "navegar pra lá" dentro da própria janela
  // não funcionaria. shell.openExternal manda pro navegador padrão do
  // sistema, de verdade.
  ipcMain.handle('open-external', (_event, url) => shell.openExternal(url));
  // Item pedido: clicar numa notificação nativa traz a janela de volta
  // pra frente (mesmo vindo da bandeja) — ver o onclick da notificação
  // em SocketContext.jsx.
  ipcMain.handle('focus-window', () => {
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
  ipcMain.handle('set-unread-count', (_event, count) => {
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
  ipcMain.handle('projectmc:get-status', (_event, id) => projectMcManager.getStatus(id || 'projectmc'));
  ipcMain.handle('projectmc:check-update', async (_event, id) => {
    try {
      return await projectMcManager.checkForUpdate(id || 'projectmc');
    } catch (err) {
      return { error: err.message };
    }
  });
  ipcMain.handle('projectmc:install', async (event, id) => {
    const moduleId = id || 'projectmc';
    try {
      const result = await projectMcManager.installOrUpdate(moduleId, (progress) => {
        event.sender.send('projectmc:progress', { id: moduleId, ...progress });
      });
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle('projectmc:launch', (_event, id) => {
    try {
      projectMcManager.launch(id || 'projectmc');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle('projectmc:uninstall', (_event, id) => {
    try {
      projectMcManager.uninstall(id || 'projectmc');
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
  ipcMain.handle('mods:detect-steam-games', () => {
    try {
      return { success: true, ...steamDetector.detectInstalledSteamGames() };
    } catch (err) {
      return { success: false, error: err.message, steamFound: false, games: [] };
    }
  });

  // Item pedido 29: jogo não encontrado automaticamente — deixa a pessoa
  // escolher a pasta manualmente pelo diálogo nativo do Windows/Linux.
  ipcMain.handle('mods:select-game-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow || undefined, {
      title: 'Selecione a pasta do jogo',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return { success: false, canceled: true };
    if (!steamDetector.looksLikeGameFolder(result.filePaths[0])) return { success: false, error: 'Pasta inválida.' };
    return { success: true, path: result.filePaths[0] };
  });

  // Item pedido 12: instalação automática — baixa da URL assinada que o
  // backend devolveu (ver server: POST /api/mods/.../download), instala
  // na pasta certa e nunca envia o arquivo de volta pro servidor.
  ipcMain.handle('mods:install', async (event, payload) => {
    try {
      const result = await modsManager.installMod(payload, (progress) => {
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
  ipcMain.handle('mods:install-thunderstore', async (event, payload) => {
    try {
      const result = await modsManager.installThunderstorePackage(payload, (progress) => {
        event.sender.send('mods:progress', { modioModId: payload.fullName, ...progress });
      });
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('mods:uninstall', (_event, payload) => {
    try {
      return { success: true, ...modsManager.uninstallMod(payload) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Aceita o caminho (formato antigo) ou { gameInstallPath, steamAppId }.
  ipcMain.handle('mods:list-installed', (_event, arg) => {
    try {
      const { gameInstallPath, steamAppId } = typeof arg === 'string' ? { gameInstallPath: arg } : (arg || {});
      return { success: true, ...modsManager.listInstalledMods(gameInstallPath, steamAppId) };
    } catch (err) {
      return { success: false, error: err.message, enabled: [], disabled: [] };
    }
  });

  // Item pedido: "identificar mods JÁ instalados nos arquivos do jogo" —
  // varre as pastas de mods do perfil do jogo (só leitura, nunca move
  // nem apaga nada) e devolve detectados + instalados pelo Project Club,
  // junto com o estado do loader (BepInEx/MelonLoader/SMAPI...).
  ipcMain.handle('mods:scan-installed', (_event, { gameInstallPath, steamAppId } = {}) => {
    try {
      return { success: true, ...modsManager.scanInstalled({ gameInstallPath, steamAppId }) };
    } catch (err) {
      return { success: false, error: err.message, items: [] };
    }
  });

  // "Como este jogo usa mods": loader, pastas, tipos de arquivo, avisos.
  // Nexus Mods / Vortex: quem abre os links nxm:// e links pendentes.
  ipcMain.handle('nexus:get-link-handler', () => {
    try { return { success: true, enabled: app.isDefaultProtocolClient('nxm') }; } catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('nexus:set-link-handler', (_event, enabled) => {
    try {
      const ok = setNxmHandler(!!enabled);
      return { success: ok !== false, enabled: app.isDefaultProtocolClient('nxm') };
    } catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('nexus:open-download', (_event, url) => {
    try { return openDownloadWindow(String(url || '')); } catch (err) { return { success: false, error: err.message }; }
  });
  // "Sair da conta" da janela de download (apaga o login salvo).
  ipcMain.handle('nexus:clear-download-login', async () => {
    try { await session.fromPartition(DOWNLOAD_PARTITION).clearStorageData(); return { success: true }; } catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('nexus:consume-pending', () => pendingNxmLinks.splice(0, pendingNxmLinks.length));

  ipcMain.handle('mods:get-install-profile', (_event, { gameInstallPath, steamAppId } = {}) => {
    try {
      return { success: true, profile: modsManager.getInstallProfile({ gameInstallPath, steamAppId }) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Item pedido 15: ativar/desativar um mod específico sem desinstalar,
  // e aplicar um perfil inteiro de uma vez (troca vários de uma vez —
  // usado pelo botão "Ativar este perfil"/"▶ Jogar com este perfil").
  ipcMain.handle('mods:set-enabled', (_event, payload) => {
    try {
      return { success: true, ...modsManager.setModEnabled(payload) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('mods:apply-profile', (_event, payload) => {
    try {
      return { success: true, ...modsManager.applyProfileMods(payload) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Item pedido: integração com Steam Workshop — só lê o que já foi
  // inscrito/baixado (ver steamDetector.listInstalledWorkshopItems); a
  // inscrição em si é feita pela própria Steam quando a pessoa clica
  // "Inscrever-se" (abre steam://url/CommunityFilePage/<id> via
  // openExternal, já existente — não precisa de handler novo pra isso).
  ipcMain.handle('mods:list-workshop-items', (_event, { gameInstallPath, workshopAppId }) => {
    try {
      return { success: true, items: steamDetector.listInstalledWorkshopItems(gameInstallPath, workshopAppId) };
    } catch (err) {
      return { success: false, error: err.message, items: [] };
    }
  });

  // Item pedido: "abrir a pasta... igual no r2modmanPlus" — abre a
  // pasta de mods do jogo no explorador de arquivos do sistema
  // (Explorer/Finder/Nautilus, o que a pessoa já usa normalmente),
  // pra quem quiser mexer nos arquivos na mão.
  ipcMain.handle('mods:open-folder', (_event, arg) => {
    try {
      const { gameInstallPath, steamAppId } = typeof arg === 'string' ? { gameInstallPath: arg } : (arg || {});
      const strategy = modsManager.detectInstallStrategy(gameInstallPath, steamAppId);
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
  ipcMain.handle('mods:pick-local-file', async () => {
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

  ipcMain.handle('mods:install-local', async (event, payload) => {
    try {
      const result = await modsManager.installLocalFile(payload, (progress) => {
        event.sender.send('mods:progress', { modioModId: payload.modioModId || 'local', ...progress });
      });
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Item pedido: "poder configurar mods" — lê/escreve os .cfg do
  // BepInEx/config como texto puro (ver modsManager.js pra entender
  // por que é assim, não como formulário).
  ipcMain.handle('mods:list-config-files', (_event, gameInstallPath) => {
    try {
      return { success: true, files: modsManager.listConfigFiles(gameInstallPath) };
    } catch (err) {
      return { success: false, error: err.message, files: [] };
    }
  });

  ipcMain.handle('mods:read-config-file', (_event, { gameInstallPath, filename }) => {
    try {
      return { success: true, content: modsManager.readConfigFile(gameInstallPath, filename) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('mods:write-config-file', (_event, { gameInstallPath, filename, content }) => {
    try {
      return { success: true, ...modsManager.writeConfigFile(gameInstallPath, filename, content) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Item pedido: pasta própria do Project Club (não do jogo) onde os
  // modpacks ficam salvos como arquivo, independente do servidor.
  ipcMain.handle('mods:save-modpack-local', (_event, payload) => {
    try {
      return { success: true, ...modsManager.saveModpackLocally(payload) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('mods:list-local-modpacks', (_event, gameKey) => {
    try {
      return { success: true, modpacks: modsManager.listLocalModpacks(gameKey) };
    } catch (err) {
      return { success: false, error: err.message, modpacks: [] };
    }
  });

  ipcMain.handle('mods:delete-local-modpack', (_event, { gameKey, packName }) => {
    try {
      return { success: true, ...modsManager.deleteLocalModpack(gameKey, packName) };
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
  ipcMain.on('settings:update', (_event, settings) => {
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
  ipcMain.on('overlay:notify', (_event, payload) => {
    if (payload && typeof payload === 'object') showOverlayNotification(payload);
  });

  // Item pedido: "compartilhar tela não funciona no .exe" — o Electron
  // (diferente de um navegador comum) NÃO tem embutido o pedido nativo
  // de "escolher uma tela/janela pra compartilhar" — sem isso configurado
  // aqui, getDisplayMedia() do site (usado pelo Agora) simplesmente nunca
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

  function setupAutoUpdater() {
    autoUpdater.autoDownload = true;
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
    autoUpdater.on('update-available', (info) => {
      console.log('[atualização] nova versão disponível, baixando em segundo plano:', info?.version);
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('[atualização] baixada e pronta:', info?.version);
      updateReady = true;
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
      if (hidden && !audible && idle > 300) {
        isQuitting = true;
        setImmediate(() => autoUpdater.quitAndInstall(true, true));
      }
    }
    setInterval(maybeInstallUpdate, 60 * 1000);

    // Erro de rede/servidor fora do ar é normal e não deveria assustar
    // ninguém com uma caixa de diálogo — só registra no log; a próxima
    // tentativa automática resolve sozinha quando a conexão voltar.
    autoUpdater.on('error', (err) => {
      console.error('[atualização] falha ao verificar/baixar:', err?.message || err);
    });

    const check = () => autoUpdater.checkForUpdates().catch((err) => {
      console.error('[atualização] falha ao verificar:', err?.message || err);
    });

    // Primeira checagem alguns segundos depois de abrir (não compete
    // com o carregamento inicial do site) — depois, verifica de novo a
    // cada 4 horas enquanto o app continuar aberto/rodando em segundo
    // plano.
    setTimeout(check, 10000);
    setInterval(check, 4 * 60 * 60 * 1000);

    // Item pedido: "outros apps que tiver baixados junto com o Project
    // Club" — checa e atualiza sozinho, em segundo plano, qualquer
    // módulo (ProjectMC, PhotoProject, futuros...) que já esteja
    // instalado — sem nenhum indicador visual, sem interromper quem
    // está usando. Só módulos JÁ instalados são considerados (não faz
    // sentido "atualizar" algo que a pessoa nunca baixou); ver
    // checkAndUpdateInstalledModules em projectMcManager.js.
    const checkModules = () => projectMcManager.checkAndUpdateInstalledModules().catch((err) => {
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
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      const allowed = ['media', 'microphone', 'camera', 'display-capture', 'notifications'];
      callback(allowed.includes(permission));
    });
    // Mesma liberação, mas pra checagem SÍNCRONA que alguns navegadores/
    // versões do Electron fazem antes mesmo de chegar no handler acima
    // (checkPermission, não requestPermission) — sem isso, em algumas
    // versões o pedido nem chega a acionar o handler de cima, e cai
    // direto numa negação silenciosa de qualquer jeito.
    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
      const allowed = ['media', 'microphone', 'camera', 'display-capture', 'notifications'];
      return allowed.includes(permission);
    });

    // "openAsHidden" é o que faz a inicialização automática cumprir o
    // pedido de "rodar em segundo plano sem precisar deixar uma janela
    // aberta" — abre direto minimizado na bandeja, não em cima de tudo.
    const startedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin;
    createWindow(startedAtLogin);
    createTray();
    setupAutoUpdater();

    // Configura a inicialização automática já na primeira execução — a
    // pessoa não precisa achar isso em nenhum menu escondido. Isso é só
    // o valor PADRÃO até o primeiro settings:update chegar de verdade
    // da conta (ver ipcMain.on('settings:update') acima) — uma vez que
    // a pessoa mexer na configuração de verdade, aquele valor manda.
    if (!app.getLoginItemSettings().openAtLogin) {
      app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
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
  app.on('will-quit', () => { globalShortcut.unregisterAll(); stopActivityDetection(); });
}
