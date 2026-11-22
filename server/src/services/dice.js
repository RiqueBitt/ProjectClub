const crypto = require('crypto');

// Rolagem de dados (Atividades → Rolar dados). O sorteio é sempre aqui no
// servidor (crypto.randomInt), nunca no navegador: assim ninguém forja
// resultado. Vale do D2 ao D100, vários tipos de dado na mesma rolagem.
//   pedido:    { groups: [{ sides: 20, count: 2 }, { sides: 6, count: 1 }], modifier: 3, label: 'Ataque' }
//   resultado: { groups: [{ sides, count, results: [..] }], modifier, total, label }

const MIN_SIDES = 2;
const MAX_SIDES = 100;
const MAX_PER_GROUP = 20;
const MAX_DICE = 30;
const MAX_GROUPS = 6;
const MAX_MODIFIER = 999;

function fail(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/** Confere e normaliza o pedido (junta grupos com o mesmo dado). */
function normalize(input = {}) {
  const raw = Array.isArray(input.groups) ? input.groups : [];
  const bySides = new Map();
  for (const g of raw) {
    const sides = Number(g?.sides);
    const count = Number(g?.count ?? 1);
    if (!Number.isInteger(sides) || sides < MIN_SIDES || sides > MAX_SIDES) throw fail(`Os dados vão do D${MIN_SIDES} ao D${MAX_SIDES}.`);
    if (!Number.isInteger(count) || count < 1 || count > MAX_PER_GROUP) throw fail(`Dá pra rolar de 1 a ${MAX_PER_GROUP} dados de cada tipo.`);
    bySides.set(sides, (bySides.get(sides) || 0) + count);
  }
  const groups = [...bySides.entries()].map(([sides, count]) => ({ sides, count }));
  if (!groups.length) throw fail('Escolha pelo menos um dado.');
  if (groups.length > MAX_GROUPS) throw fail(`No máximo ${MAX_GROUPS} tipos de dado por rolagem.`);
  const total = groups.reduce((n, g) => n + g.count, 0);
  if (total > MAX_DICE) throw fail(`No máximo ${MAX_DICE} dados por rolagem.`);
  for (const g of groups) if (g.count > MAX_PER_GROUP) throw fail(`Dá pra rolar de 1 a ${MAX_PER_GROUP} dados de cada tipo.`);
  let modifier = Number(input.modifier || 0);
  if (!Number.isInteger(modifier) || Math.abs(modifier) > MAX_MODIFIER) throw fail(`O bônus vai de -${MAX_MODIFIER} a +${MAX_MODIFIER}.`);
  const label = typeof input.label === 'string' ? input.label.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60) : '';
  return { groups, modifier, label: label || null };
}

/** Rola de verdade. `rand(max)` devolve 0..max-1 (troca nos testes). */
function roll(input, rand = (max) => crypto.randomInt(max)) {
  const spec = normalize(input);
  const groups = spec.groups.map((g) => ({ ...g, results: Array.from({ length: g.count }, () => rand(g.sides) + 1) }));
  const sum = groups.reduce((n, g) => n + g.results.reduce((a, b) => a + b, 0), 0);
  return { groups, modifier: spec.modifier, label: spec.label, total: sum + spec.modifier };
}

/** "2d20 + 1d6 + 3" */
function notation(r) {
  return r.groups.map((g) => `${g.count}d${g.sides}`).join(' + ') + (r.modifier ? ` ${r.modifier > 0 ? '+' : '−'} ${Math.abs(r.modifier)}` : '');
}

module.exports = { normalize, roll, notation, MIN_SIDES, MAX_SIDES, MAX_DICE, MAX_PER_GROUP };
