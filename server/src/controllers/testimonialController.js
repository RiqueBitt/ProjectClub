const prisma = require('../config/prisma');
const { PUBLIC_USER_FIELDS } = require('./authController');

// Item pedido: "sistema igual tinha no Orkut" — depoimentos. Um amigo
// escreve um texto sobre você, mas só aparece publicamente no seu
// perfil depois de VOCÊ aprovar — mesmo espírito de um pedido de
// amizade (fica pendente até quem recebe decidir), só que aqui decide
// se aquele texto fica exposto ou não, em vez de virar amigo ou não.

async function writeTestimonial(req, res, next) {
  try {
    const { targetId } = req.params;
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Escreva algo antes de enviar.' });
    if (targetId === req.user.id) return res.status(400).json({ error: 'Você não pode escrever um depoimento pra si mesmo.' });

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const existing = await prisma.testimonial.findUnique({
      where: { authorId_targetId: { authorId: req.user.id, targetId } },
    });
    if (existing) return res.status(409).json({ error: 'Você já escreveu um depoimento pra essa pessoa.' });

    const testimonial = await prisma.testimonial.create({
      data: { authorId: req.user.id, targetId, text: text.trim().slice(0, 1000), status: 'PENDING' },
      include: { author: { select: PUBLIC_USER_FIELDS } },
    });

    req.app.get('io')?.notifyUser?.(targetId, 'testimonial:new-pending', { testimonial });
    res.status(201).json({ testimonial });
  } catch (err) { next(err); }
}

// Depoimentos JÁ aprovados de alguém — o que qualquer visitante do
// perfil vê.
async function listApproved(req, res, next) {
  try {
    const { targetId } = req.params;
    const testimonials = await prisma.testimonial.findMany({
      where: { targetId, status: 'APPROVED' },
      include: { author: { select: PUBLIC_USER_FIELDS } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ testimonials });
  } catch (err) { next(err); }
}

// Os que EU recebi e ainda não decidi (aprovar/recusar) — só eu vejo
// essa lista, é privada até eu aprovar.
async function listPendingForMe(req, res, next) {
  try {
    const testimonials = await prisma.testimonial.findMany({
      where: { targetId: req.user.id, status: 'PENDING' },
      include: { author: { select: PUBLIC_USER_FIELDS } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ testimonials });
  } catch (err) { next(err); }
}

async function respond(req, res, next) {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'approve' | 'decline'
    const testimonial = await prisma.testimonial.findUnique({ where: { id } });
    if (!testimonial || testimonial.targetId !== req.user.id) {
      return res.status(404).json({ error: 'Depoimento não encontrado.' });
    }
    if (action === 'decline') {
      await prisma.testimonial.delete({ where: { id } });
      return res.json({ ok: true });
    }
    if (action !== 'approve') return res.status(400).json({ error: 'Ação inválida.' });

    const updated = await prisma.testimonial.update({
      where: { id },
      data: { status: 'APPROVED' },
      include: { author: { select: PUBLIC_USER_FIELDS } },
    });
    req.app.get('io')?.notifyUser?.(testimonial.authorId, 'testimonial:approved', { testimonial: updated });
    res.json({ testimonial: updated });
  } catch (err) { next(err); }
}

// Quem escreveu OU quem recebeu pode apagar (igual um scrap ou
// mensagem — cada lado tem controle sobre remover aquele texto).
async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const testimonial = await prisma.testimonial.findUnique({ where: { id } });
    if (!testimonial || ![testimonial.authorId, testimonial.targetId].includes(req.user.id)) {
      return res.status(404).json({ error: 'Depoimento não encontrado.' });
    }
    await prisma.testimonial.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { writeTestimonial, listApproved, listPendingForMe, respond, remove };
