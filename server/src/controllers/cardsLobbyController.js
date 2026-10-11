// Jogo de Cartas — salas de batalha (convite por link / chat / DM).
// 1v1 ou 2v2, normal (vale recompensa como PvP/PvE) ou PERSONALIZADA (o dono
// escolhe vida, energia, compras, baralho…; ninguém ganha nada). Tudo é
// validado aqui: quem entra, quem é o dono, slots, baralhos e regras.
const crypto = require('crypto');
const prisma = require('../config/prisma');
const { PUBLIC_USER_FIELDS } = require('./authController');
const { DIFFICULTIES } = require('../cards/config');
const { createGame } = require('../cards/engine');
const S = require('../cards/service');
const C = require('./cardsController');

const { CardError } = S;
const { handle, notify, safeJson } = C;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode = () => Array.from({ length: 6 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
const TTL_MS = 30 * 60_000;
const int = (v, min, max, fb) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fb; };

// Limites das regras personalizadas.
const LIMITS = {
  startHp: [10, 80], startHand: [2, 7], maxHand: [5, 10], maxEnergy: [3, 15], startEnergy: [0, 9],
  drawPerTurn: [1, 3], boardSize: [3, 8], turnSeconds: [20, 240], elementBonus: [0, 3], cardLevel: [1, 5],
};
const DECK_MODES = ['OWN', 'ALL'];
function readRules(raw, base) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [k, [min, max]] of Object.entries(LIMITS)) {
    const fb = k === 'cardLevel' ? 1 : k === 'startEnergy' ? 0 : k === 'drawPerTurn' ? 1 : base[k];
    out[k] = int(src[k], min, max, fb);
  }
  out.deckMode = DECK_MODES.includes(src.deckMode) ? src.deckMode : 'OWN';
  if (out.startHand > out.maxHand) out.startHand = out.maxHand;
  if (out.startEnergy > out.maxEnergy) out.startEnergy = out.maxEnergy;
  return out;
}

const slotCount = (format) => (format === '2V2' ? 4 : 2);
const teamOf = (i) => i % 2;
async function getLobby(code) {
  const l = await prisma.cardLobby.findUnique({ where: { code: String(code || '').toUpperCase().slice(0, 12) } });
  if (!l) throw new CardError('Sala não encontrada. O link pode ter expirado.', 404);
  return l;
}
const isOpen = (l) => l.status === 'OPEN' && new Date(l.expiresAt).getTime() > Date.now();

async function shapeLobby(l, viewerId) {
  const slots = safeJson(l.slots, []);
  const uids = [...new Set([l.hostId, ...slots.map((s) => s?.userId).filter(Boolean)])];
  const users = uids.length ? await prisma.user.findMany({ where: { id: { in: uids } }, select: PUBLIC_USER_FIELDS }) : [];
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  const board = l.boardId ? (await S.getBoards().catch(() => [])).find((b) => b.id === l.boardId) : null;
  const shaped = slots.map((s, i) => ({
    index: i, team: teamOf(i),
    user: s?.userId ? byId[s.userId] || { id: s.userId, displayName: 'Jogador' } : null,
    bot: s?.bot ? { difficulty: s.bot, name: C.BOT_NAMES[s.bot] || 'Bot', label: DIFFICULTIES[s.bot]?.label } : null,
  }));
  const hasBot = slots.some((s) => s?.bot);
  return {
    code: l.code, format: l.format, custom: l.custom, rules: safeJson(l.rules || 'null', null), status: isOpen(l) ? l.status : (l.status === 'OPEN' ? 'EXPIRED' : l.status),
    matchId: l.matchId, expiresAt: l.expiresAt, host: byId[l.hostId] || null, isHost: l.hostId === viewerId,
    mySlot: slots.findIndex((s) => s?.userId === viewerId), slots: shaped, board: board ? S.shapeBoard(board) : null,
    full: slots.every((s) => s?.userId || s?.bot),
    rewards: l.custom ? 'none' : (l.format === '2V2' && hasBot) ? 'none' : 'normal',
    link: `/cartas?sala=${l.code}`,
  };
}
async function lobbyEvent(req, l, data = {}) {
  const slots = safeJson(l.slots, []);
  for (const s of slots) if (s?.userId) notify(req, s.userId, 'cards:lobby', { code: l.code, ...data });
}
async function save(l, slots, extra = {}) {
  return prisma.cardLobby.update({ where: { id: l.id }, data: { slots: JSON.stringify(slots), expiresAt: new Date(Date.now() + TTL_MS), ...extra } });
}

// ---------- Criar / ver ----------
const create = handle(async (req, res) => {
  const userId = req.user.id;
  await C.requireActivePlayer(userId);
  const settings = await S.getSettings();
  const b = req.body || {};
  const format = b.format === '2V2' ? '2V2' : '1V1';
  const custom = b.custom === true || b.custom === 'true';
  const rules = custom ? readRules(b.rules, settings.rules) : null;
  if (!custom || rules.deckMode === 'OWN') await S.resolvePlayerDeck(userId, settings); // baralho válido
  let boardId = null;
  if (b.boardId) {
    const boards = await S.getBoards().catch(() => []);
    if (boards.some((x) => x.id === b.boardId && x.active)) boardId = b.boardId;
  }
  // Uma sala aberta por vez: a anterior do mesmo dono é fechada.
  await prisma.cardLobby.updateMany({ where: { hostId: userId, status: 'OPEN' }, data: { status: 'CANCELLED' } });
  const slots = Array.from({ length: slotCount(format) }, () => null);
  slots[0] = { userId };
  let lobby = null;
  for (let i = 0; i < 5 && !lobby; i += 1) {
    try {
      lobby = await prisma.cardLobby.create({ data: { code: genCode(), hostId: userId, format, custom, rules: rules ? JSON.stringify(rules) : null, slots: JSON.stringify(slots), boardId, expiresAt: new Date(Date.now() + TTL_MS) } });
    } catch (e) { if (e.code !== 'P2002') throw e; }
  }
  if (!lobby) throw new CardError('Não foi possível criar a sala agora. Tente de novo.');
  res.status(201).json({ lobby: await shapeLobby(lobby, userId) });
});

const view = handle(async (req, res) => {
  const l = await getLobby(req.params.code);
  res.json({ lobby: await shapeLobby(l, req.user.id) });
});

const mine = handle(async (req, res) => {
  const rows = await prisma.cardLobby.findMany({ where: { status: 'OPEN', expiresAt: { gt: new Date() } }, orderBy: { updatedAt: 'desc' }, take: 50 });
  const list = rows.filter((l) => safeJson(l.slots, []).some((s) => s?.userId === req.user.id));
  res.json({ lobbies: await Promise.all(list.slice(0, 5).map((l) => shapeLobby(l, req.user.id))) });
});

// ---------- Entrar / trocar de lugar / sair ----------
const join = handle(async (req, res) => {
  const userId = req.user.id;
  await C.requireActivePlayer(userId);
  const l = await getLobby(req.params.code);
  if (!isOpen(l)) throw new CardError('Essa sala já começou ou foi fechada.');
  const settings = await S.getSettings();
  const rules = safeJson(l.rules || 'null', null);
  if (!l.custom || rules?.deckMode !== 'ALL') await S.resolvePlayerDeck(userId, settings);
  const slots = safeJson(l.slots, []);
  const cur = slots.findIndex((s) => s?.userId === userId);
  let want = req.body?.slot === undefined || req.body?.slot === null ? -1 : int(req.body.slot, 0, slots.length - 1, -1);
  if (want < 0) want = slots.findIndex((s) => !s);
  if (want < 0) throw new CardError('A sala está cheia.');
  if (want === cur) return res.json({ lobby: await shapeLobby(l, userId) });
  if (slots[want]?.userId || (slots[want]?.bot && l.hostId !== userId)) throw new CardError('Esse lugar já está ocupado.');
  if (want === 0 && l.hostId !== userId) throw new CardError('Esse lugar é do dono da sala.');
  if (cur === 0) throw new CardError('O dono da sala fica no primeiro lugar.');
  if (cur >= 0) slots[cur] = null;
  slots[want] = { userId };
  // Trava otimista: se outra pessoa entrou ao mesmo tempo, refaz.
  const r = await prisma.cardLobby.updateMany({ where: { id: l.id, slots: l.slots, status: 'OPEN' }, data: { slots: JSON.stringify(slots), expiresAt: new Date(Date.now() + TTL_MS) } });
  if (!r.count) throw new CardError('A sala mudou agora mesmo. Tente de novo.', 409);
  const fresh = await prisma.cardLobby.findUnique({ where: { id: l.id } });
  lobbyEvent(req, fresh, { joined: userId });
  res.json({ lobby: await shapeLobby(fresh, userId) });
});

const leave = handle(async (req, res) => {
  const userId = req.user.id;
  const l = await getLobby(req.params.code);
  if (l.status !== 'OPEN') return res.json({ ok: true });
  if (l.hostId === userId) {
    await prisma.cardLobby.updateMany({ where: { id: l.id, status: 'OPEN' }, data: { status: 'CANCELLED' } });
    lobbyEvent(req, l, { closed: true });
    return res.json({ ok: true, closed: true });
  }
  const slots = safeJson(l.slots, []).map((s) => (s?.userId === userId ? null : s));
  const fresh = await save(l, slots);
  lobbyEvent(req, fresh, { left: userId });
  res.json({ ok: true });
});

// Dono: põe/tira bot num lugar vazio ou expulsa alguém.
const setSlot = handle(async (req, res) => {
  const userId = req.user.id;
  const l = await getLobby(req.params.code);
  if (l.hostId !== userId) throw new CardError('Só o dono da sala pode mudar os lugares.', 403);
  if (!isOpen(l)) throw new CardError('Essa sala já começou ou foi fechada.');
  const slots = safeJson(l.slots, []);
  const i = int(req.body?.slot, 1, slots.length - 1, -1);
  if (i < 1) throw new CardError('Lugar inválido.');
  const bot = req.body?.bot;
  if (bot) {
    if (!DIFFICULTIES[bot]) throw new CardError('Dificuldade inválida.');
    if (slots[i]?.userId) throw new CardError('Tire o jogador desse lugar antes de pôr um bot.');
    slots[i] = { bot };
  } else {
    const kicked = slots[i]?.userId;
    slots[i] = null;
    if (kicked) notify(req, kicked, 'cards:lobby', { code: l.code, kicked: true });
  }
  const fresh = await save(l, slots);
  lobbyEvent(req, fresh, {});
  res.json({ lobby: await shapeLobby(fresh, userId) });
});

// Convidar: aviso em tempo real na tela da pessoa (o link também pode ir pela DM).
const invite = handle(async (req, res) => {
  const userId = req.user.id;
  const l = await getLobby(req.params.code);
  if (!isOpen(l)) throw new CardError('Essa sala já começou ou foi fechada.');
  const slots = safeJson(l.slots, []);
  if (!slots.some((s) => s?.userId === userId)) throw new CardError('Entre na sala para convidar alguém.', 403);
  const toId = String(req.body?.userId || '');
  if (!toId || toId === userId) throw new CardError('Escolha quem convidar.');
  const to = await prisma.user.findUnique({ where: { id: toId }, select: { id: true } });
  if (!to) throw new CardError('Usuário não encontrado.', 404);
  notify(req, toId, 'cards:invite', {
    code: l.code, format: l.format, custom: l.custom,
    from: { id: req.user.id, displayName: req.user.displayName, avatarUrl: req.user.avatarUrl },
  });
  res.json({ ok: true });
});

// ---------- Começar ----------
// Nomes diferentes quando há mais de um bot da mesma dificuldade.
const BOT_ALT = { FACIL: ['Aprendiz Pip', 'Escudeiro Tom'], MEDIO: ['Duelista Nora', 'Caçador Rui'], DIFICIL: ['Mestre Kael', 'Bruxa Lia'], LENDARIO: ['Arquimaga Vex', 'Rei Dárion'] };
async function seatPlayer(slot, ctx) {
  const { settings, rules, catalog, format } = ctx;
  if (slot.bot) {
    const bd = await S.botDeck(slot.bot, settings);
    ctx.botCount = ctx.botCount || {};
    const n = (ctx.botCount[slot.bot] = (ctx.botCount[slot.bot] || 0) + 1);
    const names = BOT_ALT[slot.bot] || ['Bot'];
    return { userId: null, name: names[(n - 1) % names.length] || C.BOT_NAMES[slot.bot] || 'Bot', isBot: true, difficulty: slot.bot, deck: rules?.deckMode === 'ALL' ? S.randomDeck(catalog, settings, rules.cardLevel) : bd.deck, botHp: bd.hp };
  }
  const info = await C.playerSeatInfo(slot.userId);
  let deck;
  if (rules?.deckMode === 'ALL') deck = S.randomDeck(catalog, settings, rules.cardLevel);
  else {
    try { deck = await S.resolvePlayerDeck(slot.userId, settings); } catch { throw new CardError(`O baralho de ${info.name} não é válido.`); }
  }
  void format;
  return { ...info, deck };
}

const start = handle(async (req, res) => {
  const userId = req.user.id;
  const l = await getLobby(req.params.code);
  if (l.hostId !== userId) throw new CardError('Só o dono da sala pode começar.', 403);
  if (!isOpen(l)) throw new CardError('Essa sala já começou ou foi fechada.');
  const settings = await S.getSettings();
  const slots = safeJson(l.slots, []);
  if (!slots.every((s) => s?.userId || s?.bot)) throw new CardError('Preencha todos os lugares (com jogadores ou bots).');
  const humans = slots.filter((s) => s?.userId).map((s) => s.userId);
  if (new Set(humans).size !== humans.length) throw new CardError('Alguém está em dois lugares.');
  for (const uid of humans) {
    const p = await S.getPlayer(uid);
    if (p.banned) throw new CardError('Um dos jogadores não pode jogar agora.');
  }
  const busy = await prisma.cardMatch.findFirst({ where: { mode: 'PVP', status: 'ACTIVE', OR: [{ p1Id: { in: humans } }, { p2Id: { in: humans } }, { p3Id: { in: humans } }, { p4Id: { in: humans } }] } });
  if (busy) throw new CardError('Alguém da sala ainda está em outra partida PvP.');
  // Trava a sala antes de criar (dois cliques não criam duas partidas).
  const lock = await prisma.cardLobby.updateMany({ where: { id: l.id, status: 'OPEN' }, data: { status: 'STARTED' } });
  if (!lock.count) throw new CardError('Essa sala já começou.');
  try {
    const custom = safeJson(l.rules || 'null', null);
    const rules = l.custom && custom ? { ...settings.rules, ...custom } : { ...settings.rules };
    const catalog = await S.getCatalog();
    const ctx = { settings, rules: l.custom ? custom : null, catalog, format: l.format };
    const seated = [];
    for (const s of slots) seated.push(await seatPlayer(s, ctx));
    const duo = l.format === '2V2';
    const vsBot1v1 = !duo && seated[1].isBot;
    if (vsBot1v1) await prisma.cardMatch.updateMany({ where: { p1Id: humans[0], mode: 'PVE', status: 'ACTIVE' }, data: { status: 'CANCELLED', endReason: 'abandoned', endedAt: new Date() } });
    // Vida: personalizada usa a regra; 2v2 normal tem herói mais forte (é compartilhado).
    const hp = (i) => (l.custom ? rules.startHp : duo ? Math.round(settings.rules.startHp * 1.4) : vsBot1v1 && i === 1 ? seated[1].botHp : settings.rules.startHp);
    const players = duo
      ? [{ ...seated[0], hp: hp(0), partner: seated[2] }, { ...seated[1], hp: hp(1), partner: seated[3] }]
      : [{ ...seated[0], hp: hp(0) }, { ...seated[1], hp: hp(1) }];
    let state = createGame({ players, rules, seed: crypto.randomInt(1, 2 ** 31), first: crypto.randomInt(2) });
    const initialState = JSON.stringify(state);
    const m0 = { difficulty: vsBot1v1 ? seated[1].difficulty : null };
    const bots = C.runBots(state, m0);
    state = bots.state;
    const ids = slots.map((s) => s.userId || null);
    const match = await prisma.cardMatch.create({
      data: {
        mode: vsBot1v1 ? 'PVE' : 'PVP', difficulty: vsBot1v1 ? seated[1].difficulty : null, format: l.format, custom: l.custom, lobbyId: l.id,
        p1Id: ids[0], p2Id: ids[1] || null, p3Id: duo ? ids[2] : null, p4Id: duo ? ids[3] : null,
        status: 'ACTIVE', state: JSON.stringify(state), initialState, actions: JSON.stringify(bots.actions), version: 1,
        boardId: await S.pickBoardId(l.boardId), turnDeadline: vsBot1v1 ? null : new Date(Date.now() + rules.turnSeconds * 1000),
      },
    });
    await prisma.cardLobby.update({ where: { id: l.id }, data: { matchId: match.id } });
    for (const uid of humans) if (uid !== userId) notify(req, uid, 'cards:match', { id: match.id, started: true });
    lobbyEvent(req, l, { started: match.id });
    res.json(C.payload(match, 0, state, { events: [], viewer: userId }));
  } catch (e) {
    await prisma.cardLobby.updateMany({ where: { id: l.id, status: 'STARTED', matchId: null }, data: { status: 'OPEN' } });
    throw e;
  }
});

module.exports = { create, view, mine, join, leave, setSlot, invite, start, readRules, LIMITS };
