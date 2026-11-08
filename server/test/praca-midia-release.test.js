// Praça: mídia do jogo baixada da release do GitHub na primeira inicialização
// (server/waddle/src/common/media-store.ts → ensureMedia). Aqui a "release"
// é um servidor HTTP local com um .tar por pasta, e o manifesto é um
// manifesto pequeno de mentira, pra não depender de rede nem de 1,7 GB.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-media-'));
const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-src-'));
const relDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-rel-'));
process.env.WADDLE_MEDIA_DIR = mediaDir;
process.env.WADDLE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-data-'));
delete process.env.WADDLE_MEDIA_URL;

// "mídia" de mentira: 2 pastas, 3 arquivos
const files = ['default/tool/load.swf', 'default/websites/x.html', 'clothing/svanilla/a.swf'];
for (const f of files) { fs.mkdirSync(path.dirname(path.join(srcDir, f)), { recursive: true }); fs.writeFileSync(path.join(srcDir, f), `conteudo:${f}`); }
for (const d of ['default', 'clothing']) execFileSync('tar', ['cf', path.join(relDir, `media-${d}.tar`), '-C', srcDir, d]);

// manifesto de mentira no lugar do real (o módulo lê pelo caminho fixo)
const manifestPath = path.resolve(__dirname, '../waddle/media-manifest.json');
const realManifest = fs.readFileSync(manifestPath);
fs.writeFileSync(manifestPath, JSON.stringify({ files }));
test.after(() => fs.writeFileSync(manifestPath, realManifest));

let server; let base;
test.before(async () => {
  server = http.createServer((req, res) => {
    const f = path.join(relDir, path.basename(req.url));
    if (!fs.existsSync(f)) { res.statusCode = 404; return res.end('nope'); }
    res.setHeader('content-length', fs.statSync(f).size);
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.WADDLE_MEDIA_RELEASE = base;
});
test.after(() => server.close());

test('baixa os pacotes da release, extrai e fica pronta; depois não baixa de novo', async () => {
  const media = require('../waddle/dist/common/media-store.js');
  assert.equal(media.getMediaState().state, 'checking');
  const logs = [];
  const st = await media.ensureMedia((m) => logs.push(m));
  assert.equal(st.state, 'ready', JSON.stringify(st));
  for (const f of files) assert.equal(fs.readFileSync(path.join(mediaDir, f), 'utf8'), `conteudo:${f}`);
  assert.ok(logs.some((l) => l.includes('media-default.tar')) && logs.some((l) => l.includes('media-clothing.tar')));
  assert.ok(fs.existsSync(path.join(mediaDir, '.complete.json')));
  assert.ok(!fs.existsSync(path.join(mediaDir, '.tmp')), 'pasta temporária limpa');
  assert.equal(media.mediaFileExists('default/tool/load.swf'), true);
  assert.equal((await media.readMediaFile('clothing/svanilla/a.swf')).toString(), 'conteudo:clothing/svanilla/a.swf');
  // segunda chamada: mesma promessa, nada baixa
  const again = await media.ensureMedia(() => { throw new Error('não deveria logar'); });
  assert.equal(again.state, 'ready');
});
