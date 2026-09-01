const prisma = require('../config/prisma');
const { PUBLIC_USER_FIELDS } = require('./authController');

// Item pedido: "sistema igual tinha no Orkut" — rankings. Cada pessoa
// escolhe UM amigo por categoria (o voto pode ser trocado depois — não
// acumula vários votos seus pro mesmo alvo). O perfil de cada um
// mostra o "Top 5" DOS SEUS AMIGOS em cada categoria, comparando só
// entre quem já é amigo, igual o Orkut de verdade fazia.
const CATEGORIES = ['FUNNY', 'TRUSTWORTHY', 'CREATIVE', 'COOL'];

async function vote(req, res, next) {
  try {
    const { targetId } = req.params;
    const { category } = req.body;
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Categoria inválida.' });
    if (targetId === req.user.id) return res.status(400).json({ error: 'Você não pode votar em si mesmo.' });

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

    await prisma.rankingVote.upsert({
      where: { voterId_category: { voterId: req.user.id, category } },
      update: { targetId },
      create: { voterId: req.user.id, targetId, category },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// Pra quem já votou — pra mostrar "você votou em Fulano como mais
// engraçado" já marcado, em vez da pessoa não lembrar em quem votou.
async function myVotes(req, res, next) {
  try {
    const votes = await prisma.rankingVote.findMany({
      where: { voterId: req.user.id },
      include: { target: { select: PUBLIC_USER_FIELDS } },
    });
    res.json({ votes });
  } catch (err) { next(err); }
}

// Top 5 por categoria, só entre os AMIGOS de quem está pedindo (não é
// um ranking geral da plataforma inteira, é sempre relativo ao seu
// próprio círculo de amigos, igual o Orkut original).
async function topAmongFriends(req, res, next) {
  try {
    const friendships = await prisma.friendship.findMany({
      where: { status: 'ACCEPTED', OR: [{ requesterId: req.user.id }, { addresseeId: req.user.id }] },
    });
    const friendIds = friendships.map((f) => (f.requesterId === req.user.id ? f.addresseeId : f.requesterId));
    if (friendIds.length === 0) {
      return res.json({ rankings: Object.fromEntries(CATEGORIES.map((c) => [c, []])) });
    }

    const rankings = {};
    for (const category of CATEGORIES) {
      const grouped = await prisma.rankingVote.groupBy({
        by: ['targetId'],
        where: { category, targetId: { in: friendIds } },
        _count: { targetId: true },
        orderBy: { _count: { targetId: 'desc' } },
        take: 5,
      });
      const users = await prisma.user.findMany({ where: { id: { in: grouped.map((g) => g.targetId) } }, select: PUBLIC_USER_FIELDS });
      const userById = Object.fromEntries(users.map((u) => [u.id, u]));
      rankings[category] = grouped.map((g) => ({ user: userById[g.targetId], votes: g._count.targetId })).filter((r) => r.user);
    }
    res.json({ rankings });
  } catch (err) { next(err); }
}

module.exports = { vote, myVotes, topAmongFriends, CATEGORIES };
