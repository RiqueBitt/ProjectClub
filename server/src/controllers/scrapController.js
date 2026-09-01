const prisma = require('../config/prisma');
const { PUBLIC_USER_FIELDS } = require('./authController');

// Item pedido: recados no mural (scraps) — diferente de depoimento, é
// público na hora, sem aprovação nenhuma. Uma parede cronológica de
// mensagens curtas e informais que qualquer amigo pode deixar.

async function write(req, res, next) {
  try {
    const { targetId } = req.params;
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Escreva algo antes de enviar.' });

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const scrap = await prisma.scrap.create({
      data: { authorId: req.user.id, targetId, text: text.trim().slice(0, 300) },
      include: { author: { select: PUBLIC_USER_FIELDS } },
    });

    if (targetId !== req.user.id) {
      req.app.get('io')?.notifyUser?.(targetId, 'scrap:new', { scrap });
    }
    res.status(201).json({ scrap });
  } catch (err) { next(err); }
}

async function list(req, res, next) {
  try {
    const { targetId } = req.params;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const PAGE_SIZE = 100;
    const [scraps, total] = await Promise.all([
      prisma.scrap.findMany({
        where: { targetId },
        include: { author: { select: PUBLIC_USER_FIELDS } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.scrap.count({ where: { targetId } }),
    ]);
    res.json({ scraps, total, page, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
  } catch (err) { next(err); }
}

// Quem escreveu OU dono do mural pode apagar — igual o Orkut de
// verdade: você podia apagar um recado que te deixaram, mesmo sem ter
// sido você quem escreveu.
async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const scrap = await prisma.scrap.findUnique({ where: { id } });
    if (!scrap || ![scrap.authorId, scrap.targetId].includes(req.user.id)) {
      return res.status(404).json({ error: 'Recado não encontrado.' });
    }
    await prisma.scrap.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { write, list, remove };
