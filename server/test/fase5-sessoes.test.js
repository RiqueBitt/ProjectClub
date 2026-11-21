// Fase 5 — dispositivos conectados: encerrar uma sessão encerra a sessão
// INTEIRA (inclusive um token nascendo numa rotação simultânea), nunca toca
// a sessão de outra conta, e o "lembrar login" de um aparelho encerrado não
// recria a sessão. Banco falso em memória (sem Prisma).
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  keepSessionAlive, revokeSessionFamily, buildLoginNotice, describeDevice, maskIp,
} = require('../src/services/sessionSecurity');

function matches(row, where) {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return v.in.includes(row[k]);
      if ('not' in v) return row[k] !== v.not;
    }
    if (v instanceof Date) return row[k] instanceof Date && row[k].getTime() === v.getTime();
    return row[k] === v;
  });
}

function fakeDb(rows) {
  const tokens = rows.map((r) => ({ revoked: false, revokedReason: null, replacedById: null, ...r }));
  return {
    tokens,
    refreshToken: {
      async findUnique({ where }) { return tokens.find((t) => t.id === where.id) || null; },
      async updateMany({ where, data }) {
        let count = 0;
        tokens.forEach((t) => { if (matches(t, where)) { Object.assign(t, data); count += 1; } });
        return { count };
      },
    },
  };
}

const START = new Date('2026-11-01T10:00:00Z');
const OTHER_START = new Date('2026-11-01T11:00:00Z');

test('revokeSessionFamily: encerra o token atual e o filho de uma rotação simultânea', async () => {
  const db = fakeDb([
    { id: 'a1', userId: 'u1', sessionStartedAt: START, revoked: true, revokedReason: 'ROTATED', replacedById: 'a2' },
    { id: 'a2', userId: 'u1', sessionStartedAt: START },
    // filho que nasceu na rotação mas ainda não foi ligado por replacedById
    { id: 'a3', userId: 'u1', sessionStartedAt: START },
    { id: 'b1', userId: 'u1', sessionStartedAt: OTHER_START }, // outro aparelho da mesma conta
    { id: 'x1', userId: 'u2', sessionStartedAt: START }, // outra conta, mesmo horário (coincidência)
  ]);
  await revokeSessionFamily(db.tokens[1], 'REVOKED', { db });
  const byId = Object.fromEntries(db.tokens.map((t) => [t.id, t]));
  assert.equal(byId.a2.revoked, true);
  assert.equal(byId.a2.revokedReason, 'REVOKED');
  assert.equal(byId.a3.revoked, true);
  assert.equal(byId.b1.revoked, false, 'outro aparelho continua logado');
  assert.equal(byId.x1.revoked, false, 'nunca mexe na sessão de outra conta');
  assert.equal(byId.a1.revokedReason, 'ROTATED', 'histórico de rotação fica como estava');
});

test('revokeSessionFamily: linha antiga sem sessionStartedAt segue a corrente', async () => {
  const db = fakeDb([
    { id: 'o1', userId: 'u1', sessionStartedAt: null, replacedById: 'o2', revoked: true, revokedReason: 'ROTATED' },
    { id: 'o2', userId: 'u1', sessionStartedAt: null },
    { id: 'o3', userId: 'u1', sessionStartedAt: null },
  ]);
  await revokeSessionFamily(db.tokens[0], 'REVOKED', { db });
  assert.equal(db.tokens[1].revoked, true);
  assert.equal(db.tokens[2].revoked, false);
});

test('keepSessionAlive: lembrar-login morre junto com a sessão encerrada', async () => {
  const db = fakeDb([
    { id: 'k1', userId: 'u1', revoked: true, revokedReason: 'ROTATED', replacedById: 'k2' },
    { id: 'k2', userId: 'u1', revoked: true, revokedReason: 'REVOKED' },
    { id: 'm1', userId: 'u1', revoked: true, revokedReason: 'ROTATED', replacedById: 'm2' },
    { id: 'm2', userId: 'u1' },
    { id: 't1', userId: 'u1', revoked: true, revokedReason: 'THEFT' },
    { id: 'z1', userId: 'u1', revoked: true, revokedReason: 'ABANDONED' },
  ]);
  assert.equal(await keepSessionAlive('k1', { db }), false, 'cookie antigo da sessão encerrada');
  assert.equal(await keepSessionAlive('m1', { db }), true, 'sessão viva (só rotacionou)');
  assert.equal(await keepSessionAlive('t1', { db }), false);
  assert.equal(await keepSessionAlive('z1', { db }), true);
  assert.equal(await keepSessionAlive(null, { db }), true, 'cookie antigo sem rid: regra antiga');
  assert.equal(await keepSessionAlive('sumiu', { db }), true);
});

test('aviso de novo acesso: aparelho, rede mascarada e atalho "Não fui eu"', () => {
  const n = buildLoginNotice({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    ip: '::ffff:189.40.12.7', sessionId: 's1', when: new Date('2026-11-02T15:00:00Z'),
  });
  assert.equal(n.kind, 'SECURITY');
  assert.equal(n.link, '/seguranca/sessoes');
  assert.match(n.body, /Chrome no Windows/);
  assert.match(n.body, /189\.40\.x\.x/);
  assert.doesNotMatch(n.body, /12\.7/, 'IP completo nunca aparece');
  assert.equal(n.data.type, 'new_login');
  assert.equal(n.data.sessionId, 's1');
});

test('describeDevice/maskIp continuam iguais', () => {
  assert.equal(describeDevice('ProjectClub/2.0 (Linux; Android 14; Pixel) Nativo'), 'App no Android');
  assert.equal(describeDevice(''), 'Dispositivo desconhecido');
  assert.equal(describeDevice('Mozilla/5.0 (Macintosh) Electron/30'), 'App desktop no macOS');
  assert.equal(maskIp('10.1.2.3'), '10.1.x.x');
  assert.equal(maskIp(null), null);
});
