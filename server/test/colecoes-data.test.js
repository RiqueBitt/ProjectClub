// Coleções temáticas da Loja: todo estilo de perfil fica em exatamente uma
// coleção, e cada coleção tem o pacote certo de itens.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Sem banco aqui: só a lista de estilos importa.
require.cache[path.resolve(__dirname, '../src/config/prisma.js')] = { exports: {}, loaded: true, id: 'prisma' };
const { BUILTIN_STYLES } = require('../src/services/profileStyles');
const { COLLECTIONS } = require('../scripts/colecoes-data');

const NOSTALGIA = ['win2000', 'mensageiro']; // coleção Nostalgia (seed-nostalgia.js)

test('todo estilo existente está em exatamente uma coleção', () => {
  const used = [...NOSTALGIA, ...COLLECTIONS.flatMap((c) => c.styles)];
  assert.equal(new Set(used).size, used.length, 'estilo repetido em duas coleções');
  const all = BUILTIN_STYLES.map((s) => s.key).sort();
  assert.deepEqual([...used].sort(), all);
});

test('coleções de 2 estilos: 3 molduras, 2 efeitos; de 1 estilo: 2 molduras, 2 efeitos', () => {
  const doubles = COLLECTIONS.filter((c) => c.styles.length === 2);
  assert.equal(doubles.length, 10);
  for (const c of COLLECTIONS) {
    assert.ok(c.styles.length === 1 || c.styles.length === 2, c.slug);
    assert.equal(c.frames.length, c.styles.length === 2 ? 3 : 2, c.slug);
    assert.equal(c.effects.length, 2, c.slug);
    assert.ok(c.font?.family && c.font?.name, c.slug);
  }
});

test('nomes, fontes e pastas não se repetem', () => {
  const uniq = (arr) => new Set(arr).size === arr.length;
  assert.ok(uniq(COLLECTIONS.map((c) => c.slug)));
  assert.ok(uniq(COLLECTIONS.map((c) => c.name)));
  assert.ok(uniq([...COLLECTIONS.map((c) => c.font.family), 'Silkscreen']));
  assert.ok(uniq([...COLLECTIONS.map((c) => c.font.name), 'Pixel 2000']));
});

test('as imagens de cada coleção existem no site', () => {
  const root = path.resolve(__dirname, '../../client/public/loja');
  for (const c of COLLECTIONS) {
    const files = ['banner.webp', 'logo.webp', ...c.frames.map((_, i) => `moldura-${i + 1}.webp`), ...c.effects.map((_, i) => `efeito-${i + 1}.webp`)];
    for (const f of files) assert.ok(fs.existsSync(path.join(root, c.slug, f)), `${c.slug}/${f}`);
  }
});
