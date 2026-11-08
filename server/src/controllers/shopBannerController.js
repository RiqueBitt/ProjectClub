const prisma = require('../config/prisma');

// Banners promocionais da Loja (staff): arte, título, selo ("Por tempo
// limitado"), botão e a coleção que o botão abre.
const str = (v, max) => (v === undefined ? undefined : String(v || '').trim().slice(0, max) || null);

function readBody(req) {
  const b = req.body || {};
  const data = {};
  const title = str(b.title, 80); if (title !== undefined) data.title = title;
  for (const [k, max] of [['subtitle', 200], ['badge', 40], ['buttonLabel', 30]]) { const v = str(b[k], max); if (v !== undefined) data[k] = v; }
  if (b.collectionId !== undefined) data.collectionId = b.collectionId ? String(b.collectionId) : null;
  if (b.accentColor !== undefined) data.accentColor = /^#[0-9a-f]{6}$/i.test(b.accentColor || '') ? b.accentColor : null;
  if (b.active !== undefined) data.active = b.active === true || b.active === 'true' || b.active === '1';
  if (b.sortOrder !== undefined) { const n = parseInt(b.sortOrder, 10); data.sortOrder = Number.isFinite(n) ? n : 0; }
  if (b.endsAt !== undefined) { const d = b.endsAt ? new Date(b.endsAt) : null; data.endsAt = d && !Number.isNaN(d.getTime()) ? d : null; }
  if (req.file?.url) data.imageUrl = req.file.url;
  if (b.removeImage === 'true') data.imageUrl = null;
  return data;
}

async function list(req, res, next) {
  try { res.json({ banners: await prisma.shopBanner.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] }) }); } catch (err) { next(err); }
}
async function create(req, res, next) {
  try {
    const data = readBody(req);
    if (!data.title) return res.status(400).json({ error: 'Dê um título pro banner.' });
    res.status(201).json({ banner: await prisma.shopBanner.create({ data }) });
  } catch (err) { next(err); }
}
async function update(req, res, next) {
  try {
    const data = readBody(req);
    if (data.title === null) return res.status(400).json({ error: 'Dê um título pro banner.' });
    res.json({ banner: await prisma.shopBanner.update({ where: { id: req.params.id }, data }) });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Banner não encontrado.' });
    next(err);
  }
}
async function remove(req, res, next) {
  try { await prisma.shopBanner.delete({ where: { id: req.params.id } }); res.json({ ok: true }); } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Banner não encontrado.' });
    next(err);
  }
}

module.exports = { list, create, update, remove };
