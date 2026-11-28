// Testes da normalização/compatibilidade da busca unificada de mods
// (services/modCompat.js) — só dados falsos, sem rede. `node --test`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const c = require('../src/services/modCompat');

const LETHAL = 1966720;
const BG3 = 1086940;
const STARDEW = 413150;

const tsPkg = (name, extra = {}) => ({
  name, fullName: `Owner-${name}`, owner: 'Owner', packageUrl: 'https://thunderstore.io/x', dateCreated: '2024-01-01T00:00:00Z', dateUpdated: '2024-05-01T00:00:00Z',
  rating: 10, isPinned: false, isDeprecated: false, categories: ['Mods'], downloadCount: 1000,
  version: { versionNumber: '1.0.0', description: 'desc', icon: 'https://i/x.png', dependencies: ['BepInEx-BepInExPack-5.4.2100'], downloadUrl: 'https://d' },
  ...extra,
});

test('Thunderstore: mod que depende do BepInExPack → instala o loader junto', () => {
  const p = c.getGameProfile(LETHAL);
  const out = c.finalize(c.normalizeThunderstore(tsPkg('MoreCompany'), p), p);
  assert.equal(out.key, 'thunderstore:Owner-MoreCompany');
  assert.equal(out.installMethod, 'direct');
  assert.equal(out.compatibility.status, 'needs-loader');
  assert.match(out.compatibility.reason, /Instala o BepInEx junto/);
  assert.equal(out._isLoader, undefined); // campos internos não vazam
});

test('Thunderstore: o próprio BepInExPack é compatível; obsoleto é incompatível', () => {
  const p = c.getGameProfile(LETHAL);
  const loader = c.finalize(c.normalizeThunderstore(tsPkg('BepInExPack', { version: { dependencies: [] } }), p), p);
  assert.equal(loader.compatibility.status, 'compatible');
  assert.equal(loader.isLoader, true);
  const old = c.finalize(c.normalizeThunderstore(tsPkg('Old', { isDeprecated: true }), p), p);
  assert.equal(old.compatibility.status, 'incompatible');
  assert.match(old.compatibility.reason, /obsoleto/);
});

test('mod.io: .rar e formato que o jogo não usa → incompatível; .pak no BG3 → compatível', () => {
  const p = c.getGameProfile(BG3);
  const mk = (filename) => c.finalize(c.normalizeModio({ id: 1, name: 'X', modfile: { id: 9, filename }, stats: {}, tags: [{ name: 'UI' }], date_updated: 1700000000 }), p);
  assert.equal(mk('x.rar').compatibility.status, 'incompatible');
  assert.match(mk('x.rar').compatibility.reason, /Formato não suportado \(\.rar\)/);
  assert.equal(mk('x.exe').compatibility.status, 'incompatible');
  assert.equal(mk('x.pak').compatibility.status, 'compatible');
  assert.deepEqual(mk('x.pak').categories, ['UI']);
  assert.equal(mk('x.pak').updatedAt, new Date(1700000000 * 1000).toISOString());
});

test('mod.io sem arquivo publicado → incompatível', () => {
  const p = c.getGameProfile(999999);
  const out = c.finalize(c.normalizeModio({ id: 2, name: 'Y', modfile: null }), p);
  assert.equal(out.compatibility.status, 'incompatible');
});

test('Stardew: todo mod precisa do SMAPI (não instalável sozinho)', () => {
  const p = c.getGameProfile(STARDEW);
  const out = c.finalize(c.normalizeGameBanana({ _idRow: 5, _sName: 'Cool', _sModelName: 'Mod', _aRootCategory: { _sName: 'Gameplay' } }), p);
  assert.equal(out.compatibility.status, 'needs-loader');
  assert.equal(out.compatibility.autoInstall, false);
  assert.match(out.compatibility.reason, /SMAPI/);
});

test('GameBanana: WiP/Tool e obsoleto → incompatível', () => {
  const p = c.getGameProfile(999999);
  assert.equal(c.finalize(c.normalizeGameBanana({ _idRow: 1, _sName: 'a', _sModelName: 'Wip' }), p).compatibility.status, 'incompatible');
  assert.equal(c.finalize(c.normalizeGameBanana({ _idRow: 2, _sName: 'b', _sModelName: 'Tool' }), p).compatibility.status, 'incompatible');
  assert.equal(c.finalize(c.normalizeGameBanana({ _idRow: 3, _sName: 'c', _bIsObsolete: true }), p).compatibility.status, 'incompatible');
  const ok = c.finalize(c.normalizeGameBanana({ _idRow: 4, _sName: 'd', _aPreviewMedia: { _aImages: [{ _sBaseUrl: 'https://img', _sFile: 'a.jpg', _sFile220: 'a_220.jpg' }] } }), p);
  assert.equal(ok.compatibility.status, 'compatible');
  assert.equal(ok.thumbnailUrl, 'https://img/a_220.jpg');
});

test('Workshop: sempre pela Steam (steam-subscribe)', () => {
  const p = c.getGameProfile(105600);
  const out = c.finalize(c.normalizeWorkshop({ publishedfileid: '123', title: 'Calamity', subscriptions: 5, tags: [{ tag: 'Content' }], time_updated: 1700000000 }), p);
  assert.equal(out.installMethod, 'steam-subscribe');
  assert.equal(out.compatibility.status, 'compatible');
  assert.deepEqual(out.categories, ['Content']);
});

test('CS2 bloqueado → tudo incompatível', () => {
  const p = c.getGameProfile(730);
  assert.equal(c.finalize(c.normalizeModio({ id: 1, name: 'x', modfile: { id: 1, filename: 'a.zip' } }), p).compatibility.status, 'incompatible');
});

test('mergeResults intercala fontes em "populares" e ordena por downloads', () => {
  const a = [{ key: 'a1', source: 'modio', downloads: 5 }, { key: 'a2', source: 'modio', downloads: 1 }];
  const b = [{ key: 'b1', source: 'thunderstore', downloads: 3 }];
  assert.deepEqual(c.mergeResults({ modio: a, thunderstore: b }, 'popular').map((i) => i.key), ['b1', 'a1', 'a2']);
  assert.deepEqual(c.mergeResults({ modio: a, thunderstore: b }, 'downloads').map((i) => i.key), ['a1', 'b1', 'a2']);
});

test('mergeCategories junta nomes iguais de fontes diferentes', () => {
  const cats = c.mergeCategories({ modio: ['UI', 'Gameplay'], thunderstore: ['Gameplay', 'Suits'], gamebanana: ['ui'] });
  const ui = cats.find((x) => x.name === 'UI');
  assert.deepEqual(ui.sources.sort(), ['gamebanana', 'modio']);
  assert.equal(cats.length, 3);
});

test('identificação: normaliza nomes de arquivo/pasta e só aceita match confiável', () => {
  assert.equal(c.normalizeModName('MoreCompany.dll'), 'morecompany');
  assert.equal(c.normalizeModName('Improved_UI-1.4.2.pak'), 'improvedui');
  assert.equal(c.normalizeModName('[CP] Cool Mod'), 'coolmod');
  assert.equal(c.normalizeModName('BetterPal_P.pak'), 'betterpal');
  assert.equal(c.thunderstoreFullNameOf('notnotnotswipez-MoreCompany-1.9.1'), 'notnotnotswipez-MoreCompany');
  assert.equal(c.thunderstoreFullNameOf('MoreCompany'), null);
  assert.equal(c.pickConfident('Improved_UI.pak', [{ name: 'Improved UI' }, { name: 'Improved UI Extra' }]).name, 'Improved UI');
  assert.equal(c.pickConfident('UI', [{ name: 'UI' }]), null); // curto demais
  assert.equal(c.pickConfident('Fix', [{ name: 'Fix', downloads: 10 }, { name: 'FIX', downloads: 9 }]), null); // ambíguo
});
