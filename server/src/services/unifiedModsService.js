// Busca UNIFICADA de mods de um jogo — item pedido: "em vez de mostrar
// separado por mod.io/GameBanana etc., mostre tudo junto, com as
// categorias de mods do jogo". Pergunta pra TODAS as fontes mapeadas pro
// steamAppId ao mesmo tempo (mod.io, Thunderstore, GameBanana, Steam
// Workshop), cada uma com tempo limite próprio — uma fonte fora do ar
// nunca derruba as outras — e devolve uma lista só, normalizada, com
// compatibilidade (ver modCompat.js). Reaproveita os serviços de cada
// fonte (mesmo cache Redis, mesmas chaves).
const prisma = require('../config/prisma');
const modio = require('./modioService');
const thunderstore = require('./thunderstoreService');
const gamebanana = require('./gamebananaService');
const workshop = require('./steamWorkshopService');
const nexus = require('./nexusService');
const compat = require('./modCompat');

const SOURCE_TIMEOUT_MS = 8000;
const PER_SOURCE_LIMIT = 12;

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} demorou demais pra responder`)), ms); }),
  ]);
}

async function findMappings(steamAppId, gameName) {
  const appId = Number(steamAppId);
  const names = [gameName, compat.getGameProfile(appId).name].filter(Boolean);
  const [m, w, g, t, n] = await Promise.all([
    prisma.modGameMapping.findFirst({ where: { steamAppId: appId, enabled: true } }),
    prisma.workshopGameMapping.findFirst({ where: { steamAppId: appId, enabled: true } }),
    prisma.gameBananaGameMapping.findFirst({ where: { steamAppId: appId, enabled: true } }),
    prisma.thunderstoreGameMapping.findFirst({ where: { steamAppId: appId, enabled: true } }),
    // Nexus Mods: sem tabela — acha o jogo sozinho pelo AppID/nome.
    nexus.resolveGame(appId, names).catch(() => null),
  ]);
  return {
    modio: m && modio.isConfigured() ? { gameId: m.modioGameId } : null,
    workshop: w && workshop.isConfigured() ? { appId: w.workshopAppId, note: w.note } : null,
    gamebanana: g ? { gameId: g.gameBananaGameId } : null,
    thunderstore: t ? { community: t.communityIdentifier } : null,
    nexus: n ? { domain: n.domain, gameId: n.gameId } : null,
  };
}

// Estado da paginação de cada fonte (offset/página/cursor), devolvido
// como um token opaco — o cliente só repassa no "Ver mais".
function decodeToken(token) {
  if (!token) return null;
  try { return JSON.parse(Buffer.from(String(token), 'base64url').toString('utf8')); } catch { return null; }
}
function encodeToken(state) {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
}

const GB_SORT = { popular: 'default', downloads: 'default', new: 'new', updated: 'new' };

// ---------- Categorias de cada fonte ----------
async function sourceCategories(source, mapping) {
  if (source === 'modio') {
    const d = await modio.getGameTags(mapping.gameId);
    return (d.data || []).filter((g) => !g.hidden).flatMap((g) => g.tags || []);
  }
  if (source === 'thunderstore') {
    const list = await thunderstore.fetchCategories(mapping.community);
    return list.map((c) => c.name);
  }
  if (source === 'gamebanana') {
    const list = await gamebanana.listCategories(mapping.gameId);
    return list.map((c) => c.name);
  }
  if (source === 'nexus') return nexus.listCategories(mapping.domain);
  if (source === 'workshop') {
    // A Web API pública não lista as tags do jogo — junta as tags dos
    // itens mais populares (já cacheados pela busca normal).
    const d = await workshop.queryFiles(mapping.appId, { sort: 'popular', limit: 50 });
    const counts = new Map();
    for (const item of d.publishedfiledetails || []) for (const t of item.tags || []) counts.set(t.tag, (counts.get(t.tag) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([tag]) => tag);
  }
  return [];
}

async function gameCategories(mappings) {
  const entries = Object.entries(mappings).filter(([, m]) => m);
  const results = await Promise.all(entries.map(async ([source, mapping]) => {
    try { return [source, await withTimeout(sourceCategories(source, mapping), SOURCE_TIMEOUT_MS, source)]; } catch { return [source, []]; }
  }));
  return Object.fromEntries(results);
}

// Nome da categoria escolhida do jeito que CADA fonte escreve (ou null
// se a fonte não tem essa categoria — aí ela fica de fora da busca).
function categoryFor(source, wanted, catsBySource) {
  if (!wanted) return undefined;
  const hit = (catsBySource[source] || []).find((c) => compat.normCategory(c) === compat.normCategory(wanted));
  return hit || null;
}

// ---------- Busca em cada fonte ----------
async function searchSource(source, mapping, { q, sort, category, state, profile }) {
  if (source === 'modio') {
    const d = await modio.listMods(mapping.gameId, { query: q, sort, category, offset: state.modio || 0, limit: PER_SOURCE_LIMIT });
    const items = (d.data || []).map(compat.normalizeModio);
    const next = (state.modio || 0) + items.length;
    return { items, total: d.result_total ?? null, nextState: next, done: items.length < PER_SOURCE_LIMIT || (d.result_total != null && next >= d.result_total) };
  }
  if (source === 'thunderstore') {
    // Busca em cima da lista completa cacheada; aqui inclui os
    // obsoletos também (aparecem como incompatíveis, não somem calados).
    const all = await thunderstore.fetchCommunityPackages(mapping.community);
    let list = all.map(thunderstore.normalizePackage).filter(Boolean);
    if (q) { const n = q.trim().toLowerCase(); list = list.filter((p) => p.name.toLowerCase().includes(n) || p.owner.toLowerCase().includes(n)); }
    if (category) list = list.filter((p) => p.categories.includes(category));
    const sorters = {
      popular: (a, b) => b.rating - a.rating,
      downloads: (a, b) => b.downloadCount - a.downloadCount,
      new: (a, b) => new Date(b.dateCreated) - new Date(a.dateCreated),
      updated: (a, b) => new Date(b.dateUpdated) - new Date(a.dateUpdated),
    };
    list.sort((a, b) => (a.isDeprecated - b.isDeprecated) || (b.isPinned - a.isPinned) || (sorters[sort] || sorters.popular)(a, b));
    const offset = state.thunderstore || 0;
    const page = list.slice(offset, offset + PER_SOURCE_LIMIT).map((p) => compat.normalizeThunderstore(p, profile));
    return { items: page, total: list.length, nextState: offset + page.length, done: offset + page.length >= list.length };
  }
  if (source === 'gamebanana') {
    const page = state.gamebanana || 1;
    const d = await gamebanana.browseOrSearch(mapping.gameId, { query: q, sort: GB_SORT[sort] || 'default', page, limit: PER_SOURCE_LIMIT });
    let items = (d._aRecords || d._aResults || []).map(compat.normalizeGameBanana);
    // Sem filtro de categoria na API de busca — filtra a página aqui.
    if (category) items = items.filter((i) => i.categories.some((c) => compat.normCategory(c) === compat.normCategory(category)));
    const raw = (d._aRecords || d._aResults || []).length;
    return { items, total: d._aMetadata?._nRecordCount ?? null, nextState: page + 1, done: d._aMetadata?._bIsComplete !== false || raw === 0 };
  }
  if (source === 'nexus') {
    const offset = state.nexus || 0;
    const d = await nexus.searchMods(mapping.domain, { q, sort, category, offset, count: PER_SOURCE_LIMIT });
    const items = d.nodes.map((m) => compat.normalizeNexus(m, mapping.domain));
    const next = offset + d.nodes.length;
    return { items, total: d.totalCount, nextState: next, done: d.nodes.length < PER_SOURCE_LIMIT || next >= d.totalCount };
  }
  if (source === 'workshop') {
    const cursor = state.workshop || '*';
    const d = await workshop.queryFiles(mapping.appId, { query: q, sort, cursor, limit: PER_SOURCE_LIMIT, requiredTags: category ? [category] : undefined });
    const items = (d.publishedfiledetails || []).map(compat.normalizeWorkshop);
    return { items, total: d.total ?? null, nextState: d.next_cursor || null, done: !d.next_cursor || items.length === 0 || d.next_cursor === cursor };
  }
  return { items: [], total: 0, done: true };
}

async function unifiedSearch(steamAppId, { q, category, sort = 'popular', pageToken, gameName } = {}) {
  const profile = compat.getGameProfile(steamAppId);
  const mappings = await findMappings(steamAppId, gameName);
  const first = !pageToken;
  const state = decodeToken(pageToken) || { done: [] };
  // Com filtro de categoria, precisa saber antes como cada fonte escreve
  // o nome dela; sem filtro, as categorias vêm em paralelo com a busca
  // (uma fonte lenta não soma o tempo duas vezes).
  const catsPromise = (first || category) ? gameCategories(mappings) : Promise.resolve({});
  const catsBySource = category ? await catsPromise : {};

  const sources = [];
  const perSource = {};
  const nextState = { ...state, done: [...(state.done || [])] };
  await Promise.all(Object.entries(mappings).map(async ([source, mapping]) => {
    if (!mapping) return;
    if (nextState.done.includes(source)) { sources.push({ source, ok: true, skipped: true }); return; }
    const cat = categoryFor(source, category, catsBySource);
    if (cat === null) { // a fonte não tem essa categoria
      nextState.done.push(source);
      sources.push({ source, ok: true, skipped: true, reason: 'sem essa categoria' });
      return;
    }
    try {
      const r = await withTimeout(searchSource(source, mapping, { q: q || undefined, sort, category: cat, state, profile }), SOURCE_TIMEOUT_MS, source);
      perSource[source] = r.items.map((i) => compat.finalize(i, profile));
      nextState[source] = r.nextState;
      if (r.done) nextState.done.push(source);
      sources.push({ source, ok: true, count: r.items.length, total: r.total });
    } catch (err) {
      // Uma fonte falhando não quebra as outras — a UI avisa qual caiu.
      nextState.done.push(source);
      sources.push({ source, ok: false, error: err.message });
    }
  }));

  const allCats = await catsPromise;
  const active = Object.entries(mappings).filter(([, m]) => m).map(([s]) => s);
  const hasMore = active.some((s) => !nextState.done.includes(s));
  return {
    items: compat.mergeResults(perSource, sort),
    categories: first ? compat.mergeCategories(allCats) : undefined,
    sources: sources.sort((a, b) => a.source.localeCompare(b.source)),
    nextPageToken: hasMore ? encodeToken(nextState) : null,
    profile: {
      name: profile.name, generic: profile.generic, blocked: profile.blocked || null,
      loader: profile.loader || null, loadOrderNote: profile.loadOrderNote || null,
    },
    workshopNote: mappings.workshop?.note || null,
  };
}

// ---------- Identificar mods detectados no disco ----------
const MAX_IDENTIFY = 60;

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (i < list.length) { const idx = i; i += 1; out[idx] = await fn(list[idx]); }
  });
  await Promise.all(workers);
  return out;
}

function brief(item, profile) {
  const f = compat.finalize(item, profile);
  return { key: f.key, source: f.source, sourceId: f.sourceId, name: f.name, thumbnailUrl: f.thumbnailUrl, author: f.author, summary: f.summary, pageUrl: f.pageUrl };
}

async function identify(steamAppId, rawNames, gameName) {
  const names = [...new Set((rawNames || []).map((n) => String(n || '').trim()).filter(Boolean))].slice(0, MAX_IDENTIFY);
  const profile = compat.getGameProfile(steamAppId);
  const mappings = await findMappings(steamAppId, gameName);
  const matches = Object.fromEntries(names.map((n) => [n, null]));

  // 1) Thunderstore: a lista inteira já está em cache — compara local.
  if (mappings.thunderstore) {
    try {
      const all = await withTimeout(thunderstore.fetchCommunityPackages(mappings.thunderstore.community), SOURCE_TIMEOUT_MS, 'thunderstore');
      const pkgs = all.map(thunderstore.normalizePackage).filter(Boolean);
      const byFull = new Map(pkgs.map((p) => [p.fullName.toLowerCase(), p]));
      for (const n of names) {
        const full = compat.thunderstoreFullNameOf(n);
        let hit = full ? byFull.get(full.toLowerCase()) : null;
        if (!hit) hit = compat.pickConfident(n, pkgs.filter((p) => !p.isDeprecated).map((p) => ({ ...p, downloads: p.downloadCount, _p: p })))?._p || null;
        if (hit) matches[n] = brief(compat.normalizeThunderstore(hit, profile), profile);
      }
    } catch { /* fonte fora do ar: segue com as outras */ }
  }

  // 2) mod.io e GameBanana: uma busca por nome (limitadas e em paralelo).
  const pending = () => names.filter((n) => !matches[n]).slice(0, 20);
  const searchName = (n) => n.replace(/\.[a-z0-9]{1,8}$/i, '').replace(/[_-]+/g, ' ').replace(/\s+v?\d+(\.\d+)+.*$/i, '').trim();
  if (mappings.modio) {
    await mapLimit(pending(), 4, async (n) => {
      try {
        const d = await withTimeout(modio.listMods(mappings.modio.gameId, { query: searchName(n), limit: 5 }), SOURCE_TIMEOUT_MS, 'modio');
        const cands = (d.data || []).map(compat.normalizeModio);
        const hit = compat.pickConfident(n, cands);
        if (hit) matches[n] = brief(hit, profile);
      } catch { /* ignora */ }
    });
  }
  if (mappings.gamebanana) {
    await mapLimit(pending(), 4, async (n) => {
      try {
        const d = await withTimeout(gamebanana.browseOrSearch(mappings.gamebanana.gameId, { query: searchName(n), limit: 5 }), SOURCE_TIMEOUT_MS, 'gamebanana');
        const cands = (d._aRecords || d._aResults || []).map(compat.normalizeGameBanana);
        const hit = compat.pickConfident(n, cands);
        if (hit) matches[n] = brief(hit, profile);
      } catch { /* ignora */ }
    });
  }
  if (mappings.nexus) {
    await mapLimit(pending(), 4, async (n) => {
      try {
        const d = await withTimeout(nexus.searchMods(mappings.nexus.domain, { q: searchName(n), count: 5 }), SOURCE_TIMEOUT_MS, 'nexus');
        const cands = d.nodes.map((m) => compat.normalizeNexus(m, mappings.nexus.domain));
        const hit = compat.pickConfident(n, cands);
        if (hit) matches[n] = brief(hit, profile);
      } catch { /* ignora */ }
    });
  }
  return { matches };
}

module.exports = { unifiedSearch, identify, findMappings, decodeToken, encodeToken };
