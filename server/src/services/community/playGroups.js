// "Bora Jogar": grupos pra jogar junto num horário marcado.
//
// Alguém cria o grupo (jogo, data/hora, vagas, descrição); outras pessoas
// entram/saem. Encheu → aviso pra todo mundo do grupo. 15 min antes →
// lembrete (mesmo esquema de services/eventReminders.js: remindedAt marcado
// com updateMany, então nunca duplica). Duas horas depois do horário o
// grupo expira sozinho. Quem criou pode cancelar (a staff também).
const { deps, httpError, intIn, isStaff, PUBLIC_MINI } = require('./common');

const MIN_SLOTS = 2;
const MAX_SLOTS = 50;
const MAX_ACTIVE_PER_USER = 3;
const MAX_AHEAD_DAYS = 14;
const MIN_LEAD_MS = 5 * 60 * 1000;
const REMINDER_LEAD_MS = 15 * 60 * 1000;
const EXPIRE_AFTER_MS = 2 * 60 * 60 * 1000;
const LIST_LIMIT = 60;
const ACTIVE = ['OPEN', 'FULL'];

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function validate({ game, startsAt, slots, description }, now) {
  const g = clean(game, 80);
  if (g.length < 2) throw httpError(400, 'Diga qual é o jogo (pelo menos 2 letras).');
  const when = new Date(startsAt);
  if (Number.isNaN(when.getTime())) throw httpError(400, 'Data e hora inválidas.');
  if (when.getTime() < now.getTime() + MIN_LEAD_MS) throw httpError(400, 'Marque pelo menos 5 minutos no futuro.');
  if (when.getTime() > now.getTime() + MAX_AHEAD_DAYS * 86400000) throw httpError(400, `Dá pra marcar no máximo ${MAX_AHEAD_DAYS} dias pra frente.`);
  const n = intIn(slots, MIN_SLOTS, MAX_SLOTS);
  if (!n) throw httpError(400, `As vagas vão de ${MIN_SLOTS} a ${MAX_SLOTS} (contando você).`);
  const desc = clean(description, 500);
  return { game: g, startsAt: when, slots: n, description: desc || null };
}

function emitUpdate(io, groupId) { io?.to?.('community')?.emit?.('playgroup:update', { id: groupId }); }

async function create(user, body, over = {}) {
  const d = deps(over);
  const data = validate(body || {}, d.now);
  const mine = await d.db.playGroup.count({ where: { ownerId: user.id, status: { in: ACTIVE }, startsAt: { gt: new Date(d.now.getTime() - EXPIRE_AFTER_MS) } } });
  if (mine >= MAX_ACTIVE_PER_USER) throw httpError(429, `Você já tem ${MAX_ACTIVE_PER_USER} grupos marcados. Espere um acontecer ou cancele algum.`);
  const group = await d.db.$transaction(async (tx) => {
    const g = await tx.playGroup.create({ data: { ownerId: user.id, ...data } });
    await tx.playGroupMember.create({ data: { groupId: g.id, userId: user.id } });
    return g;
  });
  emitUpdate(d.io, group.id);
  return group;
}

async function shapeGroups(db, groups, viewerId) {
  if (!groups.length) return [];
  const members = await db.playGroupMember.findMany({ where: { groupId: { in: groups.map((g) => g.id) } }, orderBy: { joinedAt: 'asc' } });
  const userIds = [...new Set([...members.map((m) => m.userId), ...groups.map((g) => g.ownerId)])];
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: PUBLIC_MINI });
  const byId = new Map(users.map((u) => [u.id, u]));
  return groups.map((g) => {
    const list = members.filter((m) => m.groupId === g.id);
    return {
      id: g.id, game: g.game, description: g.description, startsAt: g.startsAt, slots: g.slots, status: g.status, createdAt: g.createdAt,
      owner: byId.get(g.ownerId) || null,
      members: list.map((m) => byId.get(m.userId)).filter(Boolean),
      count: list.length,
      joined: list.some((m) => m.userId === viewerId),
      isOwner: g.ownerId === viewerId,
    };
  });
}

async function list(viewerId, over = {}) {
  const d = deps(over);
  const groups = await d.db.playGroup.findMany({
    where: { status: { in: ACTIVE }, startsAt: { gt: new Date(d.now.getTime() - EXPIRE_AFTER_MS) } },
    orderBy: { startsAt: 'asc' }, take: LIST_LIMIT,
  });
  return shapeGroups(d.db, groups, viewerId);
}

async function join(user, groupId, over = {}) {
  const d = deps(over);
  const g = await d.db.playGroup.findUnique({ where: { id: String(groupId || '') } });
  if (!g || !ACTIVE.includes(g.status)) throw httpError(404, 'Esse grupo não está mais aberto.');
  if (new Date(g.startsAt).getTime() <= d.now.getTime()) throw httpError(400, 'Esse grupo já começou.');
  if (g.status === 'FULL') throw httpError(409, 'O grupo já está completo.');
  try {
    await d.db.playGroupMember.create({ data: { groupId: g.id, userId: user.id } });
  } catch (err) {
    if (err?.code === 'P2002') throw httpError(400, 'Você já está nesse grupo.');
    throw err;
  }
  // Duas pessoas entrando juntas na última vaga: quem passou do limite sai.
  const count = await d.db.playGroupMember.count({ where: { groupId: g.id } });
  if (count > g.slots) {
    await d.db.playGroupMember.deleteMany({ where: { groupId: g.id, userId: user.id } });
    throw httpError(409, 'Alguém pegou a última vaga antes de você.');
  }
  if (count === g.slots) {
    const claimed = await d.db.playGroup.updateMany({ where: { id: g.id, status: 'OPEN', fullNotifiedAt: null }, data: { status: 'FULL', fullNotifiedAt: d.now } });
    if (claimed.count === 1) {
      const members = await d.db.playGroupMember.findMany({ where: { groupId: g.id }, select: { userId: true } });
      for (const m of members) {
        // eslint-disable-next-line no-await-in-loop
        await d.notify(d.io, m.userId, {
          kind: 'PLAY_GROUP', title: `Bora Jogar: grupo de ${g.game} completo!`,
          body: `As ${g.slots} vagas foram preenchidas. Começa ${fmtWhen(g.startsAt)}.`, link: '/participar?aba=jogar', data: { groupId: g.id },
        });
      }
    }
  }
  emitUpdate(d.io, g.id);
  return { ok: true, count };
}

async function leave(user, groupId, over = {}) {
  const d = deps(over);
  const g = await d.db.playGroup.findUnique({ where: { id: String(groupId || '') } });
  if (!g || !ACTIVE.includes(g.status)) throw httpError(404, 'Grupo não encontrado.');
  if (g.ownerId === user.id) return cancel(user, g.id, d);
  const r = await d.db.playGroupMember.deleteMany({ where: { groupId: g.id, userId: user.id } });
  if (!r.count) throw httpError(400, 'Você não está nesse grupo.');
  if (g.status === 'FULL') await d.db.playGroup.updateMany({ where: { id: g.id, status: 'FULL' }, data: { status: 'OPEN', fullNotifiedAt: null } });
  emitUpdate(d.io, g.id);
  return { ok: true };
}

async function cancel(user, groupId, over = {}) {
  const d = deps(over);
  const g = await d.db.playGroup.findUnique({ where: { id: String(groupId || '') } });
  if (!g || !ACTIVE.includes(g.status)) throw httpError(404, 'Grupo não encontrado.');
  if (g.ownerId !== user.id && !isStaff(user)) throw httpError(403, 'Só quem criou o grupo pode cancelar.');
  const r = await d.db.playGroup.updateMany({ where: { id: g.id, status: { in: ACTIVE } }, data: { status: 'CANCELLED' } });
  if (r.count === 1) {
    const members = await d.db.playGroupMember.findMany({ where: { groupId: g.id, userId: { not: user.id } }, select: { userId: true } });
    for (const m of members) {
      // eslint-disable-next-line no-await-in-loop
      await d.notify(d.io, m.userId, { kind: 'PLAY_GROUP', title: `Bora Jogar: grupo de ${g.game} cancelado`, body: `O grupo de ${fmtWhen(g.startsAt)} foi cancelado.`, link: '/participar?aba=jogar', data: { groupId: g.id } });
    }
  }
  emitUpdate(d.io, g.id);
  return { ok: true, cancelled: true };
}

function fmtWhen(date) {
  try {
    return new Date(date).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return new Date(date).toISOString(); }
}

/** A cada minuto: lembrete 15 min antes + expira grupos que já passaram. */
async function tick(over = {}) {
  const d = deps(over);
  const now = d.now.getTime();
  let reminded = 0;
  const soon = await d.db.playGroup.findMany({
    where: { status: { in: ACTIVE }, startsAt: { gt: new Date(now), lte: new Date(now + REMINDER_LEAD_MS) } }, take: 100,
  });
  for (const g of soon) {
    // eslint-disable-next-line no-await-in-loop
    const pending = await d.db.playGroupMember.findMany({ where: { groupId: g.id, remindedAt: null }, select: { id: true, userId: true } });
    for (const m of pending) {
      // eslint-disable-next-line no-await-in-loop
      const claimed = await d.db.playGroupMember.updateMany({ where: { id: m.id, remindedAt: null }, data: { remindedAt: d.now } });
      if (claimed.count !== 1) continue;
      const minutes = Math.max(1, Math.round((new Date(g.startsAt).getTime() - now) / 60000));
      // eslint-disable-next-line no-await-in-loop
      await d.notify(d.io, m.userId, {
        kind: 'PLAY_GROUP', title: `Bora Jogar: ${g.game}`, body: minutes === 1 ? 'Começa em 1 minuto!' : `Começa em ${minutes} minutos!`,
        link: '/participar?aba=jogar', data: { groupId: g.id, startsAt: g.startsAt },
      });
      reminded += 1;
    }
  }
  const ex = await d.db.playGroup.updateMany({ where: { status: { in: ACTIVE }, startsAt: { lt: new Date(now - EXPIRE_AFTER_MS) } }, data: { status: 'EXPIRED' } });
  if (ex.count) d.io?.to?.('community')?.emit?.('playgroup:update', { expired: ex.count });
  return { reminded, expired: ex.count };
}

module.exports = {
  create, list, join, leave, cancel, tick, validate,
  MIN_SLOTS, MAX_SLOTS, MAX_ACTIVE_PER_USER, MAX_AHEAD_DAYS, REMINDER_LEAD_MS, EXPIRE_AFTER_MS,
};
