const prisma = require('../config/prisma');
const { has } = require('../services/permissions');
const { messageInclude, assertAccess, roomFor } = require('./messageController');

// Matches the exact duration choices offered in PollComposerModal.jsx.
const DURATION_HOURS = { '1h': 1, '4h': 4, '16h': 16, '24h': 24, '3d': 72, '1w': 168 };
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 7;

// A poll is a Message (so it shows up in the normal channel feed, gets
// real-time delivery via the same `message:new` socket event as any other
// message, and can be replied to/pinned/deleted like one) with a Poll row
// attached to it holding the structured question/options/expiry.
async function createPoll(req, res, next) {
  try {
    const { conversationId, channelId, question, options, duration } = req.body;
    const access = await assertAccess(req, { conversationId, channelId }, true);
    if (access?.perms && !has(access.perms, 'CREATE_POLLS')) {
      return res.status(403).json({ error: 'Você não tem permissão para criar enquetes neste canal.' });
    }

    const cleanOptions = (Array.isArray(options) ? options : [])
      .map((o) => (typeof o === 'string' ? o.trim() : ''))
      .filter(Boolean);

    if (!question || !question.trim()) return res.status(400).json({ error: 'A enquete precisa de um título.' });
    if (cleanOptions.length < MIN_OPTIONS) return res.status(400).json({ error: `A enquete precisa de pelo menos ${MIN_OPTIONS} opções.` });
    if (cleanOptions.length > MAX_OPTIONS) return res.status(400).json({ error: `A enquete pode ter no máximo ${MAX_OPTIONS} opções.` });

    const hours = DURATION_HOURS[duration];
    if (!hours) return res.status(400).json({ error: 'Duração inválida.' });

    const io = req.app.get('io');
    const message = await prisma.message.create({
      data: {
        title: question.trim(),
        authorId: req.user.id,
        conversationId: conversationId || null,
        channelId: channelId || null,
        poll: {
          create: {
            question: question.trim(),
            options: JSON.stringify(cleanOptions),
            expiresAt: new Date(Date.now() + hours * 60 * 60 * 1000),
          },
        },
      },
      include: messageInclude,
    });

    io?.to(roomFor({ conversationId, channelId })).emit('message:new', message);
    res.status(201).json({ message });
  } catch (err) { next(err); }
}

// Single-choice: voting again just overwrites your previous pick (upsert on
// the pollId+userId unique constraint) rather than adding a second vote.
async function votePoll(req, res, next) {
  try {
    const { id } = req.params;
    const { optionIndex } = req.body;

    const poll = await prisma.poll.findUnique({ where: { id }, include: { message: true } });
    if (!poll) return res.status(404).json({ error: 'Enquete não encontrada.' });
    if (new Date(poll.expiresAt) <= new Date()) return res.status(400).json({ error: 'Esta enquete já foi encerrada.' });

    const options = JSON.parse(poll.options);
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= options.length) {
      return res.status(400).json({ error: 'Opção inválida.' });
    }

    await assertAccess(req, { conversationId: poll.message.conversationId, channelId: poll.message.channelId }, true);

    await prisma.pollVote.upsert({
      where: { pollId_userId: { pollId: id, userId: req.user.id } },
      update: { optionIndex },
      create: { pollId: id, userId: req.user.id, optionIndex },
    });

    const message = await prisma.message.findUnique({ where: { id: poll.messageId }, include: messageInclude });
    const io = req.app.get('io');
    io?.to(roomFor(poll.message)).emit('message:update', message);
    res.json({ message });
  } catch (err) { next(err); }
}

module.exports = { createPoll, votePoll, DURATION_HOURS };
