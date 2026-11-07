// Salas de voz temporárias (item "Salas de voz temporárias").
//
// Qualquer membro cria a própria sala ("Sala de Fulano") numa categoria que
// já tem canais de voz; ela aparece pra todo mundo na hora e some sozinha
// quando fica vazia por EMPTY_GRACE_MS. Uma sala por pessoa (pedir de novo
// devolve a que já existe) e um teto geral de salas ao mesmo tempo.
// O dono pode renomear e pôr limite de pessoas; a staff apaga como qualquer
// canal.
const getPrisma = () => require('../config/prisma');
const { sanitizeName } = require('../utils/channelNames');

const MAX_ROOMS = 25;
const EMPTY_GRACE_MS = 60 * 1000;   // vazia por 1 min → apaga
const NEW_ROOM_GRACE_MS = 2 * 60 * 1000; // sala recém-criada: 2 min pro dono entrar
const SWEEP_MS = 20 * 1000;
const MAX_LIMIT = 99;

const emptySince = new Map(); // channelId -> ms
const createdAt = new Map();  // channelId -> ms (só desta instância)

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

function clampLimit(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '' || Number(v) === 0) return null;
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(MAX_LIMIT, n);
}

async function pickCategory(categoryId, db) {
  if (categoryId) {
    const ok = await db.channel.findFirst({ where: { categoryId, type: { in: ['VOICE', 'STAGE'] }, isPrivate: false }, select: { id: true } });
    if (ok) return categoryId;
  }
  const first = await db.channel.findFirst({ where: { type: 'VOICE', isPrivate: false, tempOwnerId: null }, orderBy: { position: 'asc' }, select: { categoryId: true } });
  return first?.categoryId ?? null;
}

async function createRoom(user, { categoryId, name, userLimit } = {}, { db = getPrisma(), io = null } = {}) {
  const existing = await db.channel.findFirst({ where: { tempOwnerId: user.id } });
  if (existing) return { channel: existing, existed: true };
  const total = await db.channel.count({ where: { tempOwnerId: { not: null } } });
  if (total >= MAX_ROOMS) throw httpError(429, 'Já tem salas temporárias demais abertas agora. Entre em uma delas ou tente daqui a pouco.');
  const cat = await pickCategory(categoryId || null, db);
  const count = await db.channel.count({ where: { categoryId: cat } });
  const channel = await db.channel.create({
    data: {
      name: sanitizeName(name) || `Sala de ${String(user.displayName || user.username || 'alguém').slice(0, 40)}`,
      type: 'VOICE', categoryId: cat, position: count + 100, userLimit: clampLimit(userLimit) ?? null,
      tempOwnerId: user.id, topic: 'Sala temporária — some quando ficar vazia',
    },
  });
  createdAt.set(channel.id, Date.now());
  io?.to?.('community').emit('channel:new', { id: channel.id });
  return { channel, existed: false };
}

async function updateRoom(user, id, { name, userLimit } = {}, { db = getPrisma(), io = null } = {}) {
  const ch = await db.channel.findUnique({ where: { id } });
  if (!ch || !ch.tempOwnerId) throw httpError(404, 'Sala temporária não encontrada.');
  if (ch.tempOwnerId !== user.id) throw httpError(403, 'Só quem criou a sala pode mudar ela.');
  const data = {};
  if (name !== undefined) {
    data.name = sanitizeName(name);
    if (!data.name) throw httpError(400, 'Dê um nome à sala.');
  }
  const lim = clampLimit(userLimit);
  if (lim !== undefined) data.userLimit = lim;
  const channel = await db.channel.update({ where: { id }, data });
  io?.to?.('community').emit('channel:update', { id });
  return channel;
}

async function closeRoom(user, id, { db = getPrisma(), io = null } = {}) {
  const ch = await db.channel.findUnique({ where: { id }, select: { id: true, tempOwnerId: true } });
  if (!ch || !ch.tempOwnerId) throw httpError(404, 'Sala temporária não encontrada.');
  if (ch.tempOwnerId !== user.id) throw httpError(403, 'Só quem criou a sala pode fechar ela.');
  await db.channel.delete({ where: { id } }).catch(() => null);
  forget(id);
  io?.to?.('community').emit('channel:delete', { id });
  return true;
}

function forget(id) { emptySince.delete(id); createdAt.delete(id); }

/** Apaga as salas que ficaram vazias. Devolve os ids apagados. */
async function sweep(io, { db = getPrisma(), roomSize = require('./voiceRoomStore').roomSize, now = Date.now() } = {}) {
  const rooms = await db.channel.findMany({ where: { tempOwnerId: { not: null } }, select: { id: true } });
  const removed = [];
  const alive = new Set(rooms.map((r) => r.id));
  for (const id of [...emptySince.keys()]) if (!alive.has(id)) forget(id);
  for (const { id } of rooms) {
    // eslint-disable-next-line no-await-in-loop
    const size = await roomSize(id).catch(() => 1); // Redis instável: não apaga nada
    if (size > 0) { emptySince.delete(id); continue; }
    if (!createdAt.has(id)) createdAt.set(id, now); // reinício: conta a partir de agora
    if (now - createdAt.get(id) < NEW_ROOM_GRACE_MS) continue;
    if (!emptySince.has(id)) { emptySince.set(id, now); continue; }
    if (now - emptySince.get(id) < EMPTY_GRACE_MS) continue;
    // eslint-disable-next-line no-await-in-loop
    const gone = await db.channel.deleteMany({ where: { id, tempOwnerId: { not: null } } }).catch(() => ({ count: 0 }));
    forget(id);
    if (gone.count) { removed.push(id); io?.to?.('community').emit('channel:delete', { id }); }
  }
  return removed;
}

let timer = null;
function startTempVoiceSweeper(io) {
  if (timer) return timer;
  timer = setInterval(() => { sweep(io).catch((e) => console.error('[salas temporárias]', e?.message || e)); }, SWEEP_MS);
  timer.unref?.();
  return timer;
}

function _resetForTests() { emptySince.clear(); createdAt.clear(); }

module.exports = { createRoom, updateRoom, closeRoom, sweep, startTempVoiceSweeper, clampLimit, MAX_ROOMS, EMPTY_GRACE_MS, NEW_ROOM_GRACE_MS, _resetForTests };
