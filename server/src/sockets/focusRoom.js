// Sala de estudos: Pomodoro compartilhado dentro da call (item "Sala de
// estudos"). Qualquer pessoa da sala começa um ciclo (ex.: 25 min de foco +
// 5 de pausa); todo mundo vê o mesmo relógio. Ao fim de cada bloco de foco,
// quem está na sala ganha os minutos no ranking de foco (model FocusDay).
// Para sozinho quando a sala esvazia ou alguém aperta "Parar".
const voiceStore = require('../services/voiceRoomStore');

const PRESETS = { '25-5': [25, 5], '50-10': [50, 10], '15-3': [15, 3] };
const MIN_FOCUS = 5;
const MAX_FOCUS = 90;
const TIME_ZONE = 'America/Sao_Paulo';

const rooms = new Map(); // roomId -> { phase, endsAt, focusMin, breakMin, round, startedBy, timer }

const dayKey = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const publicState = (st) => (st ? { phase: st.phase, endsAt: st.endsAt, focusMin: st.focusMin, breakMin: st.breakMin, round: st.round, startedBy: st.startedBy } : null);

function clampMinutes(focusMin, breakMin) {
  const f = Math.min(MAX_FOCUS, Math.max(MIN_FOCUS, Math.round(Number(focusMin) || 25)));
  const b = Math.min(30, Math.max(1, Math.round(Number(breakMin) || 5)));
  return [f, b];
}

async function creditFocus(roomId, minutes, { prisma = require('../config/prisma'), io = null, now = new Date() } = {}) {
  const room = await voiceStore.getRoom(roomId).catch(() => ({}));
  const uids = Object.entries(room).filter(([, p]) => p?.socketId && (!io || io.sockets?.sockets?.has?.(p.socketId))).map(([uid]) => uid);
  const day = dayKey(now);
  await Promise.all(uids.map((userId) => prisma.focusDay.upsert({
    where: { userId_day: { userId, day } }, create: { userId, day, minutes }, update: { minutes: { increment: minutes } },
  }).catch(() => null)));
  return uids;
}

function stop(io, roomId) {
  const st = rooms.get(roomId);
  if (st?.timer) clearTimeout(st.timer);
  rooms.delete(roomId);
  io?.to?.(`voice:${roomId}`).emit('focus:state', { channelId: roomId, state: null, serverNow: Date.now() });
}

function schedule(io, roomId) {
  const st = rooms.get(roomId);
  if (!st) return;
  clearTimeout(st.timer);
  st.timer = setTimeout(() => { advance(io, roomId).catch((e) => console.error('[estudos]', e?.message || e)); }, Math.max(0, st.endsAt - Date.now()));
  st.timer.unref?.();
}

async function advance(io, roomId) {
  const st = rooms.get(roomId);
  if (!st) return;
  if ((await voiceStore.roomSize(roomId).catch(() => 0)) === 0) { stop(io, roomId); return; }
  if (st.phase === 'focus') {
    const got = await creditFocus(roomId, st.focusMin, { io });
    io.to(`voice:${roomId}`).emit('focus:done', { channelId: roomId, minutes: st.focusMin, userIds: got });
    Object.assign(st, { phase: 'break', endsAt: Date.now() + st.breakMin * 60_000 });
  } else {
    Object.assign(st, { phase: 'focus', endsAt: Date.now() + st.focusMin * 60_000, round: st.round + 1 });
  }
  io.to(`voice:${roomId}`).emit('focus:state', { channelId: roomId, state: publicState(st), serverNow: Date.now() });
  schedule(io, roomId);
}

function register(io, socket, userId) {
  const inRoom = async (roomId) => !!roomId && voiceStore.hasParticipant(roomId, userId).catch(() => false);
  socket.on('focus:get', async ({ channelId } = {}) => {
    if (!(await inRoom(channelId))) return;
    socket.emit('focus:state', { channelId, state: publicState(rooms.get(channelId)), serverNow: Date.now() });
  });
  socket.on('focus:start', async ({ channelId, preset, focusMin, breakMin } = {}) => {
    if (!(await inRoom(channelId))) return;
    const [f, b] = PRESETS[preset] || clampMinutes(focusMin, breakMin);
    const old = rooms.get(channelId);
    if (old?.timer) clearTimeout(old.timer);
    rooms.set(channelId, { phase: 'focus', endsAt: Date.now() + f * 60_000, focusMin: f, breakMin: b, round: 1, startedBy: userId, timer: null });
    schedule(io, channelId);
    io.to(`voice:${channelId}`).emit('focus:state', { channelId, state: publicState(rooms.get(channelId)), serverNow: Date.now() });
  });
  socket.on('focus:stop', async ({ channelId } = {}) => {
    if (!(await inRoom(channelId)) || !rooms.has(channelId)) return;
    stop(io, channelId);
  });
}

/** Sala esvaziou (chamado junto do ytWatch.clearIfEmpty). */
async function clearIfEmpty(io, roomId) {
  if (!rooms.has(roomId)) return;
  if ((await voiceStore.roomSize(roomId).catch(() => 1)) === 0) stop(io, roomId);
}

function _test() { return { rooms, advance, stop, creditFocus }; }

module.exports = { register, clearIfEmpty, dayKey, clampMinutes, PRESETS, publicState, _test };
