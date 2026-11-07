// Volume por pessoa salvo na conta (UserSettings.voiceVolumes): validação,
// mescla de patches e limite de tamanho. Tudo puro, sem banco.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  VOICE_VOLUMES_MAX, sanitizeVoiceVolumes, sanitizeVoiceVolumesPatch, mergeVoiceVolumes, parseVoiceVolumes,
} = require('../src/utils/voiceVolumes');

test('sanitize: descarta chaves e volumes inválidos e o padrão (100)', () => {
  const out = sanitizeVoiceVolumes({
    'a1b2-c3': 150, ok_2: 0, padrao: 100, alto: 201, neg: -1, frac: 50.5, texto: '80',
    'não pode': 40, ['x'.repeat(65)]: 40, __proto__: 50,
  });
  assert.deepEqual(out, { 'a1b2-c3': 150, ok_2: 0 });
  assert.equal(sanitizeVoiceVolumes(null), undefined);
  assert.equal(sanitizeVoiceVolumes([1, 2]), undefined);
  assert.equal(sanitizeVoiceVolumes('{}'), undefined);
});

test('sanitize: corta no limite mantendo as entradas mais recentes', () => {
  const big = {};
  for (let i = 0; i < VOICE_VOLUMES_MAX + 20; i += 1) big[`u${i}`] = 50;
  const out = sanitizeVoiceVolumes(big);
  const keys = Object.keys(out);
  assert.equal(keys.length, VOICE_VOLUMES_MAX);
  assert.equal(keys[0], 'u20');
  assert.equal(keys.at(-1), `u${VOICE_VOLUMES_MAX + 19}`);
});

test('patch: aceita null (voltar ao padrão) e rejeita patch vazio/inválido', () => {
  assert.deepEqual(sanitizeVoiceVolumesPatch({ a: 120, b: null, c: 999, 'd e': 10 }), { a: 120, b: null });
  assert.equal(sanitizeVoiceVolumesPatch({}), undefined);
  assert.equal(sanitizeVoiceVolumesPatch({ c: 999 }), undefined);
  assert.equal(sanitizeVoiceVolumesPatch(null), undefined);
  const huge = {};
  for (let i = 0; i <= VOICE_VOLUMES_MAX; i += 1) huge[`u${i}`] = 10;
  assert.equal(sanitizeVoiceVolumesPatch(huge), undefined);
});

test('merge: aplica por cima, remove com null/100 e move quem mudou pro fim', () => {
  const merged = mergeVoiceVolumes({ a: 50, b: 150, c: 30 }, { a: 80, b: null, d: 100, e: 200 });
  assert.deepEqual(merged, { c: 30, a: 80, e: 200 });
  assert.deepEqual(Object.keys(merged), ['c', 'a', 'e']);
});

test('merge: respeita o limite tirando quem não é ajustado há mais tempo', () => {
  const merged = mergeVoiceVolumes({ a: 10, b: 20, c: 30 }, { a: 15, d: 40 }, 3);
  assert.deepEqual(merged, { c: 30, a: 15, d: 40 });
});

test('parse: texto do banco vira objeto limpo; lixo vira {}', () => {
  assert.deepEqual(parseVoiceVolumes('{"a":120,"b":"x"}'), { a: 120 });
  assert.deepEqual(parseVoiceVolumes('não é json'), {});
  assert.deepEqual(parseVoiceVolumes(null), {});
});
