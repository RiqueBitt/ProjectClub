const prisma = require('../config/prisma');
const { PUBLIC_USER_FIELDS } = require('./authController');

// Item pedido: "enquetes" NO PERFIL (estilo Orkut) — pergunta + opções,
// um voto por pessoa, resultado em porcentagem. Nomes com prefixo
// "Profile" de propósito: já existe um sistema de enquete DIFERENTE no
// app (anexado a mensagens de chat, com duração/expiração — ver
// pollController.js) — esta é uma funcionalidade nova e separada.

async function create(req, res, next) {
  try {
    const { question, options } = req.body;
    if (!question || !question.trim()) return res.status(400).json({ error: 'Escreva uma pergunta.' });
    const cleanOptions = (options || []).map((o) => o?.trim()).filter(Boolean);
    if (cleanOptions.length < 2) return res.status(400).json({ error: 'Adicione pelo menos 2 opções.' });
    if (cleanOptions.length > 10) return res.status(400).json({ error: 'No máximo 10 opções.' });

    // Item pedido: máximo de 2 enquetes por perfil.
    const existingCount = await prisma.profilePoll.count({ where: { authorId: req.user.id } });
    if (existingCount >= 2) {
      return res.status(409).json({ error: 'Você já tem 2 enquetes no seu perfil — apague uma antes de criar outra.' });
    }

    const poll = await prisma.profilePoll.create({
      data: {
        authorId: req.user.id,
        question: question.trim().slice(0, 200),
        options: { create: cleanOptions.map((text, i) => ({ text: text.slice(0, 100), order: i })) },
      },
      include: { options: { include: { _count: { select: { votes: true } } } }, author: { select: PUBLIC_USER_FIELDS } },
    });
    res.status(201).json({ poll: shapePoll(poll, null) });
  } catch (err) { next(err); }
}

function shapePoll(poll, myVote) {
  const totalVotes = poll.options.reduce((sum, o) => sum + (o._count?.votes ?? 0), 0);
  return {
    id: poll.id,
    question: poll.question,
    author: poll.author,
    createdAt: poll.createdAt,
    totalVotes,
    myVoteOptionId: myVote?.optionId || null,
    options: poll.options.map((o) => ({
      id: o.id,
      text: o.text,
      votes: o._count?.votes ?? 0,
      percent: totalVotes > 0 ? Math.round(((o._count?.votes ?? 0) / totalVotes) * 100) : 0,
    })),
  };
}

async function listByAuthor(req, res, next) {
  try {
    const { authorId } = req.params;
    const polls = await prisma.profilePoll.findMany({
      where: { authorId },
      include: { author: { select: PUBLIC_USER_FIELDS }, options: { include: { _count: { select: { votes: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const myVotes = await prisma.profilePollVote.findMany({ where: { pollId: { in: polls.map((p) => p.id) }, voterId: req.user.id } });
    const myVoteByPoll = Object.fromEntries(myVotes.map((v) => [v.pollId, v]));
    res.json({ polls: polls.map((p) => shapePoll(p, myVoteByPoll[p.id])) });
  } catch (err) { next(err); }
}

async function vote(req, res, next) {
  try {
    const { id } = req.params;
    const { optionId } = req.body;
    const option = await prisma.profilePollOption.findUnique({ where: { id: optionId } });
    if (!option || option.pollId !== id) return res.status(404).json({ error: 'Opção não encontrada.' });

    // upsert pelo par (pollId, voterId) — trocar de opção substitui o
    // voto anterior, não soma um segundo voto.
    await prisma.profilePollVote.upsert({
      where: { pollId_voterId: { pollId: id, voterId: req.user.id } },
      update: { optionId },
      create: { pollId: id, optionId, voterId: req.user.id },
    });

    const poll = await prisma.profilePoll.findUnique({
      where: { id },
      include: { author: { select: PUBLIC_USER_FIELDS }, options: { include: { _count: { select: { votes: true } } } } },
    });
    res.json({ poll: shapePoll(poll, { optionId }) });
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const poll = await prisma.profilePoll.findUnique({ where: { id } });
    if (!poll || poll.authorId !== req.user.id) return res.status(404).json({ error: 'Enquete não encontrada.' });
    await prisma.profilePoll.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { create, listByAuthor, vote, remove };
