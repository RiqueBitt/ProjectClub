// Preload da janela offline ("Project Club · Conexão" → tela offline, ver
// connectionWindow.js e offlineShell.js). Expõe só o que a tela usa:
//   pcConexao   teste de conexão / minimizar / esconder (como antes)
//   pcOffline   estado da tela, Praça local, VPN salva, abrir links/pastas
//   electronAPI subconjunto das pontes do site (navegador, VPN, apps) — os
//               handlers são os mesmos do site; a página pcapp://offline é
//               uma origem confiável em security.js
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (callback) => {
  const handler = (_e, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('pcConexao', {
  check: () => ipcRenderer.invoke('conexao:check'),
  onStatus: on('conexao:status'),
  restore: () => ipcRenderer.send('conexao:restore'),
  minimize: () => ipcRenderer.send('conexao:minimize'),
  maximize: () => ipcRenderer.send('conexao:maximize'),
  hide: () => ipcRenderer.send('conexao:hide'),
});

contextBridge.exposeInMainWorld('pcOffline', {
  getState: () => ipcRenderer.invoke('offline-shell:state'),
  apps: () => ipcRenderer.invoke('offline-shell:apps'),
  pracaStart: () => ipcRenderer.invoke('offline-shell:praca-start'),
  pracaStop: () => ipcRenderer.invoke('offline-shell:praca-stop'),
  onPraca: on('offline-shell:praca-state'),
  vpnConnectSaved: (id) => ipcRenderer.invoke('offline-shell:vpn-connect', String(id || '')),
  openExternal: (url) => ipcRenderer.invoke('offline-shell:open-external', String(url || '')),
  openFolder: (what) => ipcRenderer.invoke('offline-shell:open-folder', String(what || '')),
});

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  projectMc: {
    getStatus: (id) => ipcRenderer.invoke('projectmc:get-status', id),
    checkUpdate: (id) => ipcRenderer.invoke('projectmc:check-update', id),
    install: (id) => ipcRenderer.invoke('projectmc:install', id),
    launch: (id) => ipcRenderer.invoke('projectmc:launch', id),
    onProgress: on('projectmc:progress'),
  },
  vpn: {
    version: 1,
    getState: () => ipcRenderer.invoke('vpn:get-state'),
    disconnect: () => ipcRenderer.invoke('vpn:disconnect'),
    onState: on('vpn:state'),
  },
  browser: {
    version: 2,
    getState: () => ipcRenderer.invoke('browser:get-state'),
    suggest: (q) => ipcRenderer.invoke('browser:suggest', q),
    permissionReply: (id, allow, remember) => ipcRenderer.invoke('browser:permission-reply', id, allow, remember),
    downloadAction: (id, action) => ipcRenderer.invoke('browser:download-action', id, action),
    openSystem: (url) => ipcRenderer.invoke('browser:open-system', url),
    allowHttp: (host) => ipcRenderer.invoke('browser:allow-http', host),
    allowDangerous: (host) => ipcRenderer.invoke('browser:allow-dangerous', host),
    profile: {
      load: () => ipcRenderer.invoke('browser:profile-load'),
      save: (key, data) => ipcRenderer.invoke('browser:profile-save', key, data),
    },
    on: (event, callback) => {
      const ok = ['open-tab', 'blocked', 'permission', 'download', 'shortcut', 'crashed', 'context-action', 'dangerous', 'https-upgraded', 'external'];
      if (!ok.includes(event)) return () => {};
      return on(`browser:${event}`)(callback);
    },
  },
});
