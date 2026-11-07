'use strict';
// Concursos da Praça (modelo dos projetos de fãs: concurso de iglu do CP
// Rewritten/Journey com pin exclusivo pros vencedores, Mural de Arte do CP
// Legacy com 5.000 moedas + pin pra arte destacada): o jogador manda uma
// imagem (print do iglu, desenho…), a comunidade vota uma vez por concurso e
// a staff escolhe os vencedores — o prêmio (itens originais do jogo + moedas)
// é entregue na hora pelo events.grant.
const prisma = require('../../config/prisma');
const events = require('./events');

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const ids = (arr) => (Array.isArray(arr) ? arr.map(Number).filter((n) => Number.isInteger(n) && n > 0) : []);
const KINDS = ['igloo', 'arte', 'fantasia', 'outro'];
const KIND_LABEL = { igloo: 'Concurso de iglu', arte: 'Mural de Arte', fantasia: 'Desfile de fantasias', outro: 'Concurso' };

function phase(c, d = new Date()) {
  if (!c.active) return 'off';
  if (d < c.startsAt) return 'soon';
  if (d <= c.endsAt) return 'open'; // inscrições
  if (d <= c.votingEndsAt) return 'voting';
  return 'ended';
}

function shape(c, { mine = null, myVote = null, entries = [] } = {}) {
  let prizeItems = [];
  try { prizeItems = ids(JSON.parse(c.prizeItems || '[]')); } catch { prizeItems = []; }
  return {
    id: c.id, kind: c.kind, kindLabel: KIND_LABEL[c.kind] || KIND_LABEL.outro, title: c.title, description: c.description, theme: c.theme,
    startsAt: c.startsAt, endsAt: c.endsAt, votingEndsAt: c.votingEndsAt, prizeItems, prizeCoins: c.prizeCoins, maxWinners: c.maxWinners, active: c.active,
    phase: phase(c), mine, myVote, entries,
  };
}

async function entryList(contestId, { all = false } = {}) {
  const rows = await prisma.plazaContestEntry.findMany({ where: { contestId, ...(all ? {} : { hidden: false }) }, orderBy: [{ winner: 'desc' }, { votes: 'desc' }, { createdAt: 'asc' }], take: 200 });
  const users = new Map();
  for (const r of rows) {
    if (!users.has(r.userId)) users.set(r.userId, await prisma.user.findUnique({ where: { id: r.userId }, select: { id: true, username: true, displayName: true, avatarUrl: true } }).catch(() => null));
  }
  return rows.map((r) => ({ id: r.id, userId: r.userId, user: users.get(r.userId) || null, imageUrl: r.imageUrl, caption: r.caption, votes: r.votes, winner: r.winner, hidden: r.hidden, createdAt: r.createdAt }));
}

/** Concursos visíveis pro jogador (abertos, em votação ou encerrados há pouco). */
async function playerList(userId) {
  const d = new Date();
  const rows = await prisma.plazaContest.findMany({ where: { active: true, startsAt: { lte: new Date(d.getTime() + 7 * 86400000) }, votingEndsAt: { gte: new Date(d.getTime() - 14 * 86400000) } }, orderBy: { startsAt: 'desc' }, take: 10 });
  const out = [];
  for (const c of rows) {
    const [mine, vote, entries] = await Promise.all([
      prisma.plazaContestEntry.findUnique({ where: { contestId_userId: { contestId: c.id, userId } } }),
      prisma.plazaContestVote.findUnique({ where: { contestId_userId: { contestId: c.id, userId } } }),
      entryList(c.id),
    ]);
    out.push(shape(c, { mine: mine ? { id: mine.id, imageUrl: mine.imageUrl, caption: mine.caption, votes: mine.votes, winner: mine.winner, hidden: mine.hidden } : null, myVote: vote?.entryId || null, entries }));
  }
  return out;
}

async function enter(userId, contestId, { imageUrl, caption }) {
  const c = await prisma.plazaContest.findUnique({ where: { id: String(contestId) } });
  if (!c) throw new Error('Concurso não encontrado.');
  if (phase(c) !== 'open') throw new Error(phase(c) === 'soon' ? 'As inscrições ainda não abriram.' : 'As inscrições desse concurso já fecharam.');
  if (!imageUrl) throw new Error('Mande uma imagem (print do iglu, desenho…).');
  const data = { imageUrl: String(imageUrl).slice(0, 500), caption: String(caption || '').slice(0, 200), hidden: false };
  const row = await prisma.plazaContestEntry.upsert({ where: { contestId_userId: { contestId: c.id, userId } }, create: { contestId: c.id, userId, ...data }, update: data });
  return { id: row.id, imageUrl: row.imageUrl, caption: row.caption };
}

async function vote(userId, contestId, entryId) {
  const c = await prisma.plazaContest.findUnique({ where: { id: String(contestId) } });
  if (!c) throw new Error('Concurso não encontrado.');
  if (phase(c) !== 'voting') throw new Error(phase(c) === 'open' ? 'A votação abre quando as inscrições fecharem.' : 'A votação desse concurso não está aberta.');
  const e = await prisma.plazaContestEntry.findUnique({ where: { id: String(entryId) } });
  if (!e || e.contestId !== c.id || e.hidden) throw new Error('Participação não encontrada.');
  if (e.userId === userId) throw new Error('Não dá pra votar em você mesmo.');
  const prev = await prisma.plazaContestVote.findUnique({ where: { contestId_userId: { contestId: c.id, userId } } });
  await prisma.$transaction(async (tx) => {
    if (prev) {
      const prevEntryId = prev.entryId;
      if (prevEntryId === e.id) throw new Error('Você já votou nessa.');
      await tx.plazaContestVote.update({ where: { id: prev.id }, data: { entryId: e.id } });
      await tx.plazaContestEntry.update({ where: { id: prevEntryId }, data: { votes: { decrement: 1 } } });
    } else {
      await tx.plazaContestVote.create({ data: { contestId: c.id, entryId: e.id, userId } });
    }
    await tx.plazaContestEntry.update({ where: { id: e.id }, data: { votes: { increment: 1 } } });
  });
  return { entryId: e.id, changed: !!prev };
}

// ---- staff ----
async function list() {
  const rows = await prisma.plazaContest.findMany({ orderBy: { startsAt: 'desc' }, take: 50, include: { _count: { select: { entries: true, votes: true } } } });
  return rows.map((c) => ({ ...shape(c), entriesCount: c._count.entries, votesCount: c._count.votes }));
}

async function detail(id) {
  const c = await prisma.plazaContest.findUnique({ where: { id: String(id) } });
  if (!c) throw new Error('Concurso não encontrado.');
  return shape(c, { entries: await entryList(c.id, { all: true }) });
}

async function save(body) {
  const startsAt = new Date(body.startsAt); const endsAt = new Date(body.endsAt); const votingEndsAt = new Date(body.votingEndsAt || body.endsAt);
  if ([startsAt, endsAt, votingEndsAt].some((x) => Number.isNaN(+x)) || endsAt <= startsAt || votingEndsAt < endsAt) throw new Error('Datas inválidas (início < fim das inscrições ≤ fim da votação).');
  const data = {
    kind: KINDS.includes(body.kind) ? body.kind : 'outro', title: String(body.title || '').slice(0, 100), description: String(body.description || '').slice(0, 500), theme: String(body.theme || '').slice(0, 120),
    startsAt, endsAt, votingEndsAt, prizeItems: JSON.stringify(ids(body.prizeItems)), prizeCoins: Math.max(0, Math.min(1000000, num(body.prizeCoins))), maxWinners: Math.max(1, Math.min(50, num(body.maxWinners) || 3)), active: body.active !== false,
  };
  if (!data.title) throw new Error('Dê um título ao concurso.');
  if (body.id) return prisma.plazaContest.update({ where: { id: String(body.id) }, data });
  return prisma.plazaContest.create({ data });
}

async function remove(id) { await prisma.plazaContest.delete({ where: { id: String(id) } }); }

async function hideEntry(entryId, hidden = true) {
  return prisma.plazaContestEntry.update({ where: { id: String(entryId) }, data: { hidden: !!hidden } });
}

/** Marca vencedor(es) e entrega o prêmio na hora (uma vez por participação). */
async function pickWinners(contestId, entryIds) {
  const c = await prisma.plazaContest.findUnique({ where: { id: String(contestId) } });
  if (!c) throw new Error('Concurso não encontrado.');
  let prizeItems = [];
  try { prizeItems = ids(JSON.parse(c.prizeItems || '[]')); } catch { prizeItems = []; }
  const out = [];
  for (const id of (Array.isArray(entryIds) ? entryIds : [entryIds]).map(String).slice(0, c.maxWinners)) {
    const e = await prisma.plazaContestEntry.findUnique({ where: { id } });
    if (!e || e.contestId !== c.id || e.winner) continue;
    await prisma.plazaContestEntry.update({ where: { id }, data: { winner: true } });
    const granted = await events.grant(e.userId, { coins: c.prizeCoins, items: prizeItems });
    out.push({ entryId: id, userId: e.userId, ...granted });
  }
  return out;
}

module.exports = { KINDS, KIND_LABEL, phase, playerList, enter, vote, list, detail, save, remove, hideEntry, pickWinners };
