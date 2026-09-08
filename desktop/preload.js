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
  // Item pedido: "Sistema... Iniciar com o sistema... Minimizar para
  // bandeja... Abrir links no aplicativo... Confirmar saída... Essas
  // funções podem existir no '.exe' sem necessariamente existirem na
  // versão web" — o site chama isso toda vez que o UserSettings da
  // pessoa carrega ou muda (ver useStore.js), e o processo principal
  // (main.js) usa esses valores de verdade pra decidir como se
  // comportar. Envio "fire and forget" (ipcRenderer.send, não invoke)
  // — não precisa de resposta, só avisar.
  updateSettings: (settings) => ipcRenderer.send('settings:update', settings),
  // Item pedido: "Sobreposição no jogo (overlay)... A overlay deve
  // receber eventos do Project Club: Nova mensagem, Menção, Convite,
  // Pedido de amizade, Entrada em chamada" — chamado pelo mesmo
  // notifyUser() de SocketContext.jsx que já dispara a notificação
  // nativa comum, pra cada um desses eventos. main.js decide sozinho
  // se deve mostrar de verdade (overlayEnabled/overlayNotifications
  // ligados + um jogo detectado rodando agora).
  showOverlayNotification: (payload) => ipcRenderer.send('overlay:notify', payload),
});
