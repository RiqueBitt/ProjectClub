const prisma = require('../config/prisma');
const { requireCommunityPermission, getEffectivePermissions } = require('../services/authz');
const { PERMISSIONS, toStringBits, toBits } = require('../services/permissions');

function isGradientColorString(color) {
  return typeof color === 'string' && color.startsWith('linear-gradient(');
}

function shapeRole(role) {
  return { ...role, permissions: role.permissions };
}

async function listRoles(req, res, next) {
  try {
    const roles = await prisma.role.findMany({ orderBy: { position: 'desc' } });
    res.json({ roles: roles.map(shapeRole), availablePermissions: Object.keys(PERMISSIONS) });
  } catch (err) { next(err); }
}

async function createRole(req, res, next) {
  try {
    const { name } = req.body;
    await requireCommunityPermission(req.user.id, 'MANAGE_ROLES');
    if (!name) return res.status(400).json({ error: 'Nome é obrigatório.' });

    const count = await prisma.role.count();
    const role = await prisma.role.create({
      data: { name, position: count, permissions: '0' },
    });
    req.app.get('io')?.to('community').emit('role:new', shapeRole(role));
    res.status(201).json({ role: shapeRole(role) });
  } catch (err) { next(err); }
}

async function updateRole(req, res, next) {
  try {
    const { id } = req.params;
    await requireCommunityPermission(req.user.id, 'MANAGE_ROLES');

    const existing = await prisma.role.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Cargo não encontrado.' });

    const data = {};
    if (req.body.name !== undefined && !existing.isDefault) data.name = req.body.name;
    if (req.body.color !== undefined) data.color = req.body.color;
    if (req.body.icon !== undefined) data.icon = req.body.icon;
    if (req.body.hoist !== undefined) data.hoist = !!req.body.hoist;
    if (req.body.mentionable !== undefined) data.mentionable = !!req.body.mentionable;
    if (Array.isArray(req.body.permissions) || typeof req.body.permissionsBits === 'string') {
      const requestedBits = Array.isArray(req.body.permissions)
        ? req.body.permissions.reduce((acc, key) => (PERMISSIONS[key] ? acc | PERMISSIONS[key] : acc), 0n)
        : toBits(req.body.permissionsBits);
      // SECURITY (escalação de privilégio vertical): sem isso, QUALQUER
      // pessoa com MANAGE_ROLES (não precisa ser ADMINISTRATOR) podia
      // marcar 'ADMINISTRATOR' — ou qualquer outra permissão que ela
      // mesma não tem — num cargo, e depois se atribuir esse cargo (ver
      // assignRole logo abaixo, com a mesma correção). ADMINISTRATOR
      // ignora TODAS as outras checagens (ver has() em services/
      // permissions.js) — então isso dava pra qualquer moderador virar
      // administrador completo da comunidade sozinho, só editando um
      // cargo. A regra agora é a mesma do Discord: você nunca pode
      // conceder, através de um cargo, uma permissão que você mesmo não
      // possui agora. ADMINISTRATOR (ou o ADMIN da plataforma, que
      // sempre tem ALL_PERMISSIONS via getEffectivePermissions) continua
      // podendo conceder qualquer coisa, normalmente.
      const callerBits = await getEffectivePermissions(req.user.id, null);
      const grantingBeyondOwnPermissions = (requestedBits & ~callerBits) !== 0n;
      if (grantingBeyondOwnPermissions) {
        return res.status(403).json({ error: 'Você não pode conceder a um cargo uma permissão que você mesmo não possui.' });
      }
      data.permissions = toStringBits(requestedBits);
    }

    const role = await prisma.role.update({ where: { id }, data });
    req.app.get('io')?.to('community').emit('role:update', shapeRole(role));
    res.json({ role: shapeRole(role) });
  } catch (err) { next(err); }
}

async function uploadIcon(req, res, next) {
  try {
    const { id } = req.params;
    await requireCommunityPermission(req.user.id, 'MANAGE_ROLES');
    const existing = await prisma.role.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Cargo não encontrado.' });
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

    const role = await prisma.role.update({ where: { id }, data: { icon: req.file.url } });
    req.app.get('io')?.to('community').emit('role:update', shapeRole(role));
    res.json({ role: shapeRole(role) });
  } catch (err) { next(err); }
}

async function deleteRole(req, res, next) {
  try {
    const { id } = req.params;
    await requireCommunityPermission(req.user.id, 'MANAGE_ROLES');
    const existing = await prisma.role.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Cargo não encontrado.' });
    if (existing.isDefault) return res.status(400).json({ error: 'Não é possível excluir o cargo @todos.' });

    await prisma.role.delete({ where: { id } });
    req.app.get('io')?.to('community').emit('role:delete', { id });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function reorderRoles(req, res, next) {
  try {
    const { order } = req.body;
    await requireCommunityPermission(req.user.id, 'MANAGE_ROLES');
    const ownedCount = await prisma.role.count({ where: { id: { in: order } } });
    if (ownedCount !== order.length) return res.status(400).json({ error: 'Lista de reordenação inválida.' });
    const total = order.length;
    await prisma.$transaction(
      order.map((id, index) => prisma.role.update({ where: { id }, data: { position: total - index } }))
    );
    req.app.get('io')?.to('community').emit('role:reorder', { order });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function assignRole(req, res, next) {
  try {
    const { userId, roleId } = req.params;
    await requireCommunityPermission(req.user.id, 'MANAGE_ROLES');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) return res.status(404).json({ error: 'Cargo não encontrado.' });

    // SECURITY (escalação de privilégio vertical): mesmo com updateRole já
    // impedindo criar/editar um cargo com permissões acima das próprias
    // (ver o comentário lá), sem esta checagem alguém com MANAGE_ROLES
    // ainda podia atribuir a SI MESMO (ou a qualquer um) um cargo já
    // existente — criado antes por um admin de verdade, por exemplo — que
    // já tivesse permissões maiores que as suas próprias, incluindo
    // ADMINISTRATOR. A regra é a mesma: nunca é possível atribuir um
    // cargo cujas permissões ultrapassem as que a própria pessoa já tem.
    const callerBits = await getEffectivePermissions(req.user.id, null);
    const roleBits = toBits(role.permissions);
    if ((roleBits & ~callerBits) !== 0n) {
      return res.status(403).json({ error: 'Você não pode atribuir um cargo com permissões que você mesmo não possui.' });
    }

    await prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId } },
      update: {},
      create: { userId, roleId },
    });
    req.app.get('io')?.to('community').emit('member:roles-update', { userId });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function unassignRole(req, res, next) {
  try {
    const { userId, roleId } = req.params;
    await requireCommunityPermission(req.user.id, 'MANAGE_ROLES');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) return res.status(404).json({ error: 'Cargo não encontrado.' });

    await prisma.userRole.deleteMany({ where: { userId, roleId } });
    req.app.get('io')?.to('community').emit('member:roles-update', { userId });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { listRoles, createRole, updateRole, deleteRole, reorderRoles, assignRole, unassignRole, uploadIcon };
