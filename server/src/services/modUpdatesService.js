// Atualizações de mods + "Em alta" da tela inicial de Mods.
// - checkUpdates: pra cada mod instalado PELO Project Club (o manifesto
//   local guarda source/sourceId/version), descobre a versão mais nova na
//   fonte e diz se tem atualização. Em lote, com limite de concorrência,
//   cache curto e tempo limite por item — uma fonte fora do ar só deixa
//   aqueles mods "sem informação", nunca derruba a resposta toda.
// - trending: os mods populares dos jogos pedidos (ou, sem jogos, dos
//   jogos com mais modpacks/suporte), usando a mesma busca unificada.
const prisma = require('../config/prisma');
const { redis, cacheGetOrSet } = require('../config/redis');
const modio = require('./modioService');
const thunderstore = require('./thunderstoreService');
const nexus = require('./nexusService');
const { unifiedSearch, findMappings } = require('./unifiedModsService');

const ITEM_TIMEOUT_MS = 9000;
const MAX_MODS = 80;
const LATEST_TTL = 20 * 60; // 20 min
const TRENDING_TTL = 30 * 60; // 30 min
const TRENDING_GAMES = 6;
const TRENDING_PER_GAME = 4;
const TRENDING_MAX = 16;

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); }),
  ]);
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (i < list.length) { const idx = i; i += 1; out[idx] = await fn(list[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

// ---------- Comparação de versões ----------
function cleanVersion(v) {
  return String(v ?? '').trim().replace(/^v(?=\d)/i, '');
}

// > 0 se a > b, < 0 se a < b, 0 se iguais, null se não dá pra comparar.
function compareVersions(a, b) {
  const pa = a.split(/[.\-+_ ]/).filter(Boolean);
  const pb = b.split(/[.\-+_ ]/).filter(Boolean);
  const numeric = (parts) => parts.every((p) => /^\d+$/.test(p));
  if (!numeric(pa) || !numeric(pb)) return a.toLowerCase() === b.toLowerCase() ? 0 : null;
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = Number(pa[i] || 0) - Number(pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

// Tem versão nova? Formato desconhecido ("beta-2", datas...) conta como
// atualização só quando o texto é diferente do instalado.
function isNewer(latest, installed) {
  const l = cleanVersion(latest);
  const i = cleanVersion(installed);
  if (!l || !i) return false;
  const c = compareVersions(l, i);
  return c == null ? l.toLowerCase() !== i.toLowerCase() : c > 0;
}

// ---------- Versão mais nova em cada fonte ----------
async function latestFor(mod, mappings) {
  const { source, sourceId } = mod;
  if (source === 'modio') {
    if (!mappings.modio) return null;
    const id = Number(sourceId);
    if (!Number.isInteger(id) || id <= 0) return null;
    return cacheGetOrSet(`modupd:modio:${id}`, LATEST_TTL, async () => {
      const m = await modio.getMod(mappings.modio.gameId, id);
      return { version: m.modfile?.version || null, name: m.name || null, thumbnailUrl: m.logo?.thumb_320x180 || null };
    });
  }
  if (source === 'thunderstore') {
    if (!mappings.thunderstore) return null;
    // A lista inteira da comunidade já fica em cache — procura local.
    const all = await thunderstore.fetchCommunityPackages(mappings.thunderstore.community);
    const raw = all.find((p) => p.full_name === sourceId);
    if (!raw) return null;
    const pkg = thunderstore.normalizePackage(raw);
    return { version: pkg?.version?.versionNumber || null, name: pkg?.name || null, thumbnailUrl: pkg?.version?.icon || null };
  }
  if (source === 'nexus') {
    const [domain, rawId] = String(sourceId).split(':');
    const modId = Number(rawId);
    if (!domain || !Number.isInteger(modId) || modId <= 0) return null;
    return cacheGetOrSet(`modupd:nexus:${domain}:${modId}`, LATEST_TTL, async () => {
      const m = await nexus.getMod(domain, modId);
      const main = (m.files || []).find((f) => f.primary) || (m.files || []).find((f) => f.category === 'MAIN');
      return { version: main?.version || m.version || null, name: m.name || null, thumbnailUrl: m.thumbUrl || null };
    });
  }
  // GameBanana / Workshop / arquivos locais: sem versão confiável (a
  // Steam atualiza os itens do Workshop sozinha).
  return null;
}

async function checkUpdates(steamAppId, rawMods, gameName) {
  const seen = new Set();
  const mods = [];
  for (const m of rawMods || []) {
    const source = String(m?.source || '').slice(0, 20);
    const sourceId = String(m?.sourceId ?? '').slice(0, 200);
    if (!source || !sourceId) continue;
    const key = `${source}:${sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mods.push({ key, source, sourceId, version: m.version != null ? String(m.version).slice(0, 60) : null });
    if (mods.length >= MAX_MODS) break;
  }
  if (mods.length === 0) return { results: {} };

  const mappings = await findMappings(steamAppId, gameName);
  const needsAccount = mods.some((m) => m.source === 'nexus') ? !(await nexus.canDownloadDirect()) : false;

  const rows = await mapLimit(mods, 4, async (m) => {
    let latest = null;
    try { latest = await withTimeout(latestFor(m, mappings), ITEM_TIMEOUT_MS); } catch { latest = null; }
    if (!latest) return [m.key, { known: false, updateAvailable: false }];
    return [m.key, {
      known: !!latest.version,
      latestVersion: latest.version || null,
      installedVersion: m.version,
      updateAvailable: isNewer(latest.version, m.version),
      name: latest.name, thumbnailUrl: latest.thumbnailUrl,
      // Mods que só baixam com login no site da fonte: o "Atualizar tudo"
      // pula e explica (a pessoa atualiza pela página do mod).
      needsAccount: m.source === 'nexus' ? needsAccount : false,
    }];
  });
  return { results: Object.fromEntries(rows) };
}

// ---------- Em alta ----------
// Sem lista de jogos (navegador, sem o app): jogos com mais downloads de
// modpacks públicos + jogos com catálogo de mods cadastrado pela staff.
async function defaultTrendingGames() {
  const games = new Map();
  try {
    const top = await prisma.sharedModpack.groupBy({
      by: ['steamAppId'], where: { isPublic: true },
      _sum: { downloadCount: true }, orderBy: { _sum: { downloadCount: 'desc' } }, take: TRENDING_GAMES,
    });
    if (top.length) {
      const names = await prisma.sharedModpack.findMany({
        where: { steamAppId: { in: top.map((t) => t.steamAppId) } }, select: { steamAppId: true, gameName: true }, distinct: ['steamAppId'],
      });
      const byId = new Map(names.map((n) => [n.steamAppId, n.gameName]));
      for (const t of top) games.set(t.steamAppId, byId.get(t.steamAppId) || null);
    }
  } catch { /* sem modpacks: segue com os catálogos */ }
  if (games.size < TRENDING_GAMES) {
    const [ts, mi] = await Promise.all([
      prisma.thunderstoreGameMapping.findMany({ where: { enabled: true }, select: { steamAppId: true, displayName: true }, take: TRENDING_GAMES }).catch(() => []),
      prisma.modGameMapping.findMany({ where: { enabled: true }, select: { steamAppId: true, displayName: true }, take: TRENDING_GAMES }).catch(() => []),
    ]);
    for (const g of [...ts, ...mi]) {
      if (games.size >= TRENDING_GAMES) break;
      if (!games.has(g.steamAppId)) games.set(g.steamAppId, g.displayName);
    }
  }
  return [...games.entries()].map(([steamAppId, name]) => ({ steamAppId, name }));
}

async function trendingFor(games) {
  const perGame = await Promise.all(games.map(async (g) => {
    try {
      const d = await withTimeout(unifiedSearch(g.steamAppId, { sort: 'popular', gameName: g.name || undefined }), 12000);
      const gameName = g.name || d.profile?.name || `App ${g.steamAppId}`;
      return (d.items || [])
        .filter((i) => i.compatibility?.status !== 'incompatible' && !i.needsAccount && !i.isLoader)
        .slice(0, TRENDING_PER_GAME)
        .map((i) => ({
          key: i.key, source: i.source, sourceId: i.sourceId, name: i.name, summary: String(i.summary || '').slice(0, 160),
          thumbnailUrl: i.thumbnailUrl, author: i.author, downloads: i.downloads || 0, likes: i.likes || 0,
          updatedAt: i.updatedAt || null, installMethod: i.installMethod, compatibility: i.compatibility,
          steamAppId: g.steamAppId, gameName,
        }));
    } catch { return []; }
  }));
  // Intercala os jogos (1º de cada, 2º de cada...) pra lista não virar
  // um jogo só.
  const out = [];
  const max = Math.max(0, ...perGame.map((l) => l.length));
  for (let i = 0; i < max && out.length < TRENDING_MAX; i += 1) {
    for (const l of perGame) if (l[i] && out.length < TRENDING_MAX) out.push(l[i]);
  }
  return out;
}

async function trending(requested) {
  const games = (requested || []).slice(0, TRENDING_GAMES);
  const list = games.length ? games : await defaultTrendingGames();
  if (list.length === 0) return { items: [], games: [] };
  const cacheKey = `mods:trending:${list.map((g) => g.steamAppId).sort((a, b) => a - b).join(',')}`;
  try {
    const cached = await redis.get(`cache:${cacheKey}`);
    if (cached !== null) return { items: JSON.parse(cached), games: list.map((g) => g.steamAppId) };
  } catch { /* sem Redis: calcula direto */ }
  const items = await trendingFor(list);
  // Lista vazia (fontes fora do ar) não vai pro cache — tenta de novo logo.
  if (items.length) { try { await redis.set(`cache:${cacheKey}`, JSON.stringify(items), 'EX', TRENDING_TTL); } catch { /* ignora */ } }
  return { items, games: list.map((g) => g.steamAppId) };
}

module.exports = { checkUpdates, trending, isNewer, compareVersions };
