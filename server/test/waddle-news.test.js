'use strict';
// Jornal do Club Penguin em português: regras de texto (sem SWF real).
const test = require('node:test');
const assert = require('node:assert');
const news = require('../src/services/waddle/news');
const layout = require('../src/services/waddle/news/layout');
const swf = require('../src/services/waddle/news/swf');

const { identity, sanitize } = news._test;

test('jornal: assinaturas e listas de nomes não vão pra IA', () => {
  assert.strictEqual(identity('–Nivi9'), '–Nivi9');
  assert.strictEqual(identity('MISTY2355'), 'MISTY2355');
  assert.ok(identity('Alfs34 Ally78562 Carol8871 Chucker321 Crissycold Dali'));
  assert.strictEqual(identity('Did you know puffles can help you out in games?'), null);
});

test('jornal: limpa a resposta da IA e recusa respostas ruins', () => {
  const seg = { text: 'Read More' };
  assert.strictEqual(sanitize('Tradução: "Leia Mais"', seg), 'Leia Mais');
  assert.strictEqual(sanitize('<think>hmm</think>Leia Mais', seg), 'Leia Mais');
  assert.strictEqual(sanitize('', seg), null);
  assert.strictEqual(sanitize('阅读更多', seg), null);
  assert.strictEqual(sanitize('Did you know puffles can help', { text: 'Did you know puffles can help' }), null);
});

test('jornal: quebra de linha conta palavra maior que a linha', () => {
  const f = layout.fonts().condensed;
  const lines = layout.wrap('PRECISAMOS DE VOCÊ', f, 260, 900);
  assert.ok(lines.length >= 3);
  assert.ok(layout.measure('Ação', layout.fonts().regular, 200) > 0);
});

test('jornal: DefineEditText e fonte montam tags válidas', () => {
  const t = swf.editTextTag({ id: 7, bounds: { xmin: 0, xmax: 2000, ymin: 0, ymax: 400 }, fontId: 9, height: 240, color: 0x333333, text: '<p>Olá</p>' });
  assert.strictEqual(t.code, 37);
  assert.strictEqual(t.body.readUInt16LE(0), 7);
  const f = swf.fontTag(layout.fonts().regular.body, 42);
  assert.strictEqual(f.body.readUInt16LE(0), 42);
  assert.ok(f.body.includes(Buffer.from('PC Proxima Regular')));
});
