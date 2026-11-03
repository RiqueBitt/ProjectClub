// Praça virtual 2D em tempo real (Fase 8). Regras puras em services/plaza.js.
//
// Eventos (cliente → servidor):
//   plaza:join { room? }   entra (ou troca de sala); resposta: plaza:state
//   plaza:move { x, y, dir }  anda (limitado a ~15/s e MAX_STEP por passo)
//   plaza:say { text }     fala (balão) — só quem está perto recebe
//   plaza:leave            sai
//   plaza:rooms            lista as salas abertas (plaza:rooms)
// Servidor → cliente:
//   plaza:state, plaza:snapshot (posições, ~10/s, só quando algo mudou),
//   plaza:member-joined, plaza:member-left, plaza:bubble, plaza:error,
//   plaza:replaced (a pessoa abriu a Praça em outra aba/aparelho).
//
// Estado só em memória desta instância do servidor (cada instância tem as
// próprias salas). Ninguém fica "preso": desconectou, sai da sala.
const P = require('../services/plaza');

const getPrisma = () => require('../config/prisma');

async function defaultLoadProfile(userId) {
  const db = getPrisma();
  const [user, pet] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { id: true, displayName: true, username: true, avatarUrl: true } }),
    db.petPenguin.findUnique({ where: { userId }, select: { color: true, stage: true, equipped: true } }).catch(() => null),
  ]);
  if (!user) return null;
  let equipped = {};
  try { equipped = pet?.equipped ? JSON.parse(pet.equipped) : {}; } catch { equipped = {}; }
  return {
    displayName: user.displayName, username: user.username, avatarUrl: user.avatarUrl || null,
    color: pet?.color || null, stage: pet?.stage ?? 0, equipped,
  };
}

// Moderação da fala: link de convite e regras do automod da comunidade
// (palavras bloqueadas, links, phishing...). Só bloqueia a fala — sem
// punição automática aqui.
async function defaultModerate(userId, text) {
  try {
    if (require('../services/dmAutomod').containsInviteLink(text)) return { ok: false, reason: 'Links de convite não são permitidos na Praça.' };
    const hit = await require('../services/automod').checkMessage({ channelId: 'plaza', userId, content: text });
    if (hit) return { ok: false, reason: 'Essa mensagem foi bloqueada pela moderação automática.' };
  } catch { /* automod indisponível: segue */ }
  return { ok: true };
}

let voiceCache = { at: 0, value: null };
async function defaultVoiceChannel() {
  const id = process.env.PLAZA_VOICE_CHANNEL_ID;
  if (!id) return null;
  if (Date.now() - voiceCache.at < 60_000) return voiceCache.value;
  const ch = await getPrisma().channel.findUnique({ where: { id }, select: { id: true, name: true, type: true } }).catch(() => null);
  voiceCache = { at: Date.now(), value: ch && ['VOICE', 'STAGE'].includes(ch.type) ? ch : null };
  return voiceCache.value;
}

function createPlaza({ loadProfile = defaultLoadProfile, moderate = defaultModerate, voiceChannel = defaultVoiceChannel, now = () => Date.now() } = {}) {
  const rooms = new Map(); // roomId -> Map(userId -> member)
  const byUser = new Map(); // userId -> roomId
  const dirty = new Set();
  let timer = null;
  let bubbleSeq = 0;

  const sizes = () => new Map([...rooms].map(([id, m]) => [id, m.size]));
  const roomList = () => [...rooms].filter(([, m]) => m.size > 0).map(([id, m]) => ({ id, label: P.roomLabel(id), count: m.size, cap: P.ROOM_CAP })).sort((a, b) => Number(a.id) - Number(b.id));
  const publicMember = (m) => ({ userId: m.userId, x: m.x, y: m.y, dir: m.dir, ...m.profile });

  function flush(io) {
    for (const roomId of dirty) {
      const members = rooms.get(roomId);
      if (!members?.size) continue;
      io.to(`plaza:${roomId}`).emit('plaza:snapshot', { room: roomId, t: now(), p: [...members.values()].map((m) => [m.userId, m.x, m.y, m.dir]) });
    }
    dirty.clear();
  }

  function ensureTimer(io) {
    if (timer) return;
    timer = setInterval(() => {
      flush(io);
      if (!byUser.size) { clearInterval(timer); timer = null; }
    }, P.SNAPSHOT_MS);
    timer.unref?.();
  }

  // Tira a pessoa da sala (sem checar qual conexão pediu).
  function removeMember(io, userId) {
    const roomId = byUser.get(userId);
    if (!roomId) return false;
    const members = rooms.get(roomId);
    const m = members?.get(userId);
    members?.delete(userId);
    byUser.delete(userId);
    if (members && !members.size) rooms.delete(roomId);
    const sock = m ? io.sockets?.sockets?.get?.(m.socketId) : null;
    sock?.leave?.(`plaza:${roomId}`);
    io.to(`plaza:${roomId}`).emit('plaza:member-left', { room: roomId, userId });
    return true;
  }

  // Saída pedida por uma conexão: só vale se for a conexão "dona" da vaga
  // (se outra aba já assumiu, a antiga desconectando não derruba a nova).
  function leave(io, userId, socket) {
    const roomId = byUser.get(userId);
    const m = roomId && rooms.get(roomId)?.get(userId);
    if (!m || (socket && m.socketId !== socket.id)) return false;
    socket?.leave?.(`plaza:${roomId}`);
    return removeMember(io, userId);
  }

  async function join(io, socket, userId, { room } = {}) {
    // Já estava na Praça (outra aba/aparelho ou troca de sala): sai antes.
    const prevRoom = byUser.get(userId);
    if (prevRoom) {
      const old = rooms.get(prevRoom)?.get(userId);
      if (old && old.socketId !== socket.id) io.to(old.socketId).emit('plaza:replaced', {});
      socket.leave?.(`plaza:${prevRoom}`);
      removeMember(io, userId);
    }
    const roomId = P.pickRoom(sizes(), room);
    if (!roomId) { socket.emit('plaza:error', { error: 'Todas as praças estão lotadas agora. Tente de novo daqui a pouco.' }); return null; }
    const profile = await loadProfile(userId);
    if (!profile || socket.connected === false) return null;
    // Enquanto carregava o perfil, outra conexão pode ter entrado.
    if (byUser.has(userId)) removeMember(io, userId);
    if ((rooms.get(roomId)?.size || 0) >= P.ROOM_CAP) { socket.emit('plaza:error', { error: 'Essa praça acabou de lotar. Tente outra.' }); return null; }
    const pos = P.spawnPoint();
    const t = now();
    const member = { userId, socketId: socket.id, x: pos.x, y: pos.y, dir: 'down', profile, move: P.makeMoveBucket(t), chat: P.makeChatBucket(t) };
    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    rooms.get(roomId).set(userId, member);
    byUser.set(userId, roomId);
    socket.join(`plaza:${roomId}`);
    const voice = await voiceChannel().catch(() => null);
    socket.emit('plaza:state', {
      room: roomId, label: P.roomLabel(roomId), rooms: roomList(),
      map: { w: P.MAP_W, h: P.MAP_H, zones: P.ZONES }, radius: P.PROXIMITY_RADIUS, chatMax: P.CHAT_MAX, cap: P.ROOM_CAP,
      me: publicMember(member), members: [...rooms.get(roomId).values()].map(publicMember), voice,
    });
    socket.to(`plaza:${roomId}`).emit('plaza:member-joined', { room: roomId, member: publicMember(member) });
    ensureTimer(io);
    return roomId;
  }

  function memberOf(userId, socket) {
    const roomId = byUser.get(userId);
    const m = roomId && rooms.get(roomId)?.get(userId);
    if (!m || m.socketId !== socket.id) return null;
    return { roomId, m };
  }

  function move(io, socket, userId, payload = {}) {
    const found = memberOf(userId, socket);
    if (!found) return false;
    const { roomId, m } = found;
    if (!P.takeToken(m.move, now())) return false;
    const next = P.validateMove(m, payload);
    if (!next) return false;
    m.x = next.x; m.y = next.y;
    if (['up', 'down', 'left', 'right'].includes(payload.dir)) m.dir = payload.dir;
    dirty.add(roomId);
    ensureTimer(io);
    return true;
  }

  async function say(io, socket, userId, payload = {}) {
    const found = memberOf(userId, socket);
    if (!found) return false;
    const { roomId, m } = found;
    const text = P.sanitizeChat(payload.text);
    if (!text) return false;
    if (!P.takeToken(m.chat, now())) { socket.emit('plaza:error', { error: 'Calma! Espere um pouquinho antes de falar de novo.' }); return false; }
    const verdict = await moderate(userId, text);
    if (!verdict?.ok) { socket.emit('plaza:error', { error: verdict?.reason || 'Mensagem bloqueada.' }); return false; }
    const members = [...(rooms.get(roomId)?.values() || [])];
    const bubble = { id: `${now()}-${(bubbleSeq += 1)}`, userId, text, at: now() };
    for (const l of P.listenersFor(m, members)) io.to(l.socketId).emit('plaza:bubble', bubble);
    return true;
  }

  function register(io, socket, userId) {
    const safe = (fn) => async (payload) => { try { await fn(payload || {}); } catch (e) { console.error('[praça]', e?.message || e); } };
    socket.on('plaza:join', safe((p) => join(io, socket, userId, { room: p.room })));
    socket.on('plaza:move', safe((p) => move(io, socket, userId, p)));
    socket.on('plaza:say', safe((p) => say(io, socket, userId, p)));
    socket.on('plaza:leave', safe(() => leave(io, userId, socket)));
    socket.on('plaza:rooms', safe(() => socket.emit('plaza:rooms', { rooms: roomList(), cap: P.ROOM_CAP })));
    socket.on('disconnect', () => { try { leave(io, userId, socket); } catch { /* ignora */ } });
  }

  return { register, join, move, say, leave, removeMember, flush, roomList, _state: { rooms, byUser, dirty } };
}

const plaza = createPlaza();

module.exports = { createPlaza, register: plaza.register, plaza };
