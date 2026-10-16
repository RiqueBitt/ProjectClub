const prisma = require('../config/prisma');
const { recordTransaction } = require('./economyLedger');

// Temporada de missões: muda todo mês (horário de Brasília), com tema.
// Cada missão resgatada dá pontos (diária 10, semanal 40); a cada 100 pontos
// sobe um nível (até 30). Cada nível libera um prêmio na faixa grátis e, pra
// Assinantes/Super Assinantes, outro na faixa de apoio.

const DAILY_POINTS = 10;
const WEEKLY_POINTS = 40;
const LEVEL_POINTS = 100;
const MAX_LEVEL = 30;
const THEMES = [
  'Temporada de Verão ☀️', 'Temporada Carnaval 🎭', 'Temporada Outono 🍂', 'Temporada Arcade 🕹️', 'Temporada Neon 🌃', 'Temporada Junina 🌽',
  'Temporada Inverno ❄️', 'Temporada Galáxia 🌌', 'Temporada Primavera 🌸', 'Temporada Assombrada 🎃', 'Temporada Cyber ⚡', 'Temporada Festas 🎄',
];

const brt = (d = new Date()) => new Date(d.getTime() - 3 * 3600 * 1000);
function current(now = new Date()) {
  const t = brt(now);
  const y = t.getUTCFullYear(); const m = t.getUTCMonth();
  // Fim = meia-noite (Brasília) do dia 1 do próximo mês.
  const endsAt = new Date(Date.UTC(y, m + 1, 1, 3, 0, 0));
  return { key: `${y}-${String(m + 1).padStart(2, '0')}`, name: THEMES[m], endsAt };
}

// Prêmios de cada nível (iguais pra todo mundo, calculados).
function rewardsFor(level) {
  const milestone = level % 5 === 0;
  return {
    free: milestone ? { coins: 100 + level * 10, gems: level === MAX_LEVEL ? 10 : 3 } : { coins: 40 + level * 5, gems: 0 },
    plus: milestone ? { coins: 150 + level * 10, gems: level === MAX_LEVEL ? 25 : 8 } : { coins: 60 + level * 5, gems: 1 },
  };
}

const parse = (s) => { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const levelOf = (points) => Math.min(MAX_LEVEL, Math.floor(points / LEVEL_POINTS));

async function addPoints(userId, period) {
  const pts = period === 'WEEKLY' ? WEEKLY_POINTS : DAILY_POINTS;
  const { key } = current();
  await prisma.seasonPass.upsert({
    where: { userId_seasonKey: { userId, seasonKey: key } },
    update: { points: { increment: pts } },
    create: { userId, seasonKey: key, points: pts },
  });
  return pts;
}

async function getForUser(userId) {
  const s = current();
  const [row, user] = await Promise.all([
    prisma.seasonPass.findUnique({ where: { userId_seasonKey: { userId, seasonKey: s.key } } }),
    prisma.user.findUnique({ where: { id: userId }, select: { supporterTier: true } }),
  ]);
  const points = row?.points || 0;
  const level = levelOf(points);
  const cf = new Set(parse(row?.claimedFree)); const cp = new Set(parse(row?.claimedPlus));
  const isSupporter = require('./supporters').normalizeTier(user?.supporterTier) !== 'NONE';
  return {
    key: s.key, name: s.name, endsAt: s.endsAt, points, level, maxLevel: MAX_LEVEL, levelPoints: LEVEL_POINTS,
    pointsPerMission: { daily: DAILY_POINTS, weekly: WEEKLY_POINTS }, isSupporter,
    tiers: Array.from({ length: MAX_LEVEL }, (_, i) => {
      const lv = i + 1; const r = rewardsFor(lv);
      return { level: lv, unlocked: lv <= level, free: r.free, plus: r.plus, claimedFree: cf.has(lv), claimedPlus: cp.has(lv) };
    }),
  };
}

const fail = (status, message) => Object.assign(new Error(message), { status });

async function claim(userId, level, track) {
  const s = current();
  const lv = parseInt(level, 10);
  if (!Number.isInteger(lv) || lv < 1 || lv > MAX_LEVEL) throw fail(400, 'Nível inválido.');
  if (!['free', 'plus'].includes(track)) throw fail(400, 'Faixa inválida.');
  const r = rewardsFor(lv)[track];
  const result = await prisma.$transaction(async (tx) => {
    const row = await tx.seasonPass.findUnique({ where: { userId_seasonKey: { userId, seasonKey: s.key } } });
    if (!row || levelOf(row.points) < lv) throw fail(400, 'Você ainda não chegou nesse nível.');
    if (track === 'plus') {
      const u = await tx.user.findUnique({ where: { id: userId }, select: { supporterTier: true } });
      if (require('./supporters').normalizeTier(u?.supporterTier) === 'NONE') throw fail(403, 'A faixa de apoio é para Assinantes.');
    }
    const field = track === 'free' ? 'claimedFree' : 'claimedPlus';
    const list = parse(row[field]);
    if (list.includes(lv)) throw fail(400, 'Prêmio já resgatado.');
    // Trava otimista: só grava se a lista não mudou desde a leitura (sem resgate duplo).
    const upd = await tx.seasonPass.updateMany({ where: { userId, seasonKey: s.key, [field]: row[field] }, data: { [field]: JSON.stringify([...list, lv]) } });
    if (upd.count !== 1) throw fail(409, 'Tente de novo.');
    const data = {};
    if (r.coins) data.coins = { increment: r.coins };
    if (r.gems) data.gems = { increment: r.gems };
    return tx.user.update({ where: { id: userId }, data, select: { coins: true, gems: true } });
  });
  recordTransaction(userId, { kind: 'MISSION', label: `${s.name}: nível ${lv}${track === 'plus' ? ' (apoio)' : ''}`, coins: r.coins, gems: r.gems });
  return { reward: r, balance: result };
}

module.exports = { current, getForUser, claim, addPoints, rewardsFor, MAX_LEVEL };
