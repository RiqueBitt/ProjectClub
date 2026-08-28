const prisma = require('../config/prisma');

const AUTHOR_FIELDS = { id: true, displayName: true, avatarUrl: true, profileColor: true, platformRole: true };

async function listMyTickets(req, res, next) {
  try {
    const tickets = await prisma.ticket.findMany({
      where: { authorId: req.user.id },
      include: { author: { select: AUTHOR_FIELDS }, claimedBy: { select: AUTHOR_FIELDS } },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ tickets });
  } catch (err) { next(err); }
}

async function createTicket(req, res, next) {
  try {
    const { subject, content } = req.body;
    if (!subject?.trim()) return res.status(400).json({ error: 'Escreva um assunto.' });
    if (!content?.trim()) return res.status(400).json({ error: 'Escreva sua mensagem.' });

    const ticket = await prisma.ticket.create({
      data: {
        authorId: req.user.id, subject: subject.trim().slice(0, 120),
        messages: { create: { authorId: req.user.id, content: content.trim().slice(0, 2000) } },
      },
      include: { author: { select: AUTHOR_FIELDS }, messages: { include: { author: { select: AUTHOR_FIELDS } } } },
    });

    const io = req.app.get('io');
    io?.to('staff').emit('ticket:new', { id: ticket.id });
    res.status(201).json({ ticket });
  } catch (err) { next(err); }
}

async function getTicket(req, res, next) {
  try {
    const { id } = req.params;
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        author: { select: AUTHOR_FIELDS }, claimedBy: { select: AUTHOR_FIELDS },
        messages: { include: { author: { select: AUTHOR_FIELDS } }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket não encontrado.' });
    const isStaff = ['ADMIN', 'MODERATOR'].includes(req.user.platformRole);
    if (ticket.authorId !== req.user.id && !isStaff) return res.status(403).json({ error: 'Sem permissão.' });
    res.json({ ticket });
  } catch (err) { next(err); }
}

async function addTicketMessage(req, res, next) {
  try {
    const { id } = req.params;
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Escreva uma mensagem.' });

    const ticket = await prisma.ticket.findUnique({ where: { id } });
    if (!ticket) return res.status(404).json({ error: 'Ticket não encontrado.' });
    const isStaff = ['ADMIN', 'MODERATOR'].includes(req.user.platformRole);
    if (ticket.authorId !== req.user.id && !isStaff) return res.status(403).json({ error: 'Sem permissão.' });
    if (ticket.status === 'CLOSED') return res.status(400).json({ error: 'Este ticket já foi fechado.' });

    const message = await prisma.ticketMessage.create({
      data: { ticketId: id, authorId: req.user.id, content: content.trim().slice(0, 2000) },
      include: { author: { select: AUTHOR_FIELDS } },
    });
    await prisma.ticket.update({ where: { id }, data: { updatedAt: new Date() } });

    const io = req.app.get('io');
    io?.to(`ticket:${id}`).emit('ticket:message', { ticketId: id, message });
    io?.notifyUser?.(ticket.authorId, 'ticket:update', { ticketId: id });
    if (ticket.claimedById) io?.notifyUser?.(ticket.claimedById, 'ticket:update', { ticketId: id });
    io?.to('staff').emit('ticket:update', { ticketId: id });
    res.status(201).json({ message });
  } catch (err) { next(err); }
}

async function adminListTickets(req, res, next) {
  try {
    const { status } = req.query;
    const tickets = await prisma.ticket.findMany({
      where: status ? { status } : undefined,
      include: { author: { select: AUTHOR_FIELDS }, claimedBy: { select: AUTHOR_FIELDS } },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ tickets });
  } catch (err) { next(err); }
}

async function claimTicket(req, res, next) {
  try {
    const { id } = req.params;
    const ticket = await prisma.ticket.update({
      where: { id }, data: { claimedById: req.user.id },
      include: { author: { select: AUTHOR_FIELDS }, claimedBy: { select: AUTHOR_FIELDS } },
    });
    req.app.get('io')?.to('staff').emit('ticket:update', { ticketId: id });
    res.json({ ticket });
  } catch (err) { next(err); }
}

async function closeTicket(req, res, next) {
  try {
    const { id } = req.params;
    const ticket = await prisma.ticket.update({
      where: { id }, data: { status: 'CLOSED', closedAt: new Date() },
      include: { author: { select: AUTHOR_FIELDS } },
    });
    const io = req.app.get('io');
    io?.notifyUser?.(ticket.authorId, 'ticket:update', { ticketId: id });
    io?.to('staff').emit('ticket:update', { ticketId: id });
    res.json({ ticket });
  } catch (err) { next(err); }
}

module.exports = {
  listMyTickets, createTicket, getTicket, addTicketMessage,
  adminListTickets, claimTicket, closeTicket,
};
