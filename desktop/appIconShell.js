'use strict';
// Ícone do app no sistema (Configurações → Aparência → Ícone do app).
//
// BUG CORRIGIDO: trocar o ícone só mudava a janela e a bandeja. No Windows a
// barra de tarefas e a área de trabalho usam o ícone do ATALHO (.lnk), e no
// Linux os lançadores usam o arquivo .desktop — nenhum dos dois era mexido.
// Agora:
//   - Windows: gera um .ico do ícone escolhido, atualiza os atalhos do
//     Project Club (área de trabalho, menu Iniciar, fixado na barra de
//     tarefas), o botão da barra (setAppDetails) e pede pro Explorer
//     recarregar o cache de ícones.
//   - Linux: troca o Icon= dos .desktop do Project Club (menu e área de
//     trabalho).
// Tudo é "melhor esforço": se algo falhar, o app segue normal.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

// ICO com imagens PNG dentro (aceito do Windows Vista em diante).
function pngsToIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const entries = [];
  let offset = 6 + 16 * count;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

function writeIco(img, file) {
  const pngs = [256, 64, 48, 32, 24, 16].map((size) => ({ size, data: img.resize({ width: size, height: size, quality: 'best' }).toPNG() }));
  fs.writeFileSync(file, pngsToIco(pngs));
  return file;
}

// .lnk do Project Club: área de trabalho, menu Iniciar (de onde a Pesquisa do
// Windows tira o ícone) e itens fixados na barra de tarefas — inclusive as
// subpastas (o Windows 11 guarda fixados em TaskBar\ImplicitAppShortcuts\<id>).
function windowsShortcuts(app) {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const programData = process.env.ProgramData || 'C:\\ProgramData';
  const roots = [
    [app.getPath('desktop'), 0],
    [path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop'), 0],
    [path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), 2],
    [path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), 2],
    [path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch'), 4],
  ];
  const out = new Set();
  const walk = (dir, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile() && /\.lnk$/i.test(e.name)) out.add(full);
      else if (e.isDirectory() && depth > 0) walk(full, depth - 1);
    }
  };
  for (const [d, depth] of roots) walk(d, depth);
  return [...out];
}

function applyWindows({ app, shell, win, appId, icoPath }) {
  const exe = path.resolve(process.execPath).toLowerCase();
  let changed = 0;
  for (const lnk of windowsShortcuts(app)) {
    try {
      const info = shell.readShortcutLink(lnk);
      if (!info?.target || path.resolve(info.target).toLowerCase() !== exe) continue;
      const ok = shell.writeShortcutLink(lnk, 'update', icoPath
        ? { icon: icoPath, iconIndex: 0 }
        : { icon: process.execPath, iconIndex: 0 });
      if (ok) changed++;
    } catch { /* atalho sem permissão: segue */ }
  }
  try {
    if (win && !win.isDestroyed()) {
      win.setAppDetails({
        appId,
        appIconPath: icoPath || process.execPath,
        appIconIndex: 0,
        relaunchCommand: `"${process.execPath}"`,
        relaunchDisplayName: 'Project Club',
      });
    }
  } catch { /* ok */ }
  // Explorer guarda os ícones em cache: pede pra recarregar (Windows 10/11).
  // Como o .ico novo tem outro nome (ver applySystemIcon), a Pesquisa, o menu
  // Iniciar e a barra de tarefas não reaproveitam a imagem velha do cache.
  if (changed) {
    const ie4 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'ie4uinit.exe');
    execFile(ie4, ['-show'], { windowsHide: true }, () => {});
  }
  return changed;
}

function linuxDesktopFiles(app) {
  const dirs = [
    path.join(os.homedir(), '.local', 'share', 'applications'),
    app.getPath('desktop'),
  ];
  const out = [];
  for (const d of dirs) {
    let names = [];
    try { names = fs.readdirSync(d); } catch { continue; }
    for (const n of names) if (/\.desktop$/i.test(n)) out.push(path.join(d, n));
  }
  return out;
}

function applyLinux({ app, pngPath, defaultIcon }) {
  const self = (process.env.APPIMAGE || process.execPath).toLowerCase();
  let changed = 0;
  for (const f of linuxDesktopFiles(app)) {
    try {
      const txt = fs.readFileSync(f, 'utf8');
      const exec = (txt.match(/^Exec=(.*)$/m) || [])[1] || '';
      const isOurs = exec.toLowerCase().includes(self) || /^Name=Project Club\s*$/m.test(txt);
      if (!isOurs) continue;
      // Guarda o Icon= original (do AppImage/instalador) pra conseguir voltar ao padrão.
      const curIcon = (txt.match(/^Icon=(.*)$/m) || [])[1] || '';
      const saved = (txt.match(/^X-ProjectClub-OriginalIcon=(.*)$/m) || [])[1];
      let base = txt;
      if (saved === undefined && curIcon) base = base.replace(/^Icon=.*$/m, (l) => `${l}\nX-ProjectClub-OriginalIcon=${curIcon}`);
      const original = saved !== undefined ? saved : curIcon;
      const icon = pngPath || original || defaultIcon;
      if (!icon) continue;
      const next = /^Icon=.*$/m.test(base) ? base.replace(/^Icon=.*$/m, `Icon=${icon}`) : base.replace(/^\[Desktop Entry\]\s*$/m, `[Desktop Entry]\nIcon=${icon}`);
      if (next !== txt) { fs.writeFileSync(f, next); changed++; }
    } catch { /* sem permissão: segue */ }
  }
  if (changed) execFile('update-desktop-database', [path.join(os.homedir(), '.local', 'share', 'applications')], () => {});
  return changed;
}

/**
 * Aplica o ícone escolhido nos atalhos do sistema.
 * @param {object} o
 * @param {Electron.NativeImage|null} o.img  ícone escolhido (null = padrão)
 */
function applySystemIcon({ app, shell, win, appId, img, userDataDir, defaultIconPng }) {
  try {
    if (process.platform === 'win32') {
      // Um .ico com nome novo a cada ícone (app-icon-<hash>.ico): o Windows
      // guarda o ícone do atalho em cache pelo caminho do arquivo, então
      // regravar sempre o mesmo "app-icon.ico" deixava a imagem antiga na
      // Pesquisa e na barra de tarefas até reiniciar o PC.
      let icoPath = null;
      if (img) {
        const png = img.toPNG();
        const hash = require('crypto').createHash('sha1').update(png).digest('hex').slice(0, 10);
        icoPath = path.join(userDataDir, `app-icon-${hash}.ico`);
        if (!fs.existsSync(icoPath)) writeIco(img, icoPath);
      }
      for (const n of safeList(userDataDir)) {
        if (/^app-icon(-[0-9a-f]+)?\.ico$/i.test(n) && (!icoPath || path.join(userDataDir, n) !== icoPath)) {
          try { fs.unlinkSync(path.join(userDataDir, n)); } catch { /* em uso: fica */ }
        }
      }
      return applyWindows({ app, shell, win, appId, icoPath });
    }
    if (process.platform === 'linux') {
      const pngPath = img ? path.join(userDataDir, 'app-icon.png') : null;
      return applyLinux({ app, pngPath, defaultIcon: defaultIconPng });
    }
  } catch (err) { console.warn('[app-icon] não deu pra trocar o ícone dos atalhos:', err?.message || err); }
  return 0;
}

function safeList(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

module.exports = { applySystemIcon, pngsToIco, windowsShortcuts };
