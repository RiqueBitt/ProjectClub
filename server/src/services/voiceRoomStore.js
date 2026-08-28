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
};
