// "YouTube - Assistir juntos" dentro de chamadas de voz.
// Estado por sala de voz (mesmo id usado no voiceRoomStore: id do canal,
// "clan:<id>" ou id sintético de chamada de DM) guardado no Redis com TTL:
//   { videoId, title, playing, positionSec, updatedAt, hostId, queue[] }
// positionSec é a posição no instante updatedAt; quem recebe calcula a
// posição atual somando (agora - updatedAt) quando playing=true.
// Só quem está DENTRO da sala (voiceStore) pode ver/controlar; em canais
// de comunidade, controlar exige SPEAK; fechar exige ser o host ou ter
// MANAGE_CHANNELS.
const prisma = require('../config/prisma');
const { redis } = require('../config/redis');
const voiceStore = require('../services/voiceRoomStore');
const { getEffectivePermissions } = require('../services/authz');
const { has } = require('../services/permissions');

const KEY = (roomId) => `voice:yt:${roomId}`;
const TTL_SEC = 12 * 60 * 60;
const MAX_QUEUE = 50;
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

// Aceita id puro (11 chars) ou URLs watch?v=, youtu.be/, shorts/, embed/, live/.
function parseVideoId(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (ID_RE.test(s)) return s;
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '').toLowerCase();
  let id = null;
  if (host === 'youtu.be') id = u.pathname.split('/')[1];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/);
      if (m) id = m[2];
    }
  }
  return id && ID_RE.test(id) ? id : null;
}

function cleanTitle(t) {
  return typeof t === 'string' ? t.replace(/[\u0000-\u001f]/g, '').slice(0, 200) : null;
}

async function getState(roomId) {
  const raw = await redis.get(KEY(roomId));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
async function saveState(roomId, state) {
  if (!state) { await redis.del(KEY(roomId)); return; }
  await redis.set(KEY(roomId), JSON.stringify(state), 'EX', TTL_SEC);
}

// Posição "agora" a partir do snapshot.
function currentPos(st, now = Date.now()) {
  if (!st) return 0;
  return Math.max(0, (st.positionSec || 0) + (st.playing ? (now - (st.updatedAt || now)) / 1000 : 0));
}

function isCommunityChannelId(roomId) {
  return typeof roomId === 'string' && !roomId.startsWith('clan:') && !roomId.startsWith('dm:') && !roomId.includes(':');
}

// Permissões: precisa estar na sala; em canal de comunidade, SPEAK pra
// controlar; MANAGE_CHANNELS ou host pra fechar.
async function access(roomId, userId) {
  if (!roomId || typeof roomId !== 'string') return null;
  if (!(await voiceStore.hasParticipant(roomId, userId))) return null;
  let canControl = true; let canManage = false;
  if (isCommunityChannelId(roomId)) {
    const channel = await prisma.channel.findUnique({ where: { id: roomId } }).catch(() => null);
    if (channel) {
      const perms = await getEffectivePermissions(userId, roomId, channel);
      if (!has(perms, 'CONNECT')) return null;
      canControl = has(perms, 'SPEAK');
      canManage = has(perms, 'MANAGE_CHANNELS');
    }
  }
  return { canControl, canManage };
}

function register(io, socket, userId) {
  const broadcast = (roomId, state) => io.to(`voice:${roomId}`).emit('yt:state', { channelId: roomId, state: state || null, serverNow: Date.now() });
  const deny = (roomId, reason) => socket.emit('yt:error', { channelId: roomId, reason });

  // Envolve cada handler: checa acesso, carrega estado, aplica, salva, transmite.
  const on = (event, fn, { needControl = true } = {}) => {
    socket.on(event, async (payload = {}) => {
      try {
        const roomId = payload?.channelId;
        const acc = await access(roomId, userId);
        if (!acc) { deny(roomId, 'Você precisa estar na chamada.'); return; }
        if (needControl && !acc.canControl) { deny(roomId, 'Você não tem permissão para controlar o vídeo.'); return; }
        const st = await getState(roomId);
        // Sala esvaziou e o estado sobrou: descarta.
        const result = await fn({ roomId, st, payload, acc });
        if (result === undefined) return; // nada mudou
        await saveState(roomId, result);
        broadcast(roomId, result);
      } catch (err) { console.error(`[socket] ${event} falhou:`, err?.message || err); }
    });
  };

  on('yt:get', async ({ roomId, st }) => { socket.emit('yt:state', { channelId: roomId, state: st, serverNow: Date.now() }); return undefined; }, { needControl: false });

  on('yt:open', async ({ st, payload }) => {
    const videoId = parseVideoId(payload.videoId || payload.url);
    if (!videoId) { deny(payload.channelId, 'Link ou ID do YouTube inválido.'); return undefined; }
    return {
      videoId, title: cleanTitle(payload.title), playing: true, positionSec: 0, updatedAt: Date.now(),
      hostId: st?.hostId || userId, startedBy: userId,
      // mode 'music' = YouTube Music na call (só áudio + capa pra todo mundo).
      mode: payload.mode === 'music' ? 'music' : (payload.mode === 'video' ? 'video' : (st?.mode || 'video')),
      queue: st?.queue || [],
    };
  });

  on('yt:queue:add', async ({ st, payload }) => {
    const videoId = parseVideoId(payload.videoId || payload.url);
    if (!videoId) { deny(payload.channelId, 'Link ou ID do YouTube inválido.'); return undefined; }
    const item = { videoId, title: cleanTitle(payload.title), addedBy: userId };
    if (!st) return { videoId, title: item.title, playing: true, positionSec: 0, updatedAt: Date.now(), hostId: userId, startedBy: userId, mode: payload.mode === 'music' ? 'music' : 'video', queue: [] };
    if ((st.queue || []).length >= MAX_QUEUE) { deny(payload.channelId, 'A fila está cheia.'); return undefined; }
    return { ...st, queue: [...(st.queue || []), item] };
  });

  on('yt:queue:remove', async ({ st, payload }) => {
    if (!st) return undefined;
    const i = Number(payload.index);
    if (!Number.isInteger(i) || i < 0 || i >= (st.queue || []).length) return undefined;
    return { ...st, queue: st.queue.filter((_, j) => j !== i) };
  });

  on('yt:play', async ({ st, payload }) => {
    if (!st) return undefined;
    const pos = Number.isFinite(payload.positionSec) ? Math.max(0, payload.positionSec) : currentPos(st);
    return { ...st, playing: true, positionSec: pos, updatedAt: Date.now() };
  });

  on('yt:pause', async ({ st, payload }) => {
    if (!st) return undefined;
    const pos = Number.isFinite(payload.positionSec) ? Math.max(0, payload.positionSec) : currentPos(st);
    return { ...st, playing: false, positionSec: pos, updatedAt: Date.now() };
  });

  on('yt:seek', async ({ st, payload }) => {
    if (!st || !Number.isFinite(payload.positionSec)) return undefined;
    return { ...st, positionSec: Math.max(0, payload.positionSec), updatedAt: Date.now() };
  });

  // yt:next — pula pro próximo da fila; também usado no "terminou" (ended).
  // `fromVideoId` evita pular duas vezes quando vários clientes mandam
  // o mesmo "terminou" ao mesmo tempo.
  on('yt:next', async ({ st, payload }) => {
    if (!st) return undefined;
    if (payload.fromVideoId && payload.fromVideoId !== st.videoId) return undefined;
    const [next, ...rest] = st.queue || [];
    if (!next) return payload.fromVideoId ? { ...st, playing: false, positionSec: currentPos(st), updatedAt: Date.now() } : null;
    return { ...st, videoId: next.videoId, title: next.title || null, playing: true, positionSec: 0, updatedAt: Date.now(), startedBy: next.addedBy || userId, queue: rest };
  });

  on('yt:close', async ({ st, acc, payload }) => {
    if (!st) return undefined;
    if (st.hostId !== userId && !acc.canManage && isCommunityChannelId(payload.channelId)) {
      deny(payload.channelId, 'Só quem abriu ou quem gerencia o canal pode fechar.');
      return undefined;
    }
    return null;
  });
}

// Chamado em voice:sync — reenvia o estado atual a quem reconcilia.
async function sendState(socket, roomId) {
  try {
    const st = await getState(roomId);
    if (st) socket.emit('yt:state', { channelId: roomId, state: st, serverNow: Date.now() });
  } catch { /* ignora */ }
}

// Sala de voz esvaziou: limpa o estado.
async function clearIfEmpty(roomId) {
  try { if ((await voiceStore.roomSize(roomId)) === 0) await redis.del(KEY(roomId)); } catch { /* ignora */ }
}

module.exports = { register, sendState, clearIfEmpty, parseVideoId, currentPos };
