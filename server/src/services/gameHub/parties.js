// Game Hub → Partidas: alguém abre ("Valorant agora, 5 vagas" ou "Hoje às
// 21h"), convida amigos (aviso em Notificações + push) e quem entra ganha a
// call da partida — a sala de voz temporária do anfitrião, com o limite das
// vagas, que some sozinha quando esvazia (services/tempVoice.js).
// A partida vence sozinha (3 h depois de começar) e some da lista.
const getPrisma = () => require('../../config/prisma');
const { gameKeyFor } = require('../../utils/gameKeys');

const LIVE_MS = 3 * 60 * 60 * 1000;
const MAX_AHEAD_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_OPEN_PER_HOST = 2;
const MAX_INVITES = 30;
const USER_SELECT = { id: true, displayName: true, username: true, avatarUrl: true };

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
const isStaff = (user) => ['ADMIN', 'MODERATOR'].includes(user?.platformRole);
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function parseInput(body = {}, now = Date.now()) {
  const gameName = clean(body.gameName || body.game?.name, 100);
  if (gameName.length < 1) throw httpError(400, 'Escolha o jogo da partida.');
  const gameKey = gameKeyFor(body.gameKey || gameName) || gameKeyFor(gameName);
  if (!gameKey) throw httpError(400, 'Nome de jogo inválido.');
  const appId = Number(body.steamAppId ?? body.game?.steamAppId);
  const slots = Math.trunc(Number(body.slots ?? 4));
  if (!Number.isFinite(slots) || slots < 2 || slots > 16) throw httpError(400, 'As vagas vão de 2 a 16 (contando você).');
  let startsAt = null;
  if (body.startsAt) {
    const t = new Date(body.startsAt).getTime();
    if (!Number.isFinite(t)) throw httpError(400, 'Horário inválido.');
    if (t < now - 5 * 60 * 1000) throw httpError(400, 'Esse horário já passou.');
    if (t > now + MAX_AHEAD_MS) throw httpError(400, 'Dá pra marcar no máximo 14 dias pra frente.');
    if (t > now + 5 * 60 * 1000) startsAt = new Date(t);
  }
  return {
    gameName, gameKey, steamAppId: Number.isInteger(appId) && appId > 0 ? appId : null,
    title: clean(body.title, 80) || gameName, note: clean(body.note, 500) || null, slots, startsAt,
    expiresAt: new Date((startsAt ? startsAt.getTime() : now) + LIVE_MS),
  };
}

function shapeParty(p, viewerId) {
  const joined = (p.members || []).filter((m) => m.status === 'joined');
  const mine = (p.members || []).find((m) => m.userId === viewerId);
  return {
    id: p.id, title: p.title, note: p.note, slots: p.slots,
    game: { key: p.gameKey, name: p.gameName, steamAppId: p.steamAppId },
    startsAt: p.startsAt, createdAt: p.createdAt, expiresAt: p.expiresAt, status: p.status,
    host: p.host, hasCall: !!p.channelId,
    members: joined.map((m) => m.user).filter(Boolean),
    filled: joined.length,
    myStatus: p.hostId === viewerId ? 'host' : mine?.status || null,
    invitedCount: p.hostId === viewerId ? (p.members || []).filter((m) => m.status === 'invited').length : undefined,
  };
}

const INCLUDE = { host: { select: USER_SELECT }, members: { include: { user: { select: USER_SELECT } }, orderBy: { createdAt: 'asc' } } };

async function loadOpen(id, db, now = Date.now()) {
  const p = await db.gameParty.findUnique({ where: { id: String(id) }, include: INCLUDE });
  if (!p || p.status !== 'open' || new Date(p.expiresAt).getTime() <= now) throw httpError(404, 'Essa partida já acabou.');
  return p;
}

async function list(viewerId, { db = getPrisma(), now = Date.now(), gameKey = null } = {}) {
  const rows = await db.gameParty.findMany({
    where: { status: 'open', expiresAt: { gt: new Date(now) }, ...(gameKey ? { gameKey: String(gameKey).slice(0, 120) } : {}) },
    include: INCLUDE, orderBy: { createdAt: 'desc' }, take: 60,
  });
  const at = (p) => (p.startsAt ? new Date(p.startsAt).getTime() : 0);
  return rows.map((p) => shapeParty(p, viewerId)).sort((a, b) => at(a) - at(b));
}

async function create(user, body, { db = getPrisma(), io = null, now = Date.now(), notify, isBlocked } = {}) {
  const input = parseInput(body, now);
  const open = await db.gameParty.count({ where: { hostId: user.id, status: 'open', expiresAt: { gt: new Date(now) } } });
  if (open >= MAX_OPEN_PER_HOST) throw httpError(429, `Você já tem ${MAX_OPEN_PER_HOST} partidas abertas. Feche uma antes de abrir outra.`);
  const p = await db.gameParty.create({
    data: { ...input, hostId: user.id, members: { create: { userId: user.id, status: 'joined' } } },
    include: INCLUDE,
  });
  const ids = Array.isArray(body.invite) ? body.invite : [];
  if (ids.length) await invite(user, p.id, ids, { db, io, now, notify, isBlocked });
  return shapeParty(await db.gameParty.findUnique({ where: { id: p.id }, include: INCLUDE }), user.id);
}

async function join(user, id, { db = getPrisma(), now = Date.now() } = {}) {
  const p = await loadOpen(id, db, now);
  const mine = p.members.find((m) => m.userId === user.id);
  if (mine?.status === 'joined') return shapeParty(p, user.id);
  const filled = p.members.filter((m) => m.status === 'joined').length;
  if (filled >= p.slots) throw httpError(409, 'A partida já está cheia.');
  await db.gamePartyMember.upsert({
    where: { partyId_userId: { partyId: p.id, userId: user.id } },
    create: { partyId: p.id, userId: user.id, status: 'joined' },
    update: { status: 'joined' },
  });
  return shapeParty(await db.gameParty.findUnique({ where: { id: p.id }, include: INCLUDE }), user.id);
}

async function leave(user, id, { db = getPrisma(), now = Date.now() } = {}) {
  const p = await loadOpen(id, db, now);
  if (p.hostId === user.id) { await db.gameParty.update({ where: { id: p.id }, data: { status: 'closed' } }); return { closed: true }; }
  await db.gamePartyMember.deleteMany({ where: { partyId: p.id, userId: user.id } });
  return { closed: false };
}

async function close(user, id, { db = getPrisma(), now = Date.now() } = {}) {
  const p = await loadOpen(id, db, now);
  if (p.hostId !== user.id && !isStaff(user)) throw httpError(403, 'Só quem abriu a partida pode fechar.');
  await db.gameParty.update({ where: { id: p.id }, data: { status: 'closed' } });
  return { closed: true };
}

async function kick(user, id, userId, { db = getPrisma(), now = Date.now() } = {}) {
  const p = await loadOpen(id, db, now);
  if (p.hostId !== user.id && !isStaff(user)) throw httpError(403, 'Só quem abriu a partida pode tirar alguém.');
  if (String(userId) === p.hostId) throw httpError(400, 'O anfitrião não sai assim: feche a partida.');
  await db.gamePartyMember.deleteMany({ where: { partyId: p.id, userId: String(userId) } });
  return shapeParty(await db.gameParty.findUnique({ where: { id: p.id }, include: INCLUDE }), user.id);
}

function whenText(startsAt) {
  if (!startsAt) return 'agora';
  const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return fmt.format(new Date(startsAt));
}

async function invite(user, id, userIds, { db = getPrisma(), io = null, now = Date.now(), notify, isBlocked } = {}) {
  const p = await loadOpen(id, db, now);
  const me = p.members.find((m) => m.userId === user.id);
  if (p.hostId !== user.id && me?.status !== 'joined') throw httpError(403, 'Entre na partida pra convidar alguém.');
  const wanted = [...new Set((Array.isArray(userIds) ? userIds : []).map(String))].filter((u) => u && u !== user.id).slice(0, 15);
  if (!wanted.length) return { invited: 0 };
  const already = new Set(p.members.map((m) => m.userId));
  const invitedSoFar = p.members.filter((m) => m.status === 'invited').length;
  const room = Math.max(0, MAX_INVITES - invitedSoFar);
  const targets = await db.user.findMany({ where: { id: { in: wanted.filter((u) => !already.has(u)) } }, select: { id: true } });
  const blocked = isBlocked || require('../dmPermissions').isBlockedBetween;
  const send = notify || require('../notices').createNotice;
  let invited = 0;
  for (const t of targets.slice(0, room)) {
    try { if (await blocked(user.id, t.id)) continue; } catch { /* sem bloqueio conferível: segue */ }
    await db.gamePartyMember.create({ data: { partyId: p.id, userId: t.id, status: 'invited', invitedBy: user.id } }).catch(() => null);
    await send(io, t.id, {
      kind: 'PARTY_INVITE',
      title: `${user.displayName || user.username} te chamou pra jogar ${p.gameName}`,
      body: `${p.title} · ${whenText(p.startsAt)} · ${p.members.filter((m) => m.status === 'joined').length}/${p.slots} na partida`,
      link: `/jogos/partidas?p=${p.id}`,
      data: { partyId: p.id },
    });
    invited += 1;
  }
  return { invited };
}

// Call da partida: a sala temporária do anfitrião (cria na hora se não
// existir), com o limite das vagas. Só quem está na partida pede.
async function call(user, id, { db = getPrisma(), io = null, now = Date.now(), tempVoice = require('../tempVoice') } = {}) {
  const p = await loadOpen(id, db, now);
  const me = p.members.find((m) => m.userId === user.id);
  if (me?.status !== 'joined') throw httpError(403, 'Entre na partida pra ir pra call.');
  if (p.channelId) {
    const ch = await db.channel.findUnique({ where: { id: p.channelId } });
    if (ch) return { channel: ch };
  }
  const host = await db.user.findUnique({ where: { id: p.hostId }, select: { id: true, displayName: true, username: true } });
  const { channel } = await tempVoice.createRoom(host, { name: `Partida · ${p.gameName}`.slice(0, 90), userLimit: p.slots }, { db, io });
  await db.gameParty.update({ where: { id: p.id }, data: { channelId: channel.id } });
  return { channel };
}

module.exports = { list, create, join, leave, close, kick, invite, call, parseInput, shapeParty, LIVE_MS, MAX_OPEN_PER_HOST };
