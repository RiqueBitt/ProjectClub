const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listVortexMods, prettyName } = require('../vortexMods');

test('nome bonito tira id, versão e data da pasta do Vortex', () => {
  assert.strictEqual(prettyName('SkyUI-12604-5-2SE-1573229210'), 'SkyUI');
  assert.strictEqual(prettyName('Meu_Mod'), 'Meu Mod');
});

test('lê os manifestos de implantação e a pasta de staging (só leitura)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vtx-'));
  const game = path.join(root, 'Jogo');
  const staging = path.join(root, 'staging');
  fs.mkdirSync(path.join(game, 'Data'), { recursive: true });
  fs.mkdirSync(path.join(staging, 'SkyUI-12604-5-2SE-1573229210'), { recursive: true });
  fs.mkdirSync(path.join(staging, 'Desligado-999-1-0-1600000000'), { recursive: true });
  fs.mkdirSync(path.join(staging, '__vortex_staging_folder'), { recursive: true });
  fs.writeFileSync(path.join(game, 'Data', 'vortex.deployment.json'), JSON.stringify({
    gameId: 'skyrimse', stagingPath: staging,
    files: [{ relPath: 'a.esp', source: 'SkyUI-12604-5-2SE-1573229210' }, { relPath: 'b.bsa', source: 'SkyUI-12604-5-2SE-1573229210' }],
  }));
  const r = listVortexMods(game);
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.gameId, 'skyrimse');
  assert.deepStrictEqual(r.mods.map((m) => [m.name, m.files, m.deployed]), [['SkyUI', 2, true], ['Desligado', 0, false]]);
  // nada foi mexido
  assert.ok(fs.existsSync(path.join(game, 'Data', 'vortex.deployment.json')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('jogo sem Vortex devolve vazio', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vtx-'));
  assert.deepStrictEqual(listVortexMods(root), { found: false, gameId: null, stagingPath: null, mods: [] });
  assert.deepStrictEqual(listVortexMods(path.join(root, 'nao-existe')).mods, []);
  fs.rmSync(root, { recursive: true, force: true });
});
