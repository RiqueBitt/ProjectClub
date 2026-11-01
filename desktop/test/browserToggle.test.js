// O navegador do app de PC precisa estar ligado junto com o do site/servidor.
// Quando ficou desligado só aqui (out/2026), o site mostrava o Navegador mas
// o app bloqueava toda aba (will-attach-webview) e nada carregava.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
const flag = (src, re) => { const m = src.match(re); return m ? m[1] === 'true' : null; };

test('app de PC, site e servidor concordam sobre o navegador', () => {
  const desktop = flag(read('desktop/main.js'), /const BROWSER_ENABLED = (true|false);/);
  const client = flag(read('client/src/utils/features.js'), /browser:\s*(true|false)/);
  const server = flag(read('server/src/config/features.js'), /browser:\s*(true|false)/);
  assert.notEqual(desktop, null, 'BROWSER_ENABLED não encontrado no main.js');
  assert.equal(desktop, client, 'desktop/main.js e client/src/utils/features.js discordam');
  assert.equal(client, server, 'client e server discordam');
});
