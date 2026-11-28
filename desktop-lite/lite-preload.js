// Ponte do Project Club Lite: o mínimo que o site usa no app de PC.
// Recursos que só existem no app completo (mods, navegador, VPN, clipes,
// sobreposição) NÃO são expostos — o site confere se cada um existe
// (ex.: window.electronAPI?.mods) e esconde o que faltar.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

let boot = {};
try {
  const arg = (process.argv || []).find((a) => typeof a === 'string' && a.startsWith('--pc-boot='));
  if (arg) boot = JSON.parse(Buffer.from(arg.slice('--pc-boot='.length), 'base64').toString('utf8')) || {};
} catch { boot = {}; }

const on = (channel, cb) => {
  const h = (_e, data) => { try { cb(data); } catch { /* ok */ } };
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('electronAPI', {
  // O site usa pra saber que é o Lite (modo leve, sem recursos do app completo).
  isLite: true,
  platform: process.platform,
  getAppVersion: () => (boot.version ? Promise.resolve(boot.version) : ipcRenderer.invoke('get-app-version')),
  getAppInstallPath: () => (boot.installPath ? Promise.resolve(boot.installPath) : ipcRenderer.invoke('get-app-install-path')),
  setZoomFactor: (factor) => webFrame.setZoomFactor(factor),
  setVoiceCallActive: (active) => ipcRenderer.send('voice:active', !!active),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximizeToggle: () => ipcRenderer.invoke('window-maximize-toggle'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  windowMoveBy: (dx, dy) => ipcRenderer.send('window-move-by', dx, dy),
  onWindowMaximizedChanged: (cb) => on('window-maximized-changed', cb),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  focusWindow: () => ipcRenderer.invoke('focus-window'),
  setUnreadCount: (count) => ipcRenderer.invoke('set-unread-count', count),
  update: {
    getStatus: () => ipcRenderer.invoke('update:get-status'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (cb) => on('update:status', cb),
  },
});

// Marca a página como Lite antes de pintar: o CSS do site corta os efeitos
// pesados (ver client/src/styles/lite-mode.css).
try {
  const mark = () => document.documentElement && document.documentElement.classList.add('is-lite-app');
  mark();
  window.addEventListener('DOMContentLoaded', mark, { once: true });
} catch { /* ok */ }
