const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../clipsLibrary');

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-clipes-'));
  fs.writeFileSync(path.join(dir, 'Valorant 2026-11-26 21-04-11.webm'), Buffer.alloc(1000, 1));
  fs.writeFileSync(path.join(dir, 'Clipe 2026-11-25 10-00-00 (2).webm'), Buffer.alloc(10, 2));
  fs.writeFileSync(path.join(dir, 'notas.txt'), 'não é vídeo');
  fs.writeFileSync(path.join(dir, '.escondido.webm'), 'x');
  fs.writeFileSync(path.join(dir, 'vazio.mp4'), '');
  fs.mkdirSync(path.join(dir, 'pasta.webm'));
  return dir;
}

test('lista só os vídeos da pasta, com o jogo tirado do nome', async () => {
  const dir = tmpDir();
  const out = await lib.list(dir);
  assert.deepEqual(out.map((c) => c.name).sort(), ['Clipe 2026-11-25 10-00-00 (2).webm', 'Valorant 2026-11-26 21-04-11.webm']);
  const v = out.find((c) => c.name.startsWith('Valorant'));
  assert.equal(v.game, 'Valorant');
  assert.equal(v.size, 1000);
  assert.equal(out.find((c) => c.name.startsWith('Clipe')).game, null);
  assert.deepEqual(await lib.list(path.join(dir, 'nao-existe')), []);
});

test('não deixa sair da pasta', () => {
  const dir = tmpDir();
  for (const bad of ['../segredo.webm', '..\\segredo.webm', 'a/b.webm', '/etc/passwd', '.escondido.webm', 'notas.txt', 'pasta.webm', '', null]) {
    assert.equal(lib.resolve(dir, bad), null, String(bad));
  }
  assert.ok(lib.resolve(dir, 'Valorant 2026-11-26 21-04-11.webm'));
});

test('pcclip:// entrega o vídeo inteiro e pedaços (Range)', async () => {
  const dir = tmpDir();
  const name = 'Valorant 2026-11-26 21-04-11.webm';
  const req = (range) => ({ url: lib.fileUrlFor(name), headers: new Headers(range ? { range } : {}) });
  const full = await lib.handleRequest(req(), dir);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'video/webm');
  assert.equal((await full.arrayBuffer()).byteLength, 1000);
  const part = await lib.handleRequest(req('bytes=100-199'), dir);
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 100-199/1000');
  assert.equal((await part.arrayBuffer()).byteLength, 100);
  const tail = await lib.handleRequest(req('bytes=-50'), dir);
  assert.equal(tail.headers.get('content-range'), 'bytes 950-999/1000');
  assert.equal((await lib.handleRequest(req('bytes=5000-'), dir)).status, 416);
  assert.equal((await lib.handleRequest({ url: 'pcclip://clip/..%2Fsegredo.webm', headers: new Headers() }, dir)).status, 404);
  assert.equal((await lib.handleRequest({ url: 'pcclip://outro/x.webm', headers: new Headers() }, dir)).status, 404);
});

test('nome do arquivo vira jogo e data', () => {
  const p = lib.parseName('Counter-Strike 2 2026-01-02 03-04-05.webm');
  assert.equal(p.game, 'Counter-Strike 2');
  assert.equal(p.at.getFullYear(), 2026);
  assert.deepEqual(lib.parseName('qualquer.webm'), { game: null, at: null });
});
