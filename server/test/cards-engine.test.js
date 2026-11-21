const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
// O serviço importa o prisma; aqui só testamos funções puras.
require.cache[path.resolve(__dirname, '../src/config/prisma.js')] = { exports: {}, loaded: true, id: 'prisma' };
const { createGame, reduce, viewFor } = require('../src/cards/engine');
const { playTurn } = require('../src/cards/ai');
const { DEFAULT_SETTINGS } = require('../src/cards/config');
const { SEED_CARDS } = require('../src/cards/seed');
const S = require('../src/cards/service');

const cards = SEED_CARDS.map((c, i) => ({ ...c, id: `c${i}`, enabled: true }));
const deck = (off = 0) => Array.from({ length: 20 }, (_, i) => ({ card: cards[(i * 5 + off) % cards.length], level: 1 }));
const rules = DEFAULT_SETTINGS.rules;
const game = (seed = 1) => createGame({ players: [{ name: 'A', userId: 'a', deck: deck() }, { name: 'B', userId: 'b', deck: deck(3) }], rules, seed, first: 0 });

test('estado inicial: mãos, energia e informação oculta', () => {
  const st = game();
  assert.equal(st.players[0].hand.length, rules.startHand + 1); // comprou no início do turno
  assert.equal(st.players[1].hand.length, rules.startHand + 1); // compensação de quem joga depois
  assert.equal(st.players[0].energy, 1);
  const v = viewFor(st, 0);
  assert.equal(v.foe.hand, undefined);
  assert.ok(v.me.hand.length > 0);
  assert.equal(v.me.deck, undefined);
});

test('ações ilegais são recusadas pelo motor', () => {
  const st = game();
  assert.throws(() => reduce(st, 1, { type: 'END_TURN' }), /vez/);
  assert.throws(() => reduce(st, 0, { type: 'PLAY', uid: 'nope' }), /mão/);
  const expensive = st.players[0].hand.find((c) => c.cost > 1);
  if (expensive) assert.throws(() => reduce(st, 0, { type: 'PLAY', uid: expensive.uid }), /Energia/);
  assert.throws(() => reduce(st, 0, { type: 'HACK' }), /desconhecida/);
});

test('reduce não muta o estado anterior e é determinístico', () => {
  const a = game(42); const b = game(42);
  assert.deepEqual(a, b);
  const before = JSON.stringify(a);
  reduce(a, 0, { type: 'END_TURN' });
  assert.equal(JSON.stringify(a), before);
});

test('Guarda obriga a atacar a unidade com Guarda', () => {
  let st = game(7);
  const me = st.players[0]; const foe = st.players[1];
  me.board.push({ uid: 'x1', cardId: 'c', name: 'Atk', element: 'FOGO', rarity: 'COMUM', cost: 1, atk: 3, hp: 3, maxHp: 3, ability: 'NONE', value: 0, attacksLeft: 1, sick: false });
  foe.board.push({ uid: 'g1', cardId: 'c', name: 'Guard', element: 'AGUA', rarity: 'COMUM', cost: 1, atk: 1, hp: 5, maxHp: 5, ability: 'GUARDA', value: 0, attacksLeft: 0, sick: false });
  assert.throws(() => reduce(st, 0, { type: 'ATTACK', uid: 'x1', target: 'hero' }), /Guarda/);
  const r = reduce(st, 0, { type: 'ATTACK', uid: 'x1', target: 'g1' });
  // Fogo vs Água: Água vence Fogo, então o atacante não ganha bônus.
  assert.equal(r.state.players[1].board[0].hp, 2);
  st = r.state;
  assert.throws(() => reduce(st, 0, { type: 'ATTACK', uid: 'x1', target: 'g1' }), /não pode atacar/);
});

test('partidas entre bots sempre terminam', () => {
  for (let g = 0; g < 20; g += 1) {
    let st = createGame({ players: [{ name: 'A', isBot: true, deck: deck(g) }, { name: 'B', isBot: true, deck: deck(g + 2) }], rules, seed: g + 1, first: g % 2 });
    let n = 0;
    while (!st.over && n < 300) { st = playTurn(st, st.active, 'DIFICIL').state; n += 1; }
    assert.ok(st.over, `partida ${g} não terminou`);
  }
});

test('validação de baralho usa a coleção real', () => {
  const catalog = { byId: new Map(cards.map((c) => [c.id, c])) };
  const owned = new Map([[cards[0].id, { quantity: 1, level: 1 }]]);
  const v = S.validateDeck([{ cardId: cards[0].id, copies: 2 }], owned, catalog, rules);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /só tem 1x/.test(e)));
  const many = new Map(cards.map((c) => [c.id, { quantity: 3, level: 1 }]));
  const auto = S.autoDeck(many, { byId: catalog.byId }, rules);
  assert.equal(S.validateDeck(auto, many, catalog, rules).ok, true);
});

test('pacote respeita raridade garantida e o pool', () => {
  const catalog = { enabled: cards };
  const pack = { cardsPerPack: 5, weights: JSON.stringify({ COMUM: 100 }), guaranteed: 'RARA', poolMode: 'ALL' };
  for (let i = 0; i < 50; i += 1) {
    const out = S.drawPack(pack, catalog);
    assert.equal(out.length, 5);
    assert.ok(out.some((c) => S.rankOf(c.rarity) >= S.rankOf('RARA')));
  }
});
