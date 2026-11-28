// Mensagens agendadas + lembretes + filtros novos da busca (em:/fixada:).
// Sem banco: prisma falso em memória; o envio da agendada passa por um
// createMessageInner falso que registra o que recebeu.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const db = { scheduled: [], reminders: [], notices: [], users: { u1: { id: 'u1', displayName: 'Ana' } } };
const fakePrisma = {
  user: { findUnique: async ({ where }) => db.users[where.id] || null },
  scheduledMessage: {
    findMany: async ({ where, take }) => db.scheduled.filter((r) => r.status === where.status && (!where.sendAt || r.sendAt <= where.sendAt.lte)).slice(0, take || 100),
    findUnique: async ({ where }) => db.scheduled.find((r) => r.id === where.id) || null,
    updateMany: async ({ where, data }) => {
      let n = 0;
      for (const r of db.scheduled) {
        if (where.id && r.id !== where.id) continue;
        if (where.status && r.status !== where.status) continue;
        if (where.claimedAt && !(r.claimedAt && r.claimedAt < where.claimedAt.lt)) continue;
        Object.assign(r, data); n += 1;
      }
      return { count: n };
    },
    update: async ({ where, data }) => { const r = db.scheduled.find((x) => x.id === where.id); Object.assign(r, data); return r; },
  },
  reminder: {
    findMany: async ({ where, take }) => db.reminders.filter((r) => r.firedAt === null && r.dueAt <= where.dueAt.lte).slice(0, take),
    updateMany: async ({ where, data }) => { let n = 0; for (const r of db.reminders) { if (r.id === where.id && r.firedAt === null) { Object.assign(r, data); n += 1; } } return { count: n }; },
  },
  userNotice: { create: async ({ data }) => { const n = { id: `n${db.notices.length + 1}`, ...data }; db.notices.push(n); return n; } },
};
require.cache[path.resolve(__dirname, '../src/config/prisma.js')] = { exports: fakePrisma, loaded: true, id: 'prisma' };
require.cache[path.resolve(__dirname, '../src/services/pushNotifications.js')] = { exports: { sendPushToUser: async () => {} }, loaded: true, id: 'push' };

const scheduled = require('../src/services/scheduledMessages');
const reminders = require('../src/services/reminders');

const NOW = Date.UTC(2026, 9, 13, 15, 0); // 13/10/2026 12:00 em Brasília
const ioEvents = [];
const io = { notifyUser: (uid, ev, p) => ioEvents.push({ uid, ev, p }) };

beforeEach(() => { db.scheduled = []; db.reminders = []; db.notices = []; ioEvents.length = 0; });

// ---------------- validação ----------------
test('validateSchedule: conteúdo, sala e janela de 30s..30d', () => {
  assert.match(scheduled.validateSchedule({ content: ' ', sendAt: new Date(NOW + 60000), channelId: 'c' }, NOW).error, /Escreva/);
  assert.match(scheduled.validateSchedule({ content: 'oi', sendAt: new Date(NOW + 60000) }, NOW).error, /canal ou a conversa/);
  assert.match(scheduled.validateSchedule({ content: 'oi', sendAt: new Date(NOW + 60000), channelId: 'c', conversationId: 'd' }, NOW).error, /só o canal/);
  assert.match(scheduled.validateSchedule({ content: 'oi', sendAt: 'x', channelId: 'c' }, NOW).error, /inválida/);
  assert.match(scheduled.validateSchedule({ content: 'oi', sendAt: new Date(NOW + 1000), channelId: 'c' }, NOW).error, /30 segundos/);
  assert.match(scheduled.validateSchedule({ content: 'oi', sendAt: new Date(NOW + 40 * 86400000), channelId: 'c' }, NOW).error, /30 dias/);
  const ok = scheduled.validateSchedule({ content: ' oi ', sendAt: new Date(NOW + 3600000).toISOString(), channelId: 'c' }, NOW);
  assert.equal(ok.ok, true); assert.equal(ok.content, 'oi');
});

// ---------------- envio ----------------
test('tick envia só o que venceu, pelo createMessageInner, e marca SENT (sem duplicar)', async () => {
  db.scheduled.push(
    { id: 's1', authorId: 'u1', channelId: 'c1', conversationId: null, content: 'bom dia', replyToId: null, sendAt: new Date(NOW - 1000), status: 'PENDING', claimedAt: null },
    { id: 's2', authorId: 'u1', channelId: null, conversationId: 'd1', content: 'depois', replyToId: null, sendAt: new Date(NOW + 60000), status: 'PENDING', claimedAt: null },
  );
  const calls = [];
  const deps = { messageController: { createMessageInner: async (req, res) => { calls.push({ user: req.user.id, body: req.body, io: req.app.get('io') }); res.status(201).json({ message: { id: 'm9' } }); return true; } } };
  await scheduled.tick(io, deps, NOW);
  await scheduled.tick(io, deps, NOW); // segunda rodada não reenvia
  assert.equal(calls.length, 1);
  assert.equal(calls[0].user, 'u1');
  assert.equal(calls[0].body.channelId, 'c1');
  assert.equal(calls[0].body.content, 'bom dia');
  assert.equal(calls[0].io, io, 'o socket chega como no envio normal');
  assert.equal(db.scheduled[0].status, 'SENT');
  assert.equal(db.scheduled[0].sentMessageId, 'm9');
  assert.equal(db.scheduled[1].status, 'PENDING');
  assert.deepEqual(ioEvents.map((e) => e.ev), ['scheduled:sent']);
});

test('envio recusado (perdeu acesso/automod) vira FAILED com motivo e aviso pra pessoa', async () => {
  db.scheduled.push({ id: 's1', authorId: 'u1', channelId: 'c1', conversationId: null, content: 'x', replyToId: null, sendAt: new Date(NOW - 1), status: 'PENDING', claimedAt: null });
  const deps = { messageController: { createMessageInner: async (req, res) => { res.status(403).json({ error: 'Sem acesso a este canal.' }); return false; } } };
  await scheduled.tick(io, deps, NOW);
  assert.equal(db.scheduled[0].status, 'FAILED');
  assert.equal(db.scheduled[0].error, 'Sem acesso a este canal.');
  assert.equal(db.notices.length, 1);
  assert.equal(db.notices[0].kind, 'SCHEDULED_FAILED');
  assert.match(db.notices[0].body, /Sem acesso/);
});

test('exceção no envio também vira FAILED (nunca derruba o job)', async () => {
  db.scheduled.push({ id: 's1', authorId: 'u1', channelId: 'c1', conversationId: null, content: 'x', replyToId: null, sendAt: new Date(NOW - 1), status: 'PENDING', claimedAt: null });
  const deps = { messageController: { createMessageInner: async () => { throw new Error('banco caiu'); } } };
  await scheduled.tick(io, deps, NOW);
  assert.equal(db.scheduled[0].status, 'FAILED');
  assert.equal(db.scheduled[0].error, 'banco caiu');
});

test('reserva presa (processo caiu no meio) volta pra PENDING depois de 5 min', async () => {
  db.scheduled.push({ id: 's1', authorId: 'u1', channelId: 'c1', conversationId: null, content: 'x', replyToId: null, sendAt: new Date(NOW - 10 * 60000), status: 'SENDING', claimedAt: new Date(NOW - 6 * 60000) });
  await scheduled.tick(io, { messageController: { createMessageInner: async () => true } }, NOW);
  assert.equal(db.scheduled[0].status, 'PENDING');
});

// ---------------- lembretes ----------------
test('parseWhen entende relativo, dia+hora, só hora e datas', () => {
  const p = (x) => reminders.parseWhen(x, NOW, -180)?.toISOString() || null;
  assert.equal(p('em 2h'), '2026-10-13T17:00:00.000Z');
  assert.equal(p('30m'), '2026-10-13T15:30:00.000Z');
  assert.equal(p('2 horas e 30 minutos'), '2026-10-13T17:30:00.000Z');
  assert.equal(p('3 dias'), '2026-10-16T15:00:00.000Z');
  assert.equal(p('amanhã'), '2026-10-14T12:00:00.000Z'); // 9h local
  assert.equal(p('amanhã às 18:30'), '2026-10-14T21:30:00.000Z');
  assert.equal(p('18h'), '2026-10-13T21:00:00.000Z'); // hoje, ainda não passou
  assert.equal(p('11h'), '2026-10-14T14:00:00.000Z'); // já passou → amanhã
  assert.equal(p('15/10 14:00'), '2026-10-15T17:00:00.000Z');
  assert.equal(p('01/01 10h'), '2027-01-01T13:00:00.000Z'); // sem ano e já passou → ano que vem
  assert.equal(p('2026-10-20T15:00'), '2026-10-20T18:00:00.000Z'); // local
  assert.equal(p('2026-10-20T15:00:00Z'), '2026-10-20T15:00:00.000Z');
  assert.equal(p('xyz'), null);
  assert.equal(p('hoje 25h'), null);
});

test('validateReminder: texto, horário futuro e link só interno', () => {
  assert.match(reminders.validateReminder({ text: '', dueAt: new Date(NOW + 60000) }, NOW).error, /Escreva/);
  assert.match(reminders.validateReminder({ text: 'x', dueAt: new Date(NOW - 1) }, NOW).error, /futuro/);
  const ok = reminders.validateReminder({ text: ' pagar ', dueAt: new Date(NOW + 60000), link: 'https://evil', messageId: 'm1' }, NOW);
  assert.equal(ok.text, 'pagar'); assert.equal(ok.link, null); assert.equal(ok.messageId, 'm1');
  assert.equal(reminders.validateReminder({ text: 'x', dueAt: new Date(NOW + 60000), link: '/channels/c1' }, NOW).link, '/channels/c1');
});

test('tick dos lembretes: vira aviso REMINDER uma vez só, com link e texto', async () => {
  db.reminders.push(
    { id: 'r1', userId: 'u1', text: 'responder a Ana', link: '/channels/c1', messageId: 'm1', dueAt: new Date(NOW - 5000), firedAt: null },
    { id: 'r2', userId: 'u1', text: 'depois', link: null, messageId: null, dueAt: new Date(NOW + 5000), firedAt: null },
  );
  await reminders.tick(io, NOW);
  await reminders.tick(io, NOW);
  assert.equal(db.notices.length, 1);
  assert.equal(db.notices[0].kind, 'REMINDER');
  assert.equal(db.notices[0].body, 'responder a Ana');
  assert.equal(db.notices[0].link, '/channels/c1');
  assert.ok(db.reminders[0].firedAt);
  assert.equal(db.reminders[1].firedAt, null);
  assert.deepEqual(ioEvents.filter((e) => e.ev === 'reminder:fired').length, 1);
});

// ---------------- busca ----------------
test('parseSearchQuery: em:#canal, fixada:, e os antigos continuam', () => {
  const { parseSearchQuery: parse } = require('../src/services/searchQuery');
  const p = parse('oi em:#geral fixada: de:@ana tem:imagem');
  assert.equal(p.in, 'geral'); assert.equal(p.pinned, true); assert.equal(p.from, 'ana'); assert.ok(p.has.has('image')); assert.equal(p.text, 'oi');
  assert.equal(parse('in:anuncios pinned:nao x').pinned, false);
  assert.equal(parse('só texto').in, null);
  assert.equal(parse('só texto').pinned, null);
});
