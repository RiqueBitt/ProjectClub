// Teste do helper de progresso de atualização (node --test).
//   node --test client/src/utils/updateProgress.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePercent, updateDisplay } from './updateProgress.js';

test('normalizePercent mapeia e limita', () => {
  assert.equal(normalizePercent(0), 0);
  assert.equal(normalizePercent(42.7), 43);
  assert.equal(normalizePercent(99.4), 99);
  assert.equal(normalizePercent(100), 100);
  assert.equal(normalizePercent(150), 100); // limita em 100
  assert.equal(normalizePercent(-5), 0); // limita em 0
  assert.equal(normalizePercent(undefined), 0);
  assert.equal(normalizePercent('nan'), 0);
});

test('idle quando ninguém clicou', () => {
  const d = updateDisplay({ status: { available: true, percent: 0 }, working: false });
  assert.equal(d.mode, 'idle');
  assert.equal(d.indeterminate, false);
});

test('baixando sem progresso ainda = indeterminado (não 0% congelado)', () => {
  const d = updateDisplay({ status: { downloading: true, percent: 0 }, working: true, lastProgressAt: 0, now: 1000 });
  assert.equal(d.mode, 'downloading');
  assert.equal(d.indeterminate, true);
});

test('baixando com progresso real = porcentagem determinada', () => {
  const d = updateDisplay({ status: { downloading: true, percent: 55 }, working: true, lastProgressAt: 900, now: 1000, stallMs: 4000 });
  assert.equal(d.mode, 'downloading');
  assert.equal(d.indeterminate, false);
  assert.equal(d.percent, 55);
});

test('progresso travado por alguns segundos = volta pra indeterminado', () => {
  const d = updateDisplay({ status: { downloading: true, percent: 40 }, working: true, lastProgressAt: 1000, now: 6000, stallMs: 4000 });
  assert.equal(d.indeterminate, true);
  assert.equal(d.percent, 40);
});

test('baixado = pronto em 100%', () => {
  const d = updateDisplay({ status: { downloaded: true, percent: 100 }, working: true });
  assert.equal(d.mode, 'ready');
  assert.equal(d.percent, 100);
});

test('erro enquanto trabalhando = estado de erro', () => {
  const d = updateDisplay({ status: { downloading: false, percent: 0, error: 'sem internet' }, working: true });
  assert.equal(d.mode, 'error');
  assert.equal(d.error, 'sem internet');
});
