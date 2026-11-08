// "Project Club · Conexão" — tela de sem conexão do app de computador,
// separada do Project Club: janela própria, pequena, com página local
// (desktop/conexao/index.html) e preload próprio. Não carrega nada do site.
//
// Antes, quando a página falhava, o app trocava a janela inteira do Project
// Club por uma cópia do navegador embutida no instalador — sem conferir se
// o servidor estava mesmo fora. Agora:
//   1. a página principal falhou (rede, 5xx ou 15 s sem carregar);
//   2. confere de verdade: internet do computador + /api/health do servidor;
//   3. respondeu → falso alarme: recarrega em silêncio (até 2x por minuto);
//   4. não respondeu → esconde a janela do Project Club e abre esta janela,
//      que testa sozinha a cada 5 s; quando o servidor volta, ela fecha e o
//      Project Club reabre no lugar.
const path = require('path');
const { BrowserWindow, ipcMain, net } = require('electron');

const CHECK_EVERY_MS = 5000;
const SILENT_RELOADS_PER_MINUTE = 2;

function createConnectionGuard({ appUrl, isAppUrl, icon }) {
  let mainWindow = null;
  let connWindow = null;
  let active = false; // tela de conexão aberta (servidor fora)
  let mainWasVisible = true;
  let timer = null;
  let checking = false;
  let lastReason = '';
  const silentReloads = [];

  async function serverResponds() {
    try {
      const r = await net.fetch(new URL('/api/health', appUrl).toString(), {
        method: 'GET', signal: AbortSignal.timeout(6000), headers: { 'cache-control': 'no-cache' },
      });
      return r.status < 500;
    } catch { return false; }
  }

  async function status() {
    const network = net.isOnline();
    const server = network && await serverResponds();
    return { network, server };
  }

  function allowSilentReload() {
    const now = Date.now();
    while (silentReloads.length && now - silentReloads[0] > 60000) silentReloads.shift();
    if (silentReloads.length >= SILENT_RELOADS_PER_MINUTE) return false;
    silentReloads.push(now);
    return true;
  }

  function send(payload) {
    if (connWindow && !connWindow.isDestroyed()) connWindow.webContents.send('conexao:status', payload);
  }

  async function tick() {
    if (!active || checking) return;
    checking = true;
    send({ checking: true });
    const s = await status();
    checking = false;
    if (!active) return;
    if (s.server) { restore(); return; }
    send({ checking: false, network: s.network, reason: lastReason });
  }

  function openWindow() {
    if (connWindow && !connWindow.isDestroyed()) { connWindow.show(); connWindow.focus(); return; }
    const bounds = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;
    const width = 440; const height = 440;
    connWindow = new BrowserWindow({
      width, height, resizable: false, maximizable: false, fullscreenable: false,
      frame: false, show: false, backgroundColor: '#111318', title: 'Project Club · Conexão',
      icon,
      ...(bounds ? { x: Math.round(bounds.x + (bounds.width - width) / 2), y: Math.round(bounds.y + (bounds.height - height) / 2) } : {}),
      webPreferences: {
        preload: path.join(__dirname, 'conexaoPreload.js'),
        contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false,
      },
    });
    connWindow.removeMenu?.();
    // Página local e fixa: nada de navegar pra outro lugar ou abrir janelas.
    connWindow.webContents.on('will-navigate', (e) => e.preventDefault());
    connWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    connWindow.loadFile(path.join(__dirname, 'conexao', 'index.html'));
    connWindow.once('ready-to-show', () => { if (mainWasVisible && connWindow && !connWindow.isDestroyed()) connWindow.show(); });
    connWindow.on('closed', () => { connWindow = null; });
  }

  // Servidor fora de verdade: troca pra janela de conexão.
  function activate(reason) {
    lastReason = reason;
    if (active) { send({ reason }); return; }
    active = true;
    mainWasVisible = !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
    openWindow();
    clearInterval(timer);
    timer = setInterval(tick, CHECK_EVERY_MS);
    timer.unref?.();
  }

  // Servidor voltou: fecha a janela de conexão e reabre o Project Club.
  function restore() {
    active = false;
    clearInterval(timer); timer = null;
    const showMain = mainWasVisible || (connWindow && !connWindow.isDestroyed() && connWindow.isVisible());
    if (connWindow && !connWindow.isDestroyed()) connWindow.destroy();
    connWindow = null;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.loadURL(appUrl);
    if (showMain) { mainWindow.show(); mainWindow.focus(); }
  }

  // A página principal falhou: confere antes de mostrar qualquer coisa.
  async function mainFrameFailed(reason) {
    if (active || checking || !mainWindow || mainWindow.isDestroyed()) return;
    checking = true;
    const s = await status();
    checking = false;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    console.warn(`[conexão] página falhou (${reason}) — internet: ${s.network ? 'sim' : 'não'}, servidor: ${s.server ? 'respondeu' : 'não respondeu'}`);
    if (s.server && allowSilentReload()) { mainWindow.loadURL(appUrl); return; }
    activate(s.network ? (s.server ? 'repeated' : reason) : 'offline');
  }

  function attach(win) {
    mainWindow = win;
    const wc = win.webContents;
    let readyOnce = false;
    wc.on('dom-ready', () => { if (isAppUrl(wc.getURL())) readyOnce = true; });
    wc.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
      // -3 = navegação cancelada (outra começou no lugar): não é falta de conexão.
      if (!isMainFrame || code === -3 || !isAppUrl(url)) return;
      mainFrameFailed('network');
    });
    wc.on('did-navigate', (_e, url, httpCode) => {
      if (isAppUrl(url) && httpCode >= 500) mainFrameFailed('server');
    });
    setTimeout(() => {
      if (readyOnce || active || win.isDestroyed()) return;
      mainFrameFailed('timeout');
    }, 15000).unref?.();
  }

  // Pedidos da janela de conexão (só dela).
  const fromConn = (event) => connWindow && !connWindow.isDestroyed() && event.sender === connWindow.webContents;
  ipcMain.handle('conexao:check', async (event) => {
    if (!fromConn(event)) throw new Error('não autorizado');
    await tick();
    return { reason: lastReason };
  });
  ipcMain.on('conexao:minimize', (event) => { if (fromConn(event)) connWindow.minimize(); });
  // Fechar não encerra o app: some pra bandeja e continua testando.
  ipcMain.on('conexao:hide', (event) => { if (fromConn(event)) { mainWasVisible = false; connWindow.hide(); } });

  return {
    attach,
    isActive: () => active,
    // Bandeja / segunda instância: com o servidor fora, mostra a janela de conexão.
    show() {
      if (active) { mainWasVisible = true; openWindow(); return true; }
      return false;
    },
    dispose() { clearInterval(timer); if (connWindow && !connWindow.isDestroyed()) connWindow.destroy(); },
  };
}

module.exports = { createConnectionGuard };
