// color-mix() pra navegador antigo (Project Club Lite / Electron 22).
//   node --test client/test/legacyColorMix.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convert, parseColor, resolveVars, mixValue } from '../src/utils/legacyColorMix.js';

const vars = { '--brand': '#4C9FFF', '--bg': '#313338', '--deep': 'var(--bg)', '--a': 'rgba(0, 0, 0, .5)' };
const lookup = (n) => vars[n] || '';

test('lê as cores mais comuns', () => {
  assert.deepEqual(parseColor('#fff'), [255, 255, 255, 1]);
  assert.deepEqual(parseColor('#4C9FFF'), [76, 159, 255, 1]);
  assert.deepEqual(parseColor('rgba(10, 20, 30, .5)'), [10, 20, 30, 0.5]);
  assert.deepEqual(parseColor('rgb(10 20 30 / 50%)'), [10, 20, 30, 0.5]);
  assert.deepEqual(parseColor('transparent'), [0, 0, 0, 0]);
});

test('troca var() em várias camadas, com reserva', () => {
  assert.equal(resolveVars('var(--deep)', lookup), '#313338');
  assert.equal(resolveVars('var(--nada, #fff)', lookup), '#fff');
  assert.equal(resolveVars('var(--nada)', lookup), null);
});

test('mistura com transparent só deixa mais transparente (sem escurecer)', () => {
  assert.equal(mixValue('in srgb, #4C9FFF 20%, transparent', lookup), 'rgba(76, 159, 255, 0.2)');
});

test('mistura duas cores', () => {
  assert.equal(mixValue('in srgb, #000 50%, #fff', lookup), 'rgb(128, 128, 128)');
  assert.equal(mixValue('in srgb, #fff, #000', lookup), 'rgb(128, 128, 128)');
});

test('converte o CSS inteiro, com variáveis e color-mix dentro de color-mix', () => {
  const css = '.a{background:color-mix(in srgb, var(--brand) 85%, #fff);color:red}.b{border-color:color-mix(in srgb,color-mix(in srgb, var(--bg) 50%, #000) 50%, transparent)}';
  const out = convert(css, lookup);
  assert.ok(!out.includes('color-mix('), out);
  assert.match(out, /\.a\{background:rgb\(103, 173, 255\);color:red\}/);
  assert.match(out, /\.b\{border-color:rgba\(25, 26, 28, 0\.5\)\}/);
});

test('sem como calcular (variável de componente): deixa como estava', () => {
  const css = '.x{color:color-mix(in srgb, var(--local) 50%, #fff)}';
  assert.equal(convert(css, lookup), css);
});
