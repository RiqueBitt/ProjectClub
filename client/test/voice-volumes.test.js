// Volume por pessoa: conversão entre o cache local (0..2) e a conta (0..200)
// e a mescla ao entrar na conta.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gainToPercent, percentToGain, cleanLocalVolumes, mergeVolumesOnLogin, capLocal, toServerPatch,
} from '../src/utils/voiceVolumes.js';

test('conversões ficam dentro da faixa', () => {
  assert.equal(gainToPercent(1.234), 123);
  assert.equal(gainToPercent(5), 200);
  assert.equal(gainToPercent(-1), 0);
  assert.equal(gainToPercent('x'), 100);
  assert.equal(percentToGain(150), 1.5);
  assert.equal(percentToGain(999), 2);
});

test('cleanLocalVolumes descarta lixo do localStorage', () => {
  assert.deepEqual(cleanLocalVolumes({ a: 1.5, b: 'x', 'c d': 1, e: 9 }), { a: 1.5, e: 2 });
  assert.deepEqual(cleanLocalVolumes(null), {});
  assert.deepEqual(cleanLocalVolumes([1]), {});
});

test('mergeVolumesOnLogin: a conta vence; o que só existe aqui sobe', () => {
  const { merged, patch } = mergeVolumesOnLogin({ a: 0.5, b: 1.8, c: 1 }, { a: 120, d: 40 });
  assert.deepEqual(merged, { a: 1.2, b: 1.8, c: 1, d: 0.4 });
  assert.deepEqual(patch, { b: 180 }, 'c está em 100% e não precisa subir');
});

test('capLocal e toServerPatch', () => {
  assert.deepEqual(Object.keys(capLocal({ a: 1, b: 1, c: 1 }, 2)), ['b', 'c']);
  assert.deepEqual(toServerPatch({ a: 1, b: 0.25, 'x y': 2 }), { a: null, b: 25 });
});
