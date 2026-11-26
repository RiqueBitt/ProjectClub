// Game Hub no celular: catálogo de addons do Minecraft Bedrock (CurseForge)
// e a lista de jogos de Android que aceitam mods.
//
// A CurseForge pede uma chave (x-api-key) de graça em console.curseforge.com;
// ela fica só na variável CURSEFORGE_API_KEY do app (nunca no repositório).
// Sem a chave, as rotas respondem 503 com code 'no_key' e o app mostra só a
// importação de arquivos que já estão no celular.
//
// O servidor só repassa os dados (busca, tipos e arquivos). O download sai do
// CDN da CurseForge direto pro celular, sem passar pela gente.

const { fetchJson, cached } = require('./remote');

const API = 'https://api.curseforge.com';
const BEDROCK_GAME_ID = 78022;
const PAGE_SIZE = 20;
// Arquivos que o Minecraft abre sozinho (ACTION_VIEW) e importa.
const INSTALLABLE = ['.mcpack', '.mcaddon', '.mcworld', '.mctemplate'];
// ModsSearchSortField da CurseForge.
const SORTS = { popular: 2, updated: 3, name: 4, downloads: 6, relevance: 13 };

function apiKey() {
  return require('../../config/env').CURSEFORGE_API_KEY || '';
}

function noKey() {
  const e = new Error('O catálogo de addons ainda não foi ligado. Dá pra instalar arquivos que já estão no celular.');
  e.status = 503;
  e.code = 'no_key';
  return e;
}

async function cf(path, { key = apiKey(), fetchImpl } = {}) {
  if (!key) throw noKey();
  try {
    return await fetchJson(`${API}${path}`, { headers: { 'x-api-key': key }, fetchImpl, timeoutMs: 12_000 });
  } catch (err) {
    const msg = String(err?.message || err);
    if (/HTTP 404/.test(msg)) { const e = new Error('Addon não encontrado.'); e.status = 404; throw e; }
    console.warn('[game-hub] CurseForge falhou:', msg);
    // 401/403 = chave errada ou revogada: o app trata igual a "sem chave".
    const e = new Error(/HTTP 40[13]/.test(msg)
      ? 'O catálogo de addons está fora do ar agora. Dá pra instalar arquivos que já estão no celular.'
      : 'A CurseForge não respondeu agora. Tente de novo daqui a pouco.');
    e.status = /HTTP 40[13]/.test(msg) ? 503 : 502;
    if (e.status === 503) e.code = 'no_key';
    throw e;
  }
}

function isInstallable(fileName) {
  const n = String(fileName || '').toLowerCase();
  return INSTALLABLE.some((ext) => n.endsWith(ext));
}

function shapeFile(f) {
  if (!f || typeof f !== 'object') return null;
  return {
    id: f.id,
    name: f.displayName || f.fileName || '',
    fileName: f.fileName || '',
    size: Number(f.fileLength) || 0,
    date: f.fileDate || null,
    versions: Array.isArray(f.gameVersions) ? f.gameVersions.filter((v) => /^\d/.test(v)).slice(0, 6) : [],
    // 1 = lançamento, 2 = beta, 3 = alfa
    channel: f.releaseType === 2 ? 'beta' : f.releaseType === 3 ? 'alpha' : 'release',
    // Sem downloadUrl = o autor não deixou baixar fora do site.
    downloadUrl: f.isAvailable === false ? null : (f.downloadUrl || null),
    installable: isInstallable(f.fileName),
  };
}

function shapeMod(m) {
  if (!m || typeof m !== 'object') return null;
  const files = (Array.isArray(m.latestFiles) ? m.latestFiles : []).map(shapeFile).filter(Boolean);
  const main = files.find((f) => f.id === m.mainFileId) || files[0] || null;
  return {
    id: m.id,
    name: m.name || '',
    summary: m.summary || '',
    icon: m.logo?.thumbnailUrl || m.logo?.url || null,
    url: m.links?.websiteUrl || null,
    downloads: Number(m.downloadCount) || 0,
    classId: m.classId || null,
    categories: (Array.isArray(m.categories) ? m.categories : []).map((c) => c?.name).filter(Boolean).slice(0, 3),
    authors: (Array.isArray(m.authors) ? m.authors : []).map((a) => a?.name).filter(Boolean).slice(0, 2),
    updatedAt: m.dateModified || m.dateReleased || null,
    // O autor pode proibir download fora do site; aí o app abre a página.
    canDownload: m.allowModDistribution !== false,
    mainFile: main,
  };
}

function shapeSearch(json, page) {
  const mods = (Array.isArray(json?.data) ? json.data : []).map(shapeMod).filter(Boolean);
  const total = Number(json?.pagination?.totalCount) || 0;
  return { mods, page, hasMore: (page + 1) * PAGE_SIZE < Math.min(total, 10_000) };
}

// Tipos de conteúdo do Bedrock na CurseForge (Addons, Mapas, Texturas, Skins…).
async function classes(opts = {}) {
  return cached('cf:bedrock:classes', 24 * 3600_000, async () => {
    const json = await cf(`/v1/categories?gameId=${BEDROCK_GAME_ID}&classesOnly=true`, opts);
    const list = (Array.isArray(json?.data) ? json.data : [])
      .filter((c) => c && (c.isClass || !c.classId))
      .map((c) => ({ id: c.id, name: c.name || '', slug: c.slug || '', icon: c.iconUrl || null, order: Number(c.displayIndex) || 0 }))
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      .map(({ order, ...c }) => { void order; return c; });
    return { classes: list };
  });
}

function searchPath({ q = '', classId = null, sort = 'popular', page = 0 } = {}) {
  const p = Math.max(0, Math.min(Number.parseInt(page, 10) || 0, Math.floor(10_000 / PAGE_SIZE) - 1));
  const query = String(q || '').trim().slice(0, 80);
  const sortKey = query && sort === 'popular' ? 'relevance' : (SORTS[sort] ? sort : 'popular');
  const params = new URLSearchParams({
    gameId: String(BEDROCK_GAME_ID),
    sortField: String(SORTS[sortKey]),
    sortOrder: sortKey === 'name' ? 'asc' : 'desc',
    pageSize: String(PAGE_SIZE),
    index: String(p * PAGE_SIZE),
  });
  const cls = Number.parseInt(classId, 10);
  if (Number.isFinite(cls) && cls > 0) params.set('classId', String(cls));
  if (query) params.set('searchFilter', query);
  return { path: `/v1/mods/search?${params}`, page: p };
}

async function search(args = {}, opts = {}) {
  const { path, page } = searchPath(args);
  return cached(`cf:bedrock:${path}`, 10 * 60_000, async () => shapeSearch(await cf(path, opts), page));
}

async function files(modId, opts = {}) {
  const id = Number.parseInt(modId, 10);
  if (!Number.isFinite(id) || id <= 0) { const e = new Error('Addon inválido.'); e.status = 400; throw e; }
  return cached(`cf:bedrock:files:${id}`, 10 * 60_000, async () => {
    const [mod, list] = await Promise.all([
      cf(`/v1/mods/${id}`, opts),
      cf(`/v1/mods/${id}/files?pageSize=20&index=0`, opts),
    ]);
    if (mod?.data?.gameId && mod.data.gameId !== BEDROCK_GAME_ID) { const e = new Error('Esse item não é do Minecraft Bedrock.'); e.status = 404; throw e; }
    const shaped = (Array.isArray(list?.data) ? list.data : []).map(shapeFile).filter(Boolean)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    return { mod: shapeMod(mod?.data), files: shaped };
  });
}

// ---------- Jogos de Android que aceitam mods ----------
// Lista feita à mão (cresce sem precisar atualizar o app). support:
//   install = o Project Club instala direto no jogo
//   ingame  = o próprio jogo tem tela de mods
//   loader  = precisa de um app carregador (loaderPackages diz qual)
// Nada de "APK modificado": só caminhos oficiais ou de código aberto.
const ANDROID_GAMES = [
  { id: 'minecraft', name: 'Minecraft', packages: ['com.mojang.minecraftpe'], support: 'install',
    tip: 'Addons, texturas, mapas e skins: procure aqui e o jogo importa sozinho.' },
  { id: 'minecraft-java', name: 'Minecraft Java (launcher)', packages: ['net.kdt.pojavlaunch', 'com.movtery.zalithlauncher'], support: 'ingame',
    tip: 'Instale Fabric ou Forge pelo próprio launcher e coloque os mods na pasta mods do perfil.' },
  { id: 'mindustry', name: 'Mindustry', packages: ['io.anuke.mindustry'], support: 'ingame',
    tip: 'No jogo: Mods → Procurar. Ele baixa os mods sozinho.' },
  { id: 'unciv', name: 'Unciv', packages: ['com.unciv.app'], support: 'ingame',
    tip: 'No jogo: Mods. Dá pra baixar mapas, civilizações e regras novas.' },
  { id: 'geometry-dash', name: 'Geometry Dash', packages: ['com.robtopx.geometryjump'], support: 'loader',
    loaderName: 'Geode', loaderPackages: ['com.geode.launcher'], url: 'https://geode-sdk.org/install',
    tip: 'Instale o Geode Launcher: ele abre o jogo com os mods do Geode.' },
  { id: 'melon-playground', name: 'Melon Playground', packages: ['com.TwentySeven.MelonPlayground'], support: 'ingame',
    tip: 'No menu principal: Mods. Baixe e ligue os mods da comunidade.' },
  { id: 'delta-touch', name: 'Doom (Delta Touch)', packages: ['com.opentouchgaming.deltatouch'], support: 'ingame',
    tip: 'Coloque WADs e mods na pasta do app e escolha na tela de lançamento.' },
  { id: 'cataclysm-dda', name: 'Cataclysm: DDA', packages: ['com.cleverraven.cataclysmdda'], support: 'ingame',
    tip: 'Ao criar o mundo, escolha os mods na aba Mods.' },
];

function androidGames() {
  return { games: ANDROID_GAMES.map((g) => ({ loaderName: null, loaderPackages: [], url: null, ...g })) };
}

module.exports = {
  classes, search, files, androidGames,
  // pra testes
  shapeMod, shapeFile, shapeSearch, searchPath, isInstallable, BEDROCK_GAME_ID, PAGE_SIZE, ANDROID_GAMES,
};
