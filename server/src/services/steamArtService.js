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

module.exports = { resolve, KINDS };
