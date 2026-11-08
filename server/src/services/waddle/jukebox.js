'use strict';
// Jukebox da Danceteria (Club Penguin): quem está na sala coloca música do
// YouTube e TODO MUNDO da sala ouve a mesma coisa, no mesmo ponto.
//
// - Estado só na memória (o jogo roda num processo só): sala → música
//   tocando (com o instante em que começou) + fila. Quem entra na sala recebe
//   o estado e o player dele pula pro ponto certo (agora - startedAt).
// - Duração vem do YouTube (videoInfo); o servidor troca de música sozinho
//   quando acaba. Sem duração conhecida: para no máximo permitido ou quando
//   metade da sala avisar que acabou.
// - Pular: quem colocou a música ou a equipe pula na hora; o resto vota
//   (metade da sala). Vídeo que não toca fora do YouTube: metade da sala
//   avisando o erro → pula sozinho.
// - Limites: 3 músicas por pessoa na fila, 30 na fila, 10 min por música
//   (equipe: 1 h), 8 s entre um pedido e outro.

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

const ROOMS = { 120: 'Danceteria' };

const DEFAULT_LIMITS = {
  maxQueue: 30,
  perUser: 3,
  maxSec: 10 * 60,
  staffMaxSec: 60 * 60,
  addCooldownMs: 8000,
  unknownSec: 10 * 60, // sem duração: trava aqui
  endPadSec: 2, // folga pro último segundo tocar em todo mundo
  emptyStopMs: 2 * 60 * 1000, // sala vazia por 2 min: para e limpa a fila
  minEndedSec: 20, // "acabou" antes disso não vale (duração desconhecida)
};

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
    else id = u.pathname.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/)?.[2] || null;
  }
  return id && ID_RE.test(id) ? id : null;
}

/** "3:45" / "1:02:03" → segundos (null se não der). */
function parseClock(s) {
  const m = String(s || '').trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const sec = (Number(m[1] || 0) * 3600) + (Number(m[2]) * 60) + Number(m[3]);
  return sec > 0 ? sec : null;
}

const clean = (s, max = 160) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');

const fmtDur = (sec) => {
  const m = Math.floor(sec / 60); const s = Math.round(sec % 60);
  return m >= 60 ? `${Math.floor(m / 60)} h` : (s ? `${m} min ${s} s` : `${m} min`);
};

let seq = 0;
const newId = () => `${Date.now().toString(36)}${(seq++ % 1296).toString(36).padStart(2, '0')}`;

/**
 * @param {object} deps
 * @param {(room:number)=>Array<{userId:string|null,name:string}>} deps.players
 * @param {(userId:string)=>number|null} deps.roomOfUser
 * @param {(userId:string, event:string, payload:object)=>void} deps.emit
 * @param {(videoId:string)=>Promise<object|null>} deps.info
 * @param {(userId:string)=>Promise<boolean>} deps.isStaff
 */
function createJukebox({ players, roomOfUser, emit, info, isStaff, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, limits = {} }) {
  const L = { ...DEFAULT_LIMITS, ...limits };
  const rooms = new Map();

  const room = (id) => {
    let r = rooms.get(id);
    if (!r) {
      r = { id, current: null, queue: [], votes: new Set(), errors: new Set(), ended: new Set(), timer: null, emptyTimer: null, lastAdd: new Map() };
      rooms.set(id, r);
    }
    return r;
  };

  const listeners = (id) => [...new Set(players(id).map((p) => p.userId).filter(Boolean))];
  const nameOf = (id, userId) => players(id).find((p) => p.userId === userId)?.name || 'Alguém';
  const needed = (n) => Math.max(1, Math.ceil(n / 2));

  function snapshot(r) {
    const who = listeners(r.id);
    const inRoom = new Set(who);
    return {
      room: r.id,
      roomName: ROOMS[r.id],
      current: r.current,
      queue: r.queue,
      skip: { votes: [...r.votes].filter((u) => inRoom.has(u)), needed: needed(who.length) },
      listeners: who.length,
      limits: { perUser: L.perUser, maxSec: L.maxSec, maxQueue: L.maxQueue },
      serverNow: now(),
    };
  }

  function sendTo(userId, r, notice) {
    emit(userId, 'cpjb:state', { ...snapshot(r), notice: notice || null });
  }
  function broadcast(r, notice) {
    const s = { ...snapshot(r), notice: notice || null };
    for (const u of listeners(r.id)) emit(u, 'cpjb:state', s);
  }

  function schedule(r) {
    if (r.timer) clearTimer(r.timer);
    r.timer = null;
    if (!r.current) return;
    const total = (r.current.durationSec || L.unknownSec) + L.endPadSec;
    const left = Math.max(0, total * 1000 - (now() - r.current.startedAt));
    const playing = r.current.id;
    r.timer = setTimer(() => {
      r.timer = null;
      if (r.current?.id === playing) advance(r);
    }, left);
    r.timer?.unref?.();
  }

  function start(r, item) {
    r.current = { ...item, startedAt: now() };
    r.votes.clear(); r.errors.clear(); r.ended.clear();
    schedule(r);
  }

  function advance(r, notice) {
    const nobody = listeners(r.id).length === 0;
    const next = nobody ? null : r.queue.shift();
    if (nobody) r.queue = [];
    if (next) start(r, next);
    else {
      r.current = null;
      r.votes.clear(); r.errors.clear(); r.ended.clear();
      schedule(r);
    }
    broadcast(r, notice);
  }

  // Precisa estar numa sala com jukebox.
  function where(userId) {
    const id = roomOfUser(userId);
    return id != null && ROOMS[id] ? room(id) : null;
  }

  const fail = (userId, text) => { emit(userId, 'cpjb:error', { text }); return { ok: false, error: text }; };

  async function add(userId, payload = {}) {
    let r = where(userId);
    if (!r) return fail(userId, 'Entre na Danceteria pra colocar música.');
    const videoId = parseVideoId(payload.videoId || payload.url);
    if (!videoId) return fail(userId, 'Esse link não é de um vídeo do YouTube.');
    const staff = await isStaff(userId).catch(() => false);
    const last = r.lastAdd.get(userId) || 0;
    if (!staff && now() - last < L.addCooldownMs) return fail(userId, 'Calma! Espere uns segundos pra pedir outra música.');
    const mine = r.queue.filter((x) => x.by.userId === userId).length;
    if (!staff && mine >= L.perUser) return fail(userId, `Você já tem ${L.perUser} músicas na fila. Espere uma tocar.`);
    if (r.queue.length >= L.maxQueue) return fail(userId, 'A fila está cheia.');
    if (r.current?.videoId === videoId || r.queue.some((x) => x.videoId === videoId)) return fail(userId, 'Essa música já está tocando ou na fila.');
    r.lastAdd.set(userId, now());

    let meta = null;
    try { meta = await info(videoId); } catch { meta = null; }
    if (meta?.playable === false) return fail(userId, meta.reason || 'Esse vídeo não pode tocar fora do YouTube.');
    if (meta?.live) return fail(userId, 'Transmissão ao vivo não dá pra colocar na fila.');
    const hint = payload.hint && typeof payload.hint === 'object' ? payload.hint : {};
    const durationSec = meta?.durationSec || parseClock(hint.duration) || null;
    const max = staff ? L.staffMaxSec : L.maxSec;
    if (durationSec && durationSec > max) return fail(userId, `Música muito longa (máximo ${fmtDur(max)}).`);

    // a busca demorou: confere se ainda está na mesma sala
    r = where(userId);
    if (!r) return fail(userId, 'Você saiu da Danceteria.');
    if (r.current?.videoId === videoId || r.queue.some((x) => x.videoId === videoId)) return fail(userId, 'Essa música já está tocando ou na fila.');
    if (r.queue.length >= L.maxQueue) return fail(userId, 'A fila está cheia.');

    const item = {
      id: newId(),
      videoId,
      title: clean(meta?.title) || clean(hint.title) || 'Vídeo do YouTube',
      channel: clean(meta?.channel, 100) || clean(hint.channel, 100) || null,
      durationSec,
      by: { userId, name: nameOf(r.id, userId) },
    };
    if (!r.current) start(r, item);
    else r.queue.push(item);
    broadcast(r, { kind: 'add', text: `${item.by.name} colocou “${item.title}”` });
    return { ok: true, item };
  }

  async function skip(userId) {
    const r = where(userId);
    if (!r?.current) return { ok: false };
    const name = nameOf(r.id, userId);
    if (r.current.by.userId === userId || await isStaff(userId).catch(() => false)) {
      advance(r, { kind: 'skip', text: `${name} pulou “${r.current.title}”` });
      return { ok: true, skipped: true };
    }
    if (r.votes.has(userId)) r.votes.delete(userId); else r.votes.add(userId);
    if (checkVotes(r)) return { ok: true, skipped: true };
    broadcast(r);
    return { ok: true, skipped: false };
  }

  // votos de quem saiu não contam
  function checkVotes(r) {
    if (!r.current) return false;
    const inRoom = new Set(listeners(r.id));
    for (const set of [r.votes, r.errors, r.ended]) for (const u of set) if (!inRoom.has(u)) set.delete(u);
    const n = needed(inRoom.size);
    if (r.votes.size >= n && r.votes.size > 0) { advance(r, { kind: 'skip', text: `A sala votou e pulou “${r.current.title}”` }); return true; }
    if (r.errors.size >= n && r.errors.size > 0) { advance(r, { kind: 'error', text: `“${r.current.title}” não toca fora do YouTube — pulando.` }); return true; }
    if (r.ended.size >= n && r.ended.size > 0) { advance(r); return true; }
    return false;
  }

  async function remove(userId, itemId) {
    const r = where(userId);
    if (!r) return { ok: false };
    const i = r.queue.findIndex((x) => x.id === itemId);
    if (i < 0) return { ok: false };
    if (r.queue[i].by.userId !== userId && !(await isStaff(userId).catch(() => false))) return fail(userId, 'Só quem colocou (ou a equipe) tira da fila.');
    const [gone] = r.queue.splice(i, 1);
    broadcast(r, gone.by.userId === userId ? null : { kind: 'remove', text: `${nameOf(r.id, userId)} tirou “${gone.title}” da fila` });
    return { ok: true };
  }

  async function clear(userId) {
    const r = where(userId);
    if (!r || !(await isStaff(userId).catch(() => false))) return { ok: false };
    r.queue = [];
    advance(r, { kind: 'clear', text: `${nameOf(r.id, userId)} desligou o som` });
    return { ok: true };
  }

  // O player de quem ouve avisa: 'error' (não toca embutido) ou 'ended'.
  function report(userId, { videoId, kind } = {}) {
    const r = where(userId);
    if (!r?.current || r.current.videoId !== videoId) return;
    if (kind === 'error') r.errors.add(userId);
    else if (kind === 'ended') {
      // com duração conhecida o servidor já troca sozinho
      if (r.current.durationSec) return;
      if (now() - r.current.startedAt < L.minEndedSec * 1000) return;
      r.ended.add(userId);
    } else return;
    checkVotes(r);
  }

  function get(userId) {
    const id = roomOfUser(userId);
    if (id == null || !ROOMS[id]) { emit(userId, 'cpjb:state', { room: id, current: null, queue: [], serverNow: now(), off: true }); return; }
    sendTo(userId, room(id));
  }

  // Troca de sala (vem do tique de presença do jogo).
  function onRoomChange(userId, from, to) {
    if (from != null && ROOMS[from] && rooms.has(from)) {
      const r = rooms.get(from);
      r.votes.delete(userId); r.errors.delete(userId); r.ended.delete(userId);
      if (listeners(r.id).length === 0) {
        if (!r.emptyTimer && (r.current || r.queue.length)) {
          r.emptyTimer = setTimer(() => {
            r.emptyTimer = null;
            if (listeners(r.id).length === 0) { r.queue = []; r.current = null; schedule(r); }
          }, L.emptyStopMs);
          r.emptyTimer?.unref?.();
        }
      } else if (!checkVotes(r)) broadcast(r);
    }
    if (to != null && ROOMS[to]) {
      const r = room(to);
      if (r.emptyTimer) { clearTimer(r.emptyTimer); r.emptyTimer = null; }
      broadcast(r); // quem chegou recebe o estado; os outros, o novo nº de pessoas
    } else if (from != null && ROOMS[from]) {
      emit(userId, 'cpjb:state', { room: to, current: null, queue: [], serverNow: now(), off: true });
    }
  }

  return { add, skip, remove, clear, report, get, onRoomChange, _rooms: rooms, _snapshot: (id) => snapshot(room(id)) };
}

// ---------------------------------------------------------------------------
// Instância do site (Socket.IO + jogo de verdade).

let instance = null;

function init(io) {
  if (instance) return instance;
  const waddle = require('./index');
  const yt = require('../youtubeBrowse');
  const prisma = require('../../config/prisma');
  const staffCache = new Map(); // userId -> { at, v }
  instance = createJukebox({
    players: (id) => waddle.roomPlayers(id),
    roomOfUser: (userId) => waddle.roomOfUser(userId),
    emit: (userId, ev, payload) => { try { io.to(`user:${userId}`).emit(ev, payload); } catch { /* sem socket */ } },
    info: (id) => yt.videoInfo(id),
    isStaff: async (userId) => {
      const hit = staffCache.get(userId);
      if (hit && Date.now() - hit.at < 60_000) return hit.v;
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { platformRole: true } }).catch(() => null);
      const v = ['ADMIN', 'MODERATOR'].includes(u?.platformRole);
      staffCache.set(userId, { at: Date.now(), v });
      return v;
    },
  });
  waddle.onRoomChange((userId, from, to) => instance.onRoomChange(userId, from, to));
  return instance;
}

const get = () => instance;

module.exports = { createJukebox, init, get, parseVideoId, parseClock, ROOMS, DEFAULT_LIMITS };
