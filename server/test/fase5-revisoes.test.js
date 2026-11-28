// Fase 5 — revisão de banimento/suspensão (services/appeals.js) com banco
// falso: um pedido por punição, token de revisão que não vale como login,
// permissões da equipe, aceitar tira a punição pelo caminho de sempre e
// tudo vai pro registro de auditoria.
const test = require('node:test');
const assert = require('node:assert/strict');
const appeals = require('../src/services/appeals');
const { verifyAccessToken } = require('../src/services/tokens');

const T0 = new Date('2026-11-02T12:00:00Z');

function fakeDb({ users = [], bans = [], logs = [] } = {}) {
  const db = {
    users: users.map((u) => ({ ...u })),
    bans: bans.map((b) => ({ ...b })),
    logs: logs.map((l) => ({ ...l })),
    appeals: [],
    audit: [],
  };
  let seq = 0;
  db.user = {
    async findUnique({ where }) { return db.users.find((u) => u.id === where.id) || null; },
    async update({ where, data }) {
      const u = db.users.find((x) => x.id === where.id);
      if (!u) { const e = new Error('not found'); e.code = 'P2025'; throw e; }
      Object.assign(u, data); return { ...u };
    },
  };
  db.ban = {
    async findUnique({ where }) { return db.bans.find((b) => b.userId === where.userId) || null; },
    async deleteMany({ where }) { const before = db.bans.length; db.bans = db.bans.filter((b) => b.userId !== where.userId); return { count: before - db.bans.length }; },
  };
  db.platformAuditLog = {
    async findFirst({ where }) {
      const rows = db.logs.filter((l) => l.targetId === where.targetId && l.action === where.action)
        .sort((a, b) => b.createdAt - a.createdAt);
      return rows[0] || null;
    },
    async create({ data }) { db.audit.push(data); return data; },
  };
  db.punishmentAppeal = {
    async findUnique({ where }) {
      if (where.id) return db.appeals.find((a) => a.id === where.id) || null;
      const k = where.userId_punishmentKey;
      return db.appeals.find((a) => a.userId === k.userId && a.punishmentKey === k.punishmentKey) || null;
    },
    async findFirst({ where }) { return db.appeals.filter((a) => a.userId === where.userId).slice(-1)[0] || null; },
    async create({ data }) {
      if (db.appeals.some((a) => a.userId === data.userId && a.punishmentKey === data.punishmentKey)) {
        const e = new Error('unique'); e.code = 'P2002'; throw e;
      }
      const row = { id: `a${++seq}`, staffReply: null, reviewedById: null, reviewedAt: null, ...data };
      db.appeals.push(row); return { ...row };
    },
    async updateMany({ where, data }) {
      let count = 0;
      db.appeals.forEach((a) => { if (a.id === where.id && a.status === where.status) { Object.assign(a, data); count += 1; } });
      return { count };
    },
  };
  return db;
}

const admin = { id: 'adm', platformRole: 'ADMIN' };
const mod = { id: 'mod', platformRole: 'MODERATOR' };
const member = { id: 'mem', platformRole: 'USER' };

test('token de revisão: vale só pra revisão, nunca como token de acesso', () => {
  const token = appeals.signAppealToken('u1');
  assert.equal(appeals.verifyAppealToken(token), 'u1');
  assert.throws(() => verifyAccessToken(token), 'requireAuth recusaria');
  assert.equal(appeals.verifyAppealToken('lixo'), null);
  assert.equal(appeals.verifyAppealToken(undefined), null);
  assert.equal(appeals.verifyAppealToken({}), null);
});

test('chave da punição: banimento novo = pedido novo; suspensão pela data de fim', async () => {
  const db = fakeDb({
    bans: [{ userId: 'u1', createdAt: new Date('2026-10-01T00:00:00Z'), reason: 'spam' }],
    logs: [{ targetId: 'u1', action: 'USER_BAN', createdAt: new Date('2026-10-20T00:00:00Z') }],
  });
  const ban = await appeals.currentPunishment({ id: 'u1', isPlatformBanned: true, platformBanReason: 'flood' }, { db, now: T0 });
  assert.equal(ban.kind, 'BAN');
  assert.equal(ban.key, 'BAN:2026-10-20T00:00:00.000Z');
  assert.equal(ban.reason, 'flood');
  const until = new Date('2026-11-05T00:00:00Z');
  const sus = await appeals.currentPunishment({ id: 'u2', suspendedUntil: until }, { db, now: T0 });
  assert.equal(sus.kind, 'SUSPENSION');
  assert.equal(sus.key, `SUSPENSION:${until.toISOString()}`);
  assert.equal(await appeals.currentPunishment({ id: 'u3', suspendedUntil: new Date('2026-01-01') }, { db, now: T0 }), null);
});

test('um pedido por punição, texto até 2000 caracteres', async () => {
  const db = fakeDb({ users: [{ id: 'u1', isPlatformBanned: true, platformBanReason: 'spam' }] });
  const user = db.users[0];
  await assert.rejects(appeals.submitAppeal(user, 'x'.repeat(2001), { db, now: T0 }), { code: 'invalid' });
  await assert.rejects(appeals.submitAppeal(user, { evil: true }, { db, now: T0 }), { code: 'invalid' });
  const a = await appeals.submitAppeal(user, '  Foi um engano \u0007 ', { db, now: T0 });
  assert.equal(a.status, 'PENDING');
  assert.equal(a.message, 'Foi um engano');
  await assert.rejects(appeals.submitAppeal(user, 'de novo', { db, now: T0 }), { code: 'already' });
  const state = await appeals.getMyAppealState(user, { db, now: T0 });
  assert.equal(state.canAppeal, false);
  assert.equal(state.appeal.status, 'PENDING');
  // Sem punição: nada pra pedir.
  await assert.rejects(appeals.submitAppeal({ id: 'livre' }, '', { db, now: T0 }), { code: 'no_punishment' });
});

test('texto vazio é permitido (é opcional)', async () => {
  const db = fakeDb({ users: [{ id: 'u1', suspendedUntil: new Date('2026-12-01') }] });
  const a = await appeals.submitAppeal(db.users[0], undefined, { db, now: T0 });
  assert.equal(a.message, '');
  assert.equal(a.kind, 'SUSPENSION');
});

test('permissões: só a equipe revisa, ninguém revisa o próprio pedido', async () => {
  const db = fakeDb({ users: [{ id: 'mod', platformRole: 'MODERATOR', suspendedUntil: new Date('2026-12-01') }] });
  const a = await appeals.submitAppeal(db.users[0], 'oi', { db, now: T0 });
  await assert.rejects(appeals.reviewAppeal({ appealId: a.id, reviewer: member, accept: true }, { db, now: T0 }), { code: 'forbidden' });
  await assert.rejects(appeals.reviewAppeal({ appealId: a.id, reviewer: null, accept: true }, { db, now: T0 }), { code: 'forbidden' });
  await assert.rejects(appeals.reviewAppeal({ appealId: a.id, reviewer: mod, accept: true }, { db, now: T0 }), { code: 'own' });
});

test('aceitar tira o banimento pelo caminho de sempre e audita', async () => {
  const db = fakeDb({
    users: [{ id: 'u1', isPlatformBanned: true, platformBanReason: 'spam' }],
    bans: [{ userId: 'u1', createdAt: new Date('2026-10-01'), reason: 'spam' }],
  });
  const a = await appeals.submitAppeal(db.users[0], 'desculpa', { db, now: T0 });
  const lifted = [];
  const punishments = {
    liftBan: async (id, o) => { lifted.push(['ban', id]); return require('../src/services/punishments').liftBan(id, o); },
    liftSuspension: async (id) => { lifted.push(['sus', id]); },
  };
  const r = await appeals.reviewAppeal({ appealId: a.id, reviewer: mod, accept: true, reply: 'Ok, segunda chance.' }, { db, now: T0, punishments });
  assert.equal(r.lifted, true);
  assert.deepEqual(lifted, [['ban', 'u1']]);
  assert.equal(db.users[0].isPlatformBanned, false);
  assert.equal(db.users[0].platformBanReason, null);
  assert.equal(db.bans.length, 0);
  assert.deepEqual(db.audit.map((x) => x.action), ['APPEAL_ACCEPT', 'USER_UNBAN']);
  assert.equal(db.audit[0].actorId, 'mod');
  // Não dá pra revisar duas vezes.
  await assert.rejects(appeals.reviewAppeal({ appealId: a.id, reviewer: admin, accept: false, reply: 'não' }, { db, now: T0 }), { code: 'already_reviewed' });
});

test('recusar exige resposta e mantém a punição', async () => {
  const until = new Date('2026-12-01T00:00:00Z');
  const db = fakeDb({ users: [{ id: 'u1', suspendedUntil: until }] });
  const a = await appeals.submitAppeal(db.users[0], '', { db, now: T0 });
  await assert.rejects(appeals.reviewAppeal({ appealId: a.id, reviewer: admin, accept: false, reply: '   ' }, { db, now: T0 }), { code: 'reply_required' });
  await assert.rejects(appeals.reviewAppeal({ appealId: a.id, reviewer: admin, accept: false, reply: 'x'.repeat(2001) }, { db, now: T0 }), { code: 'invalid' });
  const r = await appeals.reviewAppeal({ appealId: a.id, reviewer: admin, accept: false, reply: 'Regras são regras.' }, { db, now: T0 });
  assert.equal(r.lifted, false);
  assert.equal(r.appeal.status, 'DENIED');
  assert.equal(db.users[0].suspendedUntil, until);
  assert.deepEqual(db.audit.map((x) => x.action), ['APPEAL_DENY']);
  const state = await appeals.getMyAppealState(db.users[0], { db, now: T0 });
  assert.equal(state.appeal.staffReply, 'Regras são regras.');
  assert.equal(state.canAppeal, false);
});

test('punição trocada depois do pedido: aceitar não tira a punição nova', async () => {
  const db = fakeDb({ users: [{ id: 'u1', suspendedUntil: new Date('2026-12-01T00:00:00Z') }] });
  const a = await appeals.submitAppeal(db.users[0], '', { db, now: T0 });
  db.users[0].suspendedUntil = new Date('2027-06-01T00:00:00Z'); // suspensão nova/maior
  await assert.rejects(appeals.reviewAppeal({ appealId: a.id, reviewer: admin, accept: true }, { db, now: T0 }), { code: 'stale' });
  assert.equal(db.appeals[0].status, 'PENDING');
  // E a pessoa pode pedir revisão da punição nova.
  const b = await appeals.submitAppeal(db.users[0], 'e essa?', { db, now: T0 });
  assert.notEqual(b.id, a.id);
});

test('ids estranhos não chegam no banco', async () => {
  const db = fakeDb();
  for (const bad of [undefined, null, '', { $gt: '' }, 'x'.repeat(65)]) {
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(appeals.reviewAppeal({ appealId: bad, reviewer: admin, accept: true }, { db, now: T0 }), { code: 'not_found' });
  }
});
