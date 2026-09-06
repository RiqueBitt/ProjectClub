const prisma = require('../config/prisma');
const { requireCommunityPermission } = require('../services/authz');

// Item pedido: "Esses ícones serão criados através do Painel da
// Staff... definir o nome do ícone... disponibilizar o ícone para os
// usuários" — mesmo padrão de emojiController.js/serverStickerController.js.
const NAME_RE = /^.{2,32}$/;

async function listClanIcons(req, res, next) {
  try {
    const icons = await prisma.clanIcon.findMany({ orderBy: { createdAt: 'asc' } });
    res.json({ icons });
  } catch (err) { next(err); }
}

async function createClanIcon(req, res, next) {
  try {
    await requireCommunityPermission(req.user.id, 'MANAGE_CLAN_ICONS');
    const { name } = req.body;
    if (!name || !NAME_RE.test(name.trim())) return res.status(400).json({ error: 'Nome inválido (2-32 caracteres).' });
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

    // Item pedido: "quando eu criar um icon pro clã, deixe ele ser o
    // padrão" — sempre só um marcado como padrão por vez, então
    // desmarca o antigo antes de marcar o novo.
    const icon = await prisma.$transaction(async (tx) => {
      await tx.clanIcon.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      return tx.clanIcon.create({ data: { name: name.trim(), url: req.file.url, isDefault: true } });
    });
    res.status(201).json({ icon });
  } catch (err) { next(err); }
}

async function deleteClanIcon(req, res, next) {
  try {
    await requireCommunityPermission(req.user.id, 'MANAGE_CLAN_ICONS');
    const { id } = req.params;
    const existing = await prisma.clanIcon.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Ícone não encontrado.' });
    await prisma.clanIcon.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { listClanIcons, createClanIcon, deleteClanIcon };
