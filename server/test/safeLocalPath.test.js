const test = require('node:test');
const assert = require('node:assert');
const { safeLocalPath } = require('../src/utils/safeLocalPath');

test('caminho local: páginas do próprio site passam como vieram', () => {
  for (const ok of ['/inicio', '/admin?aba=1', '/canal/x#fim', '/@fulano', '/a//b']) {
    assert.equal(safeLocalPath(ok), ok);
  }
});

test('caminho local: disfarce de outro site é recusado (redirecionamento aberto)', () => {
  for (const bad of ['', 'inicio', '//mal.com', '/\\mal.com', '/\\/mal.com', '/a\\b', '/\t/mal.com', '/\n/mal.com', 'https://mal.com', '\\mal.com', null, undefined, 7, ['/x']]) {
    assert.equal(safeLocalPath(bad), null, JSON.stringify(bad));
  }
});
