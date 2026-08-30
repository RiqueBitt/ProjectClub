// Mesmo padrão de segurança do screenPickerPreload.js — contextBridge
// em vez de expor o Node.js direto pro HTML, evitando qualquer
// dependência de comportamento inconsistente do Electron com URLs de
// dados/arquivo.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updateWindowAPI', {
  restartNow: () => ipcRenderer.send('update-window:restart-now'),
  dismiss: () => ipcRenderer.send('update-window:dismiss'),
  onProgress: (callback) => ipcRenderer.on('update-window:progress', (_event, data) => callback(data)),
  onReady: (callback) => ipcRenderer.on('update-window:ready', (_event, data) => callback(data)),
});
