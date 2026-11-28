// Preload da janela "Project Club · Conexão" (connectionWindow.js). Só o
// mínimo: pedir um teste agora, receber o estado e minimizar/fechar.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pcConexao', {
  check: () => ipcRenderer.invoke('conexao:check'),
  onStatus: (callback) => {
    const handler = (_e, payload) => callback(payload || {});
    ipcRenderer.on('conexao:status', handler);
    return () => ipcRenderer.removeListener('conexao:status', handler);
  },
  minimize: () => ipcRenderer.send('conexao:minimize'),
  hide: () => ipcRenderer.send('conexao:hide'),
});
