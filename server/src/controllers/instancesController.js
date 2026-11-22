const prisma = require('../config/prisma');
const instances = require('../services/instances');
const { logAction } = require('../services/audit');

// Instâncias — ver services/instances.js.
//  PUT  /api/community/instance            troca a instância atual (qualquer membro)
//  GET  /api/admin/instances                lista com membros (administradores)
//  POST /api/admin/instances                cria
//  PATCH/DELETE /api/admin/instances/:id    renomeia / apaga (só vazia)
//  POST /api/admin/instances/:id/members    libera alguém { userId } ou { username }
//  DELETE /api/admin/instances/:id/members/:userId

const USER_SELECT = { id: true, username: true, displayName: true, avatarUrl: true, platformRole: true };

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function cleanName(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function cleanIcon(raw) {
  if (raw === undefined) return undefined;
  const s = String(raw ?? '').trim();
  return s ? [...s].slice(0, 4).join('') : null;
}

// Avisa a pessoa (todas as abas/aparelhos) pra buscar a lista de canais de novo.
function refreshUser(io, userId) {
  io?.to(`user:${userId}`).emit('community:update', { instances: true });
}

async function setCurrent(req, res, next) {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, platformRole: true } });
    const id = await instances.setCurrent(me, req.body?.instanceId);
    res.json({ instance: id || instances.PUBLIC_ID });
  } catch (err) { next(err); }
}

async function adminList(req, res, next) {
  try {
    const [list, members, catCounts, chanCounts] = await Promise.all([
      prisma.instance.findMany({ orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
      prisma.instanceMember.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.category.groupBy({ by: ['instanceId'], _count: { _all: true } }),
      prisma.channel.groupBy({ by: ['instanceId'], _count: { _all: true } }),
    ]);
    const userIds = [...new Set(members.map((m) => m.userId))];
    const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: USER_SELECT }) : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    const count = (rows, id) => rows.find((r) => (r.instanceId || null) === id)?._count?._all || 0;
    res.json({
      public: { ...instances.PUBLIC_INSTANCE, categories: count(catCounts, null), channels: count(chanCounts, null) },
      instances: list.map((i) => ({
        ...i,
        categories: count(catCounts, i.id),
        channels: count(chanCounts, i.id),
        members: members.filter((m) => m.instanceId === i.id && byId.has(m.userId))
          .map((m) => ({ user: byId.get(m.userId), addedAt: m.createdAt })),
      })),
    });
  } catch (err) { next(err); }
}

async function adminCreate(req, res, next) {
  try {
    const name = cleanName(req.body?.name);
    if (!name) throw httpError(400, 'Dê um nome à instância.');
    let base = instances.slugify(name) || 'instancia';
    if (base === instances.PUBLIC_ID) base = `${base}-2`;
    let id = base;
    for (let n = 2; await prisma.instance.findUnique({ where: { id } }); n += 1) id = `${base}-${n}`;
    const position = (await prisma.instance.count()) + 1;
    const instance = await prisma.instance.create({ data: { id, name, icon: cleanIcon(req.body?.icon) ?? null, position } });
    instances.invalidate();
    await logAction(req.app.get('io'), { actorId: req.user.id, action: 'INSTANCE_CREATE', targetType: 'INSTANCE', targetId: id, reason: name }).catch(() => {});
    res.status(201).json({ instance: { ...instance, members: [], categories: 0, channels: 0 } });
  } catch (err) { next(err); }
}

async function adminUpdate(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await prisma.instance.findUnique({ where: { id } });
    if (!existing) throw httpError(404, 'Instância não encontrada.');
    const data = {};
    if (req.body?.name !== undefined) {
      data.name = cleanName(req.body.name);
      if (!data.name) throw httpError(400, 'Dê um nome à instância.');
    }
    const icon = cleanIcon(req.body?.icon);
    if (icon !== undefined) data.icon = icon;
    if (Number.isInteger(req.body?.position)) data.position = Math.max(1, Math.min(999, req.body.position));
    const instance = await prisma.instance.update({ where: { id }, data });
    instances.invalidate();
    req.app.get('io')?.to('community').emit('community:update', { instances: true });
    res.json({ instance });
  } catch (err) { next(err); }
}

async function adminDelete(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await prisma.instance.findUnique({ where: { id } });
    if (!existing) throw httpError(404, 'Instância não encontrada.');
    const [cats, chans] = await Promise.all([
      prisma.category.count({ where: { instanceId: id } }),
      prisma.channel.count({ where: { instanceId: id } }),
    ]);
    if (cats || chans) {
      throw httpError(409, `Essa instância ainda tem ${cats} categoria(s) e ${chans} canal(is). Apague ou mova os canais antes de apagar a instância.`);
    }
    const members = await prisma.instanceMember.findMany({ where: { instanceId: id }, select: { userId: true } });
    await prisma.$transaction([
      prisma.userInstancePref.deleteMany({ where: { instanceId: id } }),
      prisma.instance.delete({ where: { id } }),
    ]);
    instances.invalidate();
    const io = req.app.get('io');
    members.forEach((m) => refreshUser(io, m.userId));
    await logAction(io, { actorId: req.user.id, action: 'INSTANCE_DELETE', targetType: 'INSTANCE', targetId: id, reason: existing.name }).catch(() => {});
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function adminAddMember(req, res, next) {
  try {
    const { id } = req.params;
    const instance = await prisma.instance.findUnique({ where: { id } });
    if (!instance) throw httpError(404, 'Instância não encontrada.');
    const username = String(req.body?.username || '').trim().replace(/^@/, '');
    const user = req.body?.userId
      ? await prisma.user.findUnique({ where: { id: String(req.body.userId) }, select: USER_SELECT })
      : username ? await prisma.user.findFirst({ where: { username }, select: USER_SELECT }) : null;
    if (!user) throw httpError(404, 'Usuário não encontrado.');
    await prisma.instanceMember.upsert({
      where: { instanceId_userId: { instanceId: id, userId: user.id } },
      update: {},
      create: { instanceId: id, userId: user.id, addedById: req.user.id },
    });
    instances.invalidate();
    const io = req.app.get('io');
    refreshUser(io, user.id);
    await logAction(io, { actorId: req.user.id, action: 'INSTANCE_MEMBER_ADD', targetType: 'USER', targetId: user.id, reason: instance.name }).catch(() => {});
    res.status(201).json({ member: { user, addedAt: new Date() } });
  } catch (err) { next(err); }
}

async function adminRemoveMember(req, res, next) {
  try {
    const { id, userId } = req.params;
    const instance = await prisma.instance.findUnique({ where: { id } });
    if (!instance) throw httpError(404, 'Instância não encontrada.');
    await prisma.$transaction([
      prisma.instanceMember.deleteMany({ where: { instanceId: id, userId } }),
      // Estava nela: volta pra Pública.
      prisma.userInstancePref.deleteMany({ where: { userId, instanceId: id } }),
    ]);
    instances.invalidate();
    const io = req.app.get('io');
    refreshUser(io, userId);
    // Quem estava na call/canal dessa instância perde o acesso na hora.
    io?.in(`user:${userId}`).socketsLeave([...(await channelRoomsOf(id))]);
    await logAction(io, { actorId: req.user.id, action: 'INSTANCE_MEMBER_REMOVE', targetType: 'USER', targetId: userId, reason: instance.name }).catch(() => {});
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function channelRoomsOf(instanceId) {
  const chans = await prisma.channel.findMany({ where: { instanceId }, select: { id: true } });
  return chans.map((c) => `channel:${c.id}`);
}

module.exports = { setCurrent, adminList, adminCreate, adminUpdate, adminDelete, adminAddMember, adminRemoveMember };
