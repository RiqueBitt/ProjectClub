// Telinha de "escolher o que transmitir" do Lite: recebe a lista e devolve a escolha.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('liteScreenPicker', {
  onList: (cb) => ipcRenderer.once('lite-picker:list', (_e, list) => cb(list)),
  choose: (id) => ipcRenderer.send('lite-picker:choice', id || null),
});
