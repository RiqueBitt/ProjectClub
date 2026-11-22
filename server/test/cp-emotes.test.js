// Emojis do Club Penguin: cria a coleção e os :cp_*: que faltam, sem duplicar.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureCpEmotes } = require('../src/services/cpEmotes');

function stubDb() {
  const emojis = [{ name: 'cp_coffee', url: '/x.png' }];
  const collections = [];
  return {
    emojis, collections,
    user: { findFirst: async () => ({ id: 'admin' }) },
    assetCollection: {
      findFirst: async ({ where }) => collections.find((c) => c.kind === where.kind && c.name === where.name) || null,
      create: async ({ data }) => { const c = { id: `c${collections.length + 1}`, ...data }; collections.push(c); return c; },
    },
    emoji: {
      findMany: async ({ where }) => emojis.filter((e) => where.name.in.includes(e.name)),
      count: async () => emojis.length,
      create: async ({ data }) => { emojis.push(data); return data; },
    },
  };
}

test('emojis do Club Penguin: coleção + emojis do manifest, uma vez só', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpemo-'));
  fs.mkdirSync(path.join(root, 'emoji-sets', 'clubpenguin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'emoji-sets', 'clubpenguin', 'manifest.json'), JSON.stringify([
    { name: 'cp_coffee', file: 'cp_coffee.png' },
    { name: 'cp_happy_face', file: 'cp_happy_face.png' },
    { name: 'invalido!', file: 'x.png' },
    { name: 'cp_pizza', file: '../fora.png' },
  ]));
  const db = stubDb();
  const r = await ensureCpEmotes({ db, roots: [root] });
  assert.equal(r.created, 1);
  assert.equal(db.collections.length, 1);
  assert.equal(db.collections[0].name, 'Club Penguin');
  const happy = db.emojis.find((e) => e.name === 'cp_happy_face');
  assert.equal(happy.url, '/emoji-sets/clubpenguin/cp_happy_face.png');
  assert.equal(happy.collectionId, db.collections[0].id);
  const again = await ensureCpEmotes({ db, roots: [root] });
  assert.equal(again.created, 0);
  assert.equal(db.collections.length, 1);
  assert.deepEqual(await ensureCpEmotes({ db, roots: [path.join(root, 'nada')] }), { created: 0, skipped: 'sem manifest' });
});
