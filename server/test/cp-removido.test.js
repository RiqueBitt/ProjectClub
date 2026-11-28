const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { removeLeftovers, leftoverDirs } = require('../src/services/cpCleanup');

// Club Penguin removido (nov/2026): a mídia antiga some do disco no boot;
// nada fora das pastas do jogo é apagado (as emojis :cp_*: ficam).
test('apaga a pasta da mídia do jogo', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'waddle-'));
  const media = path.join(tmp, 'waddle-media');
  fs.mkdirSync(path.join(media, 'play'), { recursive: true });
  fs.writeFileSync(path.join(media, 'play', 'x.swf'), Buffer.alloc(2048));
  const r = await removeLeftovers({ env: { WADDLE_MEDIA_DIR: media }, log: () => {} });
  assert.equal(fs.existsSync(media), false);
  assert.ok(r.bytes >= 2048);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('não apaga pasta que não é do jogo, mesmo se a variável apontar pra ela', () => {
  const dirs = leftoverDirs({ WADDLE_DATA_DIR: '/', WADDLE_MEDIA_DIR: path.resolve(__dirname, '..') });
  assert.ok(dirs.every((d) => /waddle/.test(d)));
  assert.ok(!dirs.includes('/'));
  assert.ok(!dirs.includes(path.resolve(__dirname, '..')));
});
