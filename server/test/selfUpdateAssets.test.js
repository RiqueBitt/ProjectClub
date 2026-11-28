const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// A função keep_old_assets de scripts/self-update.sh, rodada numa pasta de teste.
const script = fs.readFileSync(path.resolve(__dirname, '../../scripts/self-update.sh'), 'utf8');
const fn = /keep_old_assets\(\) \{[\s\S]*?\n\}\n/.exec(script)?.[0];

function run(app, src) {
  execFileSync('sh', ['-c', `set -eu\nAPP="$1"\nSRC="$2"\n${fn}\nkeep_old_assets`, 'sh', app, src]);
}

test('publicação: os arquivos da versão anterior continuam disponíveis', (t) => {
  assert.ok(fn, 'keep_old_assets existe no self-update.sh');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const oldDir = path.join(root, 'app/client/dist/assets');
  const newDir = path.join(root, 'src/client/dist/assets');
  fs.mkdirSync(oldDir, { recursive: true });
  fs.mkdirSync(newDir, { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'LojaPage-antiga.js'), 'antiga');
  fs.writeFileSync(path.join(oldDir, 'index-igual.js'), 'da versão anterior');
  fs.writeFileSync(path.join(oldDir, 'Velha-demais.js'), 'velha');
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600e3);
  fs.utimesSync(path.join(oldDir, 'Velha-demais.js'), tenDaysAgo, tenDaysAgo);
  fs.writeFileSync(path.join(newDir, 'LojaPage-nova.js'), 'nova');
  fs.writeFileSync(path.join(newDir, 'index-igual.js'), 'da versão nova');

  run(path.join(root, 'app'), path.join(root, 'src'));

  // o arquivo que só a versão anterior tinha foi junto
  assert.equal(fs.readFileSync(path.join(newDir, 'LojaPage-antiga.js'), 'utf8'), 'antiga');
  // o que a versão nova já tem não é trocado
  assert.equal(fs.readFileSync(path.join(newDir, 'index-igual.js'), 'utf8'), 'da versão nova');
  assert.equal(fs.readFileSync(path.join(newDir, 'LojaPage-nova.js'), 'utf8'), 'nova');
  // mais de 7 dias: fica pra trás (não acumula pra sempre)
  assert.equal(fs.existsSync(path.join(newDir, 'Velha-demais.js')), false);
});

test('publicação: primeira instalação (sem versão anterior) não dá erro', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src/client/dist/assets'), { recursive: true });
  run(path.join(root, 'app'), path.join(root, 'src'));
});
