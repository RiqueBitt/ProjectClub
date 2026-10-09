const prisma = require('../config/prisma');
const { requireCommunityPermission } = require('../services/authz');
const { toStringBits, PERMISSIONS } = require('../services/permissions');
const { sanitizeName, sanitizeIconEmoji, resolveIconUrl, checkIconUpload } = require('../utils/channelNames');

async function assertManageChannels(userId) {
  return requireCommunityPermission(userId, 'MANAGE_CHANNELS');
}

async function createCategory(req, res, next) {
  try {
    await assertManageChannels(req.user.id);
    // Nome como foi escrito (maiúsculas/espaços), só limpo.
    const name = sanitizeName(req.body.name);
    if (!name) return res.status(400).json({ error: 'Dê um nome à categoria.' });
    const iconEmoji = sanitizeIconEmoji(req.body.iconEmoji);
    const iconUrl = await resolveIconUrl(prisma, req.body.iconUrl, null);
    const count = await prisma.category.count();
    const category = await prisma.category.create({
      data: { name, position: count, iconEmoji: iconEmoji || null, iconUrl: iconEmoji ? null : (iconUrl || null) },
    });
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
    const data = {};
    if (req.body.name !== undefined) {
      data.name = sanitizeName(req.body.name);
      if (!data.name) return res.status(400).json({ error: 'Dê um nome à categoria.' });
    }
    // Ícone: emoji OU imagem — escolher um limpa o outro; null nos dois remove.
    const iconEmoji = sanitizeIconEmoji(req.body.iconEmoji);
    const iconUrl = await resolveIconUrl(prisma, req.body.iconUrl, existing.iconUrl);
    if (iconEmoji !== undefined) data.iconEmoji = iconEmoji;
    if (iconUrl !== undefined) data.iconUrl = iconUrl;
    if (iconEmoji) data.iconUrl = null;
    else if (iconUrl) data.iconEmoji = null;
    const category = await prisma.category.update({ where: { id }, data });
    req.app.get('io')?.to('community').emit('category:update', category);
    res.json({ category });
  } catch (err) { next(err); }
}

// POST /community/categories/:id/icon — imagem pequena como ícone da categoria.
async function uploadCategoryIcon(req, res, next) {
  try {
    const { id } = req.params;
    await assertManageChannels(req.user.id);
    const problem = checkIconUpload(req.file);
    if (problem) return res.status(400).json({ error: problem });
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Categoria não encontrada.' });
    const category = await prisma.category.update({ where: { id }, data: { iconUrl: req.file.url, iconEmoji: null } });
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
  createCategory, updateCategory, uploadCategoryIcon, reorderCategories, deleteCategory, assertManageChannels,
  listCategoryOverwrites, setCategoryOverwrite, deleteCategoryOverwrite,
};
