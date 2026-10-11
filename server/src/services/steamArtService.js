// Artes dos jogos da Steam (capa vertical, fundo grande, cabeçalho).
// Item pedido: "os jogos não têm capa, só o nome". A Steam passou a
// guardar as artes num endereço com um código no meio
// (store_item_assets/steam/apps/<id>/<código>/library_600x900.jpg) — o
// link antigo sem o código dá 404 em muitos jogos. Aqui pergunta pra
// API pública da loja (IStoreBrowseService/GetItems, sem chave) qual é
// o arquivo certo, testa a lista de candidatos e guarda o que funcionou.
const { redis, cacheGetOrSet } = require('../config/redis');

const KINDS = ['cover', 'hero', 'header'];
const ASSET_BASE = 'https://shared.akamai.steamstatic.com/store_item_assets/';
const LEGACY_BASE = 'https://cdn.akamai.steamstatic.com/steam/apps/';

// Quais campos da loja e quais arquivos antigos tentar, em ordem.
const PLAN = {
  cover: { assets: ['library_capsule_2x', 'library_capsule'], legacy: ['library_600x900_2x.jpg', 'library_600x900.jpg'], last: 'header' },
  hero: { assets: ['library_hero', 'library_hero_2x', 'page_background'], legacy: ['library_hero.jpg'], last: 'header' },
  header: { assets: ['header', 'header_2x', 'main_capsule'], legacy: ['header.jpg', 'capsule_616x353.jpg'], last: null },
};

async function fetchAssets(appId) {
  const input = { ids: [{ appid: appId }], context: { language: 'english', country_code: 'US' }, data_request: { include_assets: true } };
  const url = `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.response?.store_items?.[0]?.assets || null;
  } catch { return null; } finally { clearTimeout(timer); }
}

function assetUrl(assets, field) {
  const file = assets?.[field];
  if (!file || !assets.asset_url_format) return null;
  return ASSET_BASE + assets.asset_url_format.replace('${FILENAME}', file);
}

// loadImage vem do proxy (busca e já deixa no cache de imagens).
async function findUrl(appId, kind, loadImage, assets) {
  const plan = PLAN[kind];
  const candidates = [
    ...plan.assets.map((f) => assetUrl(assets, f)),
    ...plan.legacy.map((f) => `${LEGACY_BASE}${appId}/${f}`),
  ].filter(Boolean);
  for (const url of [...new Set(candidates)]) {
    try {
      const img = await loadImage(url);
      if (img?.buffer) return url;
    } catch { /* tenta o próximo */ }
  }
  return plan.last ? findUrl(appId, plan.last, loadImage, assets) : null;
}

async function cacheGet(key) {
  try { return await redis.get(`cache:${key}`); } catch { return null; }
}
async function cacheSet(key, value, ttl) {
  try { await redis.set(`cache:${key}`, value, 'EX', ttl); } catch { /* sem cache */ }
}

const inFlight = new Map(); // mesma arte pedida várias vezes ao mesmo tempo → uma busca só

async function resolve(appId, kind, loadImage) {
  const key = `steamart:${appId}:${kind}`;
  const cached = await cacheGet(key);
  if (cached !== null) return cached || null; // '' = já sabemos que não tem
  if (inFlight.has(key)) return inFlight.get(key);
  const job = (async () => {
    const assets = await cacheGetOrSet(`steamart:assets:${appId}`, 24 * 60 * 60, async () => (await fetchAssets(appId)) || {});
    const url = await findUrl(appId, kind, loadImage, assets);
    // Achou: guarda 7 dias. Não achou: 6 horas (pode ser a Steam fora do ar).
    await cacheSet(key, url || '', url ? 7 * 24 * 60 * 60 : 6 * 60 * 60);
    return url;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

// --- App ID pelo nome do jogo -------------------------------------------
// Jogos detectados sem App ID (ex.: "Overwatch 2") ficavam sem capa. Busca
// na loja da Steam (storesearch, sem chave) e só aceita nome IGUAL (sem
// acento/®/™/pontuação) — nunca chuta um jogo parecido ("Minecraft" não
// vira "Minecraft Dungeons"). Cache: Redis (30 dias achou / 3 dias não
// achou) + memória.
function normalizeGameName(name) {
  return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[®™©]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120);
}

async function searchStore(term) {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=US`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data?.items) ? data.items : [];
  } catch { return null; } finally { clearTimeout(timer); }
}

const byNameMemory = new Map(); // nome normalizado -> appId | 0
const byNameInFlight = new Map();
function rememberByName(n, id) {
  if (byNameMemory.size > 3000) byNameMemory.clear();
  byNameMemory.set(n, id || 0);
}

async function findAppIdByName(name, search = searchStore) {
  const n = normalizeGameName(name);
  if (!n) return null;
  if (byNameMemory.has(n)) return byNameMemory.get(n) || null;
  const key = `steamart:byname:${n}`;
  const cached = await cacheGet(key);
  if (cached !== null) { const id = Number(cached) || 0; rememberByName(n, id); return id || null; }
  if (byNameInFlight.has(n)) return byNameInFlight.get(n);
  const job = (async () => {
    const items = await search(name);
    if (items === null) { await cacheSet(key, '', 60 * 60); return null; } // Steam fora: tenta de novo em 1h
    const hit = items.find((it) => Number.isInteger(Number(it?.id)) && (!it.type || it.type === 'app') && normalizeGameName(it.name) === n);
    const id = hit ? Number(hit.id) : 0;
    rememberByName(n, id);
    await cacheSet(key, id ? String(id) : '', id ? 30 * 24 * 60 * 60 : 3 * 24 * 60 * 60);
    return id || null;
  })().finally(() => byNameInFlight.delete(n));
  byNameInFlight.set(n, job);
  return job;
}

module.exports = { resolve, KINDS, findAppIdByName, normalizeGameName, _test: { byNameMemory } };
