// Ponte mínima e explícita entre o site (que roda isolado, sem acesso
// direto ao Node/Electron — contextIsolation ligado em main.js) e o app
// nativo — expõe SÓ uma função de leitura (a própria versão instalada),
// nada de escrita/execução de comando/acesso a arquivo. É isso que
// permite o site saber "que versão do app está rodando" pra comparar
// com a mais recente publicada (ver utils/nativeUpdateCheck.js) e
// avisar quando tem atualização — sem esse preload, o JS da página não
// teria nenhum jeito de descobrir isso (window.navigator.userAgent não
// diz a versão do NOSSO app, só do Chromium/Electron em si).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  focusWindow: () => ipcRenderer.invoke('focus-window'),
  setUnreadCount: (count) => ipcRenderer.invoke('set-unread-count', count),
  // Item pedido: "Rich Presence" — o app de desktop detecta jogo/Spotify
  // sozinho (ver activityDetector.js) e AVISA o site sempre que muda,
  // sem o site precisar perguntar. onActivityDetected registra quem vai
  // escutar esses avisos (ver utils/nativeActivity.js) — like um
  // addEventListener, não um pedido de resposta única.
  onActivityDetected: (callback) => {
    ipcRenderer.on('activity:detected', (_event, activity) => callback(activity));
  },
});
