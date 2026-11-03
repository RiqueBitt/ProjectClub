// Fase 5 — mensagens temporárias nas DMs (services/ephemeralMessages.js):
// cálculo do prazo, opções aceitas, linha de sistema e a faxina (consulta
// certa, apaga em lotes e avisa as salas com 'message:delete').
const test = require('node:test');
const assert = require('node:assert/strict');
const eph = require('../src/services/ephemeralMessages');

const NOW = new Date('2026-11-02T12:00:00Z');

test('opções: desligado, 24 horas e 7 dias — o resto é recusado', () => {
  assert.equal(eph.normalizeMode('off'), null);
  assert.equal(eph.normalizeMode(null), null);
  assert.equal(eph.normalizeMode('24h'), 86400);
  assert.equal(eph.normalizeMode('7d'), 604800);
  assert.equal(eph.normalizeMode(86400), 86400);
  assert.equal(eph.normalizeMode('604800'), 604800);
  for (const bad of [undefined, '1h', 5, -86400, '86400.5', {}, [], 'toString', '__proto__', 'constructor']) {
    assert.equal(eph.normalizeMode(bad), undefined, String(bad));
  }
});

test('prazo: agora + duração; desligado ou inválido não tem prazo', () => {
  assert.equal(eph.computeExpiresAt(86400, NOW).toISOString(), '2026-11-03T12:00:00.000Z');
  assert.equal(eph.computeExpiresAt(604800, NOW).toISOString(), '2026-11-09T12:00:00.000Z');
  assert.equal(eph.computeExpiresAt(null, NOW), null);
  assert.equal(eph.computeExpiresAt(60, NOW), null, 'só as durações oferecidas');
});

test('expiryForConversation: lê a conversa; falha no banco nunca trava o envio', async () => {
  const db = { conversation: { findUnique: async ({ where }) => (where.id === 'c1' ? { ephemeralSeconds: 86400 } : { ephemeralSeconds: null }) } };
  assert.equal((await eph.expiryForConversation('c1', { db, now: NOW })).toISOString(), '2026-11-03T12:00:00.000Z');
  assert.equal(await eph.expiryForConversation('c2', { db, now: NOW }), null);
  assert.equal(await eph.expiryForConversation(null, { db, now: NOW }), null);
  const broken = { conversation: { findUnique: async () => { throw new Error('caiu'); } } };
  assert.equal(await eph.expiryForConversation('c1', { db: broken, now: NOW }), null);
});

test('linha de sistema mostra quem mudou e pra quanto', () => {
  const on = JSON.parse(eph.buildEphemeralSystemEmbed({ actorName: 'Ana', seconds: 604800 }));
  assert.equal(on.system, 'ephemeral');
  assert.equal(on.seconds, 604800);
  assert.match(on.description, /Ana ativou .*7 dias/);
  const off = JSON.parse(eph.buildEphemeralSystemEmbed({ actorName: 'Bia', seconds: null }));
  assert.equal(off.seconds, null);
  assert.match(off.description, /Bia desativou/);
});

test('consulta da faxina: só mensagens com prazo e já vencidas', () => {
  const w = eph.expiredWhere(NOW);
  assert.deepEqual(w, { expiresAt: { not: null, lte: NOW } });
});

test('faxina: apaga em lotes, limpa favoritos e avisa cada sala', async () => {
  const msgs = [
    { id: 'm1', conversationId: 'c1', channelId: null, threadId: null, expiresAt: new Date('2026-11-02T11:00:00Z') },
    { id: 'm2', conversationId: 'c1', channelId: null, threadId: null, expiresAt: new Date('2026-11-02T11:59:59Z') },
    { id: 'm3', conversationId: 'c2', channelId: null, threadId: null, expiresAt: new Date('2026-11-02T11:30:00Z') },
    { id: 'm4', conversationId: 'c1', channelId: null, threadId: null, expiresAt: new Date('2026-11-02T13:00:00Z') }, // ainda não
    { id: 'm5', conversationId: 'c1', channelId: null, threadId: null, expiresAt: null }, // normal
  ];
  const saved = [{ messageId: 'm1' }, { messageId: 'm5' }];
  const isExpired = (m, where) => m.expiresAt !== null && m.expiresAt <= where.expiresAt.lte;
  const db = {
    message: {
      findMany: async ({ where, take }) => msgs.filter((m) => isExpired(m, where)).sort((a, b) => a.expiresAt - b.expiresAt).slice(0, take)
        .map(({ id, conversationId, channelId, threadId }) => ({ id, conversationId, channelId, threadId })),
      deleteMany: async ({ where }) => {
        const before = msgs.length;
        for (let i = msgs.length - 1; i >= 0; i -= 1) {
          if (where.id.in.includes(msgs[i].id) && isExpired(msgs[i], where)) msgs.splice(i, 1);
        }
        return { count: before - msgs.length };
      },
    },
    savedMessage: {
      deleteMany: async ({ where }) => {
        const before = saved.length;
        for (let i = saved.length - 1; i >= 0; i -= 1) if (where.messageId.in.includes(saved[i].messageId)) saved.splice(i, 1);
        return { count: before - saved.length };
      },
    },
  };
  const emitted = [];
  const io = { to: (room) => ({ emit: (ev, payload) => emitted.push([room, ev, payload.id]) }) };
  const n = await eph.sweepExpiredMessages({ db, io, now: NOW, batch: 2 });
  assert.equal(n, 3);
  assert.deepEqual(msgs.map((m) => m.id), ['m4', 'm5']);
  assert.deepEqual(saved, [{ messageId: 'm5' }]);
  assert.deepEqual(emitted.sort(), [
    ['conversation:c1', 'message:delete', 'm1'],
    ['conversation:c1', 'message:delete', 'm2'],
    ['conversation:c2', 'message:delete', 'm3'],
  ]);
  // Rodar de novo não apaga mais nada.
  assert.equal(await eph.sweepExpiredMessages({ db, io, now: NOW }), 0);
});
