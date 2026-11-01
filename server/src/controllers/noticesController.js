const prisma = require('../config/prisma');
const { shapeNotice } = require('../services/notices');

// GET /api/notices — últimos 50 avisos salvos + quantos não lidos.
async function listNotices(req, res, next) {
  try {
    const [rows, unread] = await Promise.all([
      prisma.userNotice.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.userNotice.count({ where: { userId: req.user.id, readAt: null } }),
    ]);
    res.json({ notices: rows.map(shapeNotice), unread });
  } catch (err) { next(err); }
}

// POST /api/notices/read-all — marca todos como lidos.
async function readAll(req, res, next) {
  try {
    await prisma.userNotice.updateMany({ where: { userId: req.user.id, readAt: null }, data: { readAt: new Date() } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// POST /api/notices/:id/read
async function readOne(req, res, next) {
  try {
    await prisma.userNotice.updateMany({ where: { id: req.params.id, userId: req.user.id, readAt: null }, data: { readAt: new Date() } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// DELETE /api/notices/:id
async function removeOne(req, res, next) {
  try {
    await prisma.userNotice.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { listNotices, readAll, readOne, removeOne };
