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

export function listInstalledModsLocally(gameInstallPath) {
  return window.electronAPI.mods.listInstalled(gameInstallPath);
}

// callback(data) recebe { modioModId, phase: 'downloading'|'extracting'|'installing'|'done', percent }
// Retorna uma função de "parar de escutar" (o preload já devolve isso).
export function onModsProgress(callback) {
  return window.electronAPI?.mods?.onProgress?.(callback);
}
