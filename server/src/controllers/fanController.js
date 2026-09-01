const prisma = require('../config/prisma');

// Item pedido: "sou fã" — só um contador simples, sem texto/aprovação,
// alternando (marcar/desmarcar) igual um "curtir".

async function toggle(req, res, next) {
  try {
    const { targetId } = req.params;
    if (targetId === req.user.id) return res.status(400).json({ error: 'Você não pode ser fã de si mesmo.' });

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const existing = await prisma.fan.findUnique({
      where: { fanId_targetId: { fanId: req.user.id, targetId } },
    });

    if (existing) {
      await prisma.fan.delete({ where: { id: existing.id } });
    } else {
      await prisma.fan.create({ data: { fanId: req.user.id, targetId } });
      req.app.get('io')?.notifyUser?.(targetId, 'fan:new', { fanId: req.user.id, fanName: req.user.displayName });
    }

    const count = await prisma.fan.count({ where: { targetId } });
    res.json({ isFan: !existing, count });
  } catch (err) { next(err); }
}

async function getStatus(req, res, next) {
  try {
    const { targetId } = req.params;
    const [count, mine] = await Promise.all([
      prisma.fan.count({ where: { targetId } }),
      prisma.fan.findUnique({ where: { fanId_targetId: { fanId: req.user.id, targetId } } }),
    ]);
    res.json({ count, isFan: !!mine });
  } catch (err) { next(err); }
}

module.exports = { toggle, getStatus };
