// Jogo de Cartas — etapa 4: Draft (Arena), chefão semanal da comunidade e
// liga de clãs. Todas as regras, sorteios e prêmios ficam no servidor.
const prisma = require('../config/prisma');
const S = require('./service');
const { RARITIES, ELEMENTS } = require('./config');

const { CardError } = S;
const ledger = () => require('../services/economyLedger');
const safe = (raw, fb) => { try { const v = JSON.parse(raw); return v ?? fb; } catch { return fb; } };

// ===================================================================
// Draft
// ===================================================================
const DRAFT_MAX_WINS = 7;
const DRAFT_MAX_LOSSES = 3;
// Chance (em pesos) de cada raridade aparecer numa escolha.
const DRAFT_WEIGHTS = { COMUM: 500, INCOMUM: 280, RARA: 140, EPICA: 60, LENDARIA: 16, MITICA: 4 };

const draftSize = (settings) => Math.max(10, Math.min(30, settings.rules.deckSize | 0 || 20));

function rollDraftOptions(catalog, settings, picks) {
  const pool = catalog.fresh || catalog.enabled;
  if (!pool.length) throw new CardError('Nenhuma carta disponível.');
  const count = new Map();
  for (const id of picks) count.set(id, (count.get(id) || 0) + 1);
  const capOf = (c) => (S.rankOf(c.rarity) >= S.rankOf('LENDARIA') ? settings.rules.maxCopiesLegendary : settings.rules.maxCopies);
  const okCard = (c) => (count.get(c.id) || 0) < capOf(c);
  // Sorteia uma raridade (as três opções saem da mesma raridade, como na Arena).
  const total = RARITIES.reduce((n, r) => n + (DRAFT_WEIGHTS[r] || 0), 0);
  let roll = S.randInt(total);
  let rarity = 'COMUM';
  for (const r of RARITIES) { roll -= DRAFT_WEIGHTS[r] || 0; if (roll < 0) { rarity = r; break; } }
  let cands = pool.filter((c) => c.rarity === rarity && okCard(c));
  if (cands.length < 3) cands = pool.filter(okCard);
  if (!cands.length) cands = pool;
  const out = [];
  const used = new Set();
  for (let guard = 0; out.length < 3 && guard < 200; guard += 1) {
    const c = cands[S.randInt(cands.length)];
    if (used.has(c.id) && used.size < cands.length) continue;
    used.add(c.id);
    out.push(c.id);
  }
  return out;
}

async function activeDraft(userId) {
  return prisma.cardDraft.findFirst({ where: { userId, status: { in: ['PICKING', 'PLAYING'] } }, orderBy: { createdAt: 'desc' } });
}

async function shapeDraft(d, settings) {
  if (!d) return null;
  const catalog = await S.getCatalog();
  const card = (id) => (catalog.byId.get(id) ? S.shapeCard(catalog.byId.get(id)) : null);
  const picks = safe(d.picks, []);
  const rewards = settings.extras.draftRewards || [];
  return {
    id: d.id, status: d.status, wins: d.wins, losses: d.losses, fee: d.fee, reward: d.reward,
    size: draftSize(settings), maxWins: DRAFT_MAX_WINS, maxLosses: DRAFT_MAX_LOSSES,
    picks: picks.map(card).filter(Boolean),
    options: d.status === 'PICKING' ? safe(d.options, []).map(card).filter(Boolean) : [],
    nextReward: rewards[Math.min(d.wins, rewards.length - 1)] | 0,
    finishedAt: d.finishedAt,
  };
}

async function draftView(userId) {
  const settings = await S.getSettings();
  const [d, p, last] = await Promise.all([
    activeDraft(userId),
    S.getPlayer(userId),
    prisma.cardDraft.findFirst({ where: { userId, status: 'DONE' }, orderBy: { finishedAt: 'desc' } }),
  ]);
  return {
    draft: await shapeDraft(d, settings),
    last: d ? null : await shapeDraft(last, settings),
    fee: settings.extras.draftFee | 0, rewards: settings.extras.draftRewards || [],
    best: p.draftBest, runs: p.draftRuns,
  };
}

async function startDraft(userId) {
  const settings = await S.getSettings();
  if (!settings.enabled.pve) throw new CardError('Partidas contra bots estão desativadas.');
  if (await activeDraft(userId)) throw new CardError('Você já tem uma corrida de Draft em andamento.');
  const fee = Math.max(0, settings.extras.draftFee | 0);
  if (fee > 0) {
    const paid = await prisma.user.updateMany({ where: { id: userId, coins: { gte: fee } }, data: { coins: { decrement: fee } } });
    if (!paid.count) throw new CardError(`Você precisa de ${fee} moedas para entrar no Draft.`);
    ledger().recordTransaction(userId, { kind: 'CARDS', label: 'Jogo de Cartas: entrada no Draft', coins: -fee });
  }
  const catalog = await S.getCatalog();
  const d = await prisma.cardDraft.create({ data: { userId, picks: '[]', options: JSON.stringify(rollDraftOptions(catalog, settings, [])), fee } });
  await prisma.cardPlayer.update({ where: { userId }, data: { draftRuns: { increment: 1 } } }).catch(() => {});
  return { draft: await shapeDraft(d, settings) };
}

async function pickDraft(userId, index) {
  const settings = await S.getSettings();
  const d = await activeDraft(userId);
  if (!d || d.status !== 'PICKING') throw new CardError('Nenhuma escolha pendente.');
  const options = safe(d.options, []);
  const i = parseInt(index, 10);
  if (!(i >= 0 && i < options.length)) throw new CardError('Escolha inválida.');
  const picks = safe(d.picks, []);
  picks.push(options[i]);
  const catalog = await S.getCatalog();
  const full = picks.length >= draftSize(settings);
  const r = await prisma.cardDraft.updateMany({
    where: { id: d.id, status: 'PICKING', picks: d.picks },
    data: { picks: JSON.stringify(picks), status: full ? 'PLAYING' : 'PICKING', options: full ? null : JSON.stringify(rollDraftOptions(catalog, settings, picks)) },
  });
  if (!r.count) throw new CardError('Essa escolha já foi feita. Atualize a página.', 409);
  return { draft: await shapeDraft(await prisma.cardDraft.findUnique({ where: { id: d.id } }), settings) };
}

async function finishDraft(d, settings) {
  const rewards = settings.extras.draftRewards || [];
  const reward = Math.max(0, rewards[Math.min(d.wins, rewards.length - 1)] | 0);
  const r = await prisma.cardDraft.updateMany({ where: { id: d.id, status: { in: ['PICKING', 'PLAYING'] } }, data: { status: 'DONE', reward, finishedAt: new Date(), matchId: null } });
  if (!r.count) return null;
  if (reward > 0) {
    await prisma.user.update({ where: { id: d.userId }, data: { coins: { increment: reward } } });
    ledger().recordTransaction(d.userId, { kind: 'CARDS', label: `Jogo de Cartas: Draft (${d.wins} vitórias)`, coins: reward });
  }
  const p = await prisma.cardPlayer.findUnique({ where: { userId: d.userId } });
  if (p && d.wins > p.draftBest) await prisma.cardPlayer.update({ where: { userId: d.userId }, data: { draftBest: d.wins } });
  S.afterActivity(d.userId, []);
  return { reward, wins: d.wins, losses: d.losses };
}

async function retireDraft(userId) {
  const settings = await S.getSettings();
  const d = await activeDraft(userId);
  if (!d) throw new CardError('Nenhuma corrida de Draft ativa.');
  if (d.status === 'PICKING') throw new CardError('Termine de montar o baralho antes de encerrar.');
  // Uma partida largada no meio conta como derrota.
  const fresh = d.matchId ? { ...d, losses: d.losses + 1 } : d;
  if (d.matchId) {
    await prisma.cardMatch.updateMany({ where: { id: d.matchId, status: 'ACTIVE' }, data: { status: 'CANCELLED', endReason: 'abandoned', endedAt: new Date() } });
    await prisma.cardDraft.updateMany({ where: { id: d.id }, data: { losses: { increment: 1 }, matchId: null } });
  }
  return { result: await finishDraft(fresh, settings), ...(await draftView(userId)) };
}

const DRAFT_DIFF = (wins) => (wins < 2 ? 'MEDIO' : wins < 5 ? 'DIFICIL' : 'LENDARIO');

async function playDraft(userId) {
  const settings = await S.getSettings();
  let d = await activeDraft(userId);
  if (!d || d.status !== 'PLAYING') throw new CardError('Monte o baralho do Draft primeiro.');
  // Partida anterior largada (sem resultado) conta como derrota.
  if (d.matchId) {
    const old = await prisma.cardMatch.findUnique({ where: { id: d.matchId } });
    if (!old || old.status !== 'FINISHED') {
      await prisma.cardMatch.updateMany({ where: { id: d.matchId, status: 'ACTIVE' }, data: { status: 'CANCELLED', endReason: 'abandoned', endedAt: new Date() } });
      await prisma.cardDraft.updateMany({ where: { id: d.id, matchId: d.matchId }, data: { losses: { increment: 1 }, matchId: null } });
      d = await prisma.cardDraft.findUnique({ where: { id: d.id } });
      if (d.losses >= DRAFT_MAX_LOSSES) { await finishDraft(d, settings); throw new CardError('A partida anterior foi abandonada e contou como derrota. Sua corrida acabou.'); }
    }
  }
  const catalog = await S.getCatalog();
  const deck = safe(d.picks, []).map((id) => catalog.byId.get(id)).filter(Boolean).map((card) => ({ card, level: 2 }));
  if (!deck.length) throw new CardError('Baralho do Draft vazio.');
  const diff = DRAFT_DIFF(d.wins);
  const botLevel = d.wins < 2 ? 2 : d.wins < 5 ? 2 : 3;
  const botDeck = S.randomDeck(catalog, settings, botLevel).slice(0, deck.length);
  const C = require('../controllers/cardsController');
  const out = await C.newPveMatch(userId, {
    difficulty: diff, botName: `Desafiante ${d.wins + d.losses + 1}`, botDeck, botHp: settings.rules.startHp,
    kind: 'DRAFT', rulesExtra: { draft: d.id }, playerDeck: deck,
  });
  await prisma.cardDraft.update({ where: { id: d.id }, data: { matchId: out.id || null } });
  return out;
}

// Chamado quando uma partida do Draft termina.
async function onDraftMatch(match, state, settings) {
  const draftId = state.rules?.draft;
  if (!draftId) return null;
  const won = state.winner === 0;
  const r = await prisma.cardDraft.updateMany({
    where: { id: draftId, userId: match.p1Id, status: 'PLAYING', matchId: match.id },
    data: { matchId: null, ...(won ? { wins: { increment: 1 } } : { losses: { increment: 1 } }) },
  });
  if (!r.count) return null;
  const d = await prisma.cardDraft.findUnique({ where: { id: draftId } });
  const over = d.wins >= DRAFT_MAX_WINS || d.losses >= DRAFT_MAX_LOSSES;
  const done = over ? await finishDraft(d, settings) : null;
  return { wins: d.wins, losses: d.losses, over, reward: done?.reward || 0 };
}

// ===================================================================
// Chefão semanal
// ===================================================================
const BOSS_HERO_HP = 60;
const BOSS_TRIES_PER_DAY = 3;
const BOSS_WIN_BONUS = 15;
const BOSSES = {
  FOGO: 'Ignarok, o Devorador',
  AGUA: 'Kraken das Marés',
  TERRA: 'Golem Ancestral',
  AR: 'Tempestade Viva',
  LUZ: 'Serafim Caído',
  SOMBRA: 'Rainha do Abismo',
};

function weekBounds(d = new Date()) {
  const b = S.currentBrawl(d);
  const end = new Date(b.endsAt);
  return { key: b.week, start: new Date(end.getTime() - 7 * 86400000), end };
}

async function currentBoss(settings) {
  const { key } = weekBounds();
  let boss = await prisma.cardBoss.findUnique({ where: { weekKey: key } });
  if (boss) return boss;
  const n = parseInt(key.slice(0, 4), 10) * 53 + parseInt(key.slice(6), 10);
  const element = ELEMENTS[n % ELEMENTS.length];
  try {
    boss = await prisma.cardBoss.create({ data: { weekKey: key, name: BOSSES[element], element, hp: Math.max(100, settings.extras.bossHp | 0) } });
  } catch (e) {
    if (e.code !== 'P2002') throw e;
    boss = await prisma.cardBoss.findUnique({ where: { weekKey: key } });
  }
  return boss;
}

async function shapeBoss(boss, userId, settings) {
  const [hit, top] = await Promise.all([
    prisma.cardBossHit.findUnique({ where: { bossId_userId: { bossId: boss.id, userId } } }),
    prisma.cardBossHit.findMany({ where: { bossId: boss.id, damage: { gt: 0 } }, orderBy: { damage: 'desc' }, take: 10 }),
  ]);
  const users = top.length ? await prisma.user.findMany({ where: { id: { in: top.map((t) => t.userId) } }, select: { id: true, displayName: true, username: true, avatarUrl: true } }) : [];
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  const today = S.dayKey();
  const triesToday = hit && hit.day === today ? hit.dayTries : 0;
  const participants = await prisma.cardBossHit.count({ where: { bossId: boss.id, damage: { gt: 0 } } });
  return {
    id: boss.id, week: boss.weekKey, name: boss.name, element: boss.element, hp: boss.hp,
    damage: Math.min(boss.hp, boss.damage), defeated: !!boss.defeatedAt, defeatedAt: boss.defeatedAt,
    heroHp: BOSS_HERO_HP, participants, endsAt: weekBounds().end,
    me: { damage: hit?.damage || 0, attempts: hit?.attempts || 0, triesLeft: Math.max(0, BOSS_TRIES_PER_DAY - triesToday), claimed: !!hit?.claimed },
    canClaim: !!boss.defeatedAt && (hit?.damage || 0) > 0 && !hit?.claimed,
    reward: { coins: settings.extras.bossCoins | 0, gems: settings.extras.bossGems | 0 },
    top: top.filter((t) => byId[t.userId]).map((t, i) => ({ rank: i + 1, user: byId[t.userId], damage: t.damage })),
  };
}

async function bossView(userId) {
  const settings = await S.getSettings();
  const boss = await currentBoss(settings);
  // O chefe da semana passada, se o usuário ainda tem prêmio para pegar.
  const prev = await prisma.cardBoss.findFirst({ where: { id: { not: boss.id }, defeatedAt: { not: null } }, orderBy: { createdAt: 'desc' } });
  let previous = null;
  if (prev) {
    const h = await prisma.cardBossHit.findUnique({ where: { bossId_userId: { bossId: prev.id, userId } } });
    if (h && h.damage > 0 && !h.claimed) previous = await shapeBoss(prev, userId, settings);
  }
  return { boss: await shapeBoss(boss, userId, settings), previous };
}

async function startBoss(userId) {
  const settings = await S.getSettings();
  if (!settings.enabled.pve) throw new CardError('Partidas contra bots estão desativadas.');
  const boss = await currentBoss(settings);
  if (boss.defeatedAt) throw new CardError('O chefão desta semana já foi derrotado! Resgate seu prêmio.');
  const today = S.dayKey();
  await prisma.cardBossHit.upsert({ where: { bossId_userId: { bossId: boss.id, userId } }, update: {}, create: { bossId: boss.id, userId } });
  let ok = await prisma.cardBossHit.updateMany({ where: { bossId: boss.id, userId, day: today, dayTries: { lt: BOSS_TRIES_PER_DAY } }, data: { dayTries: { increment: 1 } } });
  if (!ok.count) ok = await prisma.cardBossHit.updateMany({ where: { bossId: boss.id, userId, OR: [{ day: null }, { day: { not: today } }] }, data: { day: today, dayTries: 1 } });
  if (!ok.count) throw new CardError(`Você já usou suas ${BOSS_TRIES_PER_DAY} tentativas de hoje. Volte amanhã!`);
  const catalog = await S.getCatalog();
  const themed = catalog.fresh.filter((c) => c.element === boss.element);
  const pool = themed.length >= 8 ? { enabled: themed } : catalog;
  const botDeck = S.randomDeck(pool, settings, 3);
  const C = require('../controllers/cardsController');
  return C.newPveMatch(userId, {
    difficulty: 'DIFICIL', botName: boss.name, botDeck, botHp: BOSS_HERO_HP,
    kind: 'BOSS', rulesExtra: { boss: boss.id },
  });
}

async function onBossMatch(match, state) {
  const bossId = state.rules?.boss;
  if (!bossId) return null;
  const foe = state.players?.[1];
  if (!foe) return null;
  const dealt = Math.max(0, Math.min(foe.maxHp, foe.maxHp - Math.max(0, foe.hp)));
  const won = state.winner === 0;
  const damage = dealt + (won ? BOSS_WIN_BONUS : 0);
  const uid = match.p1Id;
  await prisma.cardBossHit.updateMany({ where: { bossId, userId: uid }, data: { damage: { increment: damage }, attempts: { increment: 1 } } });
  if (damage > 0) {
    await prisma.cardBoss.update({ where: { id: bossId }, data: { damage: { increment: damage } } });
    await prisma.cardPlayer.update({ where: { userId: uid }, data: { bossDamage: { increment: damage } } }).catch(() => {});
  }
  const boss = await prisma.cardBoss.findUnique({ where: { id: bossId } });
  let defeated = !!boss.defeatedAt;
  if (!defeated && boss.damage >= boss.hp) {
    await prisma.cardBoss.updateMany({ where: { id: bossId, defeatedAt: null }, data: { defeatedAt: new Date() } });
    defeated = true;
  }
  S.afterActivity(uid, []);
  return { damage, total: Math.min(boss.hp, boss.damage), hp: boss.hp, defeated, name: boss.name };
}

async function claimBoss(userId, bossId) {
  const settings = await S.getSettings();
  const boss = await prisma.cardBoss.findUnique({ where: { id: String(bossId || '') } });
  if (!boss || !boss.defeatedAt) throw new CardError('Esse chefão ainda não foi derrotado.');
  const r = await prisma.cardBossHit.updateMany({ where: { bossId: boss.id, userId, damage: { gt: 0 }, claimed: false }, data: { claimed: true } });
  if (!r.count) throw new CardError('Nada para resgatar.');
  const coins = settings.extras.bossCoins | 0;
  const gems = settings.extras.bossGems | 0;
  await prisma.user.update({ where: { id: userId }, data: { coins: { increment: coins }, gems: { increment: gems } } });
  ledger().recordTransaction(userId, { kind: 'CARDS', label: `Jogo de Cartas: chefão ${boss.name}`, coins, gems });
  return { reward: { coins, gems }, ...(await bossView(userId)) };
}

// ===================================================================
// Liga de clãs (semanal)
// ===================================================================
const PTS = { PVP: 3, PVE: 1, DUO: 2 };
let leagueCache = { key: null, at: 0, data: null };

async function standings(start, end) {
  const rows = await prisma.cardMatch.findMany({
    where: { status: 'FINISHED', custom: false, endedAt: { gte: start, lt: end }, winnerId: { not: null } },
    select: { winnerId: true, mode: true, kind: true, format: true, p1Id: true, p2Id: true, p3Id: true, p4Id: true },
    take: 20000,
  });
  const userPts = new Map();
  const add = (uid, n) => { if (uid && uid !== 'BOT') userPts.set(uid, (userPts.get(uid) || 0) + n); };
  for (const m of rows) {
    if (m.kind === 'TUTORIAL') continue;
    if (m.format === '2V2') {
      // winnerId guarda o capitão do time vencedor; o parceiro também pontua.
      const teamA = [m.p1Id, m.p3Id];
      const teamB = [m.p2Id, m.p4Id];
      const team = teamA.includes(m.winnerId) ? teamA : teamB.includes(m.winnerId) ? teamB : [m.winnerId];
      for (const u of team) add(u, PTS.DUO);
    } else add(m.winnerId, m.mode === 'PVP' ? PTS.PVP : PTS.PVE);
  }
  if (!userPts.size) return [];
  const users = await prisma.user.findMany({ where: { id: { in: [...userPts.keys()] }, clanId: { not: null } }, select: { id: true, clanId: true } });
  const clanPts = new Map();
  const clanMembers = new Map();
  for (const u of users) {
    clanPts.set(u.clanId, (clanPts.get(u.clanId) || 0) + userPts.get(u.id));
    if (!clanMembers.has(u.clanId)) clanMembers.set(u.clanId, []);
    clanMembers.get(u.clanId).push(u.id);
  }
  if (!clanPts.size) return [];
  const clans = await prisma.clan.findMany({ where: { id: { in: [...clanPts.keys()] } }, select: { id: true, name: true, iconColor: true, icon: { select: { url: true } } } });
  return clans
    .map((c) => ({ clanId: c.id, name: c.name, iconColor: c.iconColor, iconUrl: c.icon?.url || null, points: clanPts.get(c.id) || 0, players: clanMembers.get(c.id) || [] }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

// Paga a semana anterior (uma vez só, protegido pela chave única da semana).
async function settlePreviousWeek(settings) {
  const now = weekBounds();
  const prevKey = weekBounds(new Date(now.start.getTime() - 3600_000)).key;
  if (await prisma.cardClanWeek.findUnique({ where: { weekKey: prevKey } })) return;
  const table = await standings(new Date(now.start.getTime() - 7 * 86400000), now.start);
  const prizes = settings.extras.clanTopCoins || [];
  const results = table.slice(0, 10).map((c, i) => ({ clanId: c.clanId, name: c.name, points: c.points, coins: Math.max(0, prizes[i] | 0), players: c.players }));
  try {
    await prisma.cardClanWeek.create({ data: { weekKey: prevKey, results: JSON.stringify(results.map(({ players, ...r }) => r)) } });
  } catch (e) { if (e.code === 'P2002') return; throw e; }
  for (const r of results) {
    if (!r.coins) continue;
    for (const uid of r.players) {
      await prisma.user.update({ where: { id: uid }, data: { coins: { increment: r.coins } } }).catch(() => {});
      ledger().recordTransaction(uid, { kind: 'CARDS', label: `Jogo de Cartas: liga de clãs (${r.name})`, coins: r.coins });
    }
  }
}

async function leagueView(userId) {
  const settings = await S.getSettings();
  await settlePreviousWeek(settings).catch((e) => console.error('[cards] liga:', e?.message));
  const wb = weekBounds();
  if (leagueCache.key !== wb.key || Date.now() - leagueCache.at > 60_000) {
    leagueCache = { key: wb.key, at: Date.now(), data: await standings(wb.start, new Date(Date.now() + 60_000)) };
  }
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { clanId: true } });
  const table = leagueCache.data;
  const prizes = settings.extras.clanTopCoins || [];
  const lastRow = await prisma.cardClanWeek.findFirst({ orderBy: { createdAt: 'desc' } });
  const myIdx = me?.clanId ? table.findIndex((c) => c.clanId === me.clanId) : -1;
  const shape = (c, i) => ({ rank: i + 1, clanId: c.clanId, name: c.name, iconColor: c.iconColor, iconUrl: c.iconUrl, points: c.points, players: c.players.length, prize: Math.max(0, prizes[i] | 0), mine: c.clanId === me?.clanId });
  return {
    week: wb.key, endsAt: wb.end, points: PTS, prizes,
    table: table.slice(0, 20).map(shape),
    myClan: me?.clanId ? (myIdx >= 0 ? shape(table[myIdx], myIdx) : { clanId: me.clanId, points: 0, rank: null, mine: true }) : null,
    last: lastRow ? { week: lastRow.weekKey, results: safe(lastRow.results, []).slice(0, 3) } : null,
  };
}

module.exports = {
  draftView, startDraft, pickDraft, playDraft, retireDraft, onDraftMatch,
  bossView, startBoss, onBossMatch, claimBoss,
  leagueView, standings, weekBounds,
  DRAFT_MAX_WINS, DRAFT_MAX_LOSSES, BOSS_HERO_HP,
};
