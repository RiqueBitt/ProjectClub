const prisma = require('../config/prisma');

// Item pedido: "RegisteredGames... Jogos adicionados... Cada jogo
// deve possuir um identificador interno. Não depender apenas do nome
// exibido." — gameKey é esse identificador interno (ex: "minecraft"),
// nunca muda mesmo que displayName mude. @@unique([userId, gameKey])
// no schema garante que a mesma pessoa não pode adicionar o mesmo
// jogo duas vezes.
//
// Detecção automática de jogo rodando (Game Detection Manager, "processos
// ativos -> identificar jogo") só é possível de verdade dentro do
// aplicativo ".exe" (o navegador não tem acesso à lista de processos do
// sistema operacional) — essas rotas cobrem só a parte "Jogos
// adicionados" manualmente, que funciona igual em qualquer plataforma.
async function listMyGames(req, res, next) {
  try {
    const games = await prisma.registeredGame.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ games });
  } catch (err) { next(err); }
}

async function addGame(req, res, next) {
  try {
    const { gameKey, displayName, iconUrl } = req.body || {};
    if (!gameKey || typeof gameKey !== 'string' || !gameKey.trim()) {
      return res.status(400).json({ error: 'gameKey é obrigatório.' });
    }
    if (!displayName || typeof displayName !== 'string' || !displayName.trim()) {
      return res.status(400).json({ error: 'displayName é obrigatório.' });
    }
    const normalizedKey = gameKey.trim().toLowerCase().slice(0, 64);
    const existing = await prisma.registeredGame.findUnique({
      where: { userId_gameKey: { userId: req.user.id, gameKey: normalizedKey } },
    });
    if (existing) {
      return res.status(400).json({ error: 'Esse jogo já está na sua lista.' });
    }
    const game = await prisma.registeredGame.create({
      data: {
        userId: req.user.id,
        gameKey: normalizedKey,
        displayName: displayName.trim().slice(0, 100),
        iconUrl: typeof iconUrl === 'string' ? iconUrl : null,
      },
    });
    res.status(201).json({ game });
  } catch (err) { next(err); }
}

async function removeGame(req, res, next) {
  try {
    const { id } = req.params;
    // where com userId junto (não só id) garante que ninguém remove um
    // jogo registrado de outra pessoa só adivinhando/forjando o id.
    const result = await prisma.registeredGame.deleteMany({ where: { id, userId: req.user.id } });
    if (result.count === 0) {
      return res.status(404).json({ error: 'Jogo não encontrado.' });
    }
    res.json({ success: true });
  } catch (err) { next(err); }
}

module.exports = { listMyGames, addGame, removeGame };
