// Camada fina em cima de window.electronAPI.mods (exposta em
// desktop/preload.js) — mesmo padrão de utils/projectMc.js. Só existe de
// verdade dentro do app desktop; no navegador comum isDesktopModsAvailable()
// volta false e a UI (ver pages/ModsPage.jsx) explica que detecção/
// instalação de mods precisa do app desktop (item pedido 13).
export function isDesktopModsAvailable() {
  return typeof window !== 'undefined' && !!window.electronAPI?.mods;
}

export function detectSteamGames() {
  return window.electronAPI.mods.detectSteamGames();
}

export function selectGameFolder() {
  return window.electronAPI.mods.selectGameFolder();
}

export function installModLocally(payload) {
  return window.electronAPI.mods.install(payload);
}

export function uninstallModLocally(payload) {
  return window.electronAPI.mods.uninstall(payload);
}

// Item pedido 15: ativar/desativar um mod sem desinstalar, e aplicar um
// perfil inteiro de uma vez (reconcilia o disco pra bater exatamente
// com a lista de mods que devem ficar ativos).
export function setModEnabledLocally(payload) {
  return window.electronAPI.mods.setEnabled(payload);
}

export function applyProfileLocally(payload) {
  return window.electronAPI.mods.applyProfile(payload);
}

export function listInstalledModsLocally(gameInstallPath) {
  return window.electronAPI.mods.listInstalled(gameInstallPath);
}

// callback(data) recebe { modioModId, phase: 'downloading'|'extracting'|'installing'|'done', percent }
// Retorna uma função de "parar de escutar" (o preload já devolve isso).
export function onModsProgress(callback) {
  return window.electronAPI?.mods?.onProgress?.(callback);
}
