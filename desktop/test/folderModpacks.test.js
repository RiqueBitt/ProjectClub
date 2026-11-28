// Modpacks em pasta: aplicar no jogo e devolver tudo quando o jogo fecha.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fp = require('../folderModpacks');

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-'));
  const root = path.join(base, 'ModManager');
  const game = path.join(base, 'GTA V');
  fs.mkdirSync(path.join(game, 'x64'), { recursive: true });
  fs.writeFileSync(path.join(game, 'GTA5.exe'), 'jogo');
  fs.writeFileSync(path.join(game, 'dinput8.dll'), 'original');
  return { base, root, game };
}

test('cria o modpack na pasta ModManager/<Jogo>/Modpacks/<Modpack>', () => {
  const { root } = setup();
  const r = fp.createPack(root, 'GTA 5', 'Modpack 1');
  assert.strictEqual(r.path, path.join(root, 'GTA 5', 'Modpacks', 'Modpack 1'));
  assert.ok(fs.existsSync(path.join(r.path, 'modpack.json')));
  assert.throws(() => fp.createPack(root, 'GTA 5', 'Modpack 1'), /Já existe/);
  assert.strictEqual(fp.listPacks(root, 'GTA 5')[0].name, 'Modpack 1');
});

test('jogar: mods vão pro jogo; ao fechar voltam pro modpack e o original volta pro jogo', () => {
  const { root, game } = setup();
  const pack = fp.createPack(root, 'GTA 5', 'Modpack 1');
  fs.mkdirSync(path.join(pack.path, 'files', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(pack.path, 'files', 'scripts', 'trainer.asi'), 'mod');
  fs.writeFileSync(path.join(pack.path, 'files', 'dinput8.dll'), 'loader-do-mod');
  const r = fp.deploy(root, { gameName: 'GTA 5', packId: pack.id, gameInstallPath: game });
  assert.deepStrictEqual(r, { deployed: 2, replaced: 1 });
  assert.strictEqual(fs.readFileSync(path.join(game, 'dinput8.dll'), 'utf8'), 'loader-do-mod');
  assert.ok(fs.existsSync(path.join(game, 'scripts', 'trainer.asi')));
  assert.ok(fp.readJournal(root));
  assert.throws(() => fp.deploy(root, { gameName: 'GTA 5', packId: pack.id, gameInstallPath: game }), /Já tem um modpack/);
  assert.throws(() => fp.deletePack(root, 'GTA 5', pack.id, fp.readJournal(root)), /aplicado/);
  fp.purge(root);
  assert.strictEqual(fs.readFileSync(path.join(game, 'dinput8.dll'), 'utf8'), 'original');
  assert.ok(!fs.existsSync(path.join(game, 'scripts')), 'a pasta criada pelo mod some');
  assert.ok(fs.existsSync(path.join(pack.path, 'files', 'scripts', 'trainer.asi')));
  assert.strictEqual(fs.readFileSync(path.join(pack.path, 'files', 'dinput8.dll'), 'utf8'), 'loader-do-mod');
  assert.strictEqual(fp.readJournal(root), null);
});

test('vigia: recolhe quando o jogo abre e depois fecha', async () => {
  const { root, game } = setup();
  const pack = fp.createPack(root, 'GTA 5', 'P');
  fs.writeFileSync(path.join(pack.path, 'files', 'mod.asi'), 'm');
  fp.deploy(root, { gameName: 'GTA 5', packId: pack.id, gameInstallPath: game });
  const seq = [false, true, true, false, false];
  const states = [];
  await new Promise((resolve) => {
    fp.watch(root, { pollMs: 5, isRunning: async () => (seq.length ? seq.shift() : false), onState: (s) => { states.push(s.state); if (s.state === 'purged') resolve(); } });
  });
  assert.deepStrictEqual(states, ['waiting', 'running', 'purged']);
  assert.ok(!fs.existsSync(path.join(game, 'mod.asi')));
  assert.ok(fs.existsSync(path.join(pack.path, 'files', 'mod.asi')));
});

test('nome de modpack não sai da pasta', () => {
  const { root } = setup();
  const r = fp.createPack(root, '../..', '../../evil');
  assert.ok(r.path.startsWith(path.join(root)));
});
