const prisma = require('../config/prisma');
const activityStore = require('../services/activityStore');

// Página "Atividade": linha do tempo do que os AMIGOS andaram fazendo —
// jogando agora (atividade detectada pelo app de desktop), posts novos no
// Feed, modpacks publicados/atualizados, conquistas e subidas de nível.
// Tudo montado a partir das tabelas que já existem; só nível e
// "Comemorar" ficam em ActivityEvent (não eram guardados em lugar nenhum).
//
// Privacidade: só amigos aceitos. Jogo/conquista/nível respeitam
// "Compartilhar atividade" (activitySharing) e a visibilidade da atividade
// (activityVisibility = 'none' esconde). Posts e modpacks públicos já são
// públicos no app, então aparecem sempre.

const USER_FIELDS = { id: true, username: true, displayName: true, avatarUrl: true, avatarDecoration: true, profileColor: true, accountLevel: true };
const PAGE = 40;
const ITEM_KEY_RE = /^(ach|lvl|post|mp):([A-Za-z0-9-]{1,64})$/;

async function friendIdsOf(userId) {
  const rows = await prisma.friendship.findMany({
    where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] },
    select: { requesterId: true, addresseeId: true },
  });
  return rows.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId));
}

// Quem deixa a atividade ser vista pelos amigos.
async function sharingIds(ids) {
  if (ids.length === 0) return new Set();
  const settings = await prisma.userSettings.findMany({
    where: { userId: { in: ids } },
    select: { userId: true, activitySharing: true, activityVisibility: true },
  });
  const by = Object.fromEntries(settings.map((s) => [s.userId, s]));
  return new Set(ids.filter((id) => by[id]?.activitySharing !== false && (by[id]?.activityVisibility || 'everyone') !== 'none'));
}

function parseJson(raw) {
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

// Arte do jogo: o app de desktop manda o header antigo da Steam
// (…/steam/apps/<appid>/header.jpg), que dá 404 em muitos jogos — troca
// pelo proxy que descobre o arquivo certo.
function steamAppIdFrom(url) {
  const m = typeof url === 'string' && url.match(/\/steam\/apps\/(\d+)\//);
  return m ? Number(m[1]) : null;
}

function cleanActivity(a) {
  if (!a) return null;
  const appId = a.type === 'game' ? steamAppIdFrom(a.imageUrl) : null;
  let imageUrl = appId ? `/api/proxy/steam/${appId}/header` : a.imageUrl || null;
  if (imageUrl && imageUrl.startsWith('data:') && imageUrl.length > 60000) imageUrl = null; // capa gigante não vai na lista
  return { type: a.type, name: a.name, detail: a.detail || null, imageUrl, steamAppId: appId, startedAt: a.startedAt || null };
}

// GET /activity/feed?before=<ISO>
async function getFeed(req, res, next) {
  try {
    const me = req.user.id;
    const before = req.query.before ? new Date(req.query.before) : null;
    const dateFilter = before && !isNaN(before.getTime()) ? { lt: before } : undefined;
    const friendIds = await friendIdsOf(me);
    if (friendIds.length === 0) return res.json({ items: [], now: [], nextBefore: null, friendCount: 0 });
    const sharing = [...(await sharingIds(friendIds))];

    const [posts, modpacks, unlocks, events] = await Promise.all([
      prisma.post.findMany({
        where: { authorId: { in: friendIds }, ...(dateFilter ? { createdAt: dateFilter } : {}) },
        orderBy: { createdAt: 'desc' },
        take: PAGE,
        select: {
          id: true, title: true, type: true, content: true, imageUrl: true, score: true, commentCount: true, createdAt: true, authorId: true,
          community: { select: { slug: true, name: true, iconUrl: true } },
        },
      }),
      prisma.sharedModpack.findMany({
        where: { authorId: { in: friendIds }, isPublic: true, ...(dateFilter ? { updatedAt: dateFilter } : {}) },
        orderBy: { updatedAt: 'desc' },
        take: 20,
        select: { id: true, name: true, gameName: true, steamAppId: true, coverUrl: true, downloadCount: true, likeCount: true, createdAt: true, updatedAt: true, authorId: true },
      }),
      sharing.length ? prisma.userAchievement.findMany({
        where: { userId: { in: sharing }, ...(dateFilter ? { unlockedAt: dateFilter } : {}) },
        orderBy: { unlockedAt: 'desc' },
        take: PAGE,
      }) : [],
      sharing.length ? prisma.activityEvent.findMany({
        where: { userId: { in: sharing }, type: { in: ['LEVEL_UP', 'CELEBRATE'] }, ...(dateFilter ? { createdAt: dateFilter } : {}) },
        orderBy: { createdAt: 'desc' },
        take: PAGE * 2,
      }) : [],
    ]);

    const achDefs = unlocks.length
      ? await prisma.achievement.findMany({ where: { key: { in: [...new Set(unlocks.map((u) => u.achievementId))] } } })
      : [];
    const achByKey = Object.fromEntries(achDefs.map((a) => [a.key, a]));
    const celebrated = new Set(events.filter((e) => e.type === 'CELEBRATE').map((e) => parseJson(e.data).itemKey).filter(Boolean));

    const items = [];
    for (const p of posts) {
      items.push({
        key: `post:${p.id}`, type: 'post', at: p.createdAt, userId: p.authorId,
        post: { id: p.id, title: p.title, type: p.type, excerpt: (p.content || '').slice(0, 180), imageUrl: p.imageUrl, score: p.score, commentCount: p.commentCount, community: p.community },
      });
    }
    for (const m of modpacks) {
      const updated = new Date(m.updatedAt).getTime() - new Date(m.createdAt).getTime() > 60_000;
      items.push({
        key: `mp:${m.id}`, type: 'modpack', at: m.updatedAt, userId: m.authorId, updated,
        modpack: { id: m.id, name: m.name, gameName: m.gameName, steamAppId: m.steamAppId, coverUrl: m.coverUrl, downloadCount: m.downloadCount, likeCount: m.likeCount },
      });
    }
    for (const u of unlocks) {
      const def = achByKey[u.achievementId];
      if (!def || def.enabled === false) continue;
      items.push({
        key: `ach:${u.id}`, type: 'achievement', at: u.unlockedAt, userId: u.userId,
        achievement: { key: def.key, name: def.name, description: def.description, rarity: def.rarity, iconUrl: def.iconUrl },
      });
    }
    for (const e of events) {
      if (e.type !== 'LEVEL_UP') continue;
      const d = parseJson(e.data);
      items.push({ key: `lvl:${e.id}`, type: 'level', at: e.createdAt, userId: e.userId, level: { level: d.level, levelName: d.levelName } });
    }
    items.sort((a, b) => new Date(b.at) - new Date(a.at));
    const page = items.slice(0, PAGE);

    // "Parabéns" (contagem, se eu já dei e alguns rostos).
    const keys = page.map((i) => i.key);
    const cheers = keys.length ? await prisma.activityCheer.findMany({ where: { itemKey: { in: keys } }, orderBy: { createdAt: 'desc' } }) : [];
    const cheerBy = {};
    for (const c of cheers) {
      const b = cheerBy[c.itemKey] || (cheerBy[c.itemKey] = { count: 0, mine: false, userIds: [] });
      b.count += 1;
      if (c.userId === me) b.mine = true;
      if (b.userIds.length < 3) b.userIds.push(c.userId);
    }

    // Jogando agora (só quem compartilha atividade).
    const nowRaw = await Promise.all(sharing.map(async (uid) => [uid, await activityStore.getActivity(uid).catch(() => null)]));
    const nowList = nowRaw.filter(([, a]) => a).map(([userId, a]) => ({ userId, activity: cleanActivity(a) }));

    const userIds = new Set([...page.map((i) => i.userId), ...nowList.map((n) => n.userId), ...Object.values(cheerBy).flatMap((b) => b.userIds)]);
    const users = await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: USER_FIELDS });
    const userBy = Object.fromEntries(users.map((u) => [u.id, u]));

    res.json({
      friendCount: friendIds.length,
      now: nowList.filter((n) => userBy[n.userId]).map((n) => ({ user: userBy[n.userId], activity: n.activity })),
      items: page.filter((i) => userBy[i.userId]).map(({ userId, ...i }) => {
        const c = cheerBy[i.key];
        return {
          ...i,
          user: userBy[userId],
          celebrated: celebrated.has(i.key),
          cheers: { count: c?.count || 0, mine: !!c?.mine, users: (c?.userIds || []).map((id) => userBy[id]).filter(Boolean) },
        };
      }),
      nextBefore: items.length > PAGE ? page[page.length - 1].at : null,
    });
  } catch (err) { next(err); }
}

// Dono de um item da linha do tempo (pra validar e avisar).
async function ownerOf(itemKey) {
  const m = ITEM_KEY_RE.exec(itemKey || '');
  if (!m) return null;
  const [, kind, id] = m;
  if (kind === 'ach') {
    const u = await prisma.userAchievement.findUnique({ where: { id }, select: { userId: true, achievementId: true } });
    if (!u) return null;
    const def = await prisma.achievement.findUnique({ where: { key: u.achievementId }, select: { name: true } });
    return { ownerId: u.userId, label: `a conquista ${def?.name || ''}`.trim() };
  }
  if (kind === 'lvl') {
    const e = await prisma.activityEvent.findUnique({ where: { id } });
    if (!e || e.type !== 'LEVEL_UP') return null;
    return { ownerId: e.userId, label: `o Nível ${parseJson(e.data).level ?? ''}`.trim() };
  }
  if (kind === 'post') {
    const p = await prisma.post.findUnique({ where: { id }, select: { authorId: true, title: true } });
    return p ? { ownerId: p.authorId, label: `o post "${p.title.slice(0, 60)}"` } : null;
  }
  const mp = await prisma.sharedModpack.findUnique({ where: { id }, select: { authorId: true, isPublic: true, name: true } });
  return mp?.isPublic ? { ownerId: mp.authorId, label: `o modpack ${mp.name}` } : null;
}

// POST /activity/cheer { itemKey } — liga/desliga o "Parabéns".
async function toggleCheer(req, res, next) {
  try {
    const me = req.user.id;
    const { itemKey } = req.body || {};
    const owner = await ownerOf(itemKey);
    if (!owner) return res.status(404).json({ error: 'Item não encontrado.' });
    if (owner.ownerId === me) return res.status(400).json({ error: 'Você não pode dar parabéns pra você mesmo.' });
    const friends = await friendIdsOf(me);
    if (!friends.includes(owner.ownerId)) return res.status(403).json({ error: 'Só amigos podem comemorar juntos.' });

    const key = { itemKey_userId: { itemKey, userId: me } };
    const existing = await prisma.activityCheer.findUnique({ where: key });
    if (existing) await prisma.activityCheer.delete({ where: key });
    else await prisma.activityCheer.create({ data: { itemKey, userId: me, ownerId: owner.ownerId } });
    const count = await prisma.activityCheer.count({ where: { itemKey } });

    if (!existing) {
      const from = await prisma.user.findUnique({ where: { id: me }, select: USER_FIELDS });
      req.app.get('io')?.notifyUser?.(owner.ownerId, 'activity:cheer', { from, itemKey, label: owner.label });
    }
    res.json({ itemKey, count, mine: !existing });
  } catch (err) { next(err); }
}

// POST /activity/celebrate { kind: 'achievement', key } | { kind: 'level', level }
// "Comemorar" do aviso de conquista/nível: destaca o item na Atividade dos
// amigos e avisa quem estiver online.
async function celebrate(req, res, next) {
  try {
    const me = req.user.id;
    const { kind } = req.body || {};
    let itemKey = null;
    let label = null;
    if (kind === 'achievement') {
      const key = String(req.body.key || '');
      const u = await prisma.userAchievement.findUnique({ where: { userId_achievementId: { userId: me, achievementId: key } } });
      if (!u) return res.status(404).json({ error: 'Conquista não encontrada.' });
      const def = await prisma.achievement.findUnique({ where: { key }, select: { name: true } });
      itemKey = `ach:${u.id}`;
      label = `desbloqueou a conquista ${def?.name || ''}`.trim();
    } else if (kind === 'level') {
      const level = Number(req.body.level);
      const recent = await prisma.activityEvent.findMany({ where: { userId: me, type: 'LEVEL_UP' }, orderBy: { createdAt: 'desc' }, take: 10 });
      const e = recent.find((r) => parseJson(r.data).level === level) || recent[0];
      if (!e) return res.status(404).json({ error: 'Nível não encontrado.' });
      itemKey = `lvl:${e.id}`;
      label = `subiu para o Nível ${parseJson(e.data).level ?? level}`;
    } else {
      return res.status(400).json({ error: 'Pedido inválido.' });
    }

    const already = await prisma.activityEvent.findFirst({ where: { userId: me, type: 'CELEBRATE', data: { contains: itemKey } } });
    if (!already) await prisma.activityEvent.create({ data: { userId: me, type: 'CELEBRATE', data: JSON.stringify({ itemKey, label }) } });

    const shares = (await sharingIds([me])).has(me);
    if (shares && !already) {
      const io = req.app.get('io');
      const from = await prisma.user.findUnique({ where: { id: me }, select: USER_FIELDS });
      for (const fid of await friendIdsOf(me)) io?.notifyUser?.(fid, 'activity:celebrate', { from, itemKey, label });
    }
    res.json({ ok: true, itemKey, shared: shares });
  } catch (err) { next(err); }
}

module.exports = { getFeed, toggleCheer, celebrate };
