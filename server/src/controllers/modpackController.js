const prisma = require('../config/prisma');

// Item pedido: "sistema de criar modpacks e postar pra outras pessoas
// baixarem — dá pra dar like, dislike e ver quantas pessoas já
// baixaram". Funciona pra QUALQUER jogo (chave = steamAppId) e qualquer
// fonte de mods. Os itens ficam num JSON em SharedModpack.items (ver
// schema.prisma) — o download de verdade acontece no app desktop, item
// por item, com o instalador de cada fonte; aqui só guardamos a lista e
// contamos votos/downloads.

const SOURCES = ['modio', 'thunderstore', 'gamebanana', 'workshop', 'nexus', 'local'];
const MAX_ITEMS = 200;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 2000;
const PAGE_SIZE = 24;
const AUTHOR_SELECT = { id: true, displayName: true, username: true, avatarUrl: true, avatarDecoration: true, profileColor: true };

function cleanString(value, max) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

// Só http(s) ou caminho do próprio site (/uploads..., upload de capa) —
// nada de javascript:/data: vindo de fora.
function cleanUrl(value) {
  const url = cleanString(value, 1000);
  return /^https?:\/\//i.test(url) || /^\/(?!\/)/.test(url) ? url : null;
}

// Um mod avulso (item de modpack OU "mod preferido" do perfil).
function sanitizeMod(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const source = SOURCES.includes(raw.source) ? raw.source : null;
  const sourceId = cleanString(raw.sourceId, 200);
  const name = cleanString(raw.name, 200);
  if (!source || !sourceId || !name) return null;
  const mod = { source, sourceId, name };
  const thumbnailUrl = cleanUrl(raw.thumbnailUrl);
  if (thumbnailUrl) mod.thumbnailUrl = thumbnailUrl;
  const version = cleanString(raw.version, 60);
  if (version) mod.version = version;
  return mod;
}

// Lista de itens: descarta o que for inválido e tira duplicata
// (mesma fonte + mesmo id).
function sanitizeItems(raw) {
  if (!Array.isArray(raw)) return null;
  const seen = new Set();
  const items = [];
  for (const entry of raw) {
    const mod = sanitizeMod(entry);
    if (!mod) continue;
    const key = `${mod.source}:${mod.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(mod);
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

function parseItems(text) {
  try {
    const parsed = JSON.parse(text || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

// Formato devolvido pro cliente. `full` = com a lista de itens (nas
// listagens também vai, é pequena; no perfil não precisa).
function serialize(mp, { myVote = 0, downloadedByMe = false, withItems = true } = {}) {
  const items = parseItems(mp.items);
  const out = {
    id: mp.id,
    authorId: mp.authorId,
    author: mp.author || null,
    steamAppId: mp.steamAppId,
    gameName: mp.gameName,
    name: mp.name,
    description: mp.description,
    coverUrl: mp.coverUrl || items.find((i) => i.thumbnailUrl)?.thumbnailUrl || null,
    hasCustomCover: !!mp.coverUrl,
    isPublic: mp.isPublic,
    likeCount: mp.likeCount,
    dislikeCount: mp.dislikeCount,
    downloadCount: mp.downloadCount,
    itemCount: items.length,
    downloadableCount: items.filter((i) => i.source !== 'local').length,
    myVote,
    downloadedByMe,
    createdAt: mp.createdAt,
    updatedAt: mp.updatedAt,
  };
  if (withItems) out.items = items;
  return out;
}

// Junta o voto/download de quem está vendo em cada modpack da lista
// (2 queries no total, não 2 por modpack).
async function withViewerState(userId, modpacks) {
  if (modpacks.length === 0) return [];
  const ids = modpacks.map((m) => m.id);
  const [votes, downloads] = await Promise.all([
    prisma.sharedModpackVote.findMany({ where: { userId, modpackId: { in: ids } }, select: { modpackId: true, value: true } }),
    prisma.sharedModpackDownload.findMany({ where: { userId, modpackId: { in: ids } }, select: { modpackId: true } }),
  ]);
  const voteBy = Object.fromEntries(votes.map((v) => [v.modpackId, v.value]));
  const dlSet = new Set(downloads.map((d) => d.modpackId));
  return modpacks.map((m) => serialize(m, { myVote: voteBy[m.id] || 0, downloadedByMe: dlSet.has(m.id) }));
}

function parseAppId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Modpack que a pessoa pode VER: público, ou dela mesma.
async function findVisible(id, userId) {
  const mp = await prisma.sharedModpack.findUnique({ where: { id }, include: { author: { select: AUTHOR_SELECT } } });
  if (!mp) return null;
  if (!mp.isPublic && mp.authorId !== userId) return null;
  return mp;
}

// GET /modpacks?steamAppId=&q=&sort=popular|new|downloads&page=
async function listPublic(req, res, next) {
  try {
    const where = { isPublic: true };
    const appId = parseAppId(req.query.steamAppId);
    if (req.query.steamAppId !== undefined && !appId) return res.status(400).json({ error: 'steamAppId inválido.' });
    if (appId) where.steamAppId = appId;
    const q = cleanString(req.query.q, 80);
    if (q) where.OR = [{ name: { contains: q } }, { description: { contains: q } }];

    const sort = ['popular', 'new', 'downloads'].includes(req.query.sort) ? req.query.sort : 'popular';
    const orderBy = sort === 'new'
      ? [{ createdAt: 'desc' }]
      : sort === 'downloads'
        ? [{ downloadCount: 'desc' }, { likeCount: 'desc' }, { createdAt: 'desc' }]
        : [{ likeCount: 'desc' }, { downloadCount: 'desc' }, { createdAt: 'desc' }];

    const page = Math.max(1, Math.min(500, Number.parseInt(req.query.page, 10) || 1));
    const [total, rows] = await Promise.all([
      prisma.sharedModpack.count({ where }),
      prisma.sharedModpack.findMany({
        where, orderBy, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE,
        include: { author: { select: AUTHOR_SELECT } },
      }),
    ]);
    const modpacks = await withViewerState(req.user.id, rows);
    res.json({ modpacks, total, page, hasMore: page * PAGE_SIZE < total });
  } catch (err) { next(err); }
}

// GET /modpacks/mine?steamAppId= — todos os meus (públicos e privados).
async function listMine(req, res, next) {
  try {
    const where = { authorId: req.user.id };
    const appId = parseAppId(req.query.steamAppId);
    if (appId) where.steamAppId = appId;
    const rows = await prisma.sharedModpack.findMany({
      where, orderBy: { updatedAt: 'desc' }, take: 200,
      include: { author: { select: AUTHOR_SELECT } },
    });
    res.json({ modpacks: await withViewerState(req.user.id, rows) });
  } catch (err) { next(err); }
}

// GET /modpacks/user/:userId — só os públicos (a menos que seja eu).
async function listByUser(req, res, next) {
  try {
    const { userId } = req.params;
    const where = { authorId: userId };
    if (userId !== req.user.id) where.isPublic = true;
    const rows = await prisma.sharedModpack.findMany({
      where, orderBy: { updatedAt: 'desc' }, take: 100,
      include: { author: { select: AUTHOR_SELECT } },
    });
    res.json({ modpacks: await withViewerState(req.user.id, rows) });
  } catch (err) { next(err); }
}

// GET /modpacks/:id
async function getOne(req, res, next) {
  try {
    const mp = await findVisible(req.params.id, req.user.id);
    if (!mp) return res.status(404).json({ error: 'Modpack não encontrado.' });
    const [modpack] = await withViewerState(req.user.id, [mp]);
    res.json({ modpack });
  } catch (err) { next(err); }
}

// Valida o corpo de criar/editar. `partial` = edição (campos opcionais).
function readBody(body, partial) {
  const data = {};
  const errors = [];
  if (!partial || body.name !== undefined) {
    const name = cleanString(body.name, MAX_NAME);
    if (!name) errors.push('Dê um nome pro modpack.');
    data.name = name;
  }
  if (body.description !== undefined) {
    const description = cleanString(body.description, MAX_DESCRIPTION);
    data.description = description || null;
  }
  if (body.isPublic !== undefined) data.isPublic = !!body.isPublic;
  if (body.coverUrl !== undefined) data.coverUrl = body.coverUrl ? cleanUrl(body.coverUrl) : null;
  if (!partial || body.items !== undefined) {
    const items = sanitizeItems(body.items === undefined ? [] : body.items);
    if (!items) errors.push('Lista de mods inválida.');
    else data.items = JSON.stringify(items);
  }
  if (!partial) {
    const appId = parseAppId(body.steamAppId);
    if (!appId) errors.push('Jogo inválido.');
    data.steamAppId = appId;
    data.gameName = cleanString(body.gameName, 120) || `App ${appId}`;
  }
  return { data, error: errors[0] || null };
}

// POST /modpacks
async function create(req, res, next) {
  try {
    const { data, error } = readBody(req.body || {}, false);
    if (error) return res.status(400).json({ error });
    const count = await prisma.sharedModpack.count({ where: { authorId: req.user.id } });
    if (count >= 100) return res.status(400).json({ error: 'Você chegou ao limite de 100 modpacks.' });
    const mp = await prisma.sharedModpack.create({
      data: { ...data, authorId: req.user.id },
      include: { author: { select: AUTHOR_SELECT } },
    });
    res.status(201).json({ modpack: serialize(mp) });
  } catch (err) { next(err); }
}

// PATCH /modpacks/:id (só o dono)
async function update(req, res, next) {
  try {
    const existing = await prisma.sharedModpack.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.authorId !== req.user.id) return res.status(404).json({ error: 'Modpack não encontrado.' });
    const { data, error } = readBody(req.body || {}, true);
    if (error) return res.status(400).json({ error });
    const mp = await prisma.sharedModpack.update({
      where: { id: existing.id }, data,
      include: { author: { select: AUTHOR_SELECT } },
    });
    const [modpack] = await withViewerState(req.user.id, [mp]);
    res.json({ modpack });
  } catch (err) { next(err); }
}

// POST /modpacks/:id/cover (multipart, campo "cover") — capa própria.
async function uploadCover(req, res, next) {
  try {
    const existing = await prisma.sharedModpack.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.authorId !== req.user.id) return res.status(404).json({ error: 'Modpack não encontrado.' });
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    const mp = await prisma.sharedModpack.update({
      where: { id: existing.id }, data: { coverUrl: req.file.url },
      include: { author: { select: AUTHOR_SELECT } },
    });
    const [modpack] = await withViewerState(req.user.id, [mp]);
    res.json({ modpack });
  } catch (err) { next(err); }
}

// DELETE /modpacks/:id (só o dono) — quem tinha ele como "preferido"
// fica sem (onDelete: SetNull no schema).
async function remove(req, res, next) {
  try {
    const existing = await prisma.sharedModpack.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.authorId !== req.user.id) return res.status(404).json({ error: 'Modpack não encontrado.' });
    await prisma.sharedModpack.delete({ where: { id: existing.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// Quanto cada contador muda ao trocar o voto `before` -> `after`
// (cada um é -1, 0 ou +1). Separado pra dar pra testar sozinho.
function voteDelta(before, after) {
  return {
    like: (after === 1 ? 1 : 0) - (before === 1 ? 1 : 0),
    dislike: (after === -1 ? 1 : 0) - (before === -1 ? 1 : 0),
  };
}

// POST /modpacks/:id/vote { value: 1 | -1 | 0 } — votar de novo no
// mesmo valor tira o voto (igual like de perfil); valor oposto troca.
// Voto + contadores na MESMA transação, pra nunca descasar.
async function vote(req, res, next) {
  try {
    const raw = Number(req.body?.value);
    if (![1, -1, 0].includes(raw)) return res.status(400).json({ error: 'Voto inválido.' });
    const mp = await findVisible(req.params.id, req.user.id);
    if (!mp || !mp.isPublic) return res.status(404).json({ error: 'Modpack não encontrado.' });
    if (mp.authorId === req.user.id) return res.status(400).json({ error: 'Você não pode votar no seu próprio modpack.' });

    const run = () => prisma.$transaction(async (tx) => {
      const key = { modpackId_userId: { modpackId: mp.id, userId: req.user.id } };
      const existing = await tx.sharedModpackVote.findUnique({ where: key });
      const before = existing?.value || 0;
      const after = raw === 0 || raw === before ? 0 : raw;
      if (after === 0 && existing) await tx.sharedModpackVote.delete({ where: key });
      else if (after !== 0 && existing) await tx.sharedModpackVote.update({ where: key, data: { value: after } });
      else if (after !== 0) await tx.sharedModpackVote.create({ data: { modpackId: mp.id, userId: req.user.id, value: after } });
      const d = voteDelta(before, after);
      const updated = (d.like || d.dislike)
        ? await tx.sharedModpack.update({
          where: { id: mp.id },
          data: { likeCount: { increment: d.like }, dislikeCount: { increment: d.dislike } },
          select: { likeCount: true, dislikeCount: true },
        })
        : { likeCount: mp.likeCount, dislikeCount: mp.dislikeCount };
      return { likeCount: Math.max(0, updated.likeCount), dislikeCount: Math.max(0, updated.dislikeCount), myVote: after };
    });

    let result;
    try { result = await run(); } catch (err) {
      // Dois cliques ao mesmo tempo: o segundo bate no @@unique — tenta de novo uma vez.
      if (err.code !== 'P2002') throw err;
      result = await run();
    }
    res.json(result);
  } catch (err) { next(err); }
}

// POST /modpacks/:id/download — chamado pelo cliente DEPOIS de baixar.
// Conta pessoas, não cliques; o autor baixando o próprio não conta.
async function registerDownload(req, res, next) {
  try {
    const mp = await findVisible(req.params.id, req.user.id);
    if (!mp) return res.status(404).json({ error: 'Modpack não encontrado.' });
    if (mp.authorId === req.user.id) return res.json({ downloadCount: mp.downloadCount, counted: false });
    const result = await prisma.$transaction(async (tx) => {
      const already = await tx.sharedModpackDownload.findUnique({ where: { modpackId_userId: { modpackId: mp.id, userId: req.user.id } } });
      if (already) return { downloadCount: mp.downloadCount, counted: false };
      await tx.sharedModpackDownload.create({ data: { modpackId: mp.id, userId: req.user.id } });
      const updated = await tx.sharedModpack.update({ where: { id: mp.id }, data: { downloadCount: { increment: 1 } }, select: { downloadCount: true } });
      return { downloadCount: updated.downloadCount, counted: true };
    }).catch((err) => {
      if (err.code === 'P2002') return { downloadCount: mp.downloadCount, counted: false };
      throw err;
    });
    res.json(result);
  } catch (err) { next(err); }
}

// Item pedido: coluna "Modpack preferido" do perfil.
// PUT /modpacks/featured  { modpackId } | { mod: {..., steamAppId, gameName} } | {} (limpa)
async function setFeatured(req, res, next) {
  try {
    const { modpackId, mod } = req.body || {};
    const data = { featuredModpackId: null, featuredModJson: null };
    if (modpackId) {
      const mp = await prisma.sharedModpack.findUnique({ where: { id: String(modpackId) }, select: { id: true, authorId: true } });
      if (!mp || mp.authorId !== req.user.id) return res.status(404).json({ error: 'Modpack não encontrado.' });
      data.featuredModpackId = mp.id;
    } else if (mod) {
      const clean = sanitizeMod(mod);
      if (!clean) return res.status(400).json({ error: 'Mod inválido.' });
      const appId = parseAppId(mod.steamAppId);
      if (appId) clean.steamAppId = appId;
      const gameName = cleanString(mod.gameName, 120);
      if (gameName) clean.gameName = gameName;
      data.featuredModJson = JSON.stringify(clean);
    }
    await prisma.user.update({ where: { id: req.user.id }, data });
    const featured = await getFeaturedForProfile(req.user.id, req.user.id);
    res.json({ featured });
  } catch (err) { next(err); }
}

// Usado pelo getUser (userController) — o que mostrar no card "Modpack
// preferido". Um modpack privado só aparece pro próprio dono.
async function getFeaturedForProfile(userId, viewerId) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { featuredModpackId: true, featuredModJson: true } });
  if (!u) return null;
  if (u.featuredModpackId) {
    const mp = await prisma.sharedModpack.findUnique({ where: { id: u.featuredModpackId }, include: { author: { select: AUTHOR_SELECT } } });
    if (!mp || (!mp.isPublic && userId !== viewerId)) return null;
    const [modpack] = viewerId ? await withViewerState(viewerId, [mp]) : [serialize(mp)];
    return { type: 'modpack', modpack };
  }
  if (u.featuredModJson) {
    try {
      const mod = JSON.parse(u.featuredModJson);
      if (mod && mod.name) return { type: 'mod', mod };
    } catch { /* JSON inválido — trata como vazio */ }
  }
  return null;
}

module.exports = {
  listPublic, listMine, listByUser, getOne, create, update, uploadCover, remove, vote, registerDownload, setFeatured,
  getFeaturedForProfile,
  // exportados pra teste
  _internals: { sanitizeItems, sanitizeMod, voteDelta, serialize },
};
