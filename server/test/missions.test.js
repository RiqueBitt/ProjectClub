// Missões (Economia): chaves de período em America/Sao_Paulo, contagem de
// progresso (com teto na meta), reação contada uma vez só e resgate único.
// Usa um prisma falso em memória (o projeto não tem banco de teste).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const rows = new Map(); // `${userId}|${missionId}|${periodKey}` -> row
const users = new Map([['u1', { coins: 0, gems: 0, accountXp: 0, accountLevel: 1 }]]);
const ledger = [];
const MISSIONS = [
  { id: 'm1', period: 'DAILY', type: 'MESSAGES', title: 'Msgs', target: 3, rewardCoins: 30, rewardGems: 0, rewardXp: 0, enabled: true },
  { id: 'm2', period: 'WEEKLY', type: 'MESSAGES', title: 'Msgs semana', target: 10, rewardCoins: 100, rewardGems: 1, rewardXp: 0, enabled: true },
  { id: 'm3', period: 'DAILY', type: 'REACTIONS', title: 'Reações', target: 5, rewardCoins: 5, rewardGems: 0, rewardXp: 0, enabled: true },
];
const k = (w) => `${w.userId}|${w.missionId}|${w.periodKey}`;
let seq = 0;
const fakePrisma = {
  mission: {
    findMany: async () => MISSIONS,
    findUnique: async ({ where }) => MISSIONS.find((m) => m.id === where.id) || null,
    count: async () => MISSIONS.length,
  },
  userMissionProgress: {
    findUnique: async ({ where }) => rows.get(k(where.userId_missionId_periodKey)) || null,
    upsert: async ({ where, create, update }) => {
      const key = k(where.userId_missionId_periodKey);
      const cur = rows.get(key);
      if (!cur) { const r = { id: `r${++seq}`, completedAt: null, claimedAt: null, ...create }; rows.set(key, r); return { ...r }; }
      cur.progress += update.progress.increment;
      return { ...cur };
    },
    updateMany: async ({ where, data }) => {
      let count = 0;
      for (const r of rows.values()) {
        if (where.id && r.id !== where.id) continue;
        if (where.userId && r.userId !== where.userId) continue;
        if (where.missionId && r.missionId !== where.missionId) continue;
        if (where.periodKey && r.periodKey !== where.periodKey) continue;
        if ('claimedAt' in where && r.claimedAt !== where.claimedAt) continue;
        if ('completedAt' in where && r.completedAt !== where.completedAt) continue;
        if (where.progress?.gte !== undefined && r.progress < where.progress.gte) continue;
        Object.assign(r, data); count += 1;
      }
      return { count };
    },
    findMany: async ({ where }) => [...rows.values()].filter((r) => r.userId === where.userId && where.periodKey.in.includes(r.periodKey)),
  },
  user: {
    findUnique: async ({ where }) => ({ ...users.get(where.id) }),
    update: async ({ where, data }) => {
      const u = users.get(where.id);
      for (const [f, v] of Object.entries(data)) u[f] = typeof v === 'object' ? u[f] + v.increment : v;
      return { ...u };
    },
  },
  economyTransaction: { create: async ({ data }) => { ledger.push(data); return data; } },
  $transaction: async (fn) => fn(fakePrisma),
};
require.cache[path.resolve(__dirname, '../src/config/prisma.js')] = { exports: fakePrisma, loaded: true, id: 'prisma' };

const missions = require('../src/services/missions');

test('chaves de período usam o fuso de São Paulo', () => {
  // 02:30 UTC de sábado 11/10 = 23:30 de sexta 10/10 em SP.
  const t = new Date('2026-10-11T02:30:00Z');
  assert.equal(missions.dayKey(t), 'D2026-10-10');
  assert.equal(missions.weekKey(t), 'W2026-10-05'); // segunda-feira
  // 03:00 UTC = meia-noite em SP -> já é sábado
  assert.equal(missions.dayKey(new Date('2026-10-11T03:00:00Z')), 'D2026-10-11');
  // domingo continua na semana da segunda anterior; segunda abre semana nova
  assert.equal(missions.weekKey(new Date('2026-10-12T15:00:00Z')), 'W2026-10-12');
  assert.equal(missions.weekKey(new Date('2026-10-11T15:00:00Z')), 'W2026-10-05');
  const r = missions.nextResets(t);
  assert.equal(r.daily, '2026-10-11T03:00:00.000Z');
  assert.equal(r.weekly, '2026-10-12T03:00:00.000Z');
});

test('progresso conta, para na meta e marca concluída', async () => {
  const events = [];
  const io = { notifyUser: (uid, ev, p) => events.push(p) };
  for (let i = 0; i < 5; i += 1) await missions.track('u1', 'MESSAGES', 1, io);
  const list = await missions.listForUser('u1');
  const m1 = list.missions.find((m) => m.id === 'm1');
  const m2 = list.missions.find((m) => m.id === 'm2');
  assert.equal(m1.progress, 3);
  assert.equal(m1.completed, true);
  assert.equal(m2.progress, 5);
  assert.equal(m2.completed, false);
  const row = [...rows.values()].find((r) => r.missionId === 'm1');
  assert.ok(row.completedAt, 'completedAt gravado');
  assert.ok(events.some((e) => e.missionId === 'm1' && e.completed));
});

test('reação: uma vez por mensagem e não na própria', async () => {
  missions.trackReaction('u1', 'msgA', 'u2', null);
  missions.trackReaction('u1', 'msgA', 'u2', null); // de novo, mesma mensagem
  missions.trackReaction('u1', 'msgB', 'u1', null); // própria mensagem
  await new Promise((r) => setTimeout(r, 20));
  const list = await missions.listForUser('u1');
  assert.equal(list.missions.find((m) => m.id === 'm3').progress, 1);
});

test('resgate dá a recompensa uma vez só e registra no histórico', async () => {
  const res = await missions.claim('u1', 'm1');
  assert.equal(res.reward.coins, 30);
  assert.equal(res.balance.coins, 30);
  await assert.rejects(() => missions.claim('u1', 'm1'), (e) => e.status === 400);
  await assert.rejects(() => missions.claim('u1', 'm2'), (e) => e.status === 400); // não concluída
  assert.equal(users.get('u1').coins, 30);
  assert.ok(ledger.some((t) => t.kind === 'MISSION' && t.coins === 30));
});

test('feature flags: casas e figurinhas desligadas devolvem 404', () => {
  const { requireFeature, isFeatureEnabled } = require('../src/config/features');
  assert.equal(isFeatureEnabled('houses'), false);
  assert.equal(isFeatureEnabled('stickers'), false);
  let status = 0;
  let nextCalled = false;
  const res = { status(s) { status = s; return this; }, json() { return this; } };
  requireFeature('houses')({}, res, () => { nextCalled = true; });
  assert.equal(status, 404);
  assert.equal(nextCalled, false);
});
