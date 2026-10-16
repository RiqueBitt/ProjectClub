const prisma = require('../config/prisma');

// "Resumo da semana": toda segunda de manhã (horário de Brasília), quem usou o
// Project Club nos últimos 30 dias recebe um aviso (com push) do que perdeu —
// menções, eventos da semana e itens novos na Loja. Só manda se tiver algo.
// Dá pra desligar em Configurações → Notificações (extraPrefs.weeklyDigest).

const DAY = 86400000;
const brt = (d = new Date()) => new Date(d.getTime() - 3 * 3600 * 1000);

function optedOut(raw) {
  try { return raw && JSON.parse(raw).weeklyDigest === false; } catch { return false; }
}

async function buildFor(userId, ctx) {
  const mentions = await prisma.message.count({
    where: {
      deleted: false, authorId: { not: userId }, createdAt: { gte: ctx.weekAgo },
      OR: [{ mentions: { some: { targetType: 'USER', targetId: userId } } }, { replyTo: { authorId: userId } }],
    },
  }).catch(() => 0);
  const parts = [];
  if (mentions) parts.push(`${mentions} ${mentions === 1 ? 'menção ou resposta' : 'menções e respostas'} pra você`);
  if (ctx.events.length) parts.push(ctx.events.length === 1 ? `o evento "${ctx.events[0].title}" esta semana` : `${ctx.events.length} eventos esta semana`);
  if (ctx.shopNew) parts.push(`${ctx.shopNew} ${ctx.shopNew === 1 ? 'item novo' : 'itens novos'} na Loja`);
  if (!parts.length) return null;
  const last = parts.pop();
  const body = parts.length ? `${parts.join(', ')} e ${last}.` : `${last.charAt(0).toUpperCase()}${last.slice(1)}.`;
  return {
    kind: 'DIGEST', title: 'Seu resumo da semana', body,
    link: mentions ? '/notifications' : ctx.events.length ? '/eventos' : '/loja',
    data: { mentions, events: ctx.events.length, shopNew: ctx.shopNew },
  };
}

async function runDigest(io) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const { dayKey } = require('./activeDays');
  const [events, shopNew, active] = await Promise.all([
    prisma.event.findMany({ where: { startsAt: { gte: now, lte: new Date(now.getTime() + 7 * DAY) }, status: { not: 'ENDED' } }, select: { title: true }, orderBy: { startsAt: 'asc' }, take: 5 }).catch(() => []),
    prisma.shopItem.count({ where: { active: true, createdAt: { gte: weekAgo } } }).catch(() => 0),
    prisma.userActiveDay.groupBy({ by: ['userId'], where: { day: { gte: dayKey(new Date(now.getTime() - 30 * DAY)) } } }).catch(() => []),
  ]);
  const ids = active.map((a) => a.userId);
  if (!ids.length) return 0;
  // Quem já recebeu nos últimos 6 dias não recebe de novo (vale após reiniciar).
  const already = new Set((await prisma.userNotice.findMany({ where: { userId: { in: ids }, kind: 'DIGEST', createdAt: { gte: new Date(now.getTime() - 6 * DAY) } }, select: { userId: true } })).map((r) => r.userId));
  const settings = await prisma.userSettings.findMany({ where: { userId: { in: ids } }, select: { userId: true, extraPrefs: true } }).catch(() => []);
  const out = new Set(settings.filter((s) => optedOut(s.extraPrefs)).map((s) => s.userId));
  const users = await prisma.user.findMany({ where: { id: { in: ids }, isPlatformBanned: false, accountDisabledAt: null }, select: { id: true } });
  const ctx = { weekAgo, events, shopNew };
  let sent = 0;
  for (const { id } of users) {
    if (already.has(id) || out.has(id)) continue;
    const n = await buildFor(id, ctx).catch(() => null);
    if (!n) continue;
    await require('./notices').createNotice(io, id, n);
    sent += 1;
    await new Promise((r) => setTimeout(r, 40)); // não engasga o push
  }
  console.log(`[resumo da semana] enviado para ${sent} pessoa(s).`);
  return sent;
}

function startWeeklyDigest(io) {
  let running = false;
  const tick = async () => {
    const t = brt();
    // Segunda (1), a partir das 10h de Brasília.
    if (t.getUTCDay() !== 1 || t.getUTCHours() < 10 || running) return;
    running = true;
    try { await runDigest(io); } catch (e) { console.error('[resumo da semana]', e?.message || e); } finally { running = false; }
  };
  setTimeout(tick, 2 * 60 * 1000);
  setInterval(tick, 30 * 60 * 1000).unref?.();
}

module.exports = { runDigest, startWeeklyDigest };
