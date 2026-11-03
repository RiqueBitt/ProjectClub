// Resumo pro widget do Android ("Project Club — quem está online"): quantos
// amigos estão online agora e quem deles está em call (até 3 nomes).
//
// Privacidade (de propósito, mínimo):
// - Só amizades ACEITAS; nunca pedidos pendentes nem bloqueios.
// - Só nome de exibição — sem id, avatar, status personalizado nem canal.
// - Invisível conta como offline (mesma regra de maskUserStatus) e também
//   não aparece "em call".
// - Call só conta se quem pede o widget pudesse ver essa sala na própria
//   lista de voz (mesma regra do voice:rosters em sockets/index.js):
//   chamadas de DM nunca, sala de clã só do próprio clã, canal só com
//   VIEW_CHANNEL.
//
// Dependências injetáveis (testes rodam sem banco/Redis).
const { maskUserStatus } = require('../utils/presenceVisibility');

const ONLINE_STATUSES = new Set(['ONLINE', 'IDLE', 'DND']);
const MAX_VOICE_NAMES = 3;
const MAX_ROOMS_SCANNED = 300;
const NAME_MAX = 32;

function defaultDeps() {
  const { getEffectivePermissions } = require('./authz');
  const { has } = require('./permissions');
  return {
    db: require('../config/prisma'),
    voiceStore: require('./voiceRoomStore'),
    canViewChannel: async (userId, channelId) => {
      const perms = await getEffectivePermissions(userId, channelId).catch(() => null);
      return !!perms && has(perms, 'VIEW_CHANNEL');
    },
  };
}

function cleanName(user) {
  const raw = String(user?.displayName || user?.username || 'Amigo').replace(/\s+/g, ' ').trim();
  const chars = [...raw];
  return chars.length > NAME_MAX ? `${chars.slice(0, NAME_MAX - 1).join('')}…` : raw;
}

// Sala de voz que essa pessoa pode "ver"? (sem consultar permissão quando
// a regra já decide sozinha).
async function roomVisible(channelId, { viewerId, viewerClanId, canViewChannel }) {
  if (typeof channelId !== 'string' || !channelId) return false;
  if (channelId.startsWith('dm:')) return false;
  if (channelId.startsWith('clan:')) return !!viewerClanId && channelId === `clan:${viewerClanId}`;
  return canViewChannel(viewerId, channelId);
}

async function buildWidgetSummary(viewerId, deps = defaultDeps()) {
  const { db, voiceStore, canViewChannel } = deps;
  const select = { id: true, displayName: true, username: true, status: true };
  const [me, friendships] = await Promise.all([
    db.user.findUnique({ where: { id: viewerId }, select: { id: true, clanId: true } }),
    db.friendship.findMany({
      where: { status: 'ACCEPTED', OR: [{ requesterId: viewerId }, { addresseeId: viewerId }] },
      select: { requesterId: true, addresseeId: true, requester: { select }, addressee: { select } },
    }),
  ]);

  const friends = new Map();
  for (const f of friendships || []) {
    const other = f.requesterId === viewerId ? f.addressee : f.requester;
    if (!other || other.id === viewerId) continue;
    friends.set(other.id, maskUserStatus(other, viewerId));
  }
  const visibleOnline = (u) => ONLINE_STATUSES.has(u?.status);
  const onlineCount = [...friends.values()].filter(visibleOnline).length;

  // Quem dos amigos (visíveis) está em alguma sala de voz que eu veria.
  const inVoice = new Map();
  if (friends.size > 0) {
    const roomIds = (await voiceStore.getActiveRoomIds().catch(() => [])) || [];
    for (const channelId of roomIds.slice(0, MAX_ROOMS_SCANNED)) {
      // eslint-disable-next-line no-await-in-loop
      const room = await voiceStore.getRoom(channelId).catch(() => ({}));
      const friendIds = Object.keys(room || {}).filter((uid) => friends.has(uid) && !inVoice.has(uid) && visibleOnline(friends.get(uid)));
      if (friendIds.length === 0) continue; // nem consulta permissão de sala sem amigo
      // eslint-disable-next-line no-await-in-loop
      if (!(await roomVisible(channelId, { viewerId, viewerClanId: me?.clanId || null, canViewChannel }))) continue;
      for (const uid of friendIds) {
        const p = room[uid] || {};
        inVoice.set(uid, { name: cleanName(friends.get(uid)), joinedAt: Number(p.joinedAt) || 0 });
      }
    }
  }
  // Quem entrou por último primeiro (é o que muda na tela), nome como desempate.
  const voiceList = [...inVoice.values()].sort((a, b) => (b.joinedAt - a.joinedAt) || a.name.localeCompare(b.name, 'pt-BR'));

  return {
    onlineCount,
    friendCount: friends.size,
    inVoiceCount: voiceList.length,
    inVoice: voiceList.slice(0, MAX_VOICE_NAMES).map((v) => v.name),
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { buildWidgetSummary, roomVisible, cleanName, MAX_VOICE_NAMES };
