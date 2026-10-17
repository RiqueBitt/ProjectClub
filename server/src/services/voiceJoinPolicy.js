// Regras de ENTRADA na voz decididas no servidor, antes de emitir o token
// de mídia (GET /api/voice/join) — igual ao Discord:
//   - claims do JWT do servidor de mídia: canSpeak (SPEAK), canVideo
//     (VIDEO), role do palco (plateia não fala nem transmite) e o mudo/
//     ensurdecer da moderação — o servidor de mídia APLICA isso (ver
//     media-server/src/permissions.js);
//   - limite de usuários do canal: cheio → 403 { code: 'channel-full',
//     error: 'Canal cheio' }. Quem tem MOVER MEMBROS fura o limite, quem já
//     está na sala (reconexão/troca de provedor) também, e quem foi movido
//     por um moderador (ticket de 60s).
//
// As dependências entram por parâmetro (testável sem banco/Redis — ver
// server/test/voice-moderacao.test.js).
const { has } = require('./permissions');

const ALL_ALLOWED = { canSpeak: true, canVideo: true, role: 'speaker', serverMuted: false, serverDeafened: false };

function isStageModerator(perms) {
  return has(perms, 'MUTE_MEMBERS') || has(perms, 'MOVE_MEMBERS') || has(perms, 'MANAGE_CHANNELS');
}

// Claims a partir das permissões efetivas + estado da sala/moderação (puro).
function claimsFor({ perms, channel, participant, modState }) {
  let role = 'speaker';
  if (channel && channel.type === 'STAGE') {
    // Já está na sala: vale o papel atual (promovido/rebaixado no palco).
    if (participant && (participant.role === 'speaker' || participant.role === 'audience')) role = participant.role;
    else role = isStageModerator(perms) ? 'speaker' : 'audience';
  }
  const audience = role === 'audience';
  const serverDeafened = !!(modState && modState.serverDeafened);
  return {
    canSpeak: has(perms, 'SPEAK') && !audience,
    canVideo: has(perms, 'VIDEO') && !audience,
    role,
    // Ensurdecido pela moderação também não fala.
    serverMuted: !!(modState && modState.serverMuted) || serverDeafened,
    serverDeafened,
  };
}

// Limite de usuários (puro). bypass = MOVER MEMBROS / já na sala / movido.
function isFull({ userLimit, size, bypass }) {
  const max = Number(userLimit) > 0 ? Number(userLimit) : 0;
  if (!max || bypass) return false;
  return size >= max;
}

const FULL_ERROR = Object.freeze({ status: 403, code: 'channel-full', message: 'Canal cheio' });

// Avalia a entrada. `deps`: { prisma, getEffectivePermissions, voiceStore }.
// Devolve { claims, error? }.
async function evaluate(user, channelName, deps = {}) {
  const name = String(channelName || '');
  // DM e clã: sem moderação de servidor nem limite.
  if (!name || name.startsWith('dm:') || name.startsWith('clan:')) return { claims: { ...ALL_ALLOWED } };
  const prisma = deps.prisma || require('../config/prisma');
  const getEffectivePermissions = deps.getEffectivePermissions || require('./authz').getEffectivePermissions;
  const voiceStore = deps.voiceStore || require('./voiceRoomStore');
  const channel = await prisma.channel.findUnique({ where: { id: name } });
  if (!channel) return { claims: { ...ALL_ALLOWED } };
  const [perms, participant, modState] = await Promise.all([
    getEffectivePermissions(user.id, channel.id, channel),
    voiceStore.getParticipant(name, user.id).catch(() => null),
    voiceStore.getModState ? voiceStore.getModState(user.id).catch(() => null) : null,
  ]);
  const claims = claimsFor({ perms, channel, participant, modState });
  // Canal AFK da comunidade: ninguém fala lá (igual ao Discord).
  const afk = deps.voiceAfk || require('./voiceAfk');
  if (await afk.isAfkChannel(name, { prisma }).catch(() => false)) claims.canSpeak = false;
  if (Number(channel.userLimit) > 0 && !participant) {
    const bypass = has(perms, 'MOVE_MEMBERS')
      || (voiceStore.hasMoveTicket ? await voiceStore.hasMoveTicket(user.id, name).catch(() => false) : false);
    const size = await voiceStore.roomSize(name).catch(() => 0);
    if (isFull({ userLimit: channel.userLimit, size, bypass })) return { claims, error: { ...FULL_ERROR } };
  }
  return { claims };
}

module.exports = { evaluate, claimsFor, isFull, isStageModerator, FULL_ERROR, ALL_ALLOWED };
