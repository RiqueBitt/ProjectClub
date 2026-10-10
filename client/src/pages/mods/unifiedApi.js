import { api } from '../../api/client';

// Chamadas da busca unificada e da identificação de mods detectados
// (ver server/src/services/unifiedModsService.js). Ficam aqui, e não em
// api/endpoints.js, pra este pedaço do sistema de mods ser autocontido.

// params: { q, category, sort: 'popular'|'downloads'|'new'|'updated', pageToken }
export const searchUnifiedMods = (steamAppId, params) => api
  .get(`/mods/unified/${steamAppId}`, { params })
  .then((r) => r.data);

// names: nomes de pastas/arquivos detectados no disco → { matches: { [nome]: mod|null } }
export const identifyInstalledMods = (steamAppId, names, gameName) => api
  .post('/mods/identify', { steamAppId, names, gameName })
  .then((r) => r.data);

// Compatibilidade final de um item: o servidor decide pela regra do
// jogo; aqui só refina com o que o PC sabe (o loader já está instalado?).
export function refineCompat(item, localProfile) {
  const c = item.compatibility || { status: 'compatible', reason: null };
  if (item.installMethod === 'steam-subscribe') return { ...c, kind: c.status === 'incompatible' ? 'bad' : 'steam' };
  if (localProfile?.blocked) return { status: 'incompatible', reason: localProfile.blocked, kind: 'bad' };
  if (c.status === 'needs-loader') {
    const loader = localProfile?.loader;
    if (loader?.installed && (!c.loader || c.loader === loader.id)) {
      return { status: 'compatible', reason: `${loader.label} já instalado`, kind: 'ok' };
    }
    return { ...c, kind: c.autoInstall ? 'auto' : 'loader' };
  }
  return { ...c, kind: c.status === 'incompatible' ? 'bad' : 'ok' };
}

export function compatLabel(compat) {
  if (compat.kind === 'steam') return 'Pela Steam';
  if (compat.kind === 'auto') return compat.loaderLabel ? `Instala o ${compat.loaderLabel} junto` : 'Instala o loader junto';
  if (compat.kind === 'loader') return compat.loaderLabel ? `Precisa do ${compat.loaderLabel}` : 'Precisa de loader';
  if (compat.kind === 'bad') return 'Incompatível';
  return 'Compatível';
}

export function formatBytes(n) {
  if (!n) return '0 KB';
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

// Tela inicial de Mods: "Em alta esta semana". games = [{ steamAppId, name }]
// (jogos do PC); sem jogos o servidor escolhe os mais populares do site.
export const getTrendingMods = (games = []) => api
  .get('/mods/trending', { params: games.length ? { games: games.map((g) => `${g.steamAppId}:${encodeURIComponent(g.name || '')}`).join(',') } : {} })
  .then((r) => r.data);

// mods: [{ source, sourceId, version }] → { results: { 'source:sourceId': { latestVersion, updateAvailable, needsAccount, ... } } }
export const checkModUpdates = (steamAppId, mods, gameName) => api
  .post('/mods/updates', { steamAppId, mods, gameName })
  .then((r) => r.data);
