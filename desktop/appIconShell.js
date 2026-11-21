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

function windowsShortcuts(app) {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const programData = process.env.ProgramData || 'C:\\ProgramData';
  const dirs = [
    app.getPath('desktop'),
    path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'),
    path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch'),
  ];
  const out = [];
  for (const d of dirs) {
    let names = [];
    try { names = fs.readdirSync(d); } catch { continue; }
    for (const n of names) if (/\.lnk$/i.test(n)) out.push(path.join(d, n));
  }
  return out;
}

function applyWindows({ app, shell, win, appId, icoPath }) {
  const exe = process.execPath.toLowerCase();
  let changed = 0;
  for (const lnk of windowsShortcuts(app)) {
    try {
      const info = shell.readShortcutLink(lnk);
      if (!info?.target || info.target.toLowerCase() !== exe) continue;
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
      const icoPath = img ? writeIco(img, path.join(userDataDir, 'app-icon.ico')) : null;
      if (!img) { try { fs.unlinkSync(path.join(userDataDir, 'app-icon.ico')); } catch { /* não tinha */ } }
      return applyWindows({ app, shell, win, appId, icoPath });
    }
    if (process.platform === 'linux') {
      const pngPath = img ? path.join(userDataDir, 'app-icon.png') : null;
      return applyLinux({ app, pngPath, defaultIcon: defaultIconPng });
    }
  } catch { /* melhor esforço */ }
  return 0;
}

module.exports = { applySystemIcon, pngsToIco };
