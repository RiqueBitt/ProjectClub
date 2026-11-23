const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Lê só a função (o app.js inteiro precisa do Prisma).
const src = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
const body = src.slice(src.indexOf('const STATIC_EXT'), src.indexOf('module.exports = createApp'));
const isMissingStaticFile = new Function(`${body}; return isMissingStaticFile;`)();

test('arquivo do site que falta não recebe o index.html (vira 404 sem cache)', () => {
  for (const p of ['/assets/index-DF9IC-Yi.js', '/assets/vendor.abc123.js', '/assets/x.css', '/sw.js', '/manifest.webmanifest', '/favicon.ico', '/version.json']) {
    assert.equal(isMissingStaticFile(p), true, p);
  }
});

test('rotas do app continuam abrindo o site (inclusive @ com ponto)', () => {
  for (const p of ['/', '/canal/geral', '/perfil/rique.bitt', '/perfil/joao.silva.2', '/loja', '/admin', '/u/abc.def']) {
    assert.equal(isMissingStaticFile(p), false, p);
  }
});
