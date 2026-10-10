const prisma = require('../config/prisma');

const AUTHOR_FIELDS = { id: true, displayName: true, avatarUrl: true, avatarDecoration: true, profileColor: true };
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
    const summaries = await rsvpSummaries(events.map((e) => e.id), req.user.id);
    res.json({ events: events.map((e) => ({ ...e, rsvp: summaries[e.id] })) });
  } catch (err) { next(err); }
}

// --- RSVP ("Eu vou" / "Talvez" / "Não vou") ---
const RSVP_STATUS = ['GOING', 'MAYBE', 'NO'];
const RSVP_AVATARS = 8;

// Resumo por evento: contagem de cada resposta, quem vai/talvez (alguns
// avatares) e a resposta de quem pediu (mine).
async function rsvpSummaries(eventIds, viewerId) {
  const out = Object.fromEntries(eventIds.map((id) => [id, { counts: { GOING: 0, MAYBE: 0, NO: 0 }, going: [], maybe: [], mine: null }]));
  if (eventIds.length === 0) return out;
  const rows = await prisma.eventRsvp.findMany({
    where: { eventId: { in: eventIds } },
    orderBy: { updatedAt: 'desc' },
    select: { eventId: true, userId: true, status: true },
  });
  const wanted = new Set();
  for (const r of rows) {
    const sum = out[r.eventId];
    if (!sum || !RSVP_STATUS.includes(r.status)) continue;
    sum.counts[r.status] += 1;
    if (r.userId === viewerId) sum.mine = r.status;
    const bucket = r.status === 'GOING' ? sum.going : r.status === 'MAYBE' ? sum.maybe : null;
    if (bucket && bucket.length < RSVP_AVATARS) { bucket.push(r.userId); wanted.add(r.userId); }
  }
  const users = wanted.size
    ? await prisma.user.findMany({ where: { id: { in: [...wanted] } }, select: AUTHOR_FIELDS })
    : [];
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  for (const sum of Object.values(out)) {
    sum.going = sum.going.map((id) => byId[id]).filter(Boolean);
    sum.maybe = sum.maybe.map((id) => byId[id]).filter(Boolean);
  }
  return out;
}

// POST /events/:id/rsvp { status } — mandar a mesma resposta de novo (ou
// null) desfaz. Avisa todo mundo ('event:rsvp') pra contagem mudar ao vivo.
async function setRsvp(req, res, next) {
  try {
    const { id } = req.params;
    const status = req.body?.status ?? null;
    if (status !== null && !RSVP_STATUS.includes(status)) return res.status(400).json({ error: 'Resposta inválida.' });
    const event = await prisma.event.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!event) return res.status(404).json({ error: 'Evento não encontrado.' });
    if (event.status === 'ENDED') return res.status(400).json({ error: 'Esse evento já terminou.' });

    const key = { eventId_userId: { eventId: id, userId: req.user.id } };
    const existing = await prisma.eventRsvp.findUnique({ where: key });
    if (status === null || existing?.status === status) {
      if (existing) await prisma.eventRsvp.delete({ where: key });
    } else {
      await prisma.eventRsvp.upsert({ where: key, update: { status }, create: { eventId: id, userId: req.user.id, status } });
    }
    const summary = (await rsvpSummaries([id], req.user.id))[id];
    const { mine, ...publicSummary } = summary;
    req.app.get('io')?.to('community').emit('event:rsvp', { eventId: id, rsvp: publicSummary });
    res.json({ rsvp: summary, mine });
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

module.exports = { listEvents, createEvent, updateEvent, deleteEvent, uploadEventBanner, uploadEventIcon, setRsvp };
