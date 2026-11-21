const prisma = require('../config/prisma');
const { PERMISSIONS, computeBasePermissions, applyOverwrites, has, toStringBits } = require('./permissions');

const ALL_PERMISSIONS = Object.values(PERMISSIONS).reduce((acc, bit) => acc | bit, 0n);

class ForbiddenError extends Error {
  constructor(message = 'Sem permissão.') {
    super(message);
    this.status = 403;
  }
}

// A comunidade tem um único cargo "@todos" (isDefault) — equivalente ao
// antigo @everyone por servidor, agora global. Toda conta nova ganha esse
// cargo automaticamente no cadastro (ver authController.register).
// Item pedido: "melhore ao máximo, deixando mais rápido... prevenindo
// erros de demora" — o cargo @everyone (isDefault: true) quase nunca
// muda (só se a staff editar isso explicitamente, raríssimo), mas
// antes era buscado do banco em TODA chamada de getEffectivePermissions
// — que por sua vez roda em praticamente toda ação da plataforma
// (carregar mensagens, enviar mensagem, entrar em call, etc.). Cache
// simples em memória com TTL curto (60s) — reduz uma query inteira do
// caminho mais quente do app sem risco real: se a staff mudar o cargo
// padrão, o efeito aparece em no máximo 1 minuto, não instantâneo, mas
// isso já era assim de qualquer forma nesse tipo de configuração rara.
let everyoneRoleCache = null;
let everyoneRoleCacheAt = 0;
const EVERYONE_ROLE_CACHE_MS = 60_000;

async function getEveryoneRole() {
  const now = Date.now();
  if (everyoneRoleCache && (now - everyoneRoleCacheAt) < EVERYONE_ROLE_CACHE_MS) return everyoneRoleCache;
  everyoneRoleCache = await prisma.role.findFirst({ where: { isDefault: true } });
  everyoneRoleCacheAt = now;
  return everyoneRoleCache;
}

// Calcula o bitfield de permissões efetivas de um usuário na comunidade
// inteira, opcionalmente já aplicando as sobrescritas de um canal
// específico. ADMIN da plataforma sempre tem tudo, igual ao dono de
// servidor no EmberCord original.
//
// Item pedido: "melhore ao máximo... mais rápido" — duas otimizações
// reais aqui (nenhuma muda o resultado final, só como ele é calculado):
// 1) user/userRoles/everyoneRole não dependem um do outro — rodavam em
//    sequência (3 idas e voltas ao banco, uma depois da outra) sem
//    motivo, agora em paralelo (Promise.all).
// 2) `knownChannel` opcional — quem já carregou o canal antes de
//    chamar essa função (o caso mais comum: messageController.js's
//    assertAccess já faz exatamente isso) pode passar ele direto,
//    evitando buscar o MESMO canal do banco de novo aqui dentro
//    logo em seguida — uma query inteira a menos em praticamente toda
//    ação da plataforma (mandar mensagem, carregar mensagens, entrar
//    numa call de canal, etc., todas passam por aqui).
async function getEffectivePermissions(userId, channelId = null, knownChannel = null) {
  const [user, userRoles, everyoneRole] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.userRole.findMany({ where: { userId }, include: { role: true } }),
    getEveryoneRole(),
  ]);
  if (!user) return 0n;
  if (user.platformRole === 'ADMIN') return ALL_PERMISSIONS;

  const roles = userRoles.map((ur) => ur.role);
  if (everyoneRole && !roles.some((r) => r.id === everyoneRole.id)) roles.push(everyoneRole);

  let base = computeBasePermissions(roles);

  if (channelId) {
    const channel = knownChannel || await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) return base;

    const [categoryOverwrites, channelOverwrites] = await Promise.all([
      channel.categoryId
        ? prisma.permissionOverwrite.findMany({ where: { categoryId: channel.categoryId } })
        : Promise.resolve([]),
      prisma.permissionOverwrite.findMany({ where: { channelId } }),
    ]);

    base = applyOverwrites(base, {
      everyoneRoleId: everyoneRole?.id,
      roleIds: roles.map((r) => r.id),
      memberId: userId,
      categoryOverwrites,
      channelOverwrites,
    });
  }

  return base;
}

async function requirePermission(userId, channelId, permissionKey) {
  const bits = await getEffectivePermissions(userId, channelId);
  if (!has(bits, permissionKey)) throw new ForbiddenError();
  return bits;
}

// Usado por controllers que precisam checar uma permissão sem um canal
// específico em foco (gerenciar categorias, cargos, moderação geral).
async function requireCommunityPermission(userId, permissionKey) {
  return requirePermission(userId, null, permissionKey);
}

// O canal tem alguma restrição de acesso (privado, ou sobrescrita de
// permissão no canal OU na categoria)? Se não tiver, todo membro vê —
// dá pra pular a checagem por pessoa (ex.: avisar menções de um cargo).
async function channelHasRestrictions(channel) {
  if (!channel) return true;
  if (channel.isPrivate) return true;
  const [own, cat] = await Promise.all([
    prisma.permissionOverwrite.count({ where: { channelId: channel.id } }),
    channel.categoryId ? prisma.permissionOverwrite.count({ where: { categoryId: channel.categoryId } }) : Promise.resolve(0),
  ]);
  return own > 0 || cat > 0;
}

// Versão em lote de getEffectivePermissions(userId, ch) pra VÁRIOS canais
// de uma vez — mesmo resultado, mas em 4 consultas no total em vez de ~5
// por canal (a lista da comunidade checava canal privado por canal privado
// em sequência: N+1 no carregamento de toda página). Devolve
// Map(channelId -> bits). `channels` precisa ter { id, categoryId }.
async function getEffectivePermissionsForChannels(userId, channels) {
  const out = new Map();
  if (!channels?.length) return out;
  const [user, userRoles, everyoneRole] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, platformRole: true } }),
    prisma.userRole.findMany({ where: { userId }, include: { role: true } }),
    getEveryoneRole(),
  ]);
  if (!user) { channels.forEach((ch) => out.set(ch.id, 0n)); return out; }
  if (user.platformRole === 'ADMIN') { channels.forEach((ch) => out.set(ch.id, ALL_PERMISSIONS)); return out; }

  const roles = userRoles.map((ur) => ur.role);
  if (everyoneRole && !roles.some((r) => r.id === everyoneRole.id)) roles.push(everyoneRole);
  const base = computeBasePermissions(roles);
  const roleIds = roles.map((r) => r.id);

  const channelIds = channels.map((ch) => ch.id);
  const categoryIds = [...new Set(channels.map((ch) => ch.categoryId).filter(Boolean))];
  const overwrites = await prisma.permissionOverwrite.findMany({
    where: { OR: [{ channelId: { in: channelIds } }, ...(categoryIds.length ? [{ categoryId: { in: categoryIds } }] : [])] },
  });
  const byChannel = new Map();
  const byCategory = new Map();
  for (const ow of overwrites) {
    if (ow.channelId) { if (!byChannel.has(ow.channelId)) byChannel.set(ow.channelId, []); byChannel.get(ow.channelId).push(ow); }
    if (ow.categoryId) { if (!byCategory.has(ow.categoryId)) byCategory.set(ow.categoryId, []); byCategory.get(ow.categoryId).push(ow); }
  }
  for (const ch of channels) {
    out.set(ch.id, applyOverwrites(base, {
      everyoneRoleId: everyoneRole?.id,
      roleIds,
      memberId: userId,
      categoryOverwrites: ch.categoryId ? (byCategory.get(ch.categoryId) || []) : [],
      channelOverwrites: byChannel.get(ch.id) || [],
    }));
  }
  return out;
}

// Hierarquia de cargos (igual ao Discord): quem gerencia cargos só mexe
// nos cargos ABAIXO do seu cargo mais alto. Devolve a posição desse teto —
// Infinity pra ADMIN da plataforma e pra quem tem Administrador (bypass).
async function getRoleCeiling(userId) {
  const [user, userRoles, everyoneRole] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { platformRole: true } }),
    prisma.userRole.findMany({ where: { userId }, include: { role: true } }),
    getEveryoneRole(),
  ]);
  if (!user) return -Infinity;
  if (user.platformRole === 'ADMIN') return Infinity;
  const roles = userRoles.map((ur) => ur.role);
  if (everyoneRole) roles.push(everyoneRole);
  if (has(computeBasePermissions(roles), 'ADMINISTRATOR')) return Infinity;
  return roles.filter((r) => !r.isDefault).reduce((max, r) => Math.max(max, r.position), 0);
}

module.exports = {
  getRoleCeiling,
  getEffectivePermissionsForChannels,
  channelHasRestrictions,
  ForbiddenError,
  ALL_PERMISSIONS,
  getEveryoneRole,
  getEffectivePermissions,
  requirePermission,
  requireCommunityPermission,
  toStringBits,
};
