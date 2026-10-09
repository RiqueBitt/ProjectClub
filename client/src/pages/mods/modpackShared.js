import { modFolderName } from '../../utils/mods';

// Peças pequenas dos modpacks públicos usadas em mais de um lugar
// (aba Modpacks do gerenciador e o card "Modpack preferido" do perfil).

export const MODPACK_SOURCE_LABEL = {
  modio: 'mod.io',
  thunderstore: 'Thunderstore',
  gamebanana: 'GameBanana',
  workshop: 'Steam Workshop',
  local: 'Arquivo local',
};

// Arte horizontal padrão da Steam (460x215) — existe pra quase todo jogo.
export function steamHeaderUrl(steamAppId) {
  return `https://cdn.akamai.steamstatic.com/steam/apps/${steamAppId}/header.jpg`;
}

// Nome da pasta que o app desktop usa pra cada item (mesma regra de
// cada instalador) — serve pra saber se já está instalado e pra ativar.
export function itemFolderName(item) {
  if (!item) return null;
  if (item.source === 'local') return item.sourceId;
  if (item.source === 'thunderstore') return modFolderName(item.sourceId);
  if (item.source === 'workshop') return null; // a Steam cuida da pasta
  return modFolderName(item.name);
}

// "Ver modpack" no perfil: guarda o pedido e a aba Modpacks do jogo
// abre ele assim que o gerenciador daquele jogo for aberto.
const PENDING_KEY = 'pc:open-modpack';
export function requestOpenModpack(steamAppId, modpackId) {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ steamAppId: Number(steamAppId), modpackId, at: Date.now() })); } catch { /* sem storage */ }
}
export function peekPendingModpack(steamAppId) {
  try {
    const raw = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
    if (!raw || Date.now() - raw.at > 10 * 60 * 1000) return null;
    return Number(raw.steamAppId) === Number(steamAppId) ? raw : null;
  } catch { return null; }
}
export function consumePendingModpack(steamAppId) {
  const raw = peekPendingModpack(steamAppId);
  if (raw) { try { sessionStorage.removeItem(PENDING_KEY); } catch { /* sem storage */ } }
  return raw;
}
