// Mod Manager único: Epic/GOG (otherGames.js) e Minecraft/Hytale (launcherMods.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const og = require('../otherGames');

test('Epic: lê manifestos, pula DLC, incompletos e não-jogos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-'));
  const w = (n, o) => fs.writeFileSync(path.join(dir, n), JSON.stringify(o));
  w('a.item', { DisplayName: 'Hades', InstallLocation: 'C:\\Games\\Hades', AppName: 'Min', MainGameAppName: 'Min', AppCategories: ['public', 'games'] });
  w('b.item', { DisplayName: 'Hades DLC', InstallLocation: 'C:\\Games\\Hades', AppName: 'Dlc', MainGameAppName: 'Min', AppCategories: ['addons'] });
  w('c.item', { DisplayName: 'Meio baixado', InstallLocation: 'C:\\x', AppName: 'X', bIsIncompleteInstall: true });
  w('d.item', { DisplayName: 'Ferramenta', InstallLocation: 'C:\\y', AppName: 'Y', AppCategories: ['applications'] });
  const list = og.parseEpicManifests(dir);
  assert.deepStrictEqual(list.map((g) => g.name), ['Hades']);
  assert.strictEqual(list[0].platform, 'epic');
});

test('GOG: lê a saída do reg query e ignora DLC', () => {
  const out = [
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1207658924',
    '    gameName    REG_SZ    The Witcher 3: Wild Hunt',
    '    path    REG_SZ    D:\\GOG\\Witcher 3',
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1640424747',
    '    gameName    REG_SZ    Hearts of Stone',
    '    path    REG_SZ    D:\\GOG\\Witcher 3',
    '    dependsOn    REG_SZ    1207658924',
  ].join('\r\n');
  const list = og.parseGogRegistry(out);
  assert.deepStrictEqual(list, [{ platform: 'gog', id: '1207658924', name: 'The Witcher 3: Wild Hunt', installPath: 'D:\\GOG\\Witcher 3' }]);
});

test('Liga com a Steam só com o mesmo nome (sem chute)', () => {
  const r = [{ appid: '292030', name: 'The Witcher® 3: Wild Hunt' }, { appid: '1', name: 'The Witcher 2' }];
  assert.strictEqual(og.pickSteamApp('The Witcher 3: Wild Hunt GOTY Edition', r), 292030);
  assert.strictEqual(og.pickSteamApp('Outro Jogo', r), null);
});

test('Minecraft/Hytale: lista, desliga, religa e apaga mods só dentro da pasta da instância', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-'));
  const prev = { APPDATA: process.env.APPDATA, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  process.env.APPDATA = home; process.env.XDG_CONFIG_HOME = home;
  try {
    delete require.cache[require.resolve('../launcherMods')];
    const lm = require('../launcherMods');
    const inst = path.join(home, 'projectmc', 'instances', 'Meu Pack');
    fs.mkdirSync(path.join(inst, 'mods'), { recursive: true });
    fs.writeFileSync(path.join(inst, 'instance.json'), JSON.stringify({ name: 'Meu Pack', runtime: { minecraft: '1.21.1', fabricLoader: '0.16.0' } }));
    fs.writeFileSync(path.join(inst, 'mods', 'sodium.jar'), 'x');
    fs.writeFileSync(path.join(inst, 'mods', 'leia.txt'), 'x');
    const [mc] = lm.listMinecraftInstances().filter((i) => i.id.startsWith('pmc:'));
    assert.strictEqual(mc.loader, 'fabric');
    assert.strictEqual(mc.gameVersion, '1.21.1');
    let r = lm.listMods('minecraft', mc.id);
    assert.deepStrictEqual(r.mods.map((m) => m.file), ['sodium.jar']);
    lm.setModEnabled('minecraft', mc.id, 'sodium.jar', false);
    r = lm.listMods('minecraft', mc.id);
    assert.strictEqual(r.mods[0].enabled, false);
    lm.setModEnabled('minecraft', mc.id, 'sodium.jar.disabled', true);
    assert.throws(() => lm.setModEnabled('minecraft', mc.id, '../instance.json', false));
    assert.throws(() => lm.listMods('minecraft', 'pmc:../../etc'));
    await assert.rejects(lm.installFromUrl('minecraft', mc.id, { url: 'https://example.com/x.jar', fileName: 'x.jar' }), /bloqueado/);
    await assert.rejects(lm.catalogRequest("../admin"), /não permitida/);
    await lm.removeMod('minecraft', mc.id, 'sodium.jar');
    assert.strictEqual(lm.listMods('minecraft', mc.id).mods.length, 0);
  } finally {
    process.env.APPDATA = prev.APPDATA; process.env.XDG_CONFIG_HOME = prev.XDG_CONFIG_HOME;
    if (prev.APPDATA === undefined) delete process.env.APPDATA;
    if (prev.XDG_CONFIG_HOME === undefined) delete process.env.XDG_CONFIG_HOME;
  }
});
