// Lembretes pessoais ("me lembra disso em 2h", "lembrar amanhã às 9h").
//
// Viram um aviso (UserNotice kind REMINDER → Notificações + socket + push)
// na hora marcada, com link pra mensagem/página de origem. Entrega única:
// o job reserva a linha (updateMany firedAt = null → agora) antes de
// avisar, então reinício ou duas instâncias não duplicam.
const prisma = require('../config/prisma');
const { createNotice } = require('./notices');

const TICK_MS = 30 * 1000;
const MAX_PER_TICK = 100;
const MAX_ACTIVE_PER_USER = 50;
const MAX_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;
let timer = null;

// "2h", "30m", "1d", "3 dias", "amanhã", "amanhã 9h", "hoje 18:30",
// "15/10 14:00", "2026-10-20T15:00" → Date. Retorna null se não entendeu.
// `now` e `tzOffsetMin` (minutos a somar ao UTC pra dar a hora local da
// pessoa; ex. Brasília = -180) deixam a função pura/testável.
function parseWhen(input, now = Date.now(), tzOffsetMin = -180) {
  const raw = String(input || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!raw) return null;
  // Hora local "de calendário" da pessoa.
  const local = new Date(now + tzOffsetMin * 60000); // UTC deslocado = relógio local
  const toUtc = (y, mo, d, h, mi) => new Date(Date.UTC(y, mo, d, h, mi) - tzOffsetMin * 60000);
  // ISO com fuso ("2026-10-20T15:00:00Z" / "-03:00") → absoluto; sem fuso →
  // hora local da pessoa.
  const isoTz = raw.match(/^\d{4}-\d{2}-\d{2}t.*(z|[+-]\d{2}:?\d{2})$/);
  if (isoTz) { const abs = new Date(raw); return Number.isNaN(abs.getTime()) || abs.getTime() <= now ? null : abs; }
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{1,2}):(\d{2}))?$/);
  if (iso) { const d = toUtc(+iso[1], +iso[2] - 1, +iso[3], iso[4] ? +iso[4] : 9, iso[5] ? +iso[5] : 0); return d.getTime() > now ? d : null; }
  // "18h" sozinho é HORA do relógio (hoje/amanhã), não "daqui 18 horas" —
  // pra relativo em horas use "em 2h", "daqui 2h" ou "2 horas".
  const bareClock = raw.match(/^(\d{1,2})\s*h$/);
  const prefixedRel = /^(?:em|daqui)\s/.test(raw);
  // Relativo: 10m, em 2h, 1d, 3 dias, 1 semana, "2 horas e 30 minutos"
  const rel = (bareClock && Number(bareClock[1]) <= 23 && !prefixedRel) ? null : raw.match(/^(?:em\s+|daqui\s+(?:a\s+)?)?((?:\d+\s*(?:m|min|mins|minuto|minutos|h|hr|hrs|hora|horas|d|dia|dias|sem|semana|semanas)\s*(?:e\s*)?)+)$/);
  if (rel) {
    let ms = 0;
    for (const m of rel[1].matchAll(/(\d+)\s*(m|min|mins|minuto|minutos|h|hr|hrs|hora|horas|d|dia|dias|sem|semana|semanas)/g)) {
      const n = Number(m[1]); const u = m[2][0];
      if (u === 'm') ms += n * 60000;
      else if (u === 'h') ms += n * 3600000;
      else if (u === 'd') ms += n * 86400000;
      else if (u === 's') ms += n * 7 * 86400000;
    }
    return ms > 0 ? new Date(now + ms) : null;
  }
  const timeRe = /(?:às?\s*)?(\d{1,2})(?::(\d{2}))?\s*h?(?:(\d{2}))?$/;
  const dayWord = raw.match(/^(hoje|amanh[ãa]|depois de amanh[ãa])(?:\s+(.*))?$/);
  if (dayWord) {
    const addDays = dayWord[1] === 'hoje' ? 0 : dayWord[1].startsWith('depois') ? 2 : 1;
    let h = 9; let mi = 0;
    if (dayWord[2]) { const t = dayWord[2].match(timeRe); if (!t) return null; h = Number(t[1]); mi = Number(t[2] || t[3] || 0); }
    if (h > 23 || mi > 59) return null;
    const d = toUtc(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + addDays, h, mi);
    return d.getTime() > now ? d : null;
  }
  // "15/10 14:00" ou "15/10/2026 14h"
  const dm = raw.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?(?:\s+(.*))?$/);
  if (dm) {
    let h = 9; let mi = 0;
    if (dm[4]) { const t = dm[4].match(timeRe); if (!t) return null; h = Number(t[1]); mi = Number(t[2] || t[3] || 0); }
    const y = dm[3] ? Number(dm[3]) : local.getUTCFullYear();
    const d = toUtc(y, Number(dm[2]) - 1, Number(dm[1]), h, mi);
    if (Number.isNaN(d.getTime()) || h > 23 || mi > 59) return null;
    // Sem ano e já passou: ano que vem.
    return d.getTime() > now ? d : (dm[3] ? null : toUtc(y + 1, Number(dm[2]) - 1, Number(dm[1]), h, mi));
  }
  // Só uma hora: "18h", "18:30" → hoje, ou amanhã se já passou.
  const t = raw.match(/^(?:às?\s*)?(\d{1,2})(?::(\d{2}))?\s*h?(\d{2})?$/);
  if (t) {
    const h = Number(t[1]); const mi = Number(t[2] || t[3] || 0);
    if (h > 23 || mi > 59) return null;
    let d = toUtc(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, mi);
    if (d.getTime() <= now) d = toUtc(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, h, mi);
    return d;
  }
  return null;
}

function validateReminder({ text, dueAt, link, messageId }, now = Date.now()) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return { error: 'Escreva do que você quer lembrar.' };
  if (t.length > 500) return { error: 'Texto longo demais (máx. 500 caracteres).' };
  const at = new Date(dueAt);
  if (Number.isNaN(at.getTime())) return { error: 'Horário inválido.' };
  if (at.getTime() < now + 20 * 1000) return { error: 'Escolha um horário no futuro.' };
  if (at.getTime() > now + MAX_AHEAD_MS) return { error: 'Dá pra lembrar até 1 ano à frente.' };
  const l = typeof link === 'string' && link.startsWith('/') ? link.slice(0, 300) : null;
  return { ok: true, text: t, dueAt: at, link: l, messageId: typeof messageId === 'string' ? messageId.slice(0, 64) : null };
}

async function tick(io, now = Date.now()) {
  try {
    const due = await prisma.reminder.findMany({
      where: { firedAt: null, dueAt: { lte: new Date(now) } }, orderBy: { dueAt: 'asc' }, take: MAX_PER_TICK,
    });
    for (const r of due) {
      // eslint-disable-next-line no-await-in-loop
      const claimed = await prisma.reminder.updateMany({ where: { id: r.id, firedAt: null }, data: { firedAt: new Date(now) } });
      if (claimed.count !== 1) continue;
      // eslint-disable-next-line no-await-in-loop
      await createNotice(io, r.userId, { kind: 'REMINDER', title: 'Lembrete', body: r.text, link: r.link || '/notifications', data: { reminderId: r.id, messageId: r.messageId } });
      io?.notifyUser?.(r.userId, 'reminder:fired', { id: r.id });
    }
  } catch (err) {
    console.error('[lembretes] tick falhou:', err?.message || err);
  }
}

function startReminders(io) {
  if (timer) return timer;
  timer = setInterval(() => tick(io), TICK_MS);
  timer.unref?.();
  return timer;
}
function stopReminders() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { parseWhen, validateReminder, tick, startReminders, stopReminders, MAX_ACTIVE_PER_USER };
