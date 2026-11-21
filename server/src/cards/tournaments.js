// Torneios da Guerra das Cartas — chaveamento eliminatório criado pela staff.
// As partidas são PvP normais (com prazo de turno); quem não aparece perde
// por tempo. Ao terminar cada partida o chaveamento avança sozinho.
const crypto = require('crypto');
const prisma = require('../config/prisma');
const S = require('./service');

const { CardError } = S;
const SIZES = [4, 8, 16, 32];
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const int = (v, min, max, fb) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fb; };

function readBody(b, isNew) {
  const d = {};
  if (b.name !== undefined) d.name = String(b.name).trim().slice(0, 80);
  if (isNew && !d.name) throw new CardError('Dê um nome ao torneio.');
  if (b.description !== undefined) d.description = String(b.description || '').slice(0, 2000) || null;
  if (b.maxPlayers !== undefined) d.maxPlayers = SIZES.includes(Number(b.maxPlayers)) ? Number(b.maxPlayers) : 8;
  if (b.prizeCoins !== undefined) d.prizeCoins = int(b.prizeCoins, 0, 1_000_000, 0);
  if (b.prizeGems !== undefined) d.prizeGems = int(b.prizeGems, 0, 100_000, 0);
  if (b.prizeCardId !== undefined) d.prizeCardId = b.prizeCardId ? String(b.prizeCardId) : null;
  if (b.startsAt !== undefined) d.startsAt = b.startsAt ? new Date(b.startsAt) : null;
  if (d.startsAt && Number.isNaN(d.startsAt.getTime())) d.startsAt = null;
  return d;
}

async function list(userId, { admin = false } = {}) {
  const rows = await prisma.cardTournament.findMany({ where: admin ? {} : { status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' }, take: 30 });
  const ids = rows.map((r) => r.id);
  const entries = ids.length ? await prisma.cardTournamentEntry.findMany({ where: { tournamentId: { in: ids } } }) : [];
  const userIds = [...new Set([...entries.map((e) => e.userId), ...rows.map((r) => r.winnerId).filter(Boolean)])];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true, username: true, avatarUrl: true } }) : [];
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  const catalog = await S.getCatalog();
  return rows.map((t) => {
    const mine = entries.filter((e) => e.tournamentId === t.id);
    const bracket = parse(t.bracket);
    return {
      id: t.id, name: t.name, description: t.description, status: t.status, maxPlayers: t.maxPlayers,
      prizeCoins: t.prizeCoins, prizeGems: t.prizeGems, startsAt: t.startsAt, createdAt: t.createdAt,
      prizeCard: t.prizeCardId && catalog.byId.get(t.prizeCardId) ? S.shapeCard(catalog.byId.get(t.prizeCardId)) : null,
      players: mine.map((e) => byId[e.userId]).filter(Boolean),
      joined: mine.some((e) => e.userId === userId),
      winner: t.winnerId ? byId[t.winnerId] || null : null,
      rounds: bracket?.rounds?.map((round) => round.map((p) => ({ ...p, p1u: byId[p.p1] || null, p2u: p.p2 ? byId[p.p2] || null : null }))) || [],
    };
  });
}

async function create(body, userId) {
  return prisma.cardTournament.create({ data: { maxPlayers: 8, ...readBody(body, true), createdById: userId } });
}

async function update(id, body) {
  const t = await prisma.cardTournament.findUnique({ where: { id } });
  if (!t) throw new CardError('Torneio não encontrado.', 404);
  if (t.status !== 'OPEN') throw new CardError('Só dá para editar torneios com inscrições abertas.');
  return prisma.cardTournament.update({ where: { id }, data: readBody(body, false) });
}

async function join(id, userId) {
  const t = await prisma.cardTournament.findUnique({ where: { id } });
  if (!t || t.status !== 'OPEN') throw new CardError('As inscrições deste torneio estão fechadas.');
  const n = await prisma.cardTournamentEntry.count({ where: { tournamentId: id } });
  if (n >= t.maxPlayers) throw new CardError('O torneio está lotado.');
  try { await prisma.cardTournamentEntry.create({ data: { tournamentId: id, userId } }); } catch (e) {
    if (e.code === 'P2002') throw new CardError('Você já está inscrito.');
    throw e;
  }
}

async function leave(id, userId) {
  const t = await prisma.cardTournament.findUnique({ where: { id } });
  if (!t || t.status !== 'OPEN') throw new CardError('Não dá mais para sair deste torneio.');
  await prisma.cardTournamentEntry.deleteMany({ where: { tournamentId: id, userId } });
}

async function cancel(id) {
  await prisma.cardTournament.updateMany({ where: { id, status: { in: ['OPEN', 'RUNNING'] } }, data: { status: 'CANCELLED' } });
  await prisma.cardMatch.updateMany({ where: { tournamentId: id, status: { in: ['ACTIVE', 'PENDING'] } }, data: { status: 'CANCELLED', endReason: 'staff', endedAt: new Date(), turnDeadline: null } });
}

// Cria as partidas de uma rodada. Byes (sem adversário) e jogadores com
// baralho inválido avançam/perdem na hora.
async function playRound(tournamentId, round, io) {
  const C = require('../controllers/cardsController');
  for (const pair of round) {
    if (pair.winner || pair.matchId) continue;
    if (!pair.p2) { pair.winner = pair.p1; continue; }
    try {
      const { match } = await C.newPvpMatch(pair.p1, pair.p2, { tournamentId });
      pair.matchId = match.id;
      for (const u of [pair.p1, pair.p2]) io?.notifyUser?.(u, 'cards:match', { id: match.id, started: true, tournament: true });
    } catch {
      // Baralho inválido de alguém: o outro avança (checa quem consegue jogar).
      const settings = await S.getSettings();
      const ok1 = await S.resolvePlayerDeck(pair.p1, settings).then(() => true).catch(() => false);
      pair.winner = ok1 ? pair.p1 : pair.p2;
      pair.walkover = true;
    }
  }
}

async function start(id, io) {
  const t = await prisma.cardTournament.findUnique({ where: { id } });
  if (!t || t.status !== 'OPEN') throw new CardError('Esse torneio não pode ser iniciado.');
  const entries = await prisma.cardTournamentEntry.findMany({ where: { tournamentId: id } });
  if (entries.length < 2) throw new CardError('Precisa de pelo menos 2 inscritos.');
  const players = entries.map((e) => e.userId);
  for (let i = players.length - 1; i > 0; i -= 1) { const j = crypto.randomInt(i + 1); [players[i], players[j]] = [players[j], players[i]]; }
  const round = [];
  for (let i = 0; i < players.length; i += 2) round.push({ p1: players[i], p2: players[i + 1] || null, matchId: null, winner: null });
  const lock = await prisma.cardTournament.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'RUNNING', bracket: JSON.stringify({ rounds: [round] }) } });
  if (!lock.count) throw new CardError('Esse torneio já começou.');
  await playRound(id, round, io);
  await advance(id, { rounds: [round] }, io);
  return prisma.cardTournament.findUnique({ where: { id } });
}

// Grava o chaveamento e, se a rodada acabou, cria a próxima ou premia.
async function advance(id, bracket, io) {
  const cur = bracket.rounds[bracket.rounds.length - 1];
  if (cur.every((p) => p.winner)) {
    const winners = cur.map((p) => p.winner);
    if (winners.length === 1) return finish(id, bracket, winners[0], io);
    const next = [];
    for (let i = 0; i < winners.length; i += 2) next.push({ p1: winners[i], p2: winners[i + 1] || null, matchId: null, winner: null });
    bracket.rounds.push(next);
    await playRound(id, next, io);
    return advance(id, bracket, io);
  }
  await prisma.cardTournament.update({ where: { id }, data: { bracket: JSON.stringify(bracket) } });
  return null;
}

async function finish(id, bracket, winnerId, io) {
  const r = await prisma.cardTournament.updateMany({ where: { id, status: 'RUNNING' }, data: { status: 'FINISHED', winnerId, bracket: JSON.stringify(bracket) } });
  if (!r.count) return;
  const t = await prisma.cardTournament.findUnique({ where: { id } });
  if (t.prizeCoins || t.prizeGems) {
    await prisma.user.update({ where: { id: winnerId }, data: { coins: { increment: t.prizeCoins }, gems: { increment: t.prizeGems } } });
    require('../services/economyLedger').recordTransaction(winnerId, { kind: 'CARDS', label: `Torneio: ${t.name}`, coins: t.prizeCoins, gems: t.prizeGems });
  }
  if (t.prizeCardId && (await prisma.cardDef.findUnique({ where: { id: t.prizeCardId } }))) {
    await prisma.$transaction(async (tx) => S.grantCards(tx, winnerId, [t.prizeCardId], [t.prizeCardId]));
  }
  io?.notifyUser?.(winnerId, 'cards:tournament', { id, won: true, name: t.name });
  io?.to?.('community')?.emit?.('cards:tournament', { id, finished: true });
}

// Chamado quando uma partida de torneio termina (service.finalizeMatch).
async function onMatchFinished(match, winnerId, io) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const t = await prisma.cardTournament.findUnique({ where: { id: match.tournamentId } });
    if (!t || t.status !== 'RUNNING') return;
    const bracket = parse(t.bracket);
    const round = bracket?.rounds?.[bracket.rounds.length - 1];
    const pair = round?.find((p) => p.matchId === match.id);
    if (!pair || pair.winner) return;
    pair.winner = winnerId || pair.p1;
    // Escrita otimista: só grava se ninguém mexeu no chaveamento no meio.
    const ok = await prisma.cardTournament.updateMany({ where: { id: t.id, bracket: t.bracket, status: 'RUNNING' }, data: { bracket: JSON.stringify(bracket) } });
    if (!ok.count) continue;
    await advance(t.id, bracket, io);
    return;
  }
}

module.exports = { list, create, update, join, leave, cancel, start, onMatchFinished, SIZES };
