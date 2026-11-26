// Game Hub → capas dos jogos (site e celular).
//
// Ordem de busca de cada capa:
//  1. imagem que a loja já mandou (se não for um "sem imagem" de reserva);
//  2. Steam: header.jpg conferido; se a Steam mudou o endereço (jogos novos
//     ficam numa pasta com código), pega o header_image do appdetails;
//  3. jogos fora da Steam (World of Warcraft, Roblox, Minecraft, VALORANT,
//     LoL…): a arte da Twitch pelo nome (vertical, 285×380);
//  4. busca na loja da Steam pelo nome exato.
// Imagens da Epic/Unreal vêm em 1–4 MB: pedimos a versão pequena do próprio
// CDN delas (?w=…&h=…&resize=1), que fica em ~40 KB.
//
// Tudo fica guardado em memória (achou: 7 dias; não achou: 12 h).
const { fetchJson, UA } = require('./remote');

const HIT_TTL = 7 * 24 * 3600_000;
const MISS_TTL = 12 * 3600_000;
const MAX_ENTRIES = 5000;
const store = new Map(); // key -> { at, value }
const inflight = new Map();

// "Sem imagem" de reserva de lojas/agregadores: nunca serve de capa.
const PLACEHOLDER = [/cheapshark\.com\/img\/default_box_art/i, /404_boxart/i, /\/no[-_]?image/i, /placeholder/i];
const isPlaceholder = (url) => !url || PLACEHOLDER.some((re) => re.test(url));

// Nome da Twitch quando é diferente do nosso.
const TWITCH_ALIAS = {
  'counter-strike-2': 'Counter-Strike',
  'counter-strike-global-offensive': 'Counter-Strike',
  'league-of-legends': 'League of Legends',
  'valorant': 'VALORANT',
  'pubg-battlegrounds': 'PUBG: BATTLEGROUNDS',
  'grand-theft-auto-v': 'Grand Theft Auto V',
  'grand-theft-auto-v-enhanced': 'Grand Theft Auto V',
  'minecraft-java-edition': 'Minecraft',
  'minecraft-bedrock-edition': 'Minecraft',
  'minecraft-launcher': 'Minecraft',
  'battle-net': null,
};

function slug(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[™®©]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Variações do nome pra achar na Twitch: sem ™/®, sem "Deluxe Edition" etc. */
function nameVariants(name) {
  const clean = String(name || '').replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim();
  const out = [clean];
  const noEdition = clean
    .replace(/\s*[-–:]?\s*(digital\s+)?(deluxe|gold|ultimate|premium|special|standard|complete|definitive|legendary|elite|game of the year|goty|anniversary|enhanced|remastered|collector'?s|palace|karakuri|galactic|turbocharged)(\s+edition|\s+collection)?\s*$/i, '')
    .replace(/\s+edition\s*$/i, '')
    .trim();
  if (noEdition && noEdition !== clean) out.push(noEdition);
  const beforeColon = clean.split(/\s[-–:]\s|:\s/)[0].trim();
  if (beforeColon.length >= 3 && !out.includes(beforeColon)) out.push(beforeColon);
  return [...new Set(out)].filter(Boolean).slice(0, 3);
}

/** A imagem é vertical (capa de caixa)? Pelo endereço, sem baixar. */
function isTall(url) {
  const u = String(url || '');
  return /1200x1600|285x380|600x900|library_600x900|_s2_|-s2-|portrait|boxart|sw=197&(amp;)?sh=261/i.test(u);
}

/** Pede ao CDN a versão menor (Epic/Unreal); conserta &amp; da Ubisoft. */
function sized(url, tall = isTall(url)) {
  if (!url) return url;
  let u = String(url).replace(/&amp;/g, '&');
  if (/^https:\/\/(cdn1\.epicgames\.com|cdn2\.unrealengine\.com)\//i.test(u) && !/[?&]resize=1/.test(u)) {
    const [w, h] = tall ? [360, 480] : [640, 360];
    u += `${u.includes('?') ? '&' : '?'}h=${h}&quality=medium&resize=1&w=${w}`;
  }
  return u;
}

function remember(key, value) {
  if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value);
  store.set(key, { at: Date.now(), value });
  return value;
}

async function memo(key, loader) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < (hit.value ? HIT_TTL : MISS_TTL)) return hit.value;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try { return remember(key, await loader()); } catch { return hit?.value ?? null; } finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

/** A imagem existe de verdade? (HEAD sem seguir redirecionamento: a Twitch redireciona pro "sem capa".) */
async function exists(url, { fetchImpl = globalThis.fetch } = {}) {
  return memo(`ok:${url}`, async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const r = await fetchImpl(url, { method: 'HEAD', redirect: 'manual', headers: { 'user-agent': UA }, signal: ctrl.signal });
      return r.status === 200 && /^image\//i.test(r.headers?.get?.('content-type') || 'image/');
    } finally { clearTimeout(t); }
  });
}

const steamCdn = (id) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`;

/** Capa larga da Steam pra um appId (ou null). */
async function steamHeader(appId, deps = {}) {
  const id = Number(appId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return memo(`steam:${id}`, async () => {
    if (await exists(steamCdn(id), deps)) return steamCdn(id);
    const j = await fetchJson(`https://store.steampowered.com/api/appdetails?appids=${id}&filters=basic`, { ...deps, timeoutMs: 6000 });
    const d = j?.[id];
    return d?.success && d.data?.header_image ? d.data.header_image : null;
  });
}

/** Arte da Twitch pelo nome (vertical). */
async function twitchArt(name, deps = {}) {
  const key = slug(name);
  if (!key) return null;
  const alias = Object.prototype.hasOwnProperty.call(TWITCH_ALIAS, key) ? TWITCH_ALIAS[key] : undefined;
  if (alias === null) return null;
  const names = alias ? [alias] : nameVariants(name);
  return memo(`twitch:${key}`, async () => {
    for (const n of names) {
      const url = `https://static-cdn.jtvnw.net/ttv-boxart/${encodeURIComponent(n)}-285x380.jpg`;
      if (await exists(url, deps)) return url;
    }
    return null;
  });
}

/** Busca na loja da Steam pelo nome (só aceita nome igual). */
async function steamByName(name, deps = {}) {
  const key = slug(name);
  if (!key) return null;
  return memo(`steamname:${key}`, async () => {
    const j = await fetchJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(String(name).slice(0, 80))}&cc=br&l=portuguese`, { ...deps, timeoutMs: 6000 });
    const hit = (j?.items || []).find((i) => slug(i?.name) === key);
    return hit ? steamHeader(hit.id, deps) : null;
  });
}

/**
 * Capa de um jogo: { url, tall } ou null.
 * [image] = imagem que já veio (loja, ícone salvo); [prefer] 'wide' tenta a
 * larga da Steam antes da imagem que veio (cartões de promoção).
 */
async function resolve({ name, steamAppId = null, image = null, prefer = null } = {}, deps = {}) {
  const given = !isPlaceholder(image) ? String(image) : null;
  if (given && !(prefer === 'wide' && isTall(given) && steamAppId)) {
    // Endereço da Steam montado por nós (sem ?t=): confere antes de usar.
    if (!/steamstatic\.com\/store_item_assets\/steam\/apps\/\d+\/header\.jpg$/i.test(given)) return { url: sized(given), tall: isTall(given) };
  }
  if (steamAppId) {
    const s = await steamHeader(steamAppId, deps).catch(() => null);
    if (s) return { url: s, tall: false };
  }
  if (given && isTall(given)) return { url: sized(given), tall: true };
  if (name) {
    const tw = await twitchArt(name, deps).catch(() => null);
    if (tw) return { url: tw, tall: true };
    if (!steamAppId) {
      const s = await steamByName(name, deps).catch(() => null);
      if (s) return { url: s, tall: false };
    }
  }
  return null;
}

/** Resolve várias de uma vez (no máximo [limit] buscas juntas). */
async function resolveMany(items, toQuery, apply, { limit = 6, deps = {} } = {}) {
  const queue = items.map((it, i) => [it, i]);
  const worker = async () => {
    while (queue.length) {
      const [it] = queue.shift();
      const q = toQuery(it);
      if (!q) continue;
      const c = await resolve(q, deps).catch(() => null);
      apply(it, c);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return items;
}

/** Põe game.cover/coverTall num objeto { game: { name, steamAppId } } (partidas, clipes, builds). */
async function withGameCovers(list, pick = (x) => x.game, deps = {}) {
  return resolveMany(list, (x) => {
    const g = pick(x);
    return g?.name ? { name: g.name, steamAppId: g.steamAppId } : null;
  }, (x, c) => {
    const g = pick(x);
    if (g) { g.cover = c?.url || null; g.coverTall = !!c?.tall; }
  }, { deps });
}

function _resetForTests() { store.clear(); inflight.clear(); }

module.exports = {
  resolve, resolveMany, withGameCovers, steamHeader, twitchArt, steamByName,
  isPlaceholder, isTall, sized, nameVariants, slug, _resetForTests,
};
