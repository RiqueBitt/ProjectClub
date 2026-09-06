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

    const icon = await prisma.clanIcon.create({ data: { name: name.trim(), url: req.file.url } });
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
