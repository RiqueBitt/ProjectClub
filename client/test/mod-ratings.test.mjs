// Avaliações de mods (Fase 7): formatação e helpers puros do cliente.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAverage, formatRatingCount, starFills, tileRatingLabel, reviewLength, reviewTooLong, distributionBars, REVIEW_MAX,
} from '../src/pages/mods/ratings.js';

test('média: vírgula e uma casa; sem avaliações = null', () => {
  assert.equal(formatAverage(4.25, 3), '4,3');
  assert.equal(formatAverage(5, 1), '5,0');
  assert.equal(formatAverage(null, 0), null);
  assert.equal(formatAverage(4, 0), null);
});

test('quantidade: singular/plural e milhar', () => {
  assert.equal(formatRatingCount(1), '1 avaliação');
  assert.equal(formatRatingCount(0), '0 avaliações');
  assert.equal(formatRatingCount(12), '12 avaliações');
  assert.equal(formatRatingCount(1250), '1,3 mil avaliações');
});

test('estrelas: meia estrela arredondada', () => {
  assert.deepEqual(starFills(4.3), [1, 1, 1, 1, 0.5]);
  assert.deepEqual(starFills(4.2), [1, 1, 1, 1, 0]);
  assert.deepEqual(starFills(0), [0, 0, 0, 0, 0]);
  assert.deepEqual(starFills(9), [1, 1, 1, 1, 1]);
});

test('cartão: rótulo só com avaliações', () => {
  assert.equal(tileRatingLabel({ average: 4.25, count: 12 }), '4,3 (12)');
  assert.equal(tileRatingLabel({ average: 3, count: 2500 }), '3,0 (2 mil)');
  assert.equal(tileRatingLabel({ average: null, count: 0 }), null);
  assert.equal(tileRatingLabel(undefined), null);
});

test('texto: limite de 500 contando emoji como 1', () => {
  assert.equal(reviewLength('  oi  '), 2);
  assert.equal(reviewTooLong('😀'.repeat(REVIEW_MAX)), false);
  assert.equal(reviewTooLong('x'.repeat(REVIEW_MAX + 1)), true);
});

test('distribuição: porcentagens de 5 a 1', () => {
  const bars = distributionBars({ 1: 1, 2: 0, 3: 0, 4: 1, 5: 2 }, 4);
  assert.deepEqual(bars.map((b) => [b.stars, b.percent]), [[5, 50], [4, 25], [3, 0], [2, 0], [1, 25]]);
  assert.deepEqual(distributionBars(null, 0).map((b) => b.percent), [0, 0, 0, 0, 0]);
});
