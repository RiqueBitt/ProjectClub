'use strict';
// Festas de 2013-2017: rodízio de anos e festas de outras marcas só pela staff.
const test = require('node:test');
const assert = require('node:assert');
const parties = require('../src/services/waddle/parties');

parties._setFileCheck(() => true); // finge que os arquivos estão no disco

test('festas: cada mês usa um ano diferente (jan-mar inclui 2017)', () => {
  assert.strictEqual(parties.rotationYear(new Date(2026, 10, 5)), 2014);
  assert.strictEqual(parties.rotationYear(new Date(2026, 11, 5)), 2015);
  const jan = new Set();
  for (let y = 2026; y < 2034; y++) jan.add(parties.rotationYear(new Date(y, 0, 10)));
  assert.ok(jan.has(2017), 'janeiro também passa por 2017');
});

test('festas: festa que vira o ano (dez→jan) cobre os dois lados', () => {
  const p = { start: '12-19', end: '01-02' };
  assert.ok(parties.covers(p, '12-25'));
  assert.ok(parties.covers(p, '01-01'));
  assert.ok(!parties.covers(p, '01-03'));
});

test('festas: no rodízio entram só as do Club Penguin', () => {
  for (let y = 2026; y < 2031; y++) {
    for (let m = 0; m < 12; m++) {
      for (const d of [1, 8, 15, 22, 28]) {
        const w = parties.wanted(new Date(y, m, d));
        if (!w) continue;
        for (const slug of w.slugs) {
          const p = parties._data.parties.find((x) => x.slug === slug);
          assert.ok(!p.licensed, `${slug} é de outra marca e entrou no rodízio`);
          assert.ok(Object.keys(p.rooms).length > 0);
        }
      }
    }
  }
});

test('festas: hoje (5/11/2026) é a Festa de Halloween 2014', () => {
  const w = parties.wanted(new Date(2026, 10, 5, 12));
  assert.deepStrictEqual(w && w.slugs, ['Halloween_Party_2014']);
});

test('festas: Halloween e aniversário do mesmo ano entram juntos (principal = a mais longa)', () => {
  // 2014: Halloween 23/10-05/11 e 9º aniversário 23/10-29/10 — out/2026 cai em 2013
  let found = null;
  for (let y = 2026; y < 2040 && !found; y++) {
    const w = parties.wanted(new Date(y, 9, 25, 12));
    if (w && w.slugs.length > 1) found = w;
  }
  assert.ok(found, 'algum ano com duas festas juntas');
  assert.match(found.slugs[0], /Halloween/);
  const m = parties.merged(found.slugs);
  assert.ok(Object.keys(m.rooms).length >= Object.keys(parties._data.parties.find((p) => p.slug === found.slugs[0]).rooms).length);
});
