// Moderação de voz do servidor, igual ao Discord: Silenciar/Ensurdecer no
// servidor (MUTE_MEMBERS / DEAFEN_MEMBERS), Mover para… e Desconectar
// (MOVE_MEMBERS). Usado pelos handlers voice:server-mute/-deafen/move/
// disconnect em sockets/index.js.
//
// Hierarquia de cargos (authz.getRoleCeiling): só dá pra moderar quem tem o
// cargo mais alto ABAIXO do seu (ADMIN da plataforma/Administrador = teto
// infinito). A própria pessoa pode tirar o próprio mudo/ensurdecer se tiver
// a permissão.
//
// Dependências por parâmetro (testável sem banco — ver
// server/test/voice-moderacao.test.js).
const { has } = require('./permissions');

const ACTION_PERMISSION = {
  'server-mute': 'MUTE_MEMBERS',
  'server-deafen': 'DEAFEN_MEMBERS',
  move: 'MOVE_MEMBERS',
  disconnect: 'MOVE_MEMBERS',
};

const VOICE_TYPES = new Set(['VOICE', 'STAGE']);

// Regra pura: pode? Devolve null (pode) ou a mensagem de erro (pt-BR).
function checkModeration({ action, actorPerms, actorCeiling, targetCeiling, self = false }) {
  const permKey = ACTION_PERMISSION[action];
  if (!permKey) return 'Ação inválida.';
  if (!has(actorPerms, permKey)) return 'Você não tem permissão para isso.';
  if (self) return null;
  if (!(actorCeiling > targetCeiling)) return 'Você não pode moderar alguém com cargo igual ou maior que o seu.';
  return null;
}

// Autoriza uma ação de moderação num canal da comunidade. Devolve
// { ok:true, channel, target } ou { ok:false, error }.
async function authorize({ actorId, channelId, targetId, action, toChannelId = null }, deps) {
  const { prisma, getEffectivePermissions, getRoleCeiling, voiceStore } = deps;
  if (typeof channelId !== 'string' || !channelId || typeof targetId !== 'string' || !targetId) return { ok: false, error: 'Dados inválidos.' };
  // DM e clã não têm moderação de servidor.
  if (channelId.startsWith('dm:') || channelId.startsWith('clan:')) return { ok: false, error: 'Não disponível nesta chamada.' };
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) return { ok: false, error: 'Canal não encontrado.' };
  const target = await voiceStore.getParticipant(channelId, targetId);
  if (!target) return { ok: false, error: 'Essa pessoa não está neste canal de voz.' };
  const self = actorId === targetId;
  const [actorPerms, actorCeiling, targetCeiling] = await Promise.all([
    getEffectivePermissions(actorId, channelId, channel),
    self ? Promise.resolve(0) : getRoleCeiling(actorId),
    self ? Promise.resolve(0) : getRoleCeiling(targetId),
  ]);
  const err = checkModeration({ action, actorPerms, actorCeiling, targetCeiling, self });
  if (err) return { ok: false, error: err };
  let toChannel = null;
  if (action === 'move') {
    if (typeof toChannelId !== 'string' || !toChannelId || toChannelId === channelId) return { ok: false, error: 'Escolha outro canal de voz.' };
    if (toChannelId.startsWith('dm:') || toChannelId.startsWith('clan:')) return { ok: false, error: 'Só dá pra mover para canais de voz da comunidade.' };
    toChannel = await prisma.channel.findUnique({ where: { id: toChannelId } });
    if (!toChannel || !VOICE_TYPES.has(toChannel.type)) return { ok: false, error: 'Canal de destino inválido.' };
    // Quem move precisa poder ver e entrar no destino (igual ao Discord).
    const destPerms = await getEffectivePermissions(actorId, toChannelId, toChannel);
    if (!has(destPerms, 'VIEW_CHANNEL') || !has(destPerms, 'CONNECT')) return { ok: false, error: 'Você não tem acesso ao canal de destino.' };
  }
  return { ok: true, channel, target, toChannel };
}

module.exports = { checkModeration, authorize, ACTION_PERMISSION };
