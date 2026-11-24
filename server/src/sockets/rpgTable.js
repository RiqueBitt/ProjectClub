// Call modo RPG (Channel.rpgMode): a mesa da chamada — 1 mestre (topo, com o
// escudo de Dungeon Master) e 4 jogadores (embaixo). Cada jogador tem nome
// de personagem e a ficha rápida do BLACKOUT: Pontos de Vida, Estresse
// (6 espaços; cheio = BURNOUT) e Pontos de Ação (3 por turno + 1 Ação
// Rápida). As rolagens de dados da call entram no histórico da mesa.
//
// Estado no Redis (por canal):
//   voice:rpg:<canal>        { master, players[4], log[] }  (some em 12 h parado)
//   voice:rpg:chars:<canal>  { <userId>: ficha }            (fica 60 dias: o
//                            personagem continua na próxima sessão)
const prisma = require('../config/prisma');
const { redis } = require('../config/redis');
const voiceStore = require('../services/voiceRoomStore');
const { getEffectivePermissions } = require('../services/authz');
const { has } = require('../services/permissions');

const RPG_LIMIT = 5;
const SEATS = 4;
const LOG_MAX = 80;
const KEY = (id) => `voice:rpg:${id}`;
const CHARS = (id) => `voice:rpg:chars:${id}`;
const TTL = 12 * 60 * 60;
const CHARS_TTL = 60 * 24 * 60 * 60;

const clampInt = (v, lo, hi, dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const cleanName = (s) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) : '');

/** Ficha padrão (PV 10 = o valor mais comum das classes do BLACKOUT). */
function defaultChar() { return { name: '', pv: 10, pvMax: 10, stress: 0, pa: 3, ar: 1 }; }
function cleanChar(prev, patch = {}) {
  const c = { ...defaultChar(), ...(prev || {}) };
  if (patch.name !== undefined) c.name = cleanName(patch.name);
  if (patch.pvMax !== undefined) c.pvMax = clampInt(patch.pvMax, 1, 99, c.pvMax);
  if (patch.pv !== undefined) c.pv = clampInt(patch.pv, 0, 99, c.pv);
  c.pv = Math.min(c.pv, c.pvMax);
  if (patch.stress !== undefined) c.stress = clampInt(patch.stress, 0, 6, c.stress);
  if (patch.pa !== undefined) c.pa = clampInt(patch.pa, 0, 3, c.pa);
  if (patch.ar !== undefined) c.ar = clampInt(patch.ar, 0, 1, c.ar);
  return c;
}

async function readJson(key, dflt) {
  try { const raw = await redis.get(key); return raw ? JSON.parse(raw) : dflt; } catch { return dflt; }
}
async function getTable(id) {
  const t = await readJson(KEY(id), null);
  const players = Array.isArray(t?.players) ? t.players.slice(0, SEATS) : [];
  while (players.length < SEATS) players.push(null);
  return { master: t?.master || null, players, log: Array.isArray(t?.log) ? t.log.slice(-LOG_MAX) : [] };
}
const saveTable = (id, t) => redis.set(KEY(id), JSON.stringify(t), 'EX', TTL);
const getChars = (id) => readJson(CHARS(id), {});
const saveChars = (id, c) => redis.set(CHARS(id), JSON.stringify(c), 'EX', CHARS_TTL);

const rpgCache = new Map(); // canal -> { at, on }
async function isRpgChannel(id) {
  const hit = rpgCache.get(id);
  if (hit && Date.now() - hit.at < 15_000) return hit.on;
  const ch = await prisma.channel.findUnique({ where: { id }, select: { rpgMode: true, type: true } }).catch(() => null);
  const on = !!ch?.rpgMode && ch.type === 'VOICE';
  rpgCache.set(id, { at: Date.now(), on });
  if (rpgCache.size > 2000) rpgCache.clear();
  return on;
}

/** Tira dos lugares quem não está mais na chamada. */
async function prune(id, t) {
  const room = await voiceStore.getRoom(id).catch(() => ({}));
  const inRoom = (uid) => !!uid && !!room[uid];
  let changed = false;
  if (t.master && !inRoom(t.master)) { t.master = null; changed = true; }
  t.players = t.players.map((uid) => { if (uid && !inRoom(uid)) { changed = true; return null; } return uid; });
  return changed;
}

async function snapshot(id) {
  const t = await getTable(id);
  if (await prune(id, t)) await saveTable(id, t);
  const chars = await getChars(id);
  const seated = [t.master, ...t.players].filter(Boolean);
  const sheets = {};
  for (const uid of seated) sheets[uid] = cleanChar(chars[uid]);
  return { channelId: id, master: t.master, players: t.players, chars: sheets, log: t.log };
}
async function broadcast(io, id) {
  io.to(`voice:${id}`).emit('rpg:state', await snapshot(id));
}

/** Rolagem de dados da call → histórico da mesa (chamado pelo diceRoll). */
async function onRoll(io, id, event) {
  if (!(await isRpgChannel(id))) return;
  const t = await getTable(id);
  const chars = await getChars(id);
  const uid = event.user?.id;
  const entry = {
    at: event.at, userId: uid, name: event.user?.displayName || event.user?.username || 'Alguém',
    character: (uid && cleanChar(chars[uid]).name) || null, master: !!uid && uid === t.master,
    notation: event.notation, total: event.total, label: event.label || null,
    groups: Array.isArray(event.groups) ? event.groups.map((g) => ({ sides: g.sides, results: g.results })) : [],
    modifier: event.modifier || 0,
  };
  t.log = [...t.log, entry].slice(-LOG_MAX);
  await saveTable(id, t);
  io.to(`voice:${id}`).emit('rpg:log', { channelId: id, entry });
}

function register(io, socket, userId) {
  const guard = (fn) => async (payload = {}, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      const id = typeof payload.channelId === 'string' ? payload.channelId.slice(0, 120) : '';
      if (!id || !(await isRpgChannel(id))) return reply({ error: 'Esta chamada não está no modo RPG.' });
      if (!(await voiceStore.hasParticipant(id, userId))) return reply({ error: 'Entre na chamada primeiro.' });
      const out = await fn(id, payload);
      if (out?.error) return reply(out);
      if (out?.changed !== false) await broadcast(io, id);
      return reply({ ok: true });
    } catch (err) {
      console.error('[socket] rpg falhou:', err?.message || err);
      return reply({ error: 'Não deu certo agora. Tente de novo.' });
    }
  };
  const isTableAdmin = async (id, t) => {
    if (t.master === userId) return true;
    const ch = await prisma.channel.findUnique({ where: { id } }).catch(() => null);
    if (!ch) return false;
    return has(await getEffectivePermissions(userId, id, ch), 'MANAGE_CHANNELS');
  };

  socket.on('rpg:get', guard(async (id) => { socket.emit('rpg:state', await snapshot(id)); return { changed: false }; }));

  // Sentar: 'master' | 0..3 (jogador) | null (levantar).
  socket.on('rpg:sit', guard(async (id, { seat }) => {
    const t = await getTable(id);
    await prune(id, t);
    const leave = () => {
      if (t.master === userId) t.master = null;
      t.players = t.players.map((u) => (u === userId ? null : u));
    };
    if (seat === null || seat === undefined) { leave(); await saveTable(id, t); return {}; }
    if (seat === 'master') {
      if (t.master && t.master !== userId) return { error: 'A mesa já tem um mestre.' };
      leave(); t.master = userId;
    } else {
      const i = Number(seat);
      if (!Number.isInteger(i) || i < 0 || i >= SEATS) return { error: 'Lugar inválido.' };
      if (t.players[i] && t.players[i] !== userId) return { error: 'Esse lugar já está ocupado.' };
      leave(); t.players[i] = userId;
    }
    await saveTable(id, t);
    return {};
  }));

  // Ficha: a própria pessoa ou o mestre (ou quem gerencia o canal) mexe.
  socket.on('rpg:char', guard(async (id, { userId: target, patch }) => {
    const who = typeof target === 'string' && target ? target : userId;
    const t = await getTable(id);
    if (who !== userId && !(await isTableAdmin(id, t))) return { error: 'Só o mestre mexe na ficha dos outros.' };
    if (![t.master, ...t.players].includes(who)) return { error: 'Essa pessoa não está sentada à mesa.' };
    const chars = await getChars(id);
    chars[who] = cleanChar(chars[who], patch && typeof patch === 'object' ? patch : {});
    await saveChars(id, chars);
    return {};
  }));

  // Limpar o histórico (mestre).
  socket.on('rpg:log-clear', guard(async (id) => {
    const t = await getTable(id);
    if (!(await isTableAdmin(id, t))) return { error: 'Só o mestre limpa o histórico.' };
    t.log = [];
    await saveTable(id, t);
    return {};
  }));
}

module.exports = { register, onRoll, broadcast, isRpgChannel, cleanChar, defaultChar, RPG_LIMIT, _rpgCache: rpgCache };
