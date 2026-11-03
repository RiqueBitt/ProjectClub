// Retrospectiva mensal ("Sua retrospectiva de outubro").
//
// No dia 1º (horário de Brasília) junta os números do mês anterior de cada
// pessoa que teve atividade — mensagens, minutos em call, posts, reações, XP
// ganho (contadores USER_MONTH de activity.js) e conquistas desbloqueadas —
// grava um cartão por pessoa (MonthlyRecap) e manda um aviso.
// Idempotente: cartão já gravado não é refeito nem avisado de novo.
const { monthBounds, previousMonthBounds, dayMonthSP, monthName } = require('../../utils/spTime');
const { deps, claimJob, finishJob } = require('./common');

const RUN_UNTIL_DAY = 7;      // se o servidor ficou fora no dia 1º, ainda gera até o dia 7
const MAX_USERS_PER_RUN = 20000;
const TOP_ACHIEVEMENTS = 3;

function shape(row, extra = {}) {
  return {
    messages: row?.messages || 0, voiceMinutes: row?.voiceMinutes || 0, forumPosts: row?.forumPosts || 0,
    reactions: row?.reactions || 0, xp: row?.xp || 0, points: row?.points || 0, ...extra,
  };
}

// "Entre os X% mais ativos" (só quando é algo bonito de mostrar: até 50%).
function topPercent(rank, total) {
  if (!rank || !total) return null;
  const pct = Math.max(1, Math.ceil((rank / total) * 100));
  return pct <= 50 ? pct : null;
}

async function generateFor(monthKeyBounds, over = {}) {
  const d = deps(over);
  const { key, start, end } = monthKeyBounds;
  const rows = await d.db.activityCounter.findMany({
    where: { scope: 'USER_MONTH', periodKey: key }, orderBy: { points: 'desc' }, take: MAX_USERS_PER_RUN,
  });
  const active = rows.filter((r) => r.points > 0 || r.xp > 0);
  if (!active.length) return { created: 0, total: 0 };
  const unlocked = await d.db.userAchievement.findMany({
    where: { userId: { in: active.map((r) => r.scopeId) }, unlockedAt: { gte: start, lt: end } },
    select: { userId: true, achievementId: true },
  });
  const defs = unlocked.length ? await d.db.achievement.findMany({ where: { key: { in: [...new Set(unlocked.map((u) => u.achievementId))] } }, select: { key: true, name: true, rarity: true } }) : [];
  const defByKey = new Map(defs.map((a) => [a.key, a]));
  const achByUser = new Map();
  for (const u of unlocked) {
    const list = achByUser.get(u.userId) || [];
    const def = defByKey.get(u.achievementId);
    if (def) list.push({ key: def.key, name: def.name, rarity: def.rarity });
    achByUser.set(u.userId, list);
  }
  const rarityRank = { LEGENDARY: 0, EPIC: 1, RARE: 2, COMMON: 3 };
  let created = 0;
  const ranked = rows.filter((r) => r.points > 0);
  for (const r of active) {
    const achievements = (achByUser.get(r.scopeId) || []).sort((a, b) => (rarityRank[a.rarity] ?? 9) - (rarityRank[b.rarity] ?? 9));
    const rank = r.points > 0 ? ranked.indexOf(r) + 1 : null;
    const data = shape(r, {
      achievementsCount: achievements.length,
      achievements: achievements.slice(0, TOP_ACHIEVEMENTS),
      topPercent: topPercent(rank, ranked.length),
    });
    try {
      // eslint-disable-next-line no-await-in-loop
      await d.db.monthlyRecap.create({ data: { userId: r.scopeId, monthKey: key, data: JSON.stringify(data) } });
    } catch (err) {
      if (err?.code === 'P2002') continue; // já gerado (tarefa repetida)
      throw err;
    }
    created += 1;
    // eslint-disable-next-line no-await-in-loop
    await d.notify(d.io, r.scopeId, {
      kind: 'MONTHLY_RECAP', title: `Sua retrospectiva de ${monthName(key)} chegou!`,
      body: `${data.messages} mensagens, ${data.voiceMinutes} min em call e ${data.achievementsCount} conquista(s). Veja e compartilhe.`,
      link: `/retrospectiva/${key}`, data: { monthKey: key },
    });
  }
  return { created, total: active.length };
}

async function runIfDue(over = {}) {
  const d = deps(over);
  const { day } = dayMonthSP(d.now);
  if (day > RUN_UNTIL_DAY) return null;
  const prev = previousMonthBounds(d.now);
  const jobKey = `retrospectiva:${prev.key}`;
  if (!await claimJob(d.db, jobKey, { now: d.now, staleMs: 2 * 3600 * 1000 })) return null;
  try {
    const r = await generateFor(prev, d);
    await finishJob(d.db, jobKey, `${r.created}/${r.total}`);
    return r;
  } catch (err) {
    console.error('[retrospectiva] falhou:', err?.message || err);
    return null;
  }
}

/** Cartão de um mês (ou o mais recente) + prévia do mês atual. */
async function getRecap(userId, monthKey, over = {}) {
  const d = deps(over);
  const where = monthKey && /^\d{4}-\d{2}$/.test(monthKey) ? { userId, monthKey } : { userId };
  const row = await d.db.monthlyRecap.findFirst({ where, orderBy: { monthKey: 'desc' } });
  const cur = monthBounds(d.now);
  const live = await d.db.activityCounter.findUnique({ where: { scope_scopeId_periodKey: { scope: 'USER_MONTH', scopeId: userId, periodKey: cur.key } } });
  const months = await d.db.monthlyRecap.findMany({ where: { userId }, orderBy: { monthKey: 'desc' }, take: 12, select: { monthKey: true } });
  let data = null;
  try { data = row ? JSON.parse(row.data) : null; } catch { data = null; }
  return {
    recap: row ? { monthKey: row.monthKey, monthName: monthName(row.monthKey), createdAt: row.createdAt, ...data } : null,
    current: { monthKey: cur.key, monthName: monthName(cur.key), ...shape(live) },
    months: months.map((m) => ({ monthKey: m.monthKey, monthName: monthName(m.monthKey) })),
  };
}

module.exports = { generateFor, runIfDue, getRecap, topPercent, RUN_UNTIL_DAY };
