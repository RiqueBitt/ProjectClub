// Instalador e desinstalador do Project Club com a cara do app (no lugar das
// janelas padrão do Windows/Linux).
//
// Instalar: o setup do Windows (NSIS, build/installer.nsh) copia os arquivos
// sem mostrar nada e abre o app; na primeira abertura aparece esta janela
// (setup/setup.html): "Aceitar & Instalar", Opções (atalho, iniciar com o
// sistema, abrir ao terminar) e a barra de progresso enquanto configura. Fechou
// no X antes de instalar → desfaz a instalação. No Linux (AppImage) é a mesma
// janela, e ela cria o atalho no menu de aplicativos.
//
// Desinstalar: o desinstalador do Windows abre o app com --pc-uninstall e
// espera. A janela devolve um código: 0 desinstalar, 3 desinstalar e apagar os
// dados deste PC, 1 cancelar, 2 reinstalar (baixa a versão mais nova e roda).
const { app, BrowserWindow, ipcMain, shell, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');

const RELEASES = 'https://github.com/RiqueBitt/ProjectClub/releases/latest/download/';
const EXIT = { uninstall: 0, cancel: 1, reinstall: 2, uninstallWipe: 3 };

function makeWindow(mode) {
  const w = new BrowserWindow({
    width: 640, height: 400, useContentSize: true, frame: false, resizable: false, maximizable: false, fullscreenable: false,
    show: false, center: true, backgroundColor: '#0e1016', title: 'Project Club',
    icon: path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'setupPreload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  w.setMenu(null);
  w.loadFile(path.join(__dirname, 'setup', 'setup.html'), { query: { mode, os: process.platform } });
  w.once('ready-to-show', () => { w.show(); w.focus(); });
  // links de fora (termos, privacidade) abrem no navegador
  w.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  return w;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Anda a barra até `to` em `ms` (passos pequenos, pra não pular).
async function glide(send, from, to, label, ms) {
  const steps = Math.max(1, Math.round(ms / 60));
  for (let i = 1; i <= steps; i++) {
    send({ pct: from + ((to - from) * i) / steps, label });
    await wait(ms / steps);
  }
}

/* ---------------------------------------------------------------- atalhos */

function desktopShortcut(want) {
  if (process.platform !== 'win32') return;
  const lnk = path.join(app.getPath('desktop'), 'Project Club.lnk');
  const has = fs.existsSync(lnk);
  if (!want && has) { try { fs.unlinkSync(lnk); } catch { /* sem permissão: fica */ } }
  if (want && !has) {
    try { shell.writeShortcutLink(lnk, 'create', { target: process.execPath, description: 'Project Club', icon: process.execPath, iconIndex: 0 }); } catch { /* ok */ }
  }
}

function linuxEntry(dir, name, extra = '') {
  const exe = process.env.APPIMAGE || process.execPath;
  const icons = path.join(os.homedir(), '.local', 'share', 'icons');
  fs.mkdirSync(icons, { recursive: true });
  const icon = path.join(icons, 'project-club.png');
  try { fs.copyFileSync(path.join(__dirname, 'build', 'icon.png'), icon); } catch { /* ok */ }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), [
    '[Desktop Entry]', 'Type=Application', 'Name=Project Club', 'Comment=Chat, voz e comunidade do Project Club',
    `Exec="${exe}" ${extra}%U`.replace('  ', ' '), `Icon=${icon}`, 'Categories=Network;Chat;', 'MimeType=x-scheme-handler/projectclub;', 'Terminal=false', '',
  ].join('\n'));
}

function autostart(want) {
  if (process.platform === 'linux') {
    const file = path.join(os.homedir(), '.config', 'autostart', 'project-club.desktop');
    if (want) linuxEntry(path.dirname(file), 'project-club.desktop', '--hidden ');
    else { try { fs.unlinkSync(file); } catch { /* não tinha */ } }
    return;
  }
  try { app.setLoginItemSettings({ openAtLogin: !!want, openAsHidden: true }); } catch { /* ok */ }
}

/* ---------------------------------------------------------------- instalar */

// Primeira abertura: mostra o instalador. Resolve com as opções escolhidas
// (`open`: abrir a janela do app agora) quando termina.
function runFirstRunSetup({ appUrl, writeLocalState }) {
  return new Promise((resolve) => {
    const w = makeWindow('install');
    const send = (data) => { if (!w.isDestroyed()) w.webContents.send('setup:progress', data); };
    let started = false;
    const cleanup = () => {
      for (const ch of ['setup:install', 'setup:cancel-install', 'setup:open-site']) ipcMain.removeAllListeners(ch);
    };
    ipcMain.on('setup:open-site', (_e, p) => shell.openExternal(new URL(p, appUrl).toString()));
    ipcMain.on('setup:cancel-install', () => {
      if (started) return;
      cleanup();
      // desistiu antes de instalar: no Windows desfaz a cópia dos arquivos
      if (process.platform === 'win32' && app.isPackaged) {
        const un = path.join(path.dirname(process.execPath), 'Uninstall Project Club.exe');
        if (fs.existsSync(un)) { try { spawn(un, ['/S'], { detached: true, stdio: 'ignore' }).unref(); } catch { /* ok */ } }
      }
      app.exit(0);
    });
    ipcMain.on('setup:install', async (_e, opts = {}) => {
      if (started) return;
      started = true;
      await glide(send, 0, 18, 'Preparando a instalação…', 700);
      try { if (process.platform === 'win32') desktopShortcut(opts.desktop !== false); else if (opts.menu !== false) linuxEntry(path.join(os.homedir(), '.local', 'share', 'applications'), 'project-club.desktop'); } catch (err) { console.warn('[instalador] atalho:', err.message); }
      await glide(send, 18, 42, 'Criando os atalhos…', 800);
      autostart(opts.autostart !== false);
      writeLocalState({ autoStartInitialized: true, setupDone: true, setupAt: Date.now() });
      await glide(send, 42, 64, process.platform === 'win32' ? 'Configurando o início com o Windows…' : 'Configurando o início com o sistema…', 700);
      const ping = (async () => {
        try {
          const ctl = new AbortController();
          const tm = setTimeout(() => ctl.abort(), 6000);
          await net.fetch(new URL('/api/health', appUrl).toString(), { signal: ctl.signal });
          clearTimeout(tm);
        } catch { /* sem internet agora: o app tenta de novo ao abrir */ }
      })();
      await Promise.all([ping, glide(send, 64, 92, 'Conectando ao Project Club…', 1400)]);
      await glide(send, 92, 100, 'Pronto!', 400);
      send({ pct: 100, label: 'Pronto!', done: true });
      await wait(650);
      cleanup();
      if (!w.isDestroyed()) w.close();
      resolve({ open: opts.open !== false });
    });
    w.on('closed', () => { if (!started) { cleanup(); app.exit(0); } });
  });
}

/* ---------------------------------------------------------------- desinstalar */

function regAdd(name, value) {
  return new Promise((res) => execFile('reg', ['add', 'HKCU\\Software\\ProjectClub', '/v', name, '/t', 'REG_SZ', '/d', value, '/f'], { windowsHide: true }, () => res()));
}

async function downloadLatestInstaller(send) {
  const yml = await (await net.fetch(`${RELEASES}latest.yml`)).text();
  const m = yml.match(/^path:\s*(.+)$/m);
  if (!m) throw new Error('não achei o instalador mais novo');
  const file = m[1].trim().replace(/^['"]|['"]$/g, '');
  const res = await net.fetch(RELEASES + encodeURIComponent(file));
  if (!res.ok) throw new Error(`download falhou (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const dest = path.join(os.tmpdir(), file);
  const out = fs.createWriteStream(dest);
  const reader = res.body.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    out.write(Buffer.from(value));
    if (total) send({ pct: Math.min(99, (got / total) * 100), label: `Baixando a versão mais nova (${Math.round((got / total) * 100)}%)…` });
  }
  await new Promise((r) => out.end(r));
  return dest;
}

// Abre a janela de desinstalar e termina o app com o código da escolha.
// Roda num perfil temporário pra não brigar com o app se ele estiver aberto.
function runUninstallUi() {
  const realData = app.getPath('userData');
  app.setPath('userData', path.join(os.tmpdir(), 'project-club-uninstall-ui'));
  app.whenReady().then(() => {
    const w = makeWindow('uninstall');
    const send = (data) => { if (!w.isDestroyed()) w.webContents.send('setup:progress', data); };
    let chosen = false;
    const finish = (code) => { chosen = true; setTimeout(() => app.exit(code), 250); };
    ipcMain.on('setup:open-site', () => {});
    ipcMain.on('setup:cancel', () => finish(EXIT.cancel));
    ipcMain.on('setup:uninstall', async (_e, { wipe } = {}) => {
      if (wipe && process.platform === 'win32') await regAdd('DeleteData', realData);
      finish(wipe ? EXIT.uninstallWipe : EXIT.uninstall);
    });
    ipcMain.on('setup:reinstall', async () => {
      try {
        const exe = await downloadLatestInstaller(send);
        send({ pct: 100, label: 'Abrindo o instalador…' });
        spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
        finish(EXIT.reinstall);
      } catch (err) {
        send({ pct: 0, label: `Não deu pra baixar agora (${err.message}). Tente de novo mais tarde.` });
        setTimeout(() => finish(EXIT.cancel), 3500);
      }
    });
    w.on('closed', () => { if (!chosen) app.exit(EXIT.cancel); });
  });
}

module.exports = { runFirstRunSetup, runUninstallUi, EXIT };
