const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { removeLeftovers, leftoverDirs } = require('../src/services/cpCleanup');

// Club Penguin removido (nov/2026): a mídia antiga some do disco no boot e as
// emojis :cp_*: saem do banco; nada fora das pastas do jogo é apagado.
test('apaga a pasta da mídia do jogo e as emojis :cp_*:', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'waddle-'));
  const media = path.join(tmp, 'waddle-media');
  fs.mkdirSync(path.join(media, 'play'), { recursive: true });
  fs.writeFileSync(path.join(media, 'play', 'x.swf'), Buffer.alloc(2048));
  const deleted = [];
  const db = {
    assetCollection: { findFirst: async () => ({ id: 'col1' }), delete: async ({ where }) => deleted.push(where.id) },
    emoji: { deleteMany: async ({ where }) => { assert.equal(where.url.startsWith, '/emoji-sets/clubpenguin/'); return { count: 18 }; } },
  };
  const r = await removeLeftovers({ env: { WADDLE_MEDIA_DIR: media }, db, log: () => {} });
  assert.equal(fs.existsSync(media), false);
  assert.ok(r.bytes >= 2048);
  assert.equal(r.emojis, 18);
  assert.deepEqual(deleted, ['col1']);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('não apaga pasta que não é do jogo, mesmo se a variável apontar pra ela', () => {
  const dirs = leftoverDirs({ WADDLE_DATA_DIR: '/', WADDLE_MEDIA_DIR: path.resolve(__dirname, '..') });
  assert.ok(dirs.every((d) => /waddle/.test(d)));
  assert.ok(!dirs.includes('/'));
  assert.ok(!dirs.includes(path.resolve(__dirname, '..')));
});
