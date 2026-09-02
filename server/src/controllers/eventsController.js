const prisma = require('../config/prisma');

const AUTHOR_FIELDS = { id: true, displayName: true, avatarUrl: true, profileColor: true };
const VALID_STATUS = ['UPCOMING', 'ACTIVE', 'ENDED'];
// Item pedido: "sistema de eventos integrado ao painel da Staff —
// somente usuários autorizados pelo Painel da Staff poderão criar,
// editar ou excluir eventos". Mesmo padrão de checagem já usado em
// updatesController.js (o outro sistema staff-only parecido).
const isStaff = (user) => ['ADMIN', 'MODERATOR'].includes(user.platformRole);

// Pública — qualquer pessoa logada vê os eventos (aparecem na
// categoria "Início"). Mais recentes primeiro.
async function listEvents(req, res, next) {
  try {
    const events = await prisma.event.findMany({
      include: { createdBy: { select: AUTHOR_FIELDS } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ events });
  } catch (err) { next(err); }
}

async function createEvent(req, res, next) {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Só a staff pode criar eventos.' });
    const { title, description, startsAt, endsAt, status } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Escreva um título.' });
    if (!description?.trim()) return res.status(400).json({ error: 'Escreva uma descrição.' });

    const data = {
      title: title.trim().slice(0, 150),
      description: description.trim().slice(0, 5000),
      createdById: req.user.id,
    };
    if (startsAt) { const d = new Date(startsAt); if (!isNaN(d.getTime())) data.startsAt = d; }
    if (endsAt) { const d = new Date(endsAt); if (!isNaN(d.getTime())) data.endsAt = d; }
    if (status && VALID_STATUS.includes(status)) data.status = status;

    const event = await prisma.event.create({ data, include: { createdBy: { select: AUTHOR_FIELDS } } });
    req.app.get('io')?.to('community').emit('event:new', event);
    res.status(201).json({ event });
  } catch (err) { next(err); }
}

async function updateEvent(req, res, next) {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Só a staff pode editar eventos.' });
    const { id } = req.params;
    const { title, description, startsAt, endsAt, status } = req.body;

    const data = {};
    if (title !== undefined) {
      if (!title.trim()) return res.status(400).json({ error: 'Escreva um título.' });
      data.title = title.trim().slice(0, 150);
    }
    if (description !== undefined) {
      if (!description.trim()) return res.status(400).json({ error: 'Escreva uma descrição.' });
      data.description = description.trim().slice(0, 5000);
    }
    if (startsAt !== undefined) data.startsAt = startsAt ? new Date(startsAt) : null;
    if (endsAt !== undefined) data.endsAt = endsAt ? new Date(endsAt) : null;
    if (status !== undefined && VALID_STATUS.includes(status)) data.status = status;

    const event = await prisma.event.update({ where: { id }, data, include: { createdBy: { select: AUTHOR_FIELDS } } });
    req.app.get('io')?.to('community').emit('event:update', event);
    res.json({ event });
  } catch (err) { next(err); }
}

async function deleteEvent(req, res, next) {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Só a staff pode excluir eventos.' });
    const { id } = req.params;
    await prisma.event.delete({ where: { id } });
    req.app.get('io')?.to('community').emit('event:delete', { id });
    res.json({ deleted: true });
  } catch (err) { next(err); }
}

async function uploadEventBanner(req, res, next) {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Só a staff pode editar eventos.' });
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    const { id } = req.params;
    const event = await prisma.event.update({
      where: { id }, data: { bannerUrl: req.file.url }, include: { createdBy: { select: AUTHOR_FIELDS } },
    });
    req.app.get('io')?.to('community').emit('event:update', event);
    res.json({ event });
  } catch (err) { next(err); }
}

async function uploadEventIcon(req, res, next) {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ error: 'Só a staff pode editar eventos.' });
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    const { id } = req.params;
    const event = await prisma.event.update({
      where: { id }, data: { iconUrl: req.file.url }, include: { createdBy: { select: AUTHOR_FIELDS } },
    });
    req.app.get('io')?.to('community').emit('event:update', event);
    res.json({ event });
  } catch (err) { next(err); }
}

module.exports = { listEvents, createEvent, updateEvent, deleteEvent, uploadEventBanner, uploadEventIcon };
