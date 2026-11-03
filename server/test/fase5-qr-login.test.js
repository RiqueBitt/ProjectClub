// Fase 5 — máquina de estados do "Entrar com o celular" (services/qrLogin.js)
// com banco falso em memória: uso único, expiração, trava por quem abriu o
// link primeiro, segredo do PC fora do QR e mesmo navegador na troca.
const test = require('node:test');
const assert = require('node:assert/strict');
const qr = require('../src/services/qrLogin');

function fakeDb() {
  const rows = [];
  let seq = 0;
  const match = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);
  return {
    rows,
    qrLoginPairing: {
      async create({ data }) { const row = { id: `p${++seq}`, scannedById: null, userId: null, ...data }; rows.push(row); return { ...row }; },
      async findUnique({ where }) { const r = rows.find((x) => match(x, where)); return r ? { ...r } : null; },
      async updateMany({ where, data }) {
        let count = 0;
        rows.forEach((r) => { if (match(r, where)) { Object.assign(r, data); count += 1; } });
        return { count };
      },
    },
  };
}

const UA = 'Mozilla/5.0 (Windows NT 10.0) Chrome/130';
const T0 = new Date('2026-11-02T12:00:00Z');
const at = (sec) => new Date(T0.getTime() + sec * 1000);

async function newPairing(db) {
  return qr.createPairing({ db, ip: '200.1.2.3', userAgent: UA, now: T0 });
}

async function rejects(promise, code) {
  await assert.rejects(promise, (err) => err instanceof qr.QrLoginError && err.code === code);
}

test('fluxo feliz: PENDING → SCANNED → APPROVED → CONSUMED', async () => {
  const db = fakeDb();
  const p = await newPairing(db);
  assert.ok(qr.isToken(p.code) && qr.isToken(p.secret));
  assert.notEqual(p.code, p.secret);
  // Só hashes no banco.
  assert.equal(db.rows[0].codeHash, qr.sha256(p.code));
  assert.ok(!JSON.stringify(db.rows).includes(p.code));
  assert.ok(!JSON.stringify(db.rows).includes(p.secret));

  assert.equal((await qr.pollPairing(p.secret, { db, now: at(1) })).status, 'PENDING');
  await qr.scanPairing(p.code, 'u1', { db, now: at(5) });
  assert.equal((await qr.pollPairing(p.secret, { db, now: at(6) })).status, 'SCANNED');
  await qr.decidePairing(p.code, 'u1', true, { db, now: at(10) });
  assert.equal((await qr.pollPairing(p.secret, { db, now: at(11) })).status, 'APPROVED');
  const out = await qr.consumePairing(p.secret, { db, userAgent: UA, now: at(12) });
  assert.equal(out.userId, 'u1');
  assert.equal((await qr.pollPairing(p.secret, { db, now: at(13) })).status, 'CONSUMED');
});

test('replay: o segredo só vira sessão uma vez', async () => {
  const db = fakeDb();
  const p = await newPairing(db);
  await qr.scanPairing(p.code, 'u1', { db, now: at(1) });
  await qr.decidePairing(p.code, 'u1', true, { db, now: at(2) });
  const [a, b] = await Promise.allSettled([
    qr.consumePairing(p.secret, { db, userAgent: UA, now: at(3) }),
    qr.consumePairing(p.secret, { db, userAgent: UA, now: at(3) }),
  ]);
  assert.equal([a, b].filter((r) => r.status === 'fulfilled').length, 1);
  await rejects(qr.consumePairing(p.secret, { db, userAgent: UA, now: at(4) }), 'used');
  // Aprovar de novo depois de usado também não rola.
  await rejects(qr.decidePairing(p.code, 'u1', true, { db, now: at(5) }), 'used');
});

test('o code do QR NÃO troca por sessão (só o segredo do PC)', async () => {
  const db = fakeDb();
  const p = await newPairing(db);
  await qr.scanPairing(p.code, 'u1', { db, now: at(1) });
  await qr.decidePairing(p.code, 'u1', true, { db, now: at(2) });
  await rejects(qr.consumePairing(p.code, { db, userAgent: UA, now: at(3) }), 'invalid');
  await rejects(qr.pollPairing(p.code, { db, now: at(3) }), 'invalid');
});

test('sem aprovação não há sessão; recusado fica recusado', async () => {
  const db = fakeDb();
  const p = await newPairing(db);
  await rejects(qr.consumePairing(p.secret, { db, userAgent: UA, now: at(1) }), 'not_approved');
  await qr.scanPairing(p.code, 'u1', { db, now: at(2) });
  await rejects(qr.consumePairing(p.secret, { db, userAgent: UA, now: at(3) }), 'not_approved');
  await qr.decidePairing(p.code, 'u1', false, { db, now: at(4) });
  assert.equal((await qr.pollPairing(p.secret, { db, now: at(5) })).status, 'DENIED');
  await rejects(qr.consumePairing(p.secret, { db, userAgent: UA, now: at(6) }), 'denied');
  await rejects(qr.decidePairing(p.code, 'u1', true, { db, now: at(7) }), 'denied');
});

test('aprovar exige ter aberto a tela antes (SCANNED) — sem atalho por outro caminho', async () => {
  const db = fakeDb();
  const p = await newPairing(db);
  await rejects(qr.decidePairing(p.code, 'u1', true, { db, now: at(1) }), 'not_scanned');
  assert.equal(db.rows[0].status, 'PENDING');
});

test('quem abriu primeiro trava: outra conta não vê nem aprova', async () => {
  const db = fakeDb();
  const p = await newPairing(db);
  await qr.scanPairing(p.code, 'u1', { db, now: at(1) });
  await rejects(qr.scanPairing(p.code, 'u2', { db, now: at(2) }), 'taken');
  await rejects(qr.decidePairing(p.code, 'u2', true, { db, now: at(2) }), 'taken');
  // A mesma conta pode reabrir o link.
  await qr.scanPairing(p.code, 'u1', { db, now: at(3) });
});

test('expira em 2 minutos (inclusive depois de aprovado)', async () => {
  const db = fakeDb();
  const p = await newPairing(db);
  assert.equal(p.expiresAt.getTime() - T0.getTime(), qr.TTL_MS);
  await qr.scanPairing(p.code, 'u1', { db, now: at(30) });
  await qr.decidePairing(p.code, 'u1', true, { db, now: at(60) });
  assert.equal((await qr.pollPairing(p.secret, { db, now: at(121) })).status, 'EXPIRED');
  await rejects(qr.consumePairing(p.secret, { db, userAgent: UA, now: at(121) }), 'expired');

  const p2 = await newPairing(db);
  await rejects(qr.scanPairing(p2.code, 'u1', { db, now: at(120) }), 'expired');
});

test('troca só no mesmo navegador que pediu', async () => {
  const db = fakeDb();
  const p = await newPairing(db);
  await qr.scanPairing(p.code, 'u1', { db, now: at(1) });
  await qr.decidePairing(p.code, 'u1', true, { db, now: at(2) });
  await rejects(qr.consumePairing(p.secret, { db, userAgent: 'curl/8.0', now: at(3) }), 'device');
  // Continua aprovado pro PC certo.
  assert.equal((await qr.consumePairing(p.secret, { db, userAgent: UA, now: at(4) })).userId, 'u1');
});

test('entradas malformadas não chegam no banco', async () => {
  const db = fakeDb();
  let calls = 0;
  const orig = db.qrLoginPairing.findUnique;
  db.qrLoginPairing.findUnique = async (...a) => { calls += 1; return orig(...a); };
  for (const bad of ['', 'x', null, undefined, { $ne: null }, 'a'.repeat(44), `${'a'.repeat(42)}!`]) {
    // eslint-disable-next-line no-await-in-loop
    await rejects(qr.pollPairing(bad, { db, now: T0 }), 'invalid');
    // eslint-disable-next-line no-await-in-loop
    await rejects(qr.scanPairing(bad, 'u1', { db, now: T0 }), 'invalid');
  }
  assert.equal(calls, 0);
  await rejects(qr.scanPairing('a'.repeat(43), null, { db, now: T0 }), 'invalid');
});
