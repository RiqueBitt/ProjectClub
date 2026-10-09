// Nexus Mods (nexusmods.com) — a mesma fonte que o Vortex usa. Item
// pedido: "adicione uma nova API de mods de jogos e o Vortex".
//
// - Busca/listagem: API v2 (GraphQL, https://api.nexusmods.com/v2/graphql),
//   que tem filtro por nome, categoria e ordenação. Se ela falhar, cai
//   pras listas da v1 (em alta / novos / atualizados).
// - Detalhes e arquivos: API v1 (REST) com a chave do servidor.
// - Download: a Nexus só libera link direto pela API pra conta Premium;
//   pra conta grátis o link precisa da chave temporária que o site gera
//   no botão "Mod Manager Download" (link nxm://, o mesmo do Vortex) —
//   o app desktop do Project Club pode receber esse link (ver desktop/).
//
// A chave fica só no servidor (variável NEXUS_API_KEY), nunca vai pro
// navegador. Tudo com cache no Redis pra respeitar o limite da Nexus
// (≈20 mil chamadas/dia por chave).
const env = require('../config/env');
const { cacheGetOrSet } = require('../config/redis');

const V1 = 'https://api.nexusmods.com/v1';
const V2 = 'https://api.nexusmods.com/v2/graphql';
const APP_NAME = 'ProjectClub';
const APP_VERSION = '1.0.0';

class NexusNotConfiguredError extends Error {
  constructor() { super('Fonte de mods indisponível no momento.'); this.status = 503; }
}

function isConfigured() {
  return !!env.NEXUS_API_KEY;
}

function headers(extra = {}) {
  return {
    apikey: env.NEXUS_API_KEY,
    'Application-Name': APP_NAME,
    'Application-Version': APP_VERSION,
    Accept: 'application/json',
    ...extra,
  };
}

async function v1(path, params) {
  if (!isConfigured()) throw new NexusNotConfiguredError();
  const url = new URL(`${V1}${path}`);
  for (const [k, v] of Object.entries(params || {})) if (v != null && v !== '') url.searchParams.set(k, v);
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    let msg = `A fonte de mods respondeu ${res.status}`;
    try { const body = await res.json(); if (body?.message) msg = body.message; } catch { /* sem corpo */ }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function gql(query, variables) {
  if (!isConfigured()) throw new NexusNotConfiguredError();
  const res = await fetch(V2, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) { const err = new Error(`A busca de mods respondeu ${res.status}`); err.status = res.status; throw err; }
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors[0].message || 'Erro na busca de mods');
  return body.data;
}

// ---------- Jogo: steamAppId → domínio da Nexus ----------
// A Nexus não guarda o AppID da Steam, então os jogos mais comuns ficam
// fixos aqui; o resto é achado pelo nome na lista de jogos da Nexus.
const STEAM_TO_NEXUS = {
  489830: 'skyrimspecialedition', 72850: 'skyrim', 377160: 'fallout4', 22380: 'newvegas', 22370: 'fallout3',
  22330: 'oblivion', 2623190: 'oblivionremastered', 22320: 'morrowind', 1716740: 'starfield', 1151340: 'fallout76',
  976620: 'enderalspecialedition', 1091500: 'cyberpunk2077', 292030: 'witcher3', 20920: 'witcher2',
  1086940: 'baldursgate3', 413150: 'stardewvalley', 1245620: 'eldenring', 374320: 'darksouls3', 570940: 'darksoulsremastered',
  814380: 'sekiro', 1888160: 'armoredcore6firesofrubicon', 1627720: 'liesofp', 582010: 'monsterhunterworld',
  1446780: 'monsterhunterrise', 2246340: 'monsterhunterwilds', 2054970: 'dragonsdogma2', 1196590: 'residentevilvillage',
  2050650: 'residentevil42023', 261550: 'mountandblade2bannerlord', 48700: 'mbwarband', 268500: 'xcom2',
  1222690: 'dragonageinquisition', 1328670: 'masseffectlegendaryedition', 1238000: 'masseffectandromeda',
  379430: 'kingdomcomedeliverance', 1771300: 'kingdomcomedeliverance2', 892970: 'valheim', 264710: 'subnautica',
  848450: 'subnauticabelowzero', 275850: 'nomanssky', 294100: 'rimworld', 105600: 'terraria', 1623730: 'palworld',
  990080: 'hogwartslegacy', 2358720: 'blackmythwukong', 1966720: 'lethalcompany', 271590: 'gta5',
  1174180: 'reddeadredemption2', 1222670: 'thesims4', 262060: 'darkestdungeon', 239140: 'dyinglight', 534380: 'dyinglight2',
  524220: 'nierautomata', 1462040: 'finalfantasy7remake', 1687950: 'persona5', 435150: 'divinityoriginalsin2definitiveedition',
  560130: 'pillarsofeternity2', 281990: 'stellaris', 255710: 'citiesskylines', 251570: '7daystodie', 548430: 'deeprockgalactic',
  1145360: 'hades', 1145350: 'hades2', 367520: 'hollowknight', 632360: 'riskofrain2', 1604030: 'vrising',
  1364780: 'streetfighter6', 1774580: 'starwarsjedisurvivor', 1593500: 'godofwar', 2322010: 'godofwarragnarok',
  1817070: 'marvelsspidermanremastered', 1551360: 'forzahorizon5', 2195250: 'eafc24', 1158310: 'crusaderkings3',
  394360: 'heartsofironiv', 236850: 'europauniversalis4', 1172470: 'apexlegends', 1063730: 'newworld',
};

const normName = (s) => String(s || '').toLowerCase().replace(/[™®©]/g, '').replace(/[^a-z0-9]+/g, '');

async function listGames() {
  return cacheGetOrSet('nexus:games', 24 * 60 * 60, async () => {
    const list = await v1('/games.json');
    return (list || []).map((g) => ({ id: g.id, name: g.name, domain: g.domain_name, mods: g.mods || 0 }));
  });
}

// Devolve { domain, gameId, name } ou null se a Nexus não tem esse jogo.
async function resolveGame(steamAppId, names = []) {
  if (!isConfigured()) return null;
  let games = [];
  try { games = await listGames(); } catch { /* sem lista: só o mapa fixo */ }
  const fixed = STEAM_TO_NEXUS[Number(steamAppId)];
  if (fixed) {
    const g = games.find((x) => x.domain === fixed);
    if (g || games.length === 0) return { domain: fixed, gameId: g?.id || null, name: g?.name || null };
  }
  const wanted = names.map(normName).filter(Boolean);
  if (wanted.length === 0) return null;
  const hit = games
    .filter((g) => g.mods > 0 && wanted.includes(normName(g.name)))
    .sort((a, b) => b.mods - a.mods)[0];
  return hit ? { domain: hit.domain, gameId: hit.id, name: hit.name } : null;
}

async function getGameInfo(domain) {
  return cacheGetOrSet(`nexus:game:${domain}`, 6 * 60 * 60, () => v1(`/games/${encodeURIComponent(domain)}.json`));
}

async function listCategories(domain) {
  const info = await getGameInfo(domain);
  return [...new Set((info.categories || []).map((c) => c.name).filter(Boolean))];
}

// ---------- Busca ----------
const MODS_QUERY = `
query Mods($filter: ModsFilter, $sort: [ModsSort!], $offset: Int, $count: Int) {
  mods(filter: $filter, sort: $sort, offset: $offset, count: $count) {
    totalCount
    nodes {
      modId name summary version author status adultContent
      downloads endorsements createdAt updatedAt
      thumbnailUrl pictureUrl
      modCategory { name }
      uploader { name }
      game { domainName }
    }
  }
}`;

const SORT_FIELD = { popular: 'endorsements', downloads: 'downloads', new: 'createdAt', updated: 'updatedAt' };

async function searchMods(domain, { q, sort = 'popular', category, offset = 0, count = 12 } = {}) {
  const filter = {
    gameDomainName: [{ value: domain, op: 'EQUALS' }],
    adultContent: [{ value: false, op: 'EQUALS' }],
  };
  if (q) filter.name = [{ value: q, op: 'WILDCARD' }];
  if (category) filter.categoryName = [{ value: category, op: 'EQUALS' }];
  const variables = { filter, sort: [{ [SORT_FIELD[sort] || 'endorsements']: { direction: 'DESC' } }], offset, count };
  const key = `nexus:search:${JSON.stringify(variables)}`;
  try {
    return await cacheGetOrSet(key, 5 * 60, async () => {
      const d = await gql(MODS_QUERY, variables);
      return { totalCount: d.mods?.totalCount ?? 0, nodes: d.mods?.nodes || [] };
    });
  } catch (err) {
    // GraphQL fora: sem busca por nome, mas ainda mostra as listas da v1.
    if (q || category || offset > 0) throw err;
    const list = sort === 'new' ? 'latest_added' : sort === 'updated' ? 'latest_updated' : 'trending';
    const mods = await cacheGetOrSet(`nexus:v1list:${domain}:${list}`, 10 * 60, () => v1(`/games/${encodeURIComponent(domain)}/mods/${list}.json`));
    const nodes = (mods || []).filter((m) => m.available !== false && !m.contains_adult_content).map((m) => ({
      modId: m.mod_id, name: m.name, summary: m.summary, version: m.version, author: m.author,
      downloads: m.mod_downloads, endorsements: m.endorsement_count,
      createdAt: m.created_time, updatedAt: m.updated_time,
      thumbnailUrl: m.picture_url, pictureUrl: m.picture_url, modCategory: null, uploader: { name: m.uploaded_by },
      game: { domainName: domain },
    }));
    return { totalCount: nodes.length, nodes };
  }
}

// ---------- Detalhes / arquivos / download ----------
// BBCode da Nexus → texto simples (a tela mostra como texto).
function stripBBCode(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\[(\/)?(b|i|u|s|center|right|left|size|font|color|quote|code|spoiler|heading|line|list|\*|img|youtube|url)(=[^\]]*)?\]/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function getMod(domain, modId) {
  const d = encodeURIComponent(domain);
  const [mod, files] = await Promise.all([
    cacheGetOrSet(`nexus:mod:${domain}:${modId}`, 10 * 60, () => v1(`/games/${d}/mods/${modId}.json`)),
    cacheGetOrSet(`nexus:files:${domain}:${modId}`, 10 * 60, () => v1(`/games/${d}/mods/${modId}/files.json`)),
  ]);
  const fileList = (files.files || [])
    .filter((f) => !['ARCHIVED', 'REMOVED', 'DELETED'].includes(String(f.category_name || '').toUpperCase()))
    .map((f) => ({
      id: f.file_id, name: f.name, filename: f.file_name, version: f.version || f.mod_version || null,
      category: f.category_name || null, primary: !!f.is_primary,
      size: f.size_in_bytes || (f.size_kb ? f.size_kb * 1024 : null),
      uploadedAt: f.uploaded_timestamp ? new Date(f.uploaded_timestamp * 1000).toISOString() : null,
      description: stripBBCode(f.description).slice(0, 400),
    }))
    // Principal primeiro, depois opcionais, depois o resto; mais novo antes.
    .sort((a, b) => (b.primary - a.primary) || ((a.category === 'MAIN' ? 0 : 1) - (b.category === 'MAIN' ? 0 : 1)) || String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
  const [images, virusScan] = await Promise.all([
    Promise.resolve(extractImages(mod)),
    scanStatus(domain, modId, fileList.find((f) => f.primary) || fileList[0]).catch(() => null),
  ]);
  return {
    images, virusScan,
    createdAt: mod.created_time || null, uploadedBy: mod.uploaded_by || null, creator: mod.author || null,
    id: mod.mod_id, domain, name: mod.name, summary: stripBBCode(mod.summary),
    description: stripBBCode(mod.description).slice(0, 6000),
    thumbUrl: mod.picture_url || null, version: mod.version || null,
    author: mod.author || mod.uploaded_by || null,
    downloads: mod.mod_downloads || 0, endorsements: mod.endorsement_count || 0,
    adult: !!mod.contains_adult_content, available: mod.available !== false && mod.status === 'published',
    updatedAt: mod.updated_time || null,
    pageUrl: `https://www.nexusmods.com/${domain}/mods/${mod.mod_id}`,
    files: fileList,
  };
}

// Imagens do mod (item pedido: "parte de screenshots igual à Nexus"): a
// API não lista a galeria, então usa a imagem principal + as imagens
// que o autor colocou na descrição ([img]...[/img]).
function extractImages(mod) {
  const urls = [];
  if (mod.picture_url) urls.push(mod.picture_url);
  const re = /\[img(?:=[^\]]*)?\](https:\/\/[^\s[\]"']+?)\[\/img\]/gi;
  let m;
  while ((m = re.exec(String(mod.description || ''))) && urls.length < 24) {
    const u = m[1].trim();
    if (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(u) || /staticdelivery|imgur|nexus/i.test(u)) urls.push(u);
  }
  return [...new Set(urls)];
}

const SAFE_SCANS = new Set(['VERIFIED', 'INTERNALLY_VERIFIED', 'MANUALLY_VERIFIED']);
const BAD_SCANS = new Set(['QUARANTINED']);

// Resultado da verificação de vírus do arquivo principal (GraphQL v2).
async function scanStatus(domain, modId, file) {
  if (!file) return null;
  return cacheGetOrSet(`nexus:scan:${domain}:${modId}:${file.id}`, 60 * 60, async () => {
    const info = await getGameInfo(domain);
    if (!info?.id) return null;
    const d = await gql('query F($g: ID!, $m: ID!) { modFiles(gameId: $g, modId: $m) { fileId scannedV2 } }', { g: String(info.id), m: String(modId) });
    const hit = (d.modFiles || []).find((f) => f.fileId === file.id);
    if (!hit) return null;
    const status = hit.scannedV2;
    return { status, safe: SAFE_SCANS.has(status), danger: BAD_SCANS.has(status) };
  });
}

// key/expires vêm do link nxm:// (conta grátis). Sem eles, só funciona
// se a conta da chave do servidor for Premium.
async function getDownloadLink(domain, modId, fileId, { key, expires } = {}) {
  const params = key && expires ? { key, expires } : undefined;
  const links = await v1(`/games/${encodeURIComponent(domain)}/mods/${modId}/files/${fileId}/download_link.json`, params);
  const first = Array.isArray(links) ? links.find((l) => l.URI) : null;
  if (!first) throw new Error('Não veio link de download.');
  return { url: first.URI, cdn: first.short_name || first.name || null };
}

function managerDownloadUrl(domain, modId, fileId) {
  return `https://www.nexusmods.com/${domain}/mods/${modId}?tab=files&file_id=${fileId}&nmm=1`;
}

module.exports = {
  isConfigured, resolveGame, listGames, getGameInfo, listCategories, searchMods, getMod,
  getDownloadLink, managerDownloadUrl, stripBBCode, STEAM_TO_NEXUS, NexusNotConfiguredError,
};
