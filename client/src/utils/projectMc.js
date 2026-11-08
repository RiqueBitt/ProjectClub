// Item pedido: "criar uma nova integração... ProjectMC, launcher
// opcional de Minecraft do Project Club" — camada fina em cima de
// window.electronAPI.projectMc (exposta em desktop/preload.js). Só
// existe de verdade dentro do app desktop (Electron) — no navegador
// comum ou no app Android, window.electronAPI simplesmente não existe,
// então isDesktopApp() volta false e a tela (ver JogosPage.jsx) mostra
// uma mensagem explicando isso em vez de tentar chamar algo que não
// existe.
//
// `id` é opcional em todas — hoje só existe o módulo 'projectmc' no
// catálogo do lado do Electron (ver desktop/projectMcManager.js), mas
// a assinatura já aceita outro id, pensando nos "outros jogos ou
// aplicativos" que o pedido original menciona como próxima fase.
export function isProjectMcAvailable() {
  return typeof window !== 'undefined' && !!window.electronAPI?.projectMc;
}

export function getProjectMcStatus(id) {
  return window.electronAPI.projectMc.getStatus(id);
}

export function checkProjectMcUpdate(id) {
  return window.electronAPI.projectMc.checkUpdate(id);
}

export function installProjectMc(id) {
  return window.electronAPI.projectMc.install(id);
}

export function launchProjectMc(id) {
  return window.electronAPI.projectMc.launch(id);
}

export function uninstallProjectMc(id) {
  return window.electronAPI.projectMc.uninstall(id);
}

// callback(data) recebe { id, phase: 'downloading'|'extracting'|'done', percent }
export function onProjectMcProgress(callback) {
  window.electronAPI?.projectMc?.onProgress?.(callback);
}
