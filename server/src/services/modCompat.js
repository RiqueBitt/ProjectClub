// Normalização + compatibilidade dos mods de TODAS as fontes num formato
// só — item pedido: "em vez de mostrar separado por mod.io/GameBanana
// etc., mostre tudo junto" e "mostre quais mods são compatíveis e quais
// não". Funções puras (sem rede/banco), pra dar pra testar com dados
// falsos — quem busca de verdade é unifiedModsService.js.
const { getGameProfile, UNSUPPORTED_ARCHIVES } = require('./modGameProfiles');

function extOf(filename) {
  const m = String(filename || '').toLowerCase().match(/\.[a-z0-9]{1,10}$/);
  return m ? m[0] : null;
}

function toIso(value, unixSeconds = false) {
  if (value == null || value === '') return null;
  const ms = unixSeconds ? Number(value) * 1000 : (typeof value === 'number' ? value : Date.parse(value));
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

// ---------- Normalizadores por fonte ----------
function normalizeModio(m) {
  const modfile = m.modfile || null;
  return {
    key: `modio:${m.id}`, source: 'modio', sourceId: String(m.id),
    name: m.name, summary: m.summary || '',
    thumbnailUrl: m.logo?.thumb_320x180 || m.logo?.thumb_640x360 || m.logo?.original || null,
    author: m.submitted_by?.username || null,
    downloads: m.stats?.downloads_total || 0, likes: m.stats?.ratings_positive || 0,
    updatedAt: toIso(m.date_updated, true), createdAt: toIso(m.date_added, true),
    categories: (m.tags || []).map((t) => t.name).filter(Boolean),
    pageUrl: m.profile_url || null,
    _fileExt: modfile ? extOf(modfile.filename) : null,
    _noFile: !modfile || !modfile.id,
    _unsafe: modfile?.virus_positive === 1,
  };
}

// Pacote já normalizado por thunderstoreService.normalizePackage.
function normalizeThunderstore(p, profile) {
  const deps = p.version?.dependencies || [];
  const loaderRe = profile?.loaderPackage || /bepinexpack/i;
  return {
    key: `thunderstore:${p.fullName}`, source: 'thunderstore', sourceId: p.fullName,
    name: p.name, summary: p.version?.description || '',
    thumbnailUrl: p.version?.icon || null, author: p.owner || null,
    downloads: p.downloadCount || 0, likes: p.rating || 0,
    updatedAt: toIso(p.dateUpdated), createdAt: toIso(p.dateCreated),
    categories: p.categories || [],
    pageUrl: p.packageUrl || null,
    pinned: !!p.isPinned,
    _deprecated: !!p.isDeprecated,
    _isLoader: loaderRe.test(p.name || ''),
    _needsLoader: deps.some((d) => loaderRe.test(String(d).split('-').slice(1, -1).join('-'))),
    _dependencyCount: deps.length,
  };
}

function pickGameBananaImage(image) {
  if (!image || !image._sBaseUrl) return null;
  const fileKeys = Object.keys(image).filter((k) => k.startsWith('_sFile'));
  if (fileKeys.length === 0) return null;
  const sizedKey = fileKeys.find((k) => k !== '_sFile' && /\d/.test(k));
  return `${image._sBaseUrl}/${image[sizedKey || fileKeys[0]]}`;
}

const GB_NOT_INSTALLABLE = {
  Wip: 'Ainda em desenvolvimento (sem arquivo pra baixar)',
  Tutorial: 'É um tutorial, não um mod',
  Question: 'É uma pergunta do fórum, não um mod',
  Request: 'É um pedido, não um mod',
  Thread: 'É um tópico, não um mod',
  Tool: 'É um programa externo, não um mod',
  Concept: 'É só uma ideia, sem arquivo',
};

function normalizeGameBanana(raw) {
  const model = raw._sModelName || 'Mod';
  const image = raw._aPreviewMedia?._aImages?.[0];
  return {
    key: `gamebanana:${raw._idRow}`, source: 'gamebanana', sourceId: String(raw._idRow),
    name: raw._sName || 'Sem nome', summary: raw._sDescription || '',
    thumbnailUrl: pickGameBananaImage(image),
    author: raw._aSubmitter?._sName || raw._aOwner?._sName || null,
    downloads: raw._nDownloadCount || 0, likes: raw._nLikeCount || 0, views: raw._nViewCount || 0,
    updatedAt: toIso(raw._tsDateModified || raw._tsDateUpdated, true), createdAt: toIso(raw._tsDateAdded, true),
    categories: [raw._aRootCategory?._sName, raw._aCategory?._sName].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i),
    pageUrl: raw._sProfileUrl || null,
    _model: model,
    _obsolete: !!raw._bIsObsolete,
    _notInstallable: GB_NOT_INSTALLABLE[model] || null,
  };
}

function normalizeWorkshop(item) {
  return {
    key: `workshop:${item.publishedfileid}`, source: 'workshop', sourceId: String(item.publishedfileid),
    name: item.title || `Item #${item.publishedfileid}`, summary: item.short_description || item.file_description || '',
    thumbnailUrl: item.preview_url || null, author: null,
    downloads: item.subscriptions || item.lifetime_subscriptions || 0, likes: item.vote_data?.votes_up || 0,
    updatedAt: toIso(item.time_updated, true), createdAt: toIso(item.time_created, true),
    categories: (item.tags || []).map((t) => t.tag || t.display_name).filter(Boolean),
    pageUrl: `https://steamcommunity.com/sharedfiles/filedetails/?id=${item.publishedfileid}`,
    _banned: !!item.banned || (item.result != null && item.result !== 1),
  };
}

// Nexus Mods (GraphQL v2, ver nexusService.searchMods).
function normalizeNexus(m, domain) {
  const d = m.game?.domainName || domain;
  return {
    key: `nexus:${d}:${m.modId}`, source: 'nexus', sourceId: `${d}:${m.modId}`,
    name: m.name || `Mod #${m.modId}`, summary: m.summary || '',
    thumbnailUrl: m.thumbnailUrl || m.pictureUrl || null,
    author: m.author || m.uploader?.name || null,
    downloads: m.downloads || 0, likes: m.endorsements || 0,
    updatedAt: toIso(m.updatedAt), createdAt: toIso(m.createdAt),
    categories: [m.modCategory?.name].filter(Boolean),
    pageUrl: `https://www.nexusmods.com/${d}/mods/${m.modId}`,
    version: m.version || null,
    _removed: m.status && m.status !== 'published',
  };
}

// ---------- Compatibilidade ----------
// status: 'compatible' | 'needs-loader' | 'incompatible'
function computeCompat(item, profile) {
  if (profile.blocked) return { status: 'incompatible', reason: profile.blocked };
  if (item._deprecated || item._obsolete) return { status: 'incompatible', reason: 'Marcado como obsoleto/desatualizado pelo autor' };
  if (item.source === 'workshop') {
    if (item._banned) return { status: 'incompatible', reason: 'Item removido do Steam Workshop' };
    return { status: 'compatible', reason: 'Baixado pela própria Steam ao se inscrever' };
  }
  if (item._removed) return { status: 'incompatible', reason: 'Mod oculto ou removido pelo autor' };
  if (item._notInstallable) return { status: 'incompatible', reason: item._notInstallable };
  if (item._noFile) return { status: 'incompatible', reason: 'Sem arquivo publicado' };
  if (item._unsafe) return { status: 'incompatible', reason: 'Arquivo marcado como inseguro pela fonte' };

  const ext = item._fileExt;
  if (ext && UNSUPPORTED_ARCHIVES.includes(ext)) return { status: 'incompatible', reason: `Formato não suportado (${ext})` };
  if (ext && (profile.unsupportedExts || []).includes(ext)) return { status: 'incompatible', reason: `Formato não suportado (${ext})` };
  if (ext && profile.installableExts && !profile.installableExts.includes(ext)) {
    return { status: 'incompatible', reason: `Formato não suportado neste jogo (${ext})` };
  }

  const loader = profile.loader;
  if (item._isLoader) return { status: 'compatible', reason: `É o ${loader?.label || 'loader'} deste jogo` };
  if (loader) {
    const needs = item._needsLoader || loader.required;
    if (needs) {
      if (loader.autoInstall && item.source === 'thunderstore') {
        return { status: 'needs-loader', reason: `Instala o ${loader.label} junto`, loader: loader.id, loaderLabel: loader.label, autoInstall: true };
      }
      return { status: 'needs-loader', reason: `Precisa do ${loader.label}`, loader: loader.id, loaderLabel: loader.label, autoInstall: false };
    }
  }
  return { status: 'compatible', reason: null };
}

// Tira os campos internos (_x) e acrescenta compatibilidade + forma de instalar.
function finalize(item, profile) {
  const compatibility = computeCompat(item, profile);
  const out = {};
  for (const [k, v] of Object.entries(item)) if (!k.startsWith('_')) out[k] = v;
  out.installMethod = item.source === 'workshop' ? 'steam-subscribe' : 'direct';
  out.compatibility = compatibility;
  if (item._isLoader) out.isLoader = true;
  if (item._dependencyCount) out.dependencyCount = item._dependencyCount;
  return out;
}

// ---------- Junção das fontes ----------
const SOURCE_PRIORITY = ['thunderstore', 'nexus', 'modio', 'gamebanana', 'workshop'];

function mergeResults(perSource, sort) {
  const lists = SOURCE_PRIORITY.map((s) => perSource[s] || []).filter((l) => l.length > 0);
  if (sort === 'downloads') return lists.flat().sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
  if (sort === 'new') return lists.flat().sort((a, b) => Date.parse(b.createdAt || b.updatedAt || 0) - Date.parse(a.createdAt || a.updatedAt || 0));
  if (sort === 'updated') return lists.flat().sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
  // "Populares": cada fonte mede popularidade de um jeito, então
  // intercala (1º de cada, 2º de cada...) em vez de comparar números.
  const out = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i += 1) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}

function normCategory(name) {
  return String(name || '').trim().toLowerCase();
}

// Lista única de categorias (nomes iguais de fontes diferentes viram uma só).
function mergeCategories(bySource) {
  const map = new Map();
  for (const [source, names] of Object.entries(bySource)) {
    for (const name of names || []) {
      const k = normCategory(name);
      if (!k) continue;
      if (!map.has(k)) map.set(k, { name: String(name).trim(), sources: [] });
      const entry = map.get(k);
      if (!entry.sources.includes(source)) entry.sources.push(source);
    }
  }
  return [...map.values()].sort((a, b) => b.sources.length - a.sources.length || a.name.localeCompare(b.name, 'pt-BR'));
}

// ---------- Identificação de nomes de arquivo/pasta ----------
// "MoreCompany.dll", "Improved_UI-1.4.2.pak", "[CP] Cool Mod" → forma
// compacta comparável com o nome do mod na fonte.
function normalizeModName(name) {
  let s = String(name || '').trim();
  s = s.replace(/\.(dll|pak|utoc|ucas|esp|esm|esl|bsa|ba2|zip|7z|tmod|archive|reds|asi|package|ts4script|vpk|gma|jar|scs|pack|crp)$/i, '');
  s = s.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ');
  s = s.replace(/[-_ .]v?\d+(\.\d+){1,3}[a-z0-9.-]*$/i, '');
  s = s.replace(/_p$/i, '');
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Thunderstore: pasta "Dono-Nome" (ou "Dono-Nome-1.2.3") → nome completo.
function thunderstoreFullNameOf(name) {
  const m = String(name || '').match(/^([A-Za-z0-9_]+)-([A-Za-z0-9_]+)(?:-\d+\.\d+\.\d+)?$/);
  return m ? `${m[1]}-${m[2]}` : null;
}

// Só aceita quando há UM candidato com o mesmo nome compacto (ou um
// muito mais popular que os outros) — melhor não identificar do que
// identificar errado.
function pickConfident(name, candidates) {
  const target = normalizeModName(name);
  if (target.length < 3) return null;
  const same = candidates.filter((c) => normalizeModName(c.name) === target);
  if (same.length === 1) return same[0];
  if (same.length > 1) {
    const sorted = [...same].sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
    if ((sorted[0].downloads || 0) >= 10 * Math.max(1, sorted[1].downloads || 0)) return sorted[0];
  }
  return null;
}

module.exports = {
  extOf, normalizeModio, normalizeThunderstore, normalizeGameBanana, normalizeWorkshop, normalizeNexus,
  computeCompat, finalize, mergeResults, mergeCategories, normCategory,
  normalizeModName, thunderstoreFullNameOf, pickConfident, getGameProfile,
};
