// BUG CORRIGIDO ("ao clicar não faz nada"): a versão anterior desta
// telinha usava `require('electron')` direto dentro de um atributo
// onclick="" no HTML, carregado via uma URL "data:" — o Electron trata
// URLs "data:" como conteúdo NÃO confiável por padrão em várias
// versões, e pode simplesmente ignorar nodeIntegration nesse caso
// específico, mesmo com a opção ligada nas webPreferences. O jeito
// correto e confiável (igual o preload.js principal do app já faz) é
// expor uma função específica via contextBridge, chamada normal do
// JavaScript da página — sem nenhum require() direto no HTML.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('screenPickerAPI', {
  choose: (sourceId) => ipcRenderer.send('screen-picker:choice', sourceId),
});
