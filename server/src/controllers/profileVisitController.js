const prisma = require('../config/prisma');
const { PUBLIC_USER_FIELDS } = require('./authController');

// Item pedido: "quem visitou seu perfil" — registra a visita (ou
// atualiza a última visita + soma 1 no contador, se essa pessoa já
// tinha visitado antes). Só o DONO do perfil vê a lista de quem
// visitou — mais discreto que o Orkut original (que mostrava pra
// qualquer um), evita o lado "perseguição" da funcionalidade.
async function registerVisit(req, res, next) {
  try {
    const { targetId } = req.params;
    if (targetId === req.user.id) return res.json({ ok: true }); // visitar o próprio perfil não conta

    await prisma.profileVisit.upsert({
      where: { visitorId_targetId: { visitorId: req.user.id, targetId } },
      update: { visitCount: { increment: 1 }, lastVisitAt: new Date() },
      create: { visitorId: req.user.id, targetId },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// Só o dono do perfil pode ver essa lista — checagem no servidor, não
// só escondendo o botão na tela.
async function listVisitors(req, res, next) {
  try {
    const { targetId } = req.params;
    if (targetId !== req.user.id) return res.status(403).json({ error: 'Só você pode ver quem visitou seu perfil.' });

    const [visits, totalVisits] = await Promise.all([
      prisma.profileVisit.findMany({
        where: { targetId },
        include: { visitor: { select: PUBLIC_USER_FIELDS } },
        orderBy: { lastVisitAt: 'desc' },
        take: 50,
      }),
      prisma.profileVisit.aggregate({ where: { targetId }, _sum: { visitCount: true } }),
    ]);
    res.json({ visits, totalVisits: totalVisits._sum.visitCount || 0 });
  } catch (err) { next(err); }
}

module.exports = { registerVisit, listVisitors };
