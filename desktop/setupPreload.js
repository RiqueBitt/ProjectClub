// Ponte da janela do instalador/desinstalador (setup/setup.html) com o
// processo principal (setupWindow.js). Só expõe o que a tela precisa.
const { contextBridge, ipcRenderer } = require('electron');

const params = new URLSearchParams(location.search);

contextBridge.exposeInMainWorld('pcSetup', {
  info: () => ({ mode: params.get('mode') || 'install', platform: params.get('os') || process.platform }),
  openSite: (p) => ipcRenderer.send('setup:open-site', String(p || '/')),
  install: (opts) => ipcRenderer.send('setup:install', opts),
  cancelInstall: () => ipcRenderer.send('setup:cancel-install'),
  uninstall: (opts) => ipcRenderer.send('setup:uninstall', opts),
  cancel: () => ipcRenderer.send('setup:cancel'),
  reinstall: () => ipcRenderer.send('setup:reinstall'),
  onProgress: (cb) => ipcRenderer.on('setup:progress', (_e, data) => cb(data)),
});
