const prisma = require('../config/prisma');
const { PUBLIC_USER_FIELDS } = require('./authController');

// Item pedido: "está namorando com Fulano" — só fica público depois
// que os DOIS lados confirmam, mesmo espírito de aceitar um pedido de
// amizade (ver friendController.js, mesmo padrão reaproveitado).

async function sendRequest(req, res, next) {
  try {
    const { partnerId } = req.body;
    if (partnerId === req.user.id) return res.status(400).json({ error: 'Você não pode namorar consigo mesmo.' });

    const partner = await prisma.user.findUnique({ where: { id: partnerId } });
    if (!partner) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const existing = await prisma.relationshipRequest.findFirst({
      where: {
        status: 'PENDING',
        OR: [{ requesterId: req.user.id, partnerId }, { requesterId: partnerId, partnerId: req.user.id }],
      },
    });
    if (existing) return res.status(409).json({ error: 'Já existe um pedido pendente entre vocês.' });

    const request = await prisma.relationshipRequest.create({
      data: { requesterId: req.user.id, partnerId, status: 'PENDING' },
    });
    req.app.get('io')?.notifyUser?.(partnerId, 'relationship:request', { request, from: req.user });
    res.status(201).json({ request });
  } catch (err) { next(err); }
}

async function respond(req, res, next) {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'accept' | 'decline'
    const request = await prisma.relationshipRequest.findUnique({ where: { id } });
    if (!request || request.partnerId !== req.user.id || request.status !== 'PENDING') {
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }

    if (action === 'decline') {
      await prisma.relationshipRequest.update({ where: { id }, data: { status: 'DECLINED' } });
      req.app.get('io')?.notifyUser?.(request.requesterId, 'relationship:declined', {});
      return res.json({ ok: true });
    }
    if (action !== 'accept') return res.status(400).json({ error: 'Ação inválida.' });

    // Confirmado dos dois lados — atualiza o "cache" de parceiro nos
    // DOIS usuários ao mesmo tempo, e marca o pedido como aceito.
    await prisma.$transaction([
      prisma.relationshipRequest.update({ where: { id }, data: { status: 'ACCEPTED' } }),
      prisma.user.update({ where: { id: request.requesterId }, data: { relationshipPartnerId: request.partnerId } }),
      prisma.user.update({ where: { id: request.partnerId }, data: { relationshipPartnerId: request.requesterId } }),
    ]);

    req.app.get('io')?.notifyUser?.(request.requesterId, 'relationship:accepted', { partnerId: request.partnerId });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// Termina o relacionamento confirmado (qualquer um dos dois pode
// terminar, não precisa dos dois lados concordando — igual desfazer
// amizade).
async function endRelationship(req, res, next) {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!me.relationshipPartnerId) return res.status(400).json({ error: 'Você não está em um relacionamento confirmado.' });
    const partnerId = me.relationshipPartnerId;

    await prisma.$transaction([
      prisma.user.update({ where: { id: req.user.id }, data: { relationshipPartnerId: null } }),
      prisma.user.update({ where: { id: partnerId }, data: { relationshipPartnerId: null } }),
    ]);
    req.app.get('io')?.notifyUser?.(partnerId, 'relationship:ended', {});
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// Pedidos que EU recebi e ainda não respondi.
async function listPendingForMe(req, res, next) {
  try {
    const requests = await prisma.relationshipRequest.findMany({
      where: { partnerId: req.user.id, status: 'PENDING' },
      include: { requester: { select: PUBLIC_USER_FIELDS } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ requests });
  } catch (err) { next(err); }
}

module.exports = { sendRequest, respond, endRelationship, listPendingForMe };
