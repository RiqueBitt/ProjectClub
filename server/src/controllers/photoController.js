const prisma = require('../config/prisma');
const { PUBLIC_USER_FIELDS } = require('./authController');

// Item pedido: "álbum de fotos com comentários" — diferente do banner/
// avatar (só uma foto de cada), aqui é uma galeria de várias fotos,
// cada uma com seus próprios comentários — reaproveita o mesmo
// middleware de upload seguro já usado em outras partes do app (ícone
// de cargo, emoji customizado, etc — ver server/src/middleware/upload.js).

async function upload(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada.' });
    const { caption } = req.body;
    const photo = await prisma.photo.create({
      data: { ownerId: req.user.id, url: req.file.url, caption: caption?.slice(0, 200) || null },
    });
    res.status(201).json({ photo });
  } catch (err) { next(err); }
}

async function listByOwner(req, res, next) {
  try {
    const { ownerId } = req.params;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const PAGE_SIZE = 30;
    const [photos, total] = await Promise.all([
      prisma.photo.findMany({
        where: { ownerId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: { _count: { select: { comments: true } } },
      }),
      prisma.photo.count({ where: { ownerId } }),
    ]);
    res.json({ photos, total, page, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
  } catch (err) { next(err); }
}

async function getOne(req, res, next) {
  try {
    const { id } = req.params;
    const photo = await prisma.photo.findUnique({
      where: { id },
      include: {
        owner: { select: PUBLIC_USER_FIELDS },
        comments: { include: { author: { select: PUBLIC_USER_FIELDS } }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!photo) return res.status(404).json({ error: 'Foto não encontrada.' });
    res.json({ photo });
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const photo = await prisma.photo.findUnique({ where: { id } });
    if (!photo || photo.ownerId !== req.user.id) return res.status(404).json({ error: 'Foto não encontrada.' });
    await prisma.photo.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function comment(req, res, next) {
  try {
    const { id } = req.params;
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Escreva algo antes de enviar.' });
    const photo = await prisma.photo.findUnique({ where: { id } });
    if (!photo) return res.status(404).json({ error: 'Foto não encontrada.' });

    const photoComment = await prisma.photoComment.create({
      data: { photoId: id, authorId: req.user.id, text: text.trim().slice(0, 500) },
      include: { author: { select: PUBLIC_USER_FIELDS } },
    });
    if (photo.ownerId !== req.user.id) {
      req.app.get('io')?.notifyUser?.(photo.ownerId, 'photo:new-comment', { photoId: id, comment: photoComment });
    }
    res.status(201).json({ comment: photoComment });
  } catch (err) { next(err); }
}

async function removeComment(req, res, next) {
  try {
    const { commentId } = req.params;
    const photoComment = await prisma.photoComment.findUnique({ where: { id: commentId }, include: { photo: true } });
    if (!photoComment || ![photoComment.authorId, photoComment.photo.ownerId].includes(req.user.id)) {
      return res.status(404).json({ error: 'Comentário não encontrado.' });
    }
    await prisma.photoComment.delete({ where: { id: commentId } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { upload, listByOwner, getOne, remove, comment, removeComment };
