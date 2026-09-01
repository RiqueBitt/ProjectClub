const prisma = require('../config/prisma');

// Item pedido: "Confiável/Legal/Sexy" — três selos separados, cada um
// binário (votou = conta como "sim") — alternando (marcar/desmarcar),
// mesmo padrão do "Fã".
const TRAITS = ['TRUSTWORTHY', 'COOL', 'SEXY'];

async function toggle(req, res, next) {
  try {
    const { targetId } = req.params;
    const { trait } = req.body;
    if (!TRAITS.includes(trait)) return res.status(400).json({ error: 'Traço inválido.' });
    if (targetId === req.user.id) return res.status(400).json({ error: 'Você não pode votar em si mesmo.' });

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const existing = await prisma.traitVote.findUnique({
      where: { voterId_targetId_trait: { voterId: req.user.id, targetId, trait } },
    });
    if (existing) {
      await prisma.traitVote.delete({ where: { id: existing.id } });
    } else {
      await prisma.traitVote.create({ data: { voterId: req.user.id, targetId, trait } });
    }
    res.json(await computeStatus(req.user.id, targetId));
  } catch (err) { next(err); }
}

async function getStatus(req, res, next) {
  try {
    const { targetId } = req.params;
    res.json(await computeStatus(req.user.id, targetId));
  } catch (err) { next(err); }
}

// Devolve, pra cada traço: quantos votos tem no total (não tem "não",
// só conta quem marcou "sim" — igual o Orkut original, que não tinha
// voto negativo nesses três selos) e se EU já votei.
async function computeStatus(voterId, targetId) {
  const result = {};
  for (const trait of TRAITS) {
    const [count, mine] = await Promise.all([
      prisma.traitVote.count({ where: { targetId, trait } }),
      prisma.traitVote.findUnique({ where: { voterId_targetId_trait: { voterId, targetId, trait } } }),
    ]);
    result[trait] = { count, voted: !!mine };
  }
  return result;
}

module.exports = { toggle, getStatus, TRAITS };
