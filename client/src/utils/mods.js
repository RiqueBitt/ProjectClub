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

// Steam Workshop — só lê o que já foi inscrito/baixado (a inscrição em
// si acontece dentro da própria Steam, ver openWorkshopItemInSteam).
export function listInstalledWorkshopItemsLocally(gameInstallPath, workshopAppId) {
  return window.electronAPI.mods.listWorkshopItems(gameInstallPath, workshopAppId);
}

// Abre a página do item no cliente da Steam (protocolo steam://) — é lá
// que a pessoa clica "Inscrever-se" de verdade; nunca inscrevemos por
// ela sem clique (item pedido 28: não mexer em nada da Steam sem ação
// explícita da pessoa).
export function openWorkshopItemInSteam(publishedFileId) {
  window.electronAPI?.openExternal?.(`steam://url/CommunityFilePage/${publishedFileId}`);
}

// Item pedido: "abrir a pasta... adicionar mods de um arquivo local...
// poder configurar mods" — igual no r2modmanPlus, mas implementação
// própria (ver desktop/modsManager.js).
export function openModsFolder(gameInstallPath) {
  return window.electronAPI.mods.openFolder(gameInstallPath);
}

export function pickLocalModFile() {
  return window.electronAPI.mods.pickLocalFile();
}

export function installLocalModFile(payload) {
  return window.electronAPI.mods.installLocal(payload);
}

export function listModConfigFiles(gameInstallPath) {
  return window.electronAPI.mods.listConfigFiles(gameInstallPath);
}

export function readModConfigFile(gameInstallPath, filename) {
  return window.electronAPI.mods.readConfigFile(gameInstallPath, filename);
}

export function writeModConfigFile(gameInstallPath, filename, content) {
  return window.electronAPI.mods.writeConfigFile(gameInstallPath, filename, content);
}

// Item pedido: "como ele identifica a capa dos jogos da Steam" — a
// própria Steam hospeda a capa (capsule vertical) de cada jogo numa
// URL pública e previsível, só com o AppID — nenhuma chave nem login
// necessário, então dá pra usar direto como fallback quando a staff
// não colou uma URL de ícone própria pro jogo.
export function steamCoverUrl(steamAppId) {
  return `https://cdn.akamai.steamstatic.com/steam/apps/${steamAppId}/library_600x900.jpg`;
}

export function listInstalledModsLocally(gameInstallPath) {
  return window.electronAPI.mods.listInstalled(gameInstallPath);
}

// callback(data) recebe { modioModId, phase: 'downloading'|'extracting'|'installing'|'done', percent }
// Retorna uma função de "parar de escutar" (o preload já devolve isso).
export function onModsProgress(callback) {
  return window.electronAPI?.mods?.onProgress?.(callback);
}
