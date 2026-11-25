// Rolagem de dados na call (Atividades da chamada → Rolar dados): o
// servidor rola e todo mundo na sala vê um popup por 2 segundos. Não fica
// registrado no chat (pedido do dono). Só quem está DENTRO da sala rola.
const prisma = require('../config/prisma');
const voiceStore = require('../services/voiceRoomStore');
const dice = require('../services/dice');

const last = new Map(); // userId -> timestamp

// Teste do BLACKOUT (rolador 3D do compêndio, dentro da call): o site rola
// os 2 dados (atributo + perícia) com a física dele e manda o resultado; aqui
// a gente confere os valores e recalcula o veredito pela regra do BLACKOUT.
const BO_SIDES = [4, 6, 8, 10, 12, 20];
function boVeredito(a, b, dif) {
  const hi = Math.max(a, b), lo = Math.min(a, b);
  if (hi >= dif * 2 && lo >= dif) return 'CRÍTICO';
  if (lo >= dif) return 'SUCESSO';
  if (hi >= dif) return 'PARCIAL';
  return 'ERRO';
}
function blackoutRoll(b = {}) {
  const bad = () => { const e = new Error('Rolagem do BLACKOUT inválida.'); e.status = 400; throw e; };
  const d = (Array.isArray(b.dice) ? b.dice : []).slice(0, 2).map((x) => ({
    name: String(x?.name || '').replace(/[\u0000-\u001f]/g, '').slice(0, 40), sides: Number(x?.sides), value: Number(x?.value),
  }));
  if (d.length !== 2 || d.some((x) => !BO_SIDES.includes(x.sides) || !Number.isInteger(x.value) || x.value < 1 || x.value > x.sides)) bad();
  const dif = Math.max(2, Math.min(6, Math.round(Number(b.dif)) || 4));
  const v = boVeredito(d[0].value, d[1].value, dif);
  return {
    groups: d.map((x) => ({ sides: x.sides, count: 1, results: [x.value] })),
    modifier: 0, total: d[0].value + d[1].value,
    label: `${d[0].name || 'Dado 1'} + ${d[1].name || 'Dado 2'} · Dif ${dif} · ${v}`.slice(0, 60),
    blackout: { verdict: v, dif },
  };
}

function register(io, socket, userId) {
  socket.on('dice:roll', async (payload = {}, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      const roomId = typeof payload.channelId === 'string' ? payload.channelId.slice(0, 120) : '';
      if (!roomId || !(await voiceStore.hasParticipant(roomId, userId))) return reply({ error: 'Entre na chamada pra rolar os dados nela.' });
      const now = Date.now();
      if (now - (last.get(userId) || 0) < 1500) return reply({ error: 'Calma! Espere um instante pra rolar de novo.' });
      const r = payload.blackout ? blackoutRoll(payload.blackout) : dice.roll(payload);
      last.set(userId, now);
      if (last.size > 5000) last.delete(last.keys().next().value);
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, displayName: true, avatarUrl: true } });
      const event = { channelId: roomId, user, ...r, notation: r.blackout ? `D${r.groups[0].sides} + D${r.groups[1].sides}` : dice.notation(r), at: now };
      io.to(`voice:${roomId}`).emit('dice:rolled', event);
      // Call modo RPG: a rolagem entra no histórico da mesa.
      require('./rpgTable').onRoll(io, roomId, event).catch(() => {});
      reply({ ok: true, roll: event });
    } catch (err) {
      reply({ error: err.status === 400 ? err.message : 'Não deu pra rolar os dados agora.' });
    }
  });
}

module.exports = { register };
