// Jogo de Cartas — sistemas extras: campanha, partida rápida, mercado,
// replay/assistir, torneios e ferramentas da staff (estatísticas,
// importar/exportar cartas, campanha e torneios). Tudo validado no servidor.
const prisma = require('../config/prisma');
const { PUBLIC_USER_FIELDS } = require('./authController');
const { DIFFICULTIES, RARITIES, ELEMENTS, ABILITIES } = require('../cards/config');
const { reduce, viewFor, spectatorView, eventsFor } = require('../cards/engine');
const S = require('../cards/service');
const C = require('./cardsController');
const T = require('../cards/tournaments');
const SP = require('../cards/spectators');
const { logAction } = require('../services/audit');

const { CardError } = S;
const { handle, notify, safeJson } = C;
const ledger = () => require('../services/economyLedger');
const audit = (req, action, targetId, metadata) => logAction(req.app.get('io'), { actorId: req.user.id, action, targetType: 'CARDS', targetId, metadata }).catch(() => {});
const int = (v, min, max, fb) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fb; };

async function friendIds(userId) {
  const rows = await prisma.friendship.findMany({ where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] }, select: { requesterId: true, addresseeId: true } });
  return new Set(rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId)));
}
const isAdmin = (u) => u?.platformRole === 'ADMIN';

// ================= Campanha =================
const campaign = handle(async (req, res) => {
  await S.ensureSeed();
  const p = await S.getPlayer(req.user.id);
  const catalog = await S.getCatalog();
  const stages = await prisma.cardCampaignStage.findMany({ where: { enabled: true }, orderBy: { position: 'asc' } });
  res.json({
    progress: p.campaignStage,
    stages: stages.map((st, i) => ({
      id: st.id, index: i, name: st.name, story: st.story, botName: st.botName, difficulty: st.difficulty,
      difficultyLabel: DIFFICULTIES[st.difficulty]?.label || st.difficulty, heroHp: st.heroHp, rewardCoins: st.rewardCoins,
      rewardCard: st.rewardCardId && catalog.byId.get(st.rewardCardId) ? S.shapeCard(catalog.byId.get(st.rewardCardId)) : null,
      status: i < p.campaignStage ? 'DONE' : i === p.campaignStage ? 'CURRENT' : 'LOCKED',
    })),
  });
});

const startCampaign = handle(async (req, res) => {
  const userId = req.user.id;
  await C.requireActivePlayer(userId);
  const settings = await S.getSettings();
  if (!settings.enabled.pve) throw new CardError('Partidas contra bots estão desativadas.');
  const p = await S.getPlayer(userId);
  const stages = await prisma.cardCampaignStage.findMany({ where: { enabled: true }, orderBy: { position: 'asc' } });
  const idx = stages.findIndex((x) => x.id === req.params.id);
  if (idx < 0) throw new CardError('Fase não encontrada.', 404);
  if (idx > p.campaignStage) throw new CardError('Vença as fases anteriores primeiro.');
  const st = stages[idx];
  const difficulty = DIFFICULTIES[st.difficulty] ? st.difficulty : 'MEDIO';
  let botDeck = null;
  const ids = safeJson(st.deckCardIds || '[]', []);
  if (Array.isArray(ids) && ids.length) {
    const catalog = await S.getCatalog();
    const cards = ids.map((id) => catalog.byId.get(id)).filter((c) => c && c.enabled);
    if (cards.length) {
      botDeck = [];
      for (let i = 0; botDeck.length < settings.rules.deckSize; i += 1) botDeck.push({ card: cards[i % cards.length], level: DIFFICULTIES[difficulty].level });
    }
  }
  res.json(await C.newPveMatch(userId, { difficulty, botName: st.botName, botHp: st.heroHp, botDeck, campaignStageId: st.id, boardId: st.boardId || null }));
});

// ================= Partida rápida (fila PvP) =================
// Fila em memória (uma instância do servidor). Junta quem tem rating parecido;
// a tolerância cresce com o tempo de espera.
const queue = new Map(); // userId -> { userId, rating, since, lastPoll }
const matchedFor = new Map(); // userId -> { matchId, at }

function cleanQueue() {
  const now = Date.now();
  for (const [id, e] of queue) if (now - e.lastPoll > 15_000) queue.delete(id);
  for (const [id, m] of matchedFor) if (now - m.at > 60_000) matchedFor.delete(id);
}

async function tryMatch(req, me) {
  const now = Date.now();
  const wait = (e) => (now - e.since) / 1000;
  let best = null;
  for (const e of queue.values()) {
    if (e.userId === me.userId) continue;
    const tol = 100 + 15 * Math.max(wait(e), wait(me));
    const diff = Math.abs(e.rating - me.rating);
    if (diff <= tol && (!best || diff < best.diff)) best = { e, diff };
  }
  if (!best) return null;
  queue.delete(best.e.userId);
  queue.delete(me.userId);
  try {
    const { match } = await C.newPvpMatch(best.e.userId, me.userId);
    matchedFor.set(best.e.userId, { matchId: match.id, at: now });
    notify(req, best.e.userId, 'cards:match', { id: match.id, started: true, quick: true });
    return match.id;
  } catch (err) {
    queue.set(best.e.userId, best.e); // devolve o outro pra fila
    throw err;
  }
}

const joinQueue = handle(async (req, res) => {
  cleanQueue();
  const userId = req.user.id;
  const settings = await S.getSettings();
  if (!settings.enabled.pvp) throw new CardError('Partidas PvP estão desativadas.');
  const done = matchedFor.get(userId);
  if (done) { matchedFor.delete(userId); return res.json({ status: 'MATCHED', matchId: done.matchId }); }
  let entry = queue.get(userId);
  if (!entry) {
    await C.requireActivePlayer(userId);
    const busy = await prisma.cardMatch.findFirst({ where: { mode: 'PVP', status: 'ACTIVE', OR: [{ p1Id: userId }, { p2Id: userId }] } });
    if (busy) return res.json({ status: 'MATCHED', matchId: busy.id });
    await S.resolvePlayerDeck(userId, settings); // baralho válido antes de entrar
    const p = await S.getPlayer(userId);
    entry = { userId, rating: p.seasonRating, since: Date.now(), lastPoll: Date.now() };
    queue.set(userId, entry);
  }
  entry.lastPoll = Date.now();
  const matchId = await tryMatch(req, entry);
  if (matchId) return res.json({ status: 'MATCHED', matchId });
  res.json({ status: 'SEARCHING', since: entry.since, waiting: queue.size });
});

const leaveQueue = handle(async (req, res) => {
  queue.delete(req.user.id);
  res.json({ ok: true });
});

// ================= Mercado =================
async function shapeListings(rows) {
  const catalog = await S.getCatalog();
  const ids = [...new Set(rows.map((r) => r.sellerId))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: PUBLIC_USER_FIELDS }) : [];
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  return rows.map((r) => ({
    id: r.id, price: r.price, foil: r.foil, status: r.status, createdAt: r.createdAt, soldAt: r.soldAt,
    seller: byId[r.sellerId] || null, card: catalog.byId.get(r.cardId) ? S.shapeCard(catalog.byId.get(r.cardId)) : null,
  })).filter((x) => x.card);
}

const market = handle(async (req, res) => {
  const userId = req.user.id;
  const where = { status: 'ACTIVE' };
  if (typeof req.query.cardId === 'string' && req.query.cardId) where.cardId = req.query.cardId;
  const sort = req.query.sort === 'cheap' ? [{ price: 'asc' }] : req.query.sort === 'expensive' ? [{ price: 'desc' }] : [{ createdAt: 'desc' }];
  const [rows, mine, settings] = await Promise.all([
    prisma.cardListing.findMany({ where, orderBy: sort, take: 120 }),
    prisma.cardListing.findMany({ where: { sellerId: userId }, orderBy: { createdAt: 'desc' }, take: 30 }),
    S.getSettings(),
  ]);
  let list = await shapeListings(rows);
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q) list = list.filter((l) => l.card.name.toLowerCase().includes(q));
  if (RARITIES.includes(req.query.rarity)) list = list.filter((l) => l.card.rarity === req.query.rarity);
  res.json({ listings: list, mine: await shapeListings(mine), tax: settings.economy.marketTax, maxListings: settings.economy.maxListings, enabled: settings.enabled.market !== false });
});

const createListing = handle(async (req, res) => {
  const userId = req.user.id;
  await C.requireActivePlayer(userId);
  const settings = await S.getSettings();
  if (settings.enabled.market === false) throw new CardError('O mercado está fechado no momento.');
  const card = (await S.getCatalog()).byId.get(String(req.body?.cardId || ''));
  if (!card || !card.enabled) throw new CardError('Carta inválida.');
  const foil = req.body?.foil === true;
  const price = int(req.body?.price, 1, 1_000_000, 0);
  if (!price) throw new CardError('Defina um preço.');
  const open = await prisma.cardListing.count({ where: { sellerId: userId, status: 'ACTIVE' } });
  if (open >= settings.economy.maxListings) throw new CardError(`Você já tem ${open} cartas à venda.`);
  const listing = await prisma.$transaction(async (tx) => {
    const r = await tx.userCard.updateMany({
      where: { userId, cardId: card.id, quantity: { gte: 1 }, ...(foil ? { foil: { gte: 1 } } : {}) },
      data: { quantity: { decrement: 1 }, ...(foil ? { foil: { decrement: 1 } } : {}) },
    });
    if (r.count === 0) throw new CardError(foil ? 'Você não tem essa carta brilhante.' : 'Você não tem essa carta.');
    if (!foil) await S.clampFoil(tx, userId, card.id);
    return tx.cardListing.create({ data: { sellerId: userId, cardId: card.id, foil, price } });
  });
  res.json({ listing: (await shapeListings([listing]))[0] });
});

const cancelListing = handle(async (req, res) => {
  const userId = req.user.id;
  const l = await prisma.cardListing.findUnique({ where: { id: req.params.id } });
  if (!l || (l.sellerId !== userId && !isAdmin(req.user))) throw new CardError('Anúncio não encontrado.', 404);
  await prisma.$transaction(async (tx) => {
    const r = await tx.cardListing.updateMany({ where: { id: l.id, status: 'ACTIVE' }, data: { status: 'CANCELLED' } });
    if (r.count === 0) throw new CardError('Esse anúncio não está mais ativo.');
    await S.grantCards(tx, l.sellerId, [l.cardId], l.foil ? [l.cardId] : []);
  });
  res.json({ ok: true });
});

const buyListing = handle(async (req, res) => {
  const userId = req.user.id;
  await C.requireActivePlayer(userId);
  const settings = await S.getSettings();
  if (settings.enabled.market === false) throw new CardError('O mercado está fechado no momento.');
  const l = await prisma.cardListing.findUnique({ where: { id: req.params.id } });
  if (!l || l.status !== 'ACTIVE') throw new CardError('Essa carta já foi vendida ou retirada.');
  if (l.sellerId === userId) throw new CardError('Você não pode comprar seu próprio anúncio.');
  const tax = Math.floor((l.price * Math.max(0, Math.min(50, settings.economy.marketTax | 0))) / 100);
  await prisma.$transaction(async (tx) => {
    const lock = await tx.cardListing.updateMany({ where: { id: l.id, status: 'ACTIVE' }, data: { status: 'SOLD', buyerId: userId, soldAt: new Date() } });
    if (lock.count === 0) throw new CardError('Essa carta já foi vendida.');
    const pay = await tx.user.updateMany({ where: { id: userId, coins: { gte: l.price } }, data: { coins: { decrement: l.price } } });
    if (pay.count === 0) throw new CardError('Moedas insuficientes.');
    await tx.user.update({ where: { id: l.sellerId }, data: { coins: { increment: l.price - tax } } });
    await S.grantCards(tx, userId, [l.cardId], l.foil ? [l.cardId] : []);
  });
  const name = (await S.getCatalog()).byId.get(l.cardId)?.name || 'carta';
  ledger().recordTransaction(userId, { kind: 'CARDS', label: `Mercado: comprou ${name}`, coins: -l.price });
  ledger().recordTransaction(l.sellerId, { kind: 'CARDS', label: `Mercado: vendeu ${name}`, coins: l.price - tax });
  notify(req, l.sellerId, 'cards:market', { id: l.id, sold: true, name, coins: l.price - tax });
  S.afterActivity(userId, [['CARDS_TRADE', 1]], req.app.get('io'));
  S.afterActivity(l.sellerId, [['CARDS_TRADE', 1]], req.app.get('io'));
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { coins: true, gems: true } });
  res.json({ ok: true, wallet: me });
});

// ================= Replay / assistir =================
// PvP e torneios são públicos (só o campo; a mão nunca aparece). Partidas
// contra bot: só amigos e a staff.
async function canWatch(req, m) {
  if (C.seatOf(m, req.user.id) >= 0 || isAdmin(req.user)) return true;
  if (m.mode === 'PVP' || m.tournamentId) return true;
  const friends = await friendIds(req.user.id);
  return [m.p1Id, m.p2Id, m.p3Id, m.p4Id].some((x) => x && friends.has(x));
}

const replay = handle(async (req, res) => {
  const m = await prisma.cardMatch.findUnique({ where: { id: req.params.id } });
  if (!m || !(await canWatch(req, m))) throw new CardError('Partida não encontrada.', 404);
  if (!m.initialState) throw new CardError('Essa partida não tem replay (é anterior ao recurso).');
  if (m.status === 'ACTIVE' && C.seatOf(m, req.user.id) < 0 && !isAdmin(req.user)) throw new CardError('Assista ao vivo enquanto a partida acontece.');
  const seat = C.seatOf(m, req.user.id);
  const see = (st) => (seat >= 0 ? viewFor(st, seat, req.user.id) : spectatorView(st));
  let state = JSON.parse(m.initialState);
  const frames = [{ view: see(state), events: [], actor: null }];
  for (const { s, a } of safeJson(m.actions || '[]', []).slice(0, 400)) {
    try {
      const r = reduce(state, s, a);
      state = r.state;
      frames.push({ view: see(state), events: seat >= 0 ? eventsFor(r.events, seat) : eventsFor(r.events, -1), actor: s, action: a.type });
    } catch { break; }
  }
  res.json({ id: m.id, mode: m.mode, boardId: m.boardId || null, frames });
});

// Ao vivo: devolve a visão do lado escolhido (?lado=0|1) e, se o cliente
// mandar quantas ações já viu (?n=), os eventos novos pra animar a jogada.
const watch = handle(async (req, res) => {
  const m = await prisma.cardMatch.findUnique({ where: { id: req.params.id } });
  if (!m || !(await canWatch(req, m))) throw new CardError('Partida não encontrada.', 404);
  const seat = req.query.lado === '1' ? 1 : 0;
  const state = m.state ? JSON.parse(m.state) : null;
  if (m.status === 'ACTIVE' && C.seatOf(m, req.user.id) < 0) SP.touch(m.id, req.user);
  const log = safeJson(m.actions || '[]', []);
  const total = log.length;
  const since = req.query.n !== undefined ? int(req.query.n, 0, 100000, total) : total;
  let events = [];
  if (m.initialState && since < total && total - since <= 80) {
    try {
      let st = JSON.parse(m.initialState);
      for (let i = 0; i < total; i += 1) {
        const r = reduce(st, log[i].s, log[i].a);
        st = r.state;
        if (i >= since) events.push(...eventsFor(r.events, -1));
      }
    } catch { events = []; }
  }
  res.json({
    id: m.id, mode: m.mode, status: m.status, version: m.version, turnDeadline: m.turnDeadline, boardId: m.boardId || null,
    tournamentId: m.tournamentId || null, n: total, events: events.slice(-150), side: seat,
    spectators: SP.count(m.id), watchers: SP.list(m.id), view: state ? spectatorView(state, seat) : null,
  });
});

const stopWatching = handle(async (req, res) => {
  SP.leave(req.params.id, req.user.id);
  res.json({ ok: true });
});

// Partidas ao vivo: de amigos, de torneios e PvP públicas (as mais assistidas primeiro).
const live = handle(async (req, res) => {
  const friends = await friendIds(req.user.id);
  const ids = [...friends];
  const select = { id: true, mode: true, difficulty: true, p1Id: true, p2Id: true, p3Id: true, p4Id: true, format: true, custom: true, updatedAt: true, createdAt: true, tournamentId: true, boardId: true, state: true };
  // Só partidas com movimento recente: quem largou o jogo não aparece "ao vivo".
  const fresh = new Date(Date.now() - 4 * 60_000);
  const me = req.user.id;
  const [mine, pub] = await Promise.all([
    ids.length ? prisma.cardMatch.findMany({ where: { status: 'ACTIVE', updatedAt: { gte: fresh }, OR: [{ p1Id: { in: ids } }, { p2Id: { in: ids } }, { p3Id: { in: ids } }, { p4Id: { in: ids } }] }, orderBy: { updatedAt: 'desc' }, take: 20, select }) : [],
    prisma.cardMatch.findMany({ where: { status: 'ACTIVE', mode: 'PVP', updatedAt: { gte: fresh } }, orderBy: { updatedAt: 'desc' }, take: 30, select }),
  ]);
  const seen = new Set();
  const rows = [...mine, ...pub].filter((r) => !seen.has(r.id) && seen.add(r.id) && ![r.p1Id, r.p2Id, r.p3Id, r.p4Id].includes(me));
  const uids = [...new Set(rows.flatMap((r) => [r.p1Id, r.p2Id, r.p3Id, r.p4Id]).filter(Boolean))];
  const users = uids.length ? await prisma.user.findMany({ where: { id: { in: uids } }, select: PUBLIC_USER_FIELDS }) : [];
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  const brief = (raw) => {
    const st = safeJson(raw || 'null', null);
    if (!st?.players) return null;
    return { turn: st.turn, hp: st.players.map((p) => p.hp), board: st.players.map((p) => p.board?.length || 0) };
  };
  const bot = (r) => ({ displayName: C.BOT_NAMES[r.difficulty] || 'Bot', bot: true });
  const matches = rows.map(({ state, ...r }) => ({
    ...r, friend: [r.p1Id, r.p2Id, r.p3Id, r.p4Id].some((x) => x && friends.has(x)), spectators: SP.count(r.id), info: brief(state),
    p1: byId[r.p1Id], p2: r.p2Id ? byId[r.p2Id] : bot(r),
    p3: r.format === '2V2' ? (r.p3Id ? byId[r.p3Id] : { displayName: 'Bot', bot: true }) : undefined,
    p4: r.format === '2V2' ? (r.p4Id ? byId[r.p4Id] : { displayName: 'Bot', bot: true }) : undefined,
  })).sort((a, b) => (b.spectators - a.spectators) || (Number(b.friend) - Number(a.friend)) || (new Date(b.updatedAt) - new Date(a.updatedAt)));
  res.json({ matches: matches.slice(0, 24) });
});

// ================= Torneios (jogadores) =================
const tournaments = handle(async (req, res) => {
  res.json({ tournaments: await T.list(req.user.id) });
});
const joinTournament = handle(async (req, res) => {
  await C.requireActivePlayer(req.user.id);
  const settings = await S.getSettings();
  await S.resolvePlayerDeck(req.user.id, settings);
  await T.join(req.params.id, req.user.id);
  res.json({ ok: true });
});
const leaveTournament = handle(async (req, res) => {
  await T.leave(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ================= Staff =================
const adminStats = handle(async (req, res) => {
  const catalog = await S.getCatalog(true);
  const days = int(req.query.days, 1, 60, 14);
  const since = new Date(Date.now() - days * 86400_000);
  const [stats, opens, matches, listings, players, foils] = await Promise.all([
    prisma.cardStat.findMany(),
    prisma.cardPackOpen.findMany({ where: { createdAt: { gte: since } }, select: { dayKey: true, paidCoins: true, paidGems: true } }),
    prisma.cardMatch.findMany({ where: { status: 'FINISHED', endedAt: { gte: since } }, select: { mode: true, endedAt: true, reward1: true, reward2: true, winnerId: true, difficulty: true } }),
    prisma.cardListing.findMany({ where: { status: 'SOLD', soldAt: { gte: since } }, select: { price: true, soldAt: true } }),
    prisma.cardPlayer.count(),
    prisma.userCard.aggregate({ _sum: { foil: true, quantity: true } }),
  ]);
  const dk = (d) => S.dayKey(new Date(d));
  const byDay = {};
  const day = (k) => (byDay[k] ||= { day: k, packs: 0, coinsSpent: 0, gemsSpent: 0, matches: 0, pvp: 0, coinsRewarded: 0, marketVolume: 0 });
  for (const o of opens) { const d = day(o.dayKey); d.packs += 1; d.coinsSpent += o.paidCoins; d.gemsSpent += o.paidGems; }
  for (const m of matches) { const d = day(dk(m.endedAt)); d.matches += 1; if (m.mode === 'PVP') d.pvp += 1; d.coinsRewarded += m.reward1 + m.reward2; }
  for (const l of listings) { const d = day(dk(l.soldAt)); d.marketVolume += l.price; }
  const pve = matches.filter((m) => m.mode === 'PVE');
  const botWinRate = Object.fromEntries(Object.keys(DIFFICULTIES).map((k) => {
    const list = pve.filter((m) => m.difficulty === k);
    return [k, { games: list.length, playerWins: list.filter((m) => m.winnerId && m.winnerId !== 'BOT').length }];
  }));
  const cards = stats.map((s) => {
    const c = catalog.byId.get(s.cardId);
    return c ? { id: c.id, name: c.name, rarity: c.rarity, element: c.element, kind: c.kind, played: s.played, wins: s.wins, winRate: s.played ? Math.round((s.wins / s.played) * 100) : 0 } : null;
  }).filter(Boolean).sort((a, b) => b.played - a.played);
  res.json({
    days, players, totalCopies: foils._sum.quantity || 0, totalFoils: foils._sum.foil || 0,
    daily: Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)),
    botWinRate, cards,
  });
});

const exportCards = handle(async (req, res) => {
  const catalog = await S.getCatalog(true);
  const fields = ['slug', 'name', 'kind', 'rarity', 'element', 'collection', 'cost', 'attack', 'health', 'ability', 'abilityValue', 'description', 'flavor', 'imageUrl', 'enabled'];
  res.json({ fields, cards: catalog.all.map((c) => Object.fromEntries(fields.map((f) => [f, c[f] ?? (f === 'kind' ? 'UNIT' : null)]))) });
});

const importCards = handle(async (req, res) => {
  const rows = Array.isArray(req.body?.cards) ? req.body.cards.slice(0, 500) : [];
  if (!rows.length) throw new CardError('Nenhuma carta para importar.');
  const slugify = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  let created = 0; let updated = 0;
  const errors = [];
  for (const [i, r] of rows.entries()) {
    const name = String(r?.name || '').trim().slice(0, 60);
    const slug = slugify(r?.slug || name);
    if (!name || !slug) { errors.push(`Linha ${i + 1}: sem nome.`); continue; }
    const data = {
      name, kind: r.kind === 'SPELL' ? 'SPELL' : 'UNIT',
      rarity: RARITIES.includes(r.rarity) ? r.rarity : 'COMUM', element: ELEMENTS.includes(r.element) ? r.element : 'FOGO',
      collection: String(r.collection || 'Origens').slice(0, 40), cost: int(r.cost, 0, 10, 1), attack: int(r.attack, 0, 30, 1), health: int(r.health, 1, 40, 1),
      ability: ABILITIES[r.ability] ? r.ability : 'NONE', abilityValue: int(r.abilityValue, 0, 20, 0),
      description: r.description ? String(r.description).slice(0, 600) : null, flavor: r.flavor ? String(r.flavor).slice(0, 300) : null,
      imageUrl: typeof r.imageUrl === 'string' && /^https?:\/\//.test(r.imageUrl) ? r.imageUrl.slice(0, 500) : null,
      enabled: !(r.enabled === false || r.enabled === 'false' || r.enabled === 0 || r.enabled === '0'),
    };
    const ex = await prisma.cardDef.findUnique({ where: { slug } });
    if (ex) { await prisma.cardDef.update({ where: { id: ex.id }, data }); updated += 1; } else { await prisma.cardDef.create({ data: { ...data, slug } }); created += 1; }
  }
  S.invalidateCatalog();
  audit(req, 'CARDS_IMPORT', 'cards', { created, updated });
  res.json({ created, updated, errors });
});

// Campanha (staff)
const adminCampaign = handle(async (req, res) => {
  await S.ensureSeed();
  res.json({ stages: await prisma.cardCampaignStage.findMany({ orderBy: { position: 'asc' } }) });
});
function readStage(b, isNew) {
  const d = {};
  if (b.name !== undefined) d.name = String(b.name).trim().slice(0, 60);
  if (isNew && !d.name) throw new CardError('Dê um nome à fase.');
  if (b.story !== undefined) d.story = String(b.story || '').slice(0, 2000) || null;
  if (b.botName !== undefined) d.botName = String(b.botName || 'Bot').trim().slice(0, 40) || 'Bot';
  else if (isNew) d.botName = 'Bot';
  if (b.difficulty !== undefined) d.difficulty = DIFFICULTIES[b.difficulty] ? b.difficulty : 'MEDIO';
  if (b.heroHp !== undefined) d.heroHp = int(b.heroHp, 5, 100, 30);
  if (b.rewardCoins !== undefined) d.rewardCoins = int(b.rewardCoins, 0, 100000, 0);
  if (b.rewardCardId !== undefined) d.rewardCardId = b.rewardCardId ? String(b.rewardCardId) : null;
  if (b.deckCardIds !== undefined) d.deckCardIds = JSON.stringify(Array.isArray(b.deckCardIds) ? b.deckCardIds.filter((x) => typeof x === 'string').slice(0, 40) : []);
  if (b.position !== undefined) d.position = int(b.position, 0, 999, 0);
  if (b.enabled !== undefined) d.enabled = !!b.enabled;
  if (b.boardId !== undefined) d.boardId = b.boardId ? String(b.boardId).slice(0, 64) : null;
  return d;
}
const createStage = handle(async (req, res) => {
  const n = await prisma.cardCampaignStage.count();
  const st = await prisma.cardCampaignStage.create({ data: { position: n, ...readStage(req.body || {}, true) } });
  audit(req, 'CARDS_CAMPAIGN_CREATE', st.id, { name: st.name });
  res.json({ stage: st });
});
const updateStage = handle(async (req, res) => {
  const st = await prisma.cardCampaignStage.update({ where: { id: req.params.id }, data: readStage(req.body || {}, false) }).catch((e) => { if (e.code === 'P2025') throw new CardError('Fase não encontrada.', 404); throw e; });
  audit(req, 'CARDS_CAMPAIGN_UPDATE', st.id, { name: st.name });
  res.json({ stage: st });
});
const deleteStage = handle(async (req, res) => {
  await prisma.cardCampaignStage.deleteMany({ where: { id: req.params.id } });
  audit(req, 'CARDS_CAMPAIGN_DELETE', req.params.id);
  res.json({ ok: true });
});

// Torneios (staff)
const adminTournaments = handle(async (req, res) => res.json({ tournaments: await T.list(req.user.id, { admin: true }) }));
const createTournament = handle(async (req, res) => {
  const t = await T.create(req.body || {}, req.user.id);
  audit(req, 'CARDS_TOURNAMENT_CREATE', t.id, { name: t.name });
  req.app.get('io')?.to('community').emit('cards:tournament', { id: t.id });
  res.json({ tournament: t });
});
const updateTournament = handle(async (req, res) => {
  const t = await T.update(req.params.id, req.body || {});
  audit(req, 'CARDS_TOURNAMENT_UPDATE', t.id, { name: t.name });
  res.json({ tournament: t });
});
const startTournament = handle(async (req, res) => {
  const t = await T.start(req.params.id, req.app.get('io'));
  audit(req, 'CARDS_TOURNAMENT_START', t.id, { name: t.name });
  res.json({ tournament: t });
});
const cancelTournament = handle(async (req, res) => {
  await T.cancel(req.params.id);
  audit(req, 'CARDS_TOURNAMENT_CANCEL', req.params.id);
  res.json({ ok: true });
});

// ================= Varredura periódica =================
// Prazos de turno PvP estourados são resolvidos mesmo se ninguém abrir a
// partida (importante em torneios e partida rápida). Roda a cada 20s.
let sweeperIo = null;
let sweeper = null;
function startSweeper(io) {
  if (io) sweeperIo = io;
  if (sweeper) return;
  sweeper = setInterval(async () => {
    try {
      cleanQueue();
      const late = await prisma.cardMatch.findMany({ where: { mode: 'PVP', status: 'ACTIVE', turnDeadline: { lt: new Date(Date.now() - 3000) } }, take: 20 });
      const fakeReq = { app: { get: () => sweeperIo } };
      for (const m of late) await C.applyTimeoutIfNeeded(fakeReq, m).catch(() => {});
      // Partida contra bot largada (sem jogada há 15 min) é encerrada sem recompensa —
      // assim ela não fica aparecendo "ao vivo" com o jogador já offline.
      await prisma.cardMatch.updateMany({ where: { mode: 'PVE', status: 'ACTIVE', updatedAt: { lt: new Date(Date.now() - 15 * 60_000) } }, data: { status: 'CANCELLED', endReason: 'abandoned', endedAt: new Date() } });
      // PvP sem prazo (dados antigos) e parado há 30 min também sai.
      await prisma.cardMatch.updateMany({ where: { mode: 'PVP', status: 'ACTIVE', turnDeadline: null, updatedAt: { lt: new Date(Date.now() - 30 * 60_000) } }, data: { status: 'CANCELLED', endReason: 'abandoned', endedAt: new Date() } });
      // Salas vencidas.
      await prisma.cardLobby.updateMany({ where: { status: 'OPEN', expiresAt: { lt: new Date() } }, data: { status: 'CANCELLED' } });
      // Desafios vencidos somem.
      await prisma.cardMatch.updateMany({ where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - 5 * 60_000) } }, data: { status: 'CANCELLED', endReason: 'expired' } });
    } catch { /* ignora */ }
  }, 20_000);
  sweeper.unref?.();
}

module.exports = {
  campaign, startCampaign, joinQueue, leaveQueue, market, createListing, cancelListing, buyListing,
  replay, watch, stopWatching, live, tournaments, joinTournament, leaveTournament,
  adminStats, exportCards, importCards, adminCampaign, createStage, updateStage, deleteStage,
  adminTournaments, createTournament, updateTournament, startTournament, cancelTournament, startSweeper,
  _queue: queue,
};
