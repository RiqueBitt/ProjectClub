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
async function getEveryoneRole() {
  return prisma.role.findFirst({ where: { isDefault: true } });
}

// Calcula o bitfield de permissões efetivas de um usuário na comunidade
// inteira, opcionalmente já aplicando as sobrescritas de um canal
// específico. ADMIN da plataforma sempre tem tudo, igual ao dono de
// servidor no EmberCord original.
async function getEffectivePermissions(userId, channelId = null) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return 0n;
  if (user.platformRole === 'ADMIN') return ALL_PERMISSIONS;

  const userRoles = await prisma.userRole.findMany({
    where: { userId },
    include: { role: true },
  });
  const everyoneRole = await getEveryoneRole();
  const roles = userRoles.map((ur) => ur.role);
  if (everyoneRole && !roles.some((r) => r.id === everyoneRole.id)) roles.push(everyoneRole);

  let base = computeBasePermissions(roles);

  if (channelId) {
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
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

module.exports = {
  ForbiddenError,
  ALL_PERMISSIONS,
  getEveryoneRole,
  getEffectivePermissions,
  requirePermission,
  requireCommunityPermission,
  toStringBits,
};
