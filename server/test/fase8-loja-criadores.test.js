// Fase 8 — Loja dos criadores (services/creatorShop.js).
const test = require('node:test');
const assert = require('node:assert');
const shop = require('../src/services/creatorShop');

const staff = { id: 'staff', platformRole: 'MODERATOR' };
const member = { id: 'm1', platformRole: 'USER' };
const noLedger = () => ({ recordTransaction: () => null });

function fakeDb() {
  const st = {
    users: new Map([['criador', { id: 'criador', coins: 0, displayName: 'Criador' }], ['comprador', { id: 'comprador', coins: 300, displayName: 'Comprador' }], ['pobre', { id: 'pobre', coins: 5 }]]),
    items: new Map(), purchases: [], reports: [], emojis: [], decos: new Map(), ownDeco: [], collections: [],
  };
  let seq = 0;
  const match = (row, where = {}) => Object.entries(where).every(([k, v]) => {
    if (k === 'NOT') return !match(row, v);
    if (k === 'OR') return v.some((w) => match(row, w));
    if (v && typeof v === 'object' && 'in' in v) return v.in.includes(row[k]);
    if (v && typeof v === 'object' && 'gte' in v) return row[k] >= v.gte;
    return row[k] === v;
  });
  const apply = (row, data) => { for (const [k, v] of Object.entries(data)) row[k] = v?.increment !== undefined ? row[k] + v.increment : v?.decrement !== undefined ? row[k] - v.decrement : v; };
  const db = {
    st,
    user: {
      findUnique: async ({ where }) => (st.users.get(where.id) ? { ...st.users.get(where.id) } : null),
      findMany: async ({ where }) => [...st.users.values()].filter((u) => (where.id?.in ? where.id.in.includes(u.id) : true)),
      updateMany: async ({ where, data }) => {
        const u = st.users.get(where.id);
        if (!u || (where.coins?.gte !== undefined && u.coins < where.coins.gte)) return { count: 0 };
        apply(u, data); return { count: 1 };
      },
    },
    emoji: { findUnique: async ({ where }) => st.emojis.find((e) => e.name === where.name) || null },
    creatorItem: {
      count: async ({ where }) => [...st.items.values()].filter((i) => match(i, where)).length,
      findFirst: async ({ where }) => [...st.items.values()].find((i) => match(i, { ...where, status: undefined }) && where.status.in.includes(i.status)) || null,
      findMany: async ({ where }) => [...st.items.values()].filter((i) => match(i, where)),
      findUnique: async ({ where }) => (st.items.get(where.id) ? { ...st.items.get(where.id) } : null),
      create: async ({ data }) => { const row = { id: `i${seq += 1}`, status: 'PENDING', sales: 0, earnings: 0, decorationId: null, createdAt: new Date(), ...data }; st.items.set(row.id, row); return { ...row }; },
      update: async ({ where, data }) => { const row = st.items.get(where.id); apply(row, data); return { ...row }; },
      delete: async ({ where }) => st.items.delete(where.id),
    },
    creatorPurchase: {
      findUnique: async ({ where }) => st.purchases.find((p) => p.itemId === where.itemId_buyerId.itemId && p.buyerId === where.itemId_buyerId.buyerId) || null,
      findMany: async ({ where }) => st.purchases.filter((p) => p.buyerId === where.buyerId),
      create: async ({ data }) => {
        if (st.purchases.some((p) => p.itemId === data.itemId && p.buyerId === data.buyerId)) { const e = new Error('dup'); e.code = 'P2002'; throw e; }
        st.purchases.push(data); return data;
      },
    },
    creatorItemReport: {
      create: async ({ data }) => {
        if (st.reports.some((r) => r.itemId === data.itemId && r.reporterId === data.reporterId)) { const e = new Error('dup'); e.code = 'P2002'; throw e; }
        st.reports.push({ ...data, status: 'OPEN' }); return data;
      },
      updateMany: async ({ where, data }) => { st.reports.filter((r) => r.itemId === where.itemId).forEach((r) => Object.assign(r, data)); return { count: 1 }; },
    },
    shopCollection: {
      findFirst: async () => st.collections[0] || null,
      create: async ({ data }) => { const c = { id: 'col1', ...data }; st.collections.push(c); return c; },
    },
    avatarDecoration: {
      create: async ({ data }) => { const d = { id: `d${seq += 1}`, ...data }; st.decos.set(d.id, d); return d; },
      delete: async ({ where }) => st.decos.delete(where.id),
    },
    userAvatarDecoration: {
      upsert: async ({ create }) => { if (!st.ownDeco.some((o) => o.userId === create.userId && o.decorationId === create.decorationId)) st.ownDeco.push(create); return create; },
    },
    $transaction: async (fn) => {
      // "Rollback" simples: guarda cópia e restaura se der erro.
      const snap = JSON.stringify({ u: [...st.users], i: [...st.items], p: st.purchases, o: st.ownDeco });
      try { return await fn(db); } catch (err) {
        const s = JSON.parse(snap);
        st.users = new Map(s.u); st.items = new Map(s.i); st.purchases = s.p; st.ownDeco = s.o;
        throw err;
      }
    },
  };
  return db;
}
const file = (over = {}) => ({ url: '/uploads/x.png', mimetype: 'image/png', size: 1000, ...over });

test('taxa da plataforma: 10% arredondado pra cima', () => {
  assert.deepEqual(shop.computeFee(100), { price: 100, fee: 10, creatorShare: 90 });
  assert.deepEqual(shop.computeFee(15), { price: 15, fee: 2, creatorShare: 13 });
  assert.deepEqual(shop.computeFee(10), { price: 10, fee: 1, creatorShare: 9 });
});

test('envio: valida tipo, nome, preço, formato e tamanho', () => {
  assert.throws(() => shop.validateSubmission({ kind: 'CARRO', name: 'x', price: 50, file: file() }), /Tipo/);
  assert.throws(() => shop.validateSubmission({ kind: 'EMOJI', name: 'a', price: 50, file: file() }), /emoji/);
  assert.throws(() => shop.validateSubmission({ kind: 'EMOJI', name: 'gato', price: 5, file: file() }), /preço/);
  assert.throws(() => shop.validateSubmission({ kind: 'EMOJI', name: 'gato', price: 50.5, file: file() }), /preço/);
  assert.throws(() => shop.validateSubmission({ kind: 'STICKER', name: 'Gato', price: 50, file: file({ mimetype: 'image/svg+xml' }) }), /Formato/);
  assert.throws(() => shop.validateSubmission({ kind: 'EMOJI', name: 'gato', price: 50, file: file({ size: 600 * 1024 }) }), (e) => e.code === 'TOO_BIG');
  assert.throws(() => shop.validateSubmission({ kind: 'FRAME', name: 'Moldura', price: 50 }), /imagem/);
  const ok = shop.validateSubmission({ kind: 'emoji', name: 'Gato Feliz', price: '50', file: file() });
  assert.deepEqual(ok, { kind: 'EMOJI', name: 'gato_feliz', price: 50, description: null });
});

test('limite de envios pendentes e nome de emoji único', async () => {
  const db = fakeDb();
  db.st.emojis.push({ name: 'oficial' });
  await assert.rejects(shop.submit('criador', { kind: 'EMOJI', name: 'oficial', price: 20 }, file(), { db }), (e) => e.code === 'NAME_TAKEN');
  for (let i = 0; i < shop.MAX_PENDING; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await shop.submit('criador', { kind: 'STICKER', name: `Fig ${i}`, price: 20 }, file(), { db });
  }
  await assert.rejects(shop.submit('criador', { kind: 'STICKER', name: 'Mais uma', price: 20 }, file(), { db }), (e) => e.code === 'TOO_MANY_PENDING');
});

test('aprovação: só equipe, recusa exige motivo, moldura vira decoração oculta', async () => {
  const db = fakeDb();
  const notes = [];
  const notify = async (uid, n) => notes.push([uid, n.kind]);
  const frame = await shop.submit('criador', { kind: 'FRAME', name: 'Moldura Gelo', price: 100 }, file(), { db });
  await assert.rejects(shop.review(member, frame.id, { approve: true }, { db }), (e) => e.code === 'FORBIDDEN');
  const approved = await shop.review(staff, frame.id, { approve: true }, { db, notify });
  assert.equal(approved.status, 'APPROVED');
  assert.ok(approved.decorationId);
  assert.equal(db.st.decos.get(approved.decorationId).collectionId, 'col1');
  assert.equal(db.st.collections[0].showInShop, false);
  assert.ok(db.st.ownDeco.some((o) => o.userId === 'criador')); // o criador usa a própria moldura
  await assert.rejects(shop.review(staff, frame.id, { approve: true }, { db }), (e) => e.code === 'NOT_PENDING');

  const sticker = await shop.submit('criador', { kind: 'STICKER', name: 'Feia', price: 20 }, file(), { db });
  await assert.rejects(shop.review(staff, sticker.id, { approve: false, reason: '' }, { db }), /motivo/);
  const rejected = await shop.review(staff, sticker.id, { approve: false, reason: 'Imagem com marca d\'água' }, { db, notify });
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(rejected.rejectReason, 'Imagem com marca d\'água');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(notes.map((n) => n[1]), ['CREATOR_APPROVED', 'CREATOR_REJECTED']);
});

test('compra: paga, criador recebe menos a taxa, não compra a própria nem duas vezes', async () => {
  const db = fakeDb();
  const frame = await shop.submit('criador', { kind: 'FRAME', name: 'Moldura', price: 100 }, file(), { db });
  const pending = await shop.submit('criador', { kind: 'EMOJI', name: 'pinguim', price: 50 }, file(), { db });
  await assert.rejects(shop.buy('comprador', pending.id, { db, ledger: noLedger }), (e) => e.code === 'NOT_FOUND'); // ainda não aprovado
  const ok = await shop.review(staff, frame.id, { approve: true }, { db });

  await assert.rejects(shop.buy('criador', frame.id, { db, ledger: noLedger }), (e) => e.code === 'OWN_ITEM');
  await assert.rejects(shop.buy('pobre', frame.id, { db, ledger: noLedger }), (e) => e.code === 'NO_COINS');
  assert.equal(db.st.users.get('pobre').coins, 5);

  const r = await shop.buy('comprador', frame.id, { db, ledger: noLedger });
  assert.equal(r.fee, 10);
  assert.equal(db.st.users.get('comprador').coins, 200);
  assert.equal(db.st.users.get('criador').coins, 90);
  assert.equal(db.st.items.get(frame.id).sales, 1);
  assert.equal(db.st.items.get(frame.id).earnings, 90);
  assert.ok(db.st.ownDeco.some((o) => o.userId === 'comprador' && o.decorationId === ok.decorationId));

  await assert.rejects(shop.buy('comprador', frame.id, { db, ledger: noLedger }), (e) => e.code === 'ALREADY_OWNED');
  assert.equal(db.st.users.get('comprador').coins, 200); // nada cobrado de novo
});

test('emojis/figurinhas comprados ficam usáveis; removido some', async () => {
  const db = fakeDb();
  const emoji = await shop.submit('criador', { kind: 'EMOJI', name: 'pinguim_feliz', price: 30 }, file({ url: '/uploads/e.png' }), { db });
  await shop.review(staff, emoji.id, { approve: true }, { db });
  assert.deepEqual(await shop.usableEmojisFor('comprador', { db }), []);
  await shop.buy('comprador', emoji.id, { db, ledger: noLedger });
  const usable = await shop.usableEmojisFor('comprador', { db });
  assert.equal(usable[0].name, 'pinguim_feliz');
  assert.equal(usable[0].url, '/uploads/e.png');
  assert.equal((await shop.usableEmojisFor('criador', { db })).length, 1); // o criador também usa o dele
  assert.deepEqual(await shop.publicEmojiMap({ db }), [{ name: 'pinguim_feliz', url: '/uploads/e.png' }]);

  await shop.report('comprador', emoji.id, 'Imagem ofensiva', { db });
  await assert.rejects(shop.report('comprador', emoji.id, 'De novo', { db }), (e) => e.code === 'ALREADY_REPORTED');
  await assert.rejects(shop.removeItem(member, emoji.id, {}, { db }), (e) => e.code === 'FORBIDDEN');
  await shop.removeItem(staff, emoji.id, { reason: 'Denúncia procedente' }, { db });
  assert.equal(db.st.items.get(emoji.id).status, 'REMOVED');
  assert.equal(db.st.reports[0].status, 'RESOLVED');
  assert.deepEqual(await shop.usableEmojisFor('comprador', { db }), []);
  await assert.rejects(shop.buy('pobre', emoji.id, { db, ledger: noLedger }), (e) => e.code === 'NOT_FOUND');
});
