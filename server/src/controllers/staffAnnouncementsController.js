const prisma = require('../config/prisma');

// Canal "Anúncios": a staff publica avisos com banner; todo mundo lê.
const AUTHOR_FIELDS = { id: true, displayName: true, username: true, avatarUrl: true, avatarDecoration: true, profileColor: true, platformRole: true };
const isStaff = (u) => ['ADMIN', 'MODERATOR'].includes(u?.platformRole);
const clean = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);
const safeLink = (v) => {
  const s = clean(v, 500);
  if (!s) return null;
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  try { const u = new URL(s); return ['http:', 'https:'].includes(u.protocol) ? u.toString() : null; } catch { return null; }
};

async function withAuthors(rows) {
  const ids = [...new Set(rows.map((r) => r.createdById))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: AUTHOR_FIELDS }) : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.map((r) => ({ ...r, author: byId.get(r.createdById) || null }));
}

async function list(req, res, next) {
  try {
    const rows = await prisma.staffAnnouncement.findMany({ orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }], take: 60 });
    res.json({ announcements: await withAuthors(rows), canManage: isStaff(req.user) });
  } catch (err) { next(err); }
}

function readBody(req) {
  const b = req.body || {};
  const data = {};
  if (b.title !== undefined) data.title = clean(b.title, 160);
  if (b.body !== undefined) data.body = clean(b.body, 8000) || '';
  if (b.linkUrl !== undefined) data.linkUrl = safeLink(b.linkUrl);
  if (b.linkLabel !== undefined) data.linkLabel = clean(b.linkLabel, 60);
  if (b.pinned !== undefined) data.pinned = b.pinned === true || b.pinned === 'true';
  if (b.removeBanner === 'true' || b.removeBanner === true) data.bannerUrl = null;
  if (req.file?.url) data.bannerUrl = req.file.url;
  return data;
}

async function create(req, res, next) {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Só a staff pode publicar anúncios.' });
    const data = readBody(req);
    if (!data.title) return res.status(400).json({ error: 'Escreva um título.' });
    if (!data.body) return res.status(400).json({ error: 'Escreva o texto do anúncio.' });
    const row = await prisma.staffAnnouncement.create({ data: { ...data, createdById: req.user.id } });
    const [item] = await withAuthors([row]);
    req.app.get('io')?.to('community').emit('announcements:update', { id: row.id });
    res.status(201).json({ announcement: item });
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Só a staff pode editar anúncios.' });
    const data = readBody(req);
    if (data.title === null) return res.status(400).json({ error: 'Escreva um título.' });
    const row = await prisma.staffAnnouncement.update({ where: { id: req.params.id }, data });
    const [item] = await withAuthors([row]);
    req.app.get('io')?.to('community').emit('announcements:update', { id: row.id });
    res.json({ announcement: item });
  } catch (err) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'Anúncio não encontrado.' });
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Só a staff pode apagar anúncios.' });
    await prisma.staffAnnouncement.delete({ where: { id: req.params.id } }).catch(() => null);
    req.app.get('io')?.to('community').emit('announcements:update', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { list, create, update, remove };
