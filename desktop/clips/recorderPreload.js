// Preload da janela escondida dos Clipes (clips/recorder.html). Só duas
// saídas, nenhuma entrada: manda os pedaços de vídeo e o estado da
// gravação pro processo principal (clipsManager.js), que confere se vieram
// MESMO desta janela antes de usar.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clipBridge', {
  chunk: (arrayBuffer) => {
    const ok = arrayBuffer instanceof ArrayBuffer || ArrayBuffer.isView(arrayBuffer);
    if (ok && arrayBuffer.byteLength > 0) ipcRenderer.send('clips:chunk', arrayBuffer);
  },
  state: (state) => ipcRenderer.send('clips:recorder-state', state && typeof state === 'object' ? state : {}),
});
