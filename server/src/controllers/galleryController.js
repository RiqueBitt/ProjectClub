const prisma = require('../config/prisma');
const { has } = require('../services/permissions');

// Galeria (round 7): curtidas, "mais curtidos" e álbuns. A lista normal
// da Galeria continua em channelController.listGallery; aqui só o que é
// novo. Mídias são identificadas por itemKey: "a:<anexo>" (canal) ou
// "p:<post>" (Fórum) — o mesmo id que a lista da Galeria já devolve.
const KEY_RE = /^[ap]:[A-Za-z0-9_-]{1,64}$/;
const GALLERY_MEDIA_RE = /^(image\/(png|jpe?g|gif|webp)|video\/(mp4|webm|quicktime))$/i;
const AUTHOR = { select: { id: true, displayName: true, avatarUrl: true, avatarDecoration: true } };
const isStaff = (user) => ['ADMIN', 'MODERATOR'].includes(user?.platformRole);

// Canais que a pessoa pode ver (mesmo critério da Galeria).
async function visibleChannelMap(userId) {
  const { getEffectivePermissions } = require('../services/authz');
  const channels = await prisma.channel.findMany({ select: { id: true, name: true, type: true, iconEmoji: true, iconUrl: true } });
  const out = {};
  for (const ch of channels) {
    // eslint-disable-next-line no-await-in-loop
    const perms = await getEffectivePermissions(userId, ch.id);
    if (has(perms, 'VIEW_CHANNEL')) out[ch.id] = ch;
  }
  return out;
}

// Transforma itemKeys em itens no MESMO formato da lista da Galeria,
// descartando o que a pessoa não pode ver ou que já foi apagado.
async function resolveItems(keys, userId) {
  const aIds = keys.filter((k) => k.startsWith('a:')).map((k) => k.slice(2));
  const pIds = keys.filter((k) => k.startsWith('p:')).map((k) => k.slice(2));
  const [byChannel, attachments, posts] = await Promise.all([
    aIds.length ? visibleChannelMap(userId) : {},
    aIds.length ? prisma.attachment.findMany({
      where: { id: { in: aIds }, isSpoiler: false },
      include: { message: { select: { id: true, channelId: true, deleted: true, createdAt: true, author: AUTHOR } } },
    }) : [],
    pIds.length ? prisma.post.findMany({
      where: { id: { in: pIds }, imageUrl: { not: null } },
      select: { id: true, title: true, imageUrl: true, createdAt: true, author: AUTHOR, community: { select: { slug: true, name: true } } },
    }) : [],
  ]);
  const map = {};
  for (const a of attachments) {
    if (!a.message || a.message.deleted || !a.message.channelId || !byChannel[a.message.channelId]) continue;
    if (!GALLERY_MEDIA_RE.test(a.mimeType || '')) continue;
    map[`a:${a.id}`] = {
      id: `a:${a.id}`,
      kind: a.mimeType.startsWith('video/') ? 'video' : (/gif$/i.test(a.mimeType) ? 'gif' : 'image'),
      url: a.url, filename: a.filename, source: 'channel',
      channel: byChannel[a.message.channelId], messageId: a.message.id,
      author: a.message.author, createdAt: a.message.createdAt,
    };
  }
  for (const p of posts) {
    map[`p:${p.id}`] = {
      id: `p:${p.id}`,
      kind: /\.gif(\?|$)/i.test(p.imageUrl) ? 'gif' : 'image',
      url: p.imageUrl, source: 'post', postId: p.id, title: p.title, club: p.community,
      author: p.author, createdAt: p.createdAt,
    };
  }
  return keys.map((k) => map[k]).filter(Boolean);
}

async function likeInfo(keys, userId) {
  if (!keys.length) return { counts: {}, mine: [] };
  const [grouped, mine] = await Promise.all([
    prisma.galleryLike.groupBy({ by: ['itemKey'], where: { itemKey: { in: keys } }, _count: { _all: true } }),
    prisma.galleryLike.findMany({ where: { itemKey: { in: keys }, userId }, select: { itemKey: true } }),
  ]);
  return {
    counts: Object.fromEntries(grouped.map((g) => [g.itemKey, g._count._all])),
    mine: mine.map((m) => m.itemKey),
  };
}

const cleanKeys = (list) => [...new Set((Array.isArray(list) ? list : []).map(String).filter((k) => KEY_RE.test(k)))].slice(0, 200);

// POST /api/gallery/likes/lookup { keys } → { counts, mine }
async function lookupLikes(req, res, next) {
  try {
    res.json(await likeInfo(cleanKeys(req.body?.keys), req.user.id));
  } catch (err) { next(err); }
}

// POST /api/gallery/likes/toggle { key } → { liked, count }
async function toggleLike(req, res, next) {
  try {
    const key = String(req.body?.key || '');
    if (!KEY_RE.test(key)) return res.status(400).json({ error: 'Mídia inválida.' });
    const [item] = await resolveItems([key], req.user.id);
    if (!item) return res.status(404).json({ error: 'Essa mídia não existe mais.' });
    const where = { itemKey_userId: { itemKey: key, userId: req.user.id } };
    const existing = await prisma.galleryLike.findUnique({ where });
    if (existing) await prisma.galleryLike.delete({ where });
    else {
      await prisma.galleryLike.create({ data: { itemKey: key, userId: req.user.id } }).catch((e) => {
        if (e?.code !== 'P2002') throw e; // clique duplo: já curtiu
      });
    }
    const count = await prisma.galleryLike.count({ where: { itemKey: key } });
    req.app.get('io')?.to('community').emit('gallery:like', { key, count });
    res.json({ liked: !existing, count });
  } catch (err) { next(err); }
}

// GET /api/gallery/top?kind=&limit= → mídias mais curtidas (com contagem).
async function topLiked(req, res, next) {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 48, 1), 96);
    const grouped = await prisma.galleryLike.groupBy({
      by: ['itemKey'], _count: { _all: true },
      orderBy: { _count: { itemKey: 'desc' } },
      take: limit * 2, // sobra pra descartar o que a pessoa não pode ver
    });
    const keys = grouped.map((g) => g.itemKey);
    const items = (await resolveItems(keys, req.user.id)).slice(0, limit);
    const info = await likeInfo(items.map((i) => i.id), req.user.id);
    res.json({ items, ...info });
  } catch (err) { next(err); }
}

// ---------- Álbuns ----------
// Qualquer pessoa pode criar um álbum (público, todo mundo vê); só quem
// criou ou a staff edita, adiciona ou tira mídias.
const canEdit = (album, user) => album.createdById === user.id || isStaff(user);

async function shapeAlbums(albums, userId) {
  const creatorIds = [...new Set(albums.map((a) => a.createdById))];
  const creators = creatorIds.length ? await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: AUTHOR.select }) : [];
  const byId = Object.fromEntries(creators.map((u) => [u.id, u]));
  // Capa: as 4 mídias mais novas que a pessoa pode ver.
  const coverKeys = albums.flatMap((a) => (a.items || []).map((i) => i.itemKey));
  const resolved = coverKeys.length ? await resolveItems([...new Set(coverKeys)], userId) : [];
  const rById = Object.fromEntries(resolved.map((r) => [r.id, r]));
  return albums.map((a) => ({
    id: a.id, name: a.name, description: a.description, createdAt: a.createdAt, updatedAt: a.updatedAt,
    createdBy: byId[a.createdById] || null,
    count: a._count?.items ?? (a.items || []).length,
    covers: (a.items || []).map((i) => rById[i.itemKey]).filter(Boolean).slice(0, 4).map((r) => ({ url: r.url, kind: r.kind })),
  }));
}

async function listAlbums(req, res, next) {
  try {
    const albums = await prisma.galleryAlbum.findMany({
      orderBy: { updatedAt: 'desc' }, take: 100,
      include: { _count: { select: { items: true } }, items: { orderBy: { createdAt: 'desc' }, take: 6, select: { itemKey: true } } },
    });
    const shaped = await shapeAlbums(albums, req.user.id);
    res.json({ albums: shaped.map((a, i) => ({ ...a, canEdit: canEdit(albums[i], req.user) })) });
  } catch (err) { next(err); }
}

async function getAlbum(req, res, next) {
  try {
    const album = await prisma.galleryAlbum.findUnique({
      where: { id: req.params.id },
      include: { items: { orderBy: { createdAt: 'desc' }, take: 500 } },
    });
    if (!album) return res.status(404).json({ error: 'Álbum não encontrado.' });
    const items = await resolveItems(album.items.map((i) => i.itemKey), req.user.id);
    const entryByKey = Object.fromEntries(album.items.map((i) => [i.itemKey, i.id]));
    const info = await likeInfo(items.map((i) => i.id), req.user.id);
    const [shaped] = await shapeAlbums([{ ...album, items: album.items.slice(0, 6) }], req.user.id);
    res.json({
      album: { ...shaped, count: items.length, canEdit: canEdit(album, req.user) },
      items: items.map((i) => ({ ...i, entryId: entryByKey[i.id] })),
      ...info,
    });
  } catch (err) { next(err); }
}

function readAlbumFields(body, partial) {
  const data = {};
  if (body.name !== undefined || !partial) {
    const name = String(body.name || '').trim().slice(0, 60);
    if (!name) throw Object.assign(new Error('Dê um nome pro álbum.'), { status: 400 });
    data.name = name;
  }
  if (body.description !== undefined) data.description = String(body.description || '').trim().slice(0, 300) || null;
  return data;
}

async function createAlbum(req, res, next) {
  try {
    const data = readAlbumFields(req.body || {}, false);
    const mine = await prisma.galleryAlbum.count({ where: { createdById: req.user.id } });
    if (mine >= 30 && !isStaff(req.user)) return res.status(400).json({ error: 'Você já tem 30 álbuns. Apague um pra criar outro.' });
    const album = await prisma.galleryAlbum.create({ data: { ...data, createdById: req.user.id } });
    const [shaped] = await shapeAlbums([{ ...album, items: [], _count: { items: 0 } }], req.user.id);
    res.status(201).json({ album: { ...shaped, canEdit: true } });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

async function loadEditable(req, res) {
  const album = await prisma.galleryAlbum.findUnique({ where: { id: req.params.id } });
  if (!album) { res.status(404).json({ error: 'Álbum não encontrado.' }); return null; }
  if (!canEdit(album, req.user)) { res.status(403).json({ error: 'Só quem criou o álbum pode mudar ele.' }); return null; }
  return album;
}

async function updateAlbum(req, res, next) {
  try {
    if (!(await loadEditable(req, res))) return;
    const data = readAlbumFields(req.body || {}, true);
    const album = await prisma.galleryAlbum.update({ where: { id: req.params.id }, data });
    res.json({ album });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

async function deleteAlbum(req, res, next) {
  try {
    if (!(await loadEditable(req, res))) return;
    await prisma.galleryAlbum.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// POST /api/gallery/albums/:id/items { key }
async function addAlbumItem(req, res, next) {
  try {
    const album = await loadEditable(req, res);
    if (!album) return;
    const key = String(req.body?.key || '');
    if (!KEY_RE.test(key)) return res.status(400).json({ error: 'Mídia inválida.' });
    const [item] = await resolveItems([key], req.user.id);
    if (!item) return res.status(404).json({ error: 'Essa mídia não existe mais.' });
    const count = await prisma.galleryAlbumItem.count({ where: { albumId: album.id } });
    if (count >= 500) return res.status(400).json({ error: 'Esse álbum já está cheio (500 mídias).' });
    try {
      await prisma.galleryAlbumItem.create({
        data: { albumId: album.id, itemKey: key, url: String(item.url).slice(0, 2000), kind: item.kind, title: item.title ? String(item.title).slice(0, 180) : null, addedById: req.user.id },
      });
    } catch (e) {
      if (e?.code === 'P2002') return res.status(409).json({ error: 'Essa mídia já está no álbum.' });
      throw e;
    }
    await prisma.galleryAlbum.update({ where: { id: album.id }, data: { updatedAt: new Date() } });
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
}

// DELETE /api/gallery/albums/:id/items/:key  (key = itemKey, ex: a:123)
async function removeAlbumItem(req, res, next) {
  try {
    const album = await loadEditable(req, res);
    if (!album) return;
    await prisma.galleryAlbumItem.deleteMany({ where: { albumId: album.id, itemKey: String(req.params.key) } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = {
  lookupLikes, toggleLike, topLiked,
  listAlbums, getAlbum, createAlbum, updateAlbum, deleteAlbum, addAlbumItem, removeAlbumItem,
  resolveItems,
};
