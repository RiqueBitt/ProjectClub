// Preferências do microfone que vão pro engine: volume de entrada (%) →
// ganho e a folga do apertar-pra-falar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { micInputGainFromPrefs, pttReleaseFromPrefs } from '../src/utils/voicePrefs.js';

test('volume de entrada: 0–200% vira ganho 0..2 (padrão 100% = 1)', () => {
  assert.equal(micInputGainFromPrefs({}), 1);
  assert.equal(micInputGainFromPrefs({ inputVolume: 100 }), 1);
  assert.equal(micInputGainFromPrefs({ inputVolume: 150 }), 1.5);
  assert.equal(micInputGainFromPrefs({ inputVolume: 0 }), 0);
  assert.equal(micInputGainFromPrefs({ inputVolume: 999 }), 2);
  assert.equal(micInputGainFromPrefs({ inputVolume: 'x' }), 1);
  assert.equal(micInputGainFromPrefs(null), 1);
});

test('folga do apertar-pra-falar: 0–2000 ms, padrão 200', () => {
  assert.equal(pttReleaseFromPrefs(undefined), 200);
  assert.equal(pttReleaseFromPrefs(null), 200);
  assert.equal(pttReleaseFromPrefs(0), 0);
  assert.equal(pttReleaseFromPrefs(350.4), 350);
  assert.equal(pttReleaseFromPrefs(99999), 2000);
  assert.equal(pttReleaseFromPrefs(-5), 0);
});
