// Jogo de Cartas — modos e diversão: briga da semana, tutorial, emotes e
// "jogar de novo" das salas. Regras e prêmios sempre decididos aqui.
const prisma = require('../config/prisma');
const S = require('../cards/service');
const C = require('./cardsController');
const EM = require('../cards/emotes');

const { CardError } = S;
const { handle, safeJson, notify } = C;

// ---------- Briga da semana ----------
const brawl = handle(async (req, res) => {
  const settings = await S.getSettings();
  const b = S.currentBrawl();
  const p = await S.getPlayer(req.user.id);
  res.json({
    brawl: { key: b.key, label: b.label, desc: b.desc, week: b.week, endsAt: b.endsAt },
    wonThisWeek: p.brawlWeek === b.week, wins: p.brawlWins,
    reward: { coins: settings.extras.brawlCoins, gems: settings.extras.brawlGems },
  });
});
const startBrawl = handle(async (req, res) => {
  const userId = req.user.id;
  await C.requireActivePlayer(userId);
  const settings = await S.getSettings();
  if (!settings.enabled.pve) throw new CardError('Partidas contra bots estão desativadas.');
  const b = S.currentBrawl();
  const decks = await S.brawlDecks(b, settings, userId);
  res.json(await C.newPveMatch(userId, {
    difficulty: 'MEDIO', botName: 'Mestre da Briga', botDeck: decks.bot, botHp: b.rules?.startHp || 30,
    kind: 'BRAWL', rulesExtra: { ...(b.rules || {}), brawl: b.key }, playerDeck: decks.me,
  }));
});

// ---------- Tutorial ----------
const startTutorial = handle(async (req, res) => {
  const userId = req.user.id;
  await C.requireActivePlayer(userId);
  res.json(await C.newPveMatch(userId, { difficulty: 'FACIL', botName: 'Treinador Theo', botHp: 12, kind: 'TUTORIAL', rulesExtra: { tutorial: true } }));
});

// ---------- Emotes ----------
const emote = handle(async (req, res) => {
  const key = String(req.body?.key || '');
  if (!EM.EMOTES[key]) throw new CardError('Emote inválido.');
  const m = await prisma.cardMatch.findUnique({ where: { id: req.params.id } });
  const seat = m ? C.seatOf(m, req.user.id) : -1;
  if (!m || seat < 0 || m.status !== 'ACTIVE') throw new CardError('Partida não encontrada.', 404);
  const e = EM.push(m.id, req.user.id, seat, key);
  if (!e) return res.json({ ok: false, cooldown: true });
  C.notifyOthers(req, m, req.user.id, 'cards:emote', { id: m.id, emote: e });
  res.json({ ok: true, emote: e });
});

// ---------- Jogar de novo (salas) ----------
// Recria a sala da partida com as mesmas regras e os mesmos lugares; quem pediu vira dono.
const again = handle(async (req, res) => {
  const userId = req.user.id;
  const m = await prisma.cardMatch.findUnique({ where: { id: req.params.id } });
  if (!m || C.seatOf(m, userId) < 0) throw new CardError('Partida não encontrada.', 404);
  if (!m.lobbyId) throw new CardError('Essa partida não veio de uma sala.');
  const old = await prisma.cardLobby.findUnique({ where: { id: m.lobbyId } });
  if (!old) throw new CardError('A sala original não existe mais.');
  // Já existe uma sala nova aberta pra essa partida? Reaproveita.
  const existing = await prisma.cardLobby.findFirst({ where: { status: 'OPEN', expiresAt: { gt: new Date() }, rules: old.rules, format: old.format, custom: old.custom, createdAt: { gt: m.updatedAt } } });
  if (existing && safeJson(existing.slots, []).some((s) => s?.userId === userId)) return res.json({ code: existing.code });
  let slots = safeJson(old.slots, []);
  const mine = slots.findIndex((s) => s?.userId === userId);
  if (mine > 0) { const tmp = slots[0]; slots[0] = slots[mine]; slots[mine] = tmp; }
  slots = slots.map((s) => (s?.userId || s?.bot ? s : null));
  await prisma.cardLobby.updateMany({ where: { hostId: userId, status: 'OPEN' }, data: { status: 'CANCELLED' } });
  const crypto = require('crypto');
  const CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let lobby = null;
  for (let i = 0; i < 5 && !lobby; i += 1) {
    const code = Array.from({ length: 6 }, () => CH[crypto.randomInt(CH.length)]).join('');
    try {
      lobby = await prisma.cardLobby.create({ data: { code, hostId: userId, format: old.format, custom: old.custom, rules: old.rules, slots: JSON.stringify(slots), boardId: old.boardId, expiresAt: new Date(Date.now() + 30 * 60_000) } });
    } catch (e) { if (e.code !== 'P2002') throw e; }
  }
  if (!lobby) throw new CardError('Não foi possível criar a sala agora.');
  for (const s of slots) if (s?.userId && s.userId !== userId) notify(req, s.userId, 'cards:lobby', { code: lobby.code, again: true, from: { id: userId, displayName: req.user.displayName, avatarUrl: req.user.avatarUrl } });
  res.json({ code: lobby.code });
});

module.exports = { brawl, startBrawl, startTutorial, emote, again };
