const prisma = require('../config/prisma');
const { createNotice } = require('./notices');

// Lembrete "seu evento começa em 15 minutos" pra quem respondeu "Eu vou".
// Roda a cada minuto. Idempotente: EventRsvp.remindedAt só é marcado por
// UM processo (updateMany com remindedAt = null) e só quem conseguiu
// marcar manda o aviso — reinício/deploy ou duas instâncias não duplicam.
// Se a staff mudar o horário do evento, updateEvent zera remindedAt.
const LEAD_MS = 15 * 60 * 1000;
const TICK_MS = 60 * 1000;
let timer = null;

async function tick(io, now = Date.now()) {
  try {
    const events = await prisma.event.findMany({
      where: {
        status: { not: 'ENDED' },
        // Janela: começa entre agora e daqui a 15 min (um evento que já
        // começou não recebe lembrete atrasado).
        startsAt: { gt: new Date(now), lte: new Date(now + LEAD_MS) },
      },
      select: { id: true, title: true, startsAt: true },
      take: 50,
    });
    for (const ev of events) {
      // eslint-disable-next-line no-await-in-loop
      const pending = await prisma.eventRsvp.findMany({
        where: { eventId: ev.id, status: 'GOING', remindedAt: null },
        select: { id: true, userId: true },
        take: 1000,
      });
      for (const r of pending) {
        // eslint-disable-next-line no-await-in-loop
        const claimed = await prisma.eventRsvp.updateMany({ where: { id: r.id, remindedAt: null }, data: { remindedAt: new Date(now) } });
        if (claimed.count !== 1) continue;
        const minutes = Math.max(1, Math.round((new Date(ev.startsAt).getTime() - now) / 60000));
        // eslint-disable-next-line no-await-in-loop
        await createNotice(io, r.userId, {
          kind: 'EVENT_REMINDER',
          title: ev.title,
          body: minutes === 1 ? 'Começa em 1 minuto.' : `Começa em ${minutes} minutos.`,
          link: `/eventos/${ev.id}`,
          data: { eventId: ev.id, startsAt: ev.startsAt },
        });
      }
    }
    await startedTick(io, now);
  } catch (err) {
    console.error('[eventos] falha nos lembretes:', err?.message || err);
  }
}

// "Começou!": evento com canal de voz que acabou de começar (até 5 min) →
// aviso + push pra quem vai, com o atalho pra entrar na call.
async function startedTick(io, now) {
  const events = await prisma.event.findMany({
    where: { status: { not: 'ENDED' }, voiceChannelId: { not: null }, startsAt: { gt: new Date(now - 5 * 60 * 1000), lte: new Date(now) } },
    select: { id: true, title: true, voiceChannelId: true },
    take: 20,
  });
  for (const ev of events) {
    const ch = await prisma.channel.findUnique({ where: { id: ev.voiceChannelId }, select: { id: true, name: true } }).catch(() => null);
    if (!ch) continue;
    const pending = await prisma.eventRsvp.findMany({ where: { eventId: ev.id, status: 'GOING', startNotifiedAt: null }, select: { id: true, userId: true }, take: 1000 });
    for (const r of pending) {
      const claimed = await prisma.eventRsvp.updateMany({ where: { id: r.id, startNotifiedAt: null }, data: { startNotifiedAt: new Date(now) } });
      if (claimed.count !== 1) continue;
      await createNotice(io, r.userId, {
        kind: 'EVENT_REMINDER',
        title: `${ev.title} começou!`,
        body: `Toque pra entrar na call ${ch.name}.`,
        link: `/channels/${ch.id}?entrar=1`,
        data: { eventId: ev.id, voiceChannelId: ch.id, voiceChannelName: ch.name, join: true },
      });
    }
    // Começou: marca como Ativo (a página mostra "Ao vivo").
    await prisma.event.updateMany({ where: { id: ev.id, status: 'UPCOMING' }, data: { status: 'ACTIVE' } }).catch(() => null);
  }
}

function startEventReminders(io) {
  if (timer) return;
  timer = setInterval(() => tick(io), TICK_MS);
  timer.unref?.();
  setTimeout(() => tick(io), 15000).unref?.();
}

module.exports = { startEventReminders, tick, LEAD_MS };
