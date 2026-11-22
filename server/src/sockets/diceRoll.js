// Rolagem de dados na call (Atividades da chamada → Rolar dados): o
// servidor rola e todo mundo na sala vê um popup por 2 segundos. Não fica
// registrado no chat (pedido do dono). Só quem está DENTRO da sala rola.
const prisma = require('../config/prisma');
const voiceStore = require('../services/voiceRoomStore');
const dice = require('../services/dice');

const last = new Map(); // userId -> timestamp

function register(io, socket, userId) {
  socket.on('dice:roll', async (payload = {}, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      const roomId = typeof payload.channelId === 'string' ? payload.channelId.slice(0, 120) : '';
      if (!roomId || !(await voiceStore.hasParticipant(roomId, userId))) return reply({ error: 'Entre na chamada pra rolar os dados nela.' });
      const now = Date.now();
      if (now - (last.get(userId) || 0) < 1500) return reply({ error: 'Calma! Espere um instante pra rolar de novo.' });
      const r = dice.roll(payload);
      last.set(userId, now);
      if (last.size > 5000) last.delete(last.keys().next().value);
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, displayName: true, avatarUrl: true } });
      const event = { channelId: roomId, user, ...r, notation: dice.notation(r), at: now };
      io.to(`voice:${roomId}`).emit('dice:rolled', event);
      reply({ ok: true, roll: event });
    } catch (err) {
      reply({ error: err.status === 400 ? err.message : 'Não deu pra rolar os dados agora.' });
    }
  });
}

module.exports = { register };
