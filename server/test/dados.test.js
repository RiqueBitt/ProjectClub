// Rolagem de dados: D2 a D100, vários dados, bônus, limites e sorteio no servidor.
const test = require('node:test');
const assert = require('node:assert');
const dice = require('../src/services/dice');

test('rola cada dado entre 1 e o número de lados e soma o bônus', () => {
  for (let i = 0; i < 200; i += 1) {
    const r = dice.roll({ groups: [{ sides: 2, count: 3 }, { sides: 100, count: 2 }, { sides: 7, count: 1 }], modifier: -4 });
    const d2 = r.groups.find((g) => g.sides === 2);
    const d100 = r.groups.find((g) => g.sides === 100);
    assert.equal(d2.results.length, 3);
    assert.ok(d2.results.every((n) => n >= 1 && n <= 2));
    assert.ok(d100.results.every((n) => n >= 1 && n <= 100));
    const sum = r.groups.flatMap((g) => g.results).reduce((a, b) => a + b, 0);
    assert.equal(r.total, sum - 4);
  }
});

test('junta dados iguais e escreve a notação', () => {
  const r = dice.roll({ groups: [{ sides: 20, count: 1 }, { sides: 20, count: 1 }, { sides: 6 }], modifier: 3, label: '  Ataque  ' }, (max) => max - 1);
  assert.deepEqual(r.groups.map((g) => [g.sides, g.count]), [[20, 2], [6, 1]]);
  assert.deepEqual(r.groups[0].results, [20, 20]);
  assert.equal(r.total, 20 + 20 + 6 + 3);
  assert.equal(r.label, 'Ataque');
  assert.equal(dice.notation(r), '2d20 + 1d6 + 3');
  assert.equal(dice.notation({ ...r, modifier: -2 }), '2d20 + 1d6 − 2');
});

test('recusa pedidos fora dos limites', () => {
  for (const bad of [
    { groups: [] },
    { groups: [{ sides: 1 }] },
    { groups: [{ sides: 101 }] },
    { groups: [{ sides: 6, count: 0 }] },
    { groups: [{ sides: 6, count: 21 }] },
    { groups: [{ sides: 6, count: 15 }, { sides: 8, count: 16 }] },
    { groups: [{ sides: 6, count: 12 }, { sides: 6, count: 12 }] },
    { groups: [2, 3, 4, 5, 6, 7, 8].map((s) => ({ sides: s })) },
    { groups: [{ sides: 6 }], modifier: 1000 },
    { groups: [{ sides: 6.5 }] },
  ]) assert.throws(() => dice.roll(bad), (e) => e.status === 400, JSON.stringify(bad));
});
