// Quem está em cada canal de voz agora, e o estado de cada chamada de DM
// em andamento — vive no Redis (não mais em memória do processo), pra
// funcionar certo se a plataforma um dia rodar em mais de uma instância.
// Uma Hash por canal (`voice:room:<channelId>`, campo = userId, valor =
// JSON do participante) + um Set (`voice:activeRooms`) com os ids de
// todo canal que tem gente dentro agora, pra dar pra checar "essa pessoa
// já está em algum OUTRO canal de voz?" sem precisar escanear todas as
// chaves do Redis (isso seria lento e ruim de escalar).
const { redis } = require('../config/redis');

const roomKey = (channelId) => `voice:room:${channelId}`;
const startedAtKey = (channelId) => `voice:startedAt:${channelId}`;
const ACTIVE_ROOMS_KEY = 'voice:activeRooms';
const dmCallKey = (channelId) => `voice:dmcall:${channelId}`;

async function getRoom(channelId) {
  const raw = await redis.hgetall(roomKey(channelId));
  const room = {};
  for (const [userId, json] of Object.entries(raw)) {
    try { room[userId] = JSON.parse(json); } catch { /* entrada corrompida — ignora */ }
  }
  return room; // {} se a sala não existe ou está vazia
}

async function getParticipant(channelId, userId) {
  const raw = await redis.hget(roomKey(channelId), userId);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function setParticipant(channelId, userId, state) {
  await redis.hset(roomKey(channelId), userId, JSON.stringify(state));
  await redis.sadd(ACTIVE_ROOMS_KEY, channelId);
}

// Lê o participante atual, aplica as mudanças (patch) por cima, e salva —
// usado pelos handlers de mudo/câmera/fala, que só alteram alguns campos
// sem mexer no resto. Devolve o participante já atualizado (ou null se
// ele não estava na sala).
async function updateParticipant(channelId, userId, patch) {
  const current = await getParticipant(channelId, userId);
  if (!current) return null;
  const updated = { ...current, ...patch };
  await redis.hset(roomKey(channelId), userId, JSON.stringify(updated));
  return updated;
}

// ---------- Entrada atômica com limite de usuários ----------
// Antes: lia o tamanho da sala, comparava com o limite e só DEPOIS gravava —
// duas pessoas entrando juntas no último lugar passavam as duas. Agora o
// "confere e grava" é um script Lua (atômico no Redis). Resultado:
//   { status: 'added', size }  → entrou (size = tamanho DEPOIS de entrar)
//   { status: 'exists', size } → já estava (reconciliação, nada gravado)
//   { status: 'full', size }   → cheio (limit > 0 e size >= limit)
// limit 0/null = sem limite (ex.: quem tem MOVER MEMBROS fura o limite).
const ADD_IF_ROOM_LUA = `
local exists = redis.call('HEXISTS', KEYS[1], ARGV[1])
local size = redis.call('HLEN', KEYS[1])
if exists == 1 then return {2, size} end
local limit = tonumber(ARGV[3])
if limit > 0 and size >= limit then return {0, size} end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('SADD', KEYS[2], ARGV[4])
return {1, size + 1}
`;

// Regra pura (a mesma do Lua) — usada no caminho reserva e nos testes.
function decideAdd({ exists, size, limit }) {
  if (exists) return 'exists';
  const max = Number(limit) > 0 ? Number(limit) : 0;
  if (max > 0 && size >= max) return 'full';
  return 'added';
}

async function addParticipantIfRoom(channelId, userId, state, limit = 0) {
  const max = Number(limit) > 0 ? Math.floor(Number(limit)) : 0;
  if (typeof redis.eval === 'function') {
    try {
      const [code, size] = await redis.eval(ADD_IF_ROOM_LUA, 2, roomKey(channelId), ACTIVE_ROOMS_KEY, userId, JSON.stringify(state), String(max), channelId);
      return { status: code === 1 ? 'added' : code === 2 ? 'exists' : 'full', size: Number(size) };
    } catch (err) {
      // Redis sem EVAL (proxy/serviço que bloqueia scripts): cai pro caminho
      // reserva abaixo, serializado por canal neste processo.
      if (!/unknown command|NOSCRIPT|not allowed|ERR/i.test(String(err?.message))) throw err;
    }
  }
  return withLocalLock(`room:${channelId}`, async () => {
    const [exists, size] = await Promise.all([hasParticipant(channelId, userId), roomSize(channelId)]);
    const status = decideAdd({ exists, size, limit: max });
    if (status !== 'added') return { status, size };
    await setParticipant(channelId, userId, state);
    return { status, size: size + 1 };
  });
}

// ---------- Travas ----------
// Trava LOCAL (neste processo): fila de promessas por chave — quem chega
// enquanto outro está dentro espera ele terminar.
const localLocks = new Map(); // key -> Promise
function withLocalLock(key, fn) {
  const prev = localLocks.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  localLocks.set(key, tail);
  tail.then(() => { if (localLocks.get(key) === tail) localLocks.delete(key); });
  return run;
}

// Trava por pessoa+canal (e entre instâncias, pelo Redis com SET NX PX):
// dois voice:join iguais ao mesmo tempo (clique duplo, aba duplicada,
// reenvio) rodam UM DEPOIS DO OUTRO — o segundo vira só reconciliação e o
// voice:user-joined não sai duas vezes. Redis fora do ar: vale só a trava
// local (nunca bloqueia a entrada por causa da trava).
const RELEASE_LUA = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
async function withLock(key, fn, { ttlMs = 8000, waitMs = 4000, stepMs = 40 } = {}) {
  return withLocalLock(key, async () => {
    const lockKey = `voice:lock:${key}`;
    const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    let held = false;
    const deadline = Date.now() + waitMs;
    try {
      while (!held) {
        // eslint-disable-next-line no-await-in-loop
        const r = await redis.set(lockKey, token, 'PX', ttlMs, 'NX');
        if (r === 'OK') { held = true; break; }
        if (Date.now() >= deadline) break; // outra instância travou demais: segue mesmo assim
        // eslint-disable-next-line no-await-in-loop
        await new Promise((res) => { setTimeout(res, stepMs); });
      }
    } catch { /* Redis fora: só a trava local */ }
    try {
      return await fn();
    } finally {
      if (held) {
        try {
          if (typeof redis.eval === 'function') await redis.eval(RELEASE_LUA, 1, lockKey, token);
          else await redis.del(lockKey);
        } catch { /* expira sozinha */ }
      }
    }
  });
}

// ---------- Moderação de voz (mudo/ensurdecer DO SERVIDOR) ----------
// Igual ao Discord: o mudo do servidor é da PESSOA na comunidade (vale em
// qualquer canal até um moderador tirar), não só da sala atual.
const modKey = (userId) => `voice:mod:${userId}`;
async function getModState(userId) {
  try {
    const raw = await redis.get(modKey(userId));
    const v = raw ? JSON.parse(raw) : {};
    return { serverMuted: v.serverMuted === true, serverDeafened: v.serverDeafened === true };
  } catch { return { serverMuted: false, serverDeafened: false }; }
}
async function setModState(userId, patch = {}) {
  const cur = await getModState(userId);
  const next = {
    serverMuted: typeof patch.serverMuted === 'boolean' ? patch.serverMuted : cur.serverMuted,
    serverDeafened: typeof patch.serverDeafened === 'boolean' ? patch.serverDeafened : cur.serverDeafened,
  };
  if (!next.serverMuted && !next.serverDeafened) await redis.del(modKey(userId));
  else await redis.set(modKey(userId), JSON.stringify(next));
  return next;
}

// "Mover para…": o moderador moveu a pessoa pra um canal — por 60s ela
// pode entrar nele mesmo cheio (igual ao Discord).
const moveTicketKey = (userId, channelId) => `voice:moveticket:${userId}:${channelId}`;
async function grantMoveTicket(userId, channelId, ttlSec = 60) {
  try { await redis.set(moveTicketKey(userId, channelId), '1', 'EX', ttlSec); } catch { /* opcional */ }
}
async function hasMoveTicket(userId, channelId) {
  try { return !!(await redis.get(moveTicketKey(userId, channelId))); } catch { return false; }
}

async function removeParticipant(channelId, userId) {
  await redis.hdel(roomKey(channelId), userId);
  const size = await redis.hlen(roomKey(channelId));
  if (size === 0) await redis.srem(ACTIVE_ROOMS_KEY, channelId);
  return size;
}

async function roomSize(channelId) {
  return redis.hlen(roomKey(channelId));
}

async function hasParticipant(channelId, userId) {
  return (await redis.hexists(roomKey(channelId), userId)) === 1;
}

// Ids de TODA sala de voz com gente dentro agora — usado pra checar "essa
// pessoa já está em outro canal de voz?" antes de deixar ela entrar num
// novo (só se pode estar numa chamada de voz por vez, igual o Discord).
async function getActiveRoomIds() {
  return redis.smembers(ACTIVE_ROOMS_KEY);
}

async function deleteRoom(channelId) {
  await redis.del(roomKey(channelId));
  await redis.srem(ACTIVE_ROOMS_KEY, channelId);
  await redis.del(startedAtKey(channelId));
}

async function getStartedAt(channelId) {
  const raw = await redis.get(startedAtKey(channelId));
  return raw ? parseInt(raw, 10) : null;
}
async function setStartedAt(channelId, timestamp) {
  await redis.set(startedAtKey(channelId), String(timestamp));
}
async function clearStartedAt(channelId) {
  await redis.del(startedAtKey(channelId));
}

// ---------- Estado de chamada de DM (o embed "📞 Chamada de voz" no chat
// — precisa saber se já foi atendida/resolvida pra editar a mensagem
// certa na hora certa) ----------
async function getDmCallState(channelId) {
  const raw = await redis.get(dmCallKey(channelId));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
async function setDmCallState(channelId, state) {
  await redis.set(dmCallKey(channelId), JSON.stringify(state));
}
async function updateDmCallState(channelId, patch) {
  const current = await getDmCallState(channelId);
  if (!current) return null;
  const updated = { ...current, ...patch };
  await redis.set(dmCallKey(channelId), JSON.stringify(updated));
  return updated;
}
async function clearDmCallState(channelId) {
  await redis.del(dmCallKey(channelId));
}

// Limpa TODA sala de voz de uma vez — chamado uma vez no boot do
// servidor (ver src/index.js), nunca durante o funcionamento normal.
// BUG CORRIGIDO ("áudio não funciona em lugar nenhum, mesmo depois da
// correção de autoplay"): nenhum registro de participante aqui tinha
// TTL nem era limpo automaticamente — só sumia quando a pessoa saía do
// canal de verdade (removeParticipant) ou desconectava (leaveVoice no
// disconnect). Se o processo do servidor for encerrado abruptamente
// (deploy, restart, crash) ENQUANTO alguém está numa chamada, o evento
// de desconexão daquele socket não necessariamente termina de rodar a
// tempo — o registro dela fica "preso" no Redis pra sempre, com um
// socketId que já não existe mais. Depois de vários restarts (comuns
// durante o desenvolvimento), esses registros fantasmas se acumulam. O
// pior efeito: a checagem de "a pessoa já é participante desse canal?"
// (ver voice:join em sockets/index.js) encontrava esse fantasma e
// tratava uma entrada nova de VERDADE como se fosse só uma reconexão —
// pulando o aviso pros outros participantes e a negociação WebRTC
// completa, resultando em conectar "silenciosamente" sem nunca trocar
// áudio com ninguém. Como NENHUMA conexão de socket sobrevive a um
// restart do processo (é fisicamente impossível), é sempre seguro — e
// sempre correto — começar do zero: qualquer sala de voz que exista no
// Redis assim que o servidor liga é necessariamente inválida.
async function clearAllRooms() {
  let cursor = '0';
  const patterns = ['voice:room:*', 'voice:startedAt:*', 'voice:dmcall:*'];
  for (const pattern of patterns) {
    cursor = '0';
    do {
      // eslint-disable-next-line no-await-in-loop
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = nextCursor;
      // eslint-disable-next-line no-await-in-loop
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
  }
  await redis.del(ACTIVE_ROOMS_KEY);
}

module.exports = {
  getRoom, getParticipant, setParticipant, updateParticipant, removeParticipant,
  roomSize, hasParticipant, getActiveRoomIds, deleteRoom,
  getStartedAt, setStartedAt, clearStartedAt,
  getDmCallState, setDmCallState, updateDmCallState, clearDmCallState,
  clearAllRooms,
  addParticipantIfRoom, decideAdd, withLock, withLocalLock,
  getModState, setModState, grantMoveTicket, hasMoveTicket,
};
