// Item pedido: "pingentes... mini imagens que podem ser colocadas pelo
// usuário (lista de seleção que nós fazemos) ao lado do seu nome...
// como no Discord quando cargos possuem imagem atrelada e o ícone
// aparece ao lado" — catálogo curado pela staff (ver model Pendant),
// cada usuário escolhe um item dessa lista pra si.
const prisma = require('../config/prisma');
const { logPlatformAction } = require('./adminController');
const { SELF_USER_FIELDS } = require('./authController');

// ---------- Uso pelo usuário comum ----------

// GET /pendants — catálogo público (só os habilitados) pra montar o
// seletor nas configurações de perfil.
async function listAvailablePendants(req, res, next) {
  try {
    const pendants = await prisma.pendant.findMany({ where: { enabled: true }, orderBy: { name: 'asc' } });
    res.json({ pendants });
  } catch (err) { next(err); }
}

// PATCH /pendants/select — escolhe (ou tira, com pendantId: null) o
// pingente da própria conta.
async function selectMyPendant(req, res, next) {
  try {
    const { pendantId } = req.body;
    if (pendantId) {
      const pendant = await prisma.pendant.findUnique({ where: { id: pendantId } });
      if (!pendant || !pendant.enabled) return res.status(400).json({ error: 'Pingente inválido.' });
    }
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { selectedPendantId: pendantId || null },
      select: SELF_USER_FIELDS,
    });
    res.json({ user });
  } catch (err) { next(err); }
}

// ---------- Admin: catálogo ----------

async function adminListPendants(req, res, next) {
  try {
    const pendants = await prisma.pendant.findMany({ orderBy: { name: 'asc' } });
    res.json({ pendants });
  } catch (err) { next(err); }
}

async function adminCreatePendant(req, res, next) {
  try {
    const { name, iconUrl } = req.body;
    if (!name?.trim() || !iconUrl?.trim()) return res.status(400).json({ error: 'Nome e URL do ícone são obrigatórios.' });
    const pendant = await prisma.pendant.create({ data: { name: name.trim(), iconUrl: iconUrl.trim() } });
    await logPlatformAction(req, { action: 'PENDANT_CREATE', targetType: 'PENDANT', targetId: pendant.id, metadata: { name: pendant.name } });
    res.status(201).json({ pendant });
  } catch (err) { next(err); }
}

async function adminUpdatePendant(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await prisma.pendant.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Pingente não encontrado.' });
    const data = {};
    if (req.body.name !== undefined) data.name = req.body.name.trim();
    if (req.body.iconUrl !== undefined) data.iconUrl = req.body.iconUrl.trim();
    if (req.body.enabled !== undefined) data.enabled = !!req.body.enabled;
    const pendant = await prisma.pendant.update({ where: { id }, data });
    await logPlatformAction(req, { action: 'PENDANT_UPDATE', targetType: 'PENDANT', targetId: id, metadata: data });
    res.json({ pendant });
  } catch (err) { next(err); }
}

async function adminUploadPendantIcon(req, res, next) {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    const existing = await prisma.pendant.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Pingente não encontrado.' });
    const iconUrl = req.file.url;
    const pendant = await prisma.pendant.update({ where: { id }, data: { iconUrl } });
    res.json({ pendant });
  } catch (err) { next(err); }
}

async function adminDeletePendant(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await prisma.pendant.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Pingente não encontrado.' });
    // Ninguém fica com um pingente "fantasma" apontando pra um ID que
    // não existe mais — onDelete: SetNull no schema já cuida disso
    // automaticamente no banco, então só apagar aqui já é suficiente.
    await prisma.pendant.delete({ where: { id } });
    await logPlatformAction(req, { action: 'PENDANT_DELETE', targetType: 'PENDANT', targetId: id, metadata: { name: existing.name } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = {
  listAvailablePendants, selectMyPendant,
  adminListPendants, adminCreatePendant, adminUpdatePendant, adminUploadPendantIcon, adminDeletePendant,
};
