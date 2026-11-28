// Quem está assistindo cada partida agora. Em memória: cada espectador
// renova a presença a cada consulta e some depois de alguns segundos sem sinal.
const rooms = new Map(); // matchId -> Map(userId -> { at, name, avatarUrl })
const TTL = 12_000;

function prune(matchId) {
  const room = rooms.get(matchId);
  if (!room) return null;
  const now = Date.now();
  for (const [uid, v] of room) if (now - v.at > TTL) room.delete(uid);
  if (!room.size) { rooms.delete(matchId); return null; }
  return room;
}

function touch(matchId, user) {
  if (!matchId || !user?.id) return;
  let room = rooms.get(matchId);
  if (!room) { room = new Map(); rooms.set(matchId, room); }
  room.set(user.id, { at: Date.now(), name: user.displayName || 'Alguém', avatarUrl: user.avatarUrl || null });
  if (rooms.size > 2000) for (const id of [...rooms.keys()].slice(0, 200)) prune(id);
}

function leave(matchId, userId) { rooms.get(matchId)?.delete(userId); }
function count(matchId) { return prune(matchId)?.size || 0; }
function list(matchId, limit = 12) {
  const room = prune(matchId);
  return room ? [...room.entries()].slice(0, limit).map(([id, v]) => ({ id, displayName: v.name, avatarUrl: v.avatarUrl })) : [];
}

module.exports = { touch, leave, count, list };
