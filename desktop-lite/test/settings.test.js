// node --test desktop-lite/test/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSettings } = require('../settings');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pc-lite-'));

test('começa com a placa de vídeo ligada (automático)', () => {
  const s = createSettings(tmp());
  assert.equal(s.get('gpu'), null);
  assert.equal(s.useGpu(), true);
});

test('desliga a placa de vídeo sozinho depois de 2 travadas', () => {
  const dir = tmp();
  const s = createSettings(dir);
  s.noteGpuCrash();
  assert.equal(s.useGpu(), true);
  s.noteGpuCrash();
  assert.equal(s.useGpu(), false);
  // Vale na próxima abertura também (fica salvo).
  assert.equal(createSettings(dir).useGpu(), false);
});

test('escolha manual vence o automático', () => {
  const s = createSettings(tmp());
  s.noteGpuCrash(); s.noteGpuCrash();
  s.set('gpu', true);
  assert.equal(s.useGpu(), true);
  s.set('gpu', false);
  assert.equal(s.useGpu(), false);
});

test('arquivo estragado não derruba o app', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'lite-settings.json'), '{ isso não é json');
  assert.equal(createSettings(dir).useGpu(), true);
});
