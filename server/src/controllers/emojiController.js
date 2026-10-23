const prisma = require('../config/prisma');
const { requireCommunityPermission } = require('../services/authz');

const EMOJI_SLOT_LIMIT = 250; // fixo, sem depender de sistema de boost

async function listEmojis(req, res, next) {
  try {
    const emojis = await prisma.emoji.findMany({ orderBy: { createdAt: 'asc' } });
    res.json({ emojis });
  } catch (err) { next(err); }
}

async function createEmoji(req, res, next) {
  try {
    await requireCommunityPermission(req.user.id, 'MANAGE_EMOJIS');

    const { name, category, allowedRoleId, collectionId } = req.body;
    if (!name || !/^[a-zA-Z0-9_]{2,32}$/.test(name)) {
      return res.status(400).json({ error: 'Nome inválido. Use 2-32 letras, números ou "_".' });
    }
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

    // Item pedido: "sistema de coleções" — confere que a coleção
    // escolhida existe e é mesmo do tipo EMOJI (nunca aceita o id de
    // uma coleção de figurinha aqui, mesmo que alguém tente forçar
    // isso direto na requisição).
    if (collectionId) {
      const collection = await prisma.assetCollection.findUnique({ where: { id: collectionId } });
      if (!collection || collection.kind !== 'EMOJI') return res.status(400).json({ error: 'Coleção inválida.' });
    }

    const existing = await prisma.emoji.findUnique({ where: { name } });
    if (existing) return res.status(409).json({ error: 'Já existe um emoji com esse nome.' });

    const count = await prisma.emoji.count();
    if (count >= EMOJI_SLOT_LIMIT) {
      return res.status(400).json({ error: `Limite de ${EMOJI_SLOT_LIMIT} emojis atingido.` });
    }

    const emoji = await prisma.emoji.create({
      data: {
        name, category: category || 'Geral', allowedRoleId: allowedRoleId || null, collectionId: collectionId || null,
        url: req.file.url, createdById: req.user.id,
      },
    });
    req.app.get('io')?.to('community').emit('emoji:new', emoji);
    res.status(201).json({ emoji });
  } catch (err) { next(err); }
}

async function updateEmoji(req, res, next) {
  try {
    const { id } = req.params;
    await requireCommunityPermission(req.user.id, 'MANAGE_EMOJIS');

    const existing = await prisma.emoji.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Emoji não encontrado.' });

    const data = {};
    if (req.body.name !== undefined) {
      if (!/^[a-zA-Z0-9_]{2,32}$/.test(req.body.name)) return res.status(400).json({ error: 'Nome inválido.' });
      data.name = req.body.name;
    }
    if (req.body.category !== undefined) data.category = req.body.category || 'Geral';
    if (req.body.allowedRoleId !== undefined) data.allowedRoleId = req.body.allowedRoleId || null;
    if (req.body.collectionId !== undefined) {
      if (req.body.collectionId) {
        const collection = await prisma.assetCollection.findUnique({ where: { id: req.body.collectionId } });
        if (!collection || collection.kind !== 'EMOJI') return res.status(400).json({ error: 'Coleção inválida.' });
      }
      data.collectionId = req.body.collectionId || null;
    }

    const emoji = await prisma.emoji.update({ where: { id }, data });
    req.app.get('io')?.to('community').emit('emoji:update', emoji);
    res.json({ emoji });
  } catch (err) { next(err); }
}

async function deleteEmoji(req, res, next) {
  try {
    const { id } = req.params;
    await requireCommunityPermission(req.user.id, 'MANAGE_EMOJIS');

    const existing = await prisma.emoji.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Emoji não encontrado.' });

    await prisma.emoji.delete({ where: { id } });
    req.app.get('io')?.to('community').emit('emoji:delete', { id });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// Como agora só existe UMA comunidade, todo emoji já é "usável" por
// qualquer membro (respeitando allowedRoleId) — não precisa mais agregar
// entre vários servidores.
async function listUsableEmojis(req, res, next) {
  try {
    const emojis = await prisma.emoji.findMany({ orderBy: { createdAt: 'asc' } });
    const userRoles = await prisma.userRole.findMany({ where: { userId: req.user.id }, select: { roleId: true } });
    const roleIds = new Set(userRoles.map((r) => r.roleId));
    const usable = emojis.filter((e) => !e.allowedRoleId || roleIds.has(e.allowedRoleId));
    res.json({ emojis: usable });
  } catch (err) { next(err); }
}

module.exports = { listEmojis, createEmoji, updateEmoji, deleteEmoji, listUsableEmojis };
