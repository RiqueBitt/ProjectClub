// Loja: coleção "Fonte Mania" (antes Pixels Galore) com as fontes do manifest, 400 moedas ou 5 gemas.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensurePixelsGalore } = require('../src/services/pixelsGalore');

function stubDb() {
  const items = []; const cols = [];
  return {
    items, cols,
    shopCollection: {
      findFirst: async ({ where }) => cols.find((c) => (where.name?.in ? where.name.in.includes(c.name) : c.name === where.name)) || null,
      update: async ({ where, data }) => Object.assign(cols.find((c) => c.id === where.id), data),
      create: async ({ data }) => { const c = { id: `col${cols.length + 1}`, ...data }; cols.push(c); return c; },
    },
    shopItem: {
      findUnique: async ({ where }) => items.find((i) => i.key === where.key) || null,
      create: async ({ data }) => { items.push(data); return data; },
    },
  };
}

test('cria a coleção e as fontes uma vez só, com o preço pedido', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-'));
  const dir = path.join(root, 'fonts', 'pixels-galore');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'minecraft.otf'), 'x');
  fs.writeFileSync(path.join(dir, 'kiwi-soda.ttf'), 'x');
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify([
    { key: 'minecraft', family: 'Minecraft', file: 'minecraft.otf' },
    { key: 'kiwi-soda', family: 'Kiwi Soda', file: 'kiwi-soda.ttf' },
    { key: 'sumiu', family: 'Sumiu', file: 'sumiu.ttf' }, // arquivo não existe: fica de fora
  ]));
  const db = stubDb();
  const r = await ensurePixelsGalore({ db, roots: [root] });
  assert.equal(r.created, 2);
  assert.equal(db.cols.length, 1);
  assert.equal(db.cols[0].name, 'Fonte Mania');
  for (const it of db.items) {
    assert.equal(it.kind, 'FONT');
    assert.equal(it.priceCoins, 400);
    assert.equal(it.priceGems, 5);
    assert.equal(it.collectionId, db.cols[0].id);
  }
  const kiwi = db.items.find((i) => i.key === 'pixels-galore:kiwi-soda');
  assert.deepEqual(JSON.parse(kiwi.data), { family: 'Kiwi Soda', url: '/fonts/pixels-galore/kiwi-soda.ttf', source: 'file' });
  assert.match(kiwi.description, /CC BY 4\.0/);
  const again = await ensurePixelsGalore({ db, roots: [root] });
  assert.equal(again.created, 0);
  assert.equal(db.items.length, 2);
  assert.equal(db.cols.length, 1);
  assert.equal((await ensurePixelsGalore({ db, roots: [path.join(root, 'nada')] })).created, 0);
});

test('renomeia a coleção antiga "Pixels Galore" pra "Fonte Mania" sem criar outra', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pg2-'));
  const dir = path.join(root, 'fonts', 'pixels-galore');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'balium.ttf'), 'x');
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify([{ key: 'balium', family: 'Balium', file: 'balium.ttf' }]));
  const db = stubDb();
  db.cols.push({ id: 'velha', name: 'Pixels Galore' });
  const r = await ensurePixelsGalore({ db, roots: [root] });
  assert.equal(db.cols.length, 1);
  assert.equal(db.cols[0].name, 'Fonte Mania');
  assert.equal(r.collectionId, 'velha');
  assert.equal(db.items[0].collectionId, 'velha');
  assert.equal(db.items[0].name, 'Balium');
});
