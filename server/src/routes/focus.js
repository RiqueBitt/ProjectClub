// Ranking de foco da Sala de estudos (sockets/focusRoom.js → model FocusDay).
const express = require('express');
const prisma = require('../config/prisma');
const { requireAuth } = require('../middleware/auth');
const { dayKey } = require('../sockets/focusRoom');

const router = express.Router();
router.use(requireAuth);

router.get('/ranking', async (req, res, next) => {
  try {
    const days = [7, 30].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
    const from = dayKey(new Date(Date.now() - (days - 1) * 86_400_000));
    const rows = await prisma.focusDay.groupBy({ by: ['userId'], where: { day: { gte: from } }, _sum: { minutes: true }, orderBy: { _sum: { minutes: 'desc' } }, take: 20 });
    const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, displayName: true, username: true, avatarUrl: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    const mine = await prisma.focusDay.aggregate({ where: { userId: req.user.id, day: { gte: from } }, _sum: { minutes: true } });
    res.json({
      days,
      ranking: rows.map((r, i) => ({ position: i + 1, minutes: r._sum.minutes || 0, user: byId.get(r.userId) || { id: r.userId, displayName: 'Alguém' } })),
      me: { minutes: mine._sum.minutes || 0 },
    });
  } catch (err) { next(err); }
});

module.exports = router;
