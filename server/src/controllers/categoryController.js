const prisma = require('../config/prisma');
const { requireCommunityPermission } = require('../services/authz');
const { toStringBits, PERMISSIONS } = require('../services/permissions');

async function assertManageChannels(userId) {
  return requireCommunityPermission(userId, 'MANAGE_CHANNELS');
}

async function createCategory(req, res, next) {
  try {
    const { name } = req.body;
    await assertManageChannels(req.user.id);
    const count = await prisma.category.count();
    const category = await prisma.category.create({ data: { name, position: count } });
    req.app.get('io')?.to('community').emit('category:new', category);
    res.status(201).json({ category });
  } catch (err) { next(err); }
}

async function updateCategory(req, res, next) {
  try {
    const { id } = req.params;
    await assertManageChannels(req.user.id);
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Categoria não encontrada.' });
    const category = await prisma.category.update({ where: { id }, data: { name: req.body.name } });
    req.app.get('io')?.to('community').emit('category:update', category);
    res.json({ category });
  } catch (err) { next(err); }
}

async function reorderCategories(req, res, next) {
  try {
    const { order } = req.body; // array of category ids in new order
    await assertManageChannels(req.user.id);
    const ownedCount = await prisma.category.count({ where: { id: { in: order } } });
    if (ownedCount !== order.length) return res.status(400).json({ error: 'Lista de reordenação inválida.' });
    await prisma.$transaction(
      order.map((id, index) => prisma.category.update({ where: { id }, data: { position: index } }))
    );
    req.app.get('io')?.to('community').emit('category:reorder', { order });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function deleteCategory(req, res, next) {
  try {
    const { id } = req.params;
    await assertManageChannels(req.user.id);
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Categoria não encontrada.' });
    await prisma.category.delete({ where: { id } });
    req.app.get('io')?.to('community').emit('category:delete', { id });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function listCategoryOverwrites(req, res, next) {
  try {
    const { id } = req.params;
    await assertManageChannels(req.user.id);
    const category = await prisma.category.findUnique({ where: { id } });
    if (!category) return res.status(404).json({ error: 'Categoria não encontrada.' });
    const overwrites = await prisma.permissionOverwrite.findMany({ where: { categoryId: id } });
    res.json({ overwrites, availablePermissions: Object.keys(PERMISSIONS) });
  } catch (err) { next(err); }
}

async function setCategoryOverwrite(req, res, next) {
  try {
    const { id } = req.params;
    const { targetType, targetId, allow = [], deny = [] } = req.body;
    await assertManageChannels(req.user.id);
    const category = await prisma.category.findUnique({ where: { id } });
    if (!category) return res.status(404).json({ error: 'Categoria não encontrada.' });

    const allowBits = allow.reduce((acc, k) => (PERMISSIONS[k] ? acc | PERMISSIONS[k] : acc), 0n);
    const denyBits = deny.reduce((acc, k) => (PERMISSIONS[k] ? acc | PERMISSIONS[k] : acc), 0n);

    // SECURITY: mesma correção de setChannelOverwrite (channelController.js)
    // — nunca é possível conceder (allow) uma permissão que você mesmo
    // não possui agora, senão MANAGE_CHANNELS sozinho vira um caminho
    // pra se autoconceder ADMINISTRATOR (ou qualquer outra permissão)
    // via sobrescrita de categoria.
    const { getEffectivePermissions } = require('../services/authz');
    const callerBits = await getEffectivePermissions(req.user.id, null);
    if ((allowBits & ~callerBits) !== 0n) {
      return res.status(403).json({ error: 'Você não pode conceder uma permissão que você mesmo não possui.' });
    }

    const overwrite = await prisma.permissionOverwrite.upsert({
      where: { channelId_categoryId_targetType_targetId: { channelId: null, categoryId: id, targetType, targetId } },
      update: { allow: toStringBits(allowBits), deny: toStringBits(denyBits) },
      create: { categoryId: id, targetType, targetId, allow: toStringBits(allowBits), deny: toStringBits(denyBits) },
    });
    req.app.get('io')?.to('community').emit('overwrite:update', { categoryId: id });
    res.json({ overwrite });
  } catch (err) { next(err); }
}

async function deleteCategoryOverwrite(req, res, next) {
  try {
    const { id, overwriteId } = req.params;
    await assertManageChannels(req.user.id);
    const category = await prisma.category.findUnique({ where: { id } });
    if (!category) return res.status(404).json({ error: 'Categoria não encontrada.' });
    const overwrite = await prisma.permissionOverwrite.findUnique({ where: { id: overwriteId } });
    if (!overwrite || overwrite.categoryId !== id) return res.status(404).json({ error: 'Permissão não encontrada.' });
    await prisma.permissionOverwrite.delete({ where: { id: overwriteId } });
    req.app.get('io')?.to('community').emit('overwrite:update', { categoryId: id });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = {
  createCategory, updateCategory, reorderCategories, deleteCategory, assertManageChannels,
  listCategoryOverwrites, setCategoryOverwrite, deleteCategoryOverwrite,
};
