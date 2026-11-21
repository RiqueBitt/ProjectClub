// O cliente do Club Penguin (AS3) manda cada config pro shell (AS2) em pedaços
// com os tamanhos do chunking_map.json; o shell só sai da tela de carregamento
// quando chega o último pedaço de cada uma. Os textos das festas entram no
// game_strings conforme o calendário — o mapa de pedaços tem que acompanhar,
// senão o jogo fica carregando pra sempre (sem o pacote baixado).
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { getChunkingMapJson } = require('../waddle/dist/server/file-generators/chunking_map.json.js');
const { getGameStrings } = require('../waddle/dist/server/file-generators/game_strings.json.js');

function fakeData(extra) {
  return {
    getHunt: () => null,
    getGameStrings: () => new Map(),
    getExtraStrings: () => new Map(extra),
    getItems: () => [],
    getStampbook: () => [],
  };
}

const sum = (list) => list.reduce((a, b) => a + b, 0);

for (const extra of [0, 4, 900]) {
  test(`chunking_map cobre todos os textos do game_strings (+${extra} textos de festa)`, () => {
    const d = fakeData(Array.from({ length: extra }, (_, i) => [`pc.festa.teste.${i}`, `texto ${i}`]));
    const strings = JSON.parse(getGameStrings(d));
    const map = JSON.parse(getChunkingMapJson(d))['game_strings.json'];
    assert.equal(sum(map.lang), strings.lang.length);
    assert.equal(sum(map.error_lang), strings.error_lang.length);
    for (const n of map.lang) assert.ok(n > 0 && n <= 600, `pedaço de ${n} textos`);
  });
}
