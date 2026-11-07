// Atualização segura de mods: o "diário" guarda o estado de cada caminho e
// devolve tudo como estava se a instalação da versão nova falhar no meio.
// Usa o modRouter de verdade (só fs) em pastas temporárias.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const rb = require('../modRollback');
const router = require('../modRouter');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'pc-rollback-')); }
const write = (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };
const read = (p) => fs.readFileSync(p, 'utf8');

test('record + rollback: arquivo alterado volta, arquivo novo some, pasta volta inteira', () => {
  const base = tmp();
  const j = rb.createJournal(path.join(base, 'journal'));
  const a = path.join(base, 'game', 'a.txt');
  const novo = path.join(base, 'game', 'novo.txt');
  const pasta = path.join(base, 'game', 'Mods', 'velho');
  write(a, 'original');
  write(path.join(pasta, 'x.dll'), 'x');
  for (const p of [a, novo, pasta, a]) rb.record(j, p); // repetido não regrava
  assert.equal(j.items.length, 3);

  write(a, 'mexido');
  write(novo, 'lixo');
  fs.rmSync(pasta, { recursive: true });
  const r = rb.rollback(j);
  assert.deepEqual(r.errors, []);
  assert.equal(read(a), 'original');
  assert.equal(fs.existsSync(novo), false);
  assert.equal(read(path.join(pasta, 'x.dll')), 'x');
  rb.discard(j);
  assert.equal(fs.existsSync(j.dir), false);
});

test('pathsForInstall junta versão anterior, cópias dos originais, destinos novos e legado', () => {
  const previous = {
    files: [{ path: '/g/BepInEx/plugins/m/a.dll', stash: '/g/BepInEx/.projectclub-disabled/m/a.dll' }],
    backups: [{ path: '/g/orig.cfg', backup: '/g/.bk/orig.cfg' }],
  };
  const plan = { placements: [{ dest: '/g/BepInEx/plugins/m/b.dll', root: '/g/BepInEx' }], generated: [{ dest: '/g/x.ini', root: '/g' }] };
  const legacy = { enabledDir: '/g/Mods/m', disabledDir: '/g/Mods.disabled/m' };
  const list = rb.pathsForInstall({ previous, plan, legacy, key: 'm', backupPathFor: (d, r, k) => `${r}/BK/${k}${d.slice(r.length)}` });
  for (const p of ['/g/BepInEx/plugins/m/a.dll', '/g/BepInEx/.projectclub-disabled/m/a.dll', '/g/orig.cfg', '/g/.bk/orig.cfg',
    '/g/BepInEx/plugins/m/b.dll', '/g/BepInEx/BK/m/plugins/m/b.dll', '/g/x.ini', '/g/Mods/m', '/g/Mods.disabled/m']) {
    assert.ok(list.includes(p), p);
  }
  assert.deepEqual(rb.pathsForInstall({}), []);
});

test('missingFiles aponta o que a versão nova não colocou', () => {
  const base = tmp();
  write(path.join(base, 'ok.dll'), '1');
  assert.deepEqual(rb.missingFiles({ files: [{ path: path.join(base, 'ok.dll') }] }), []);
  assert.deepEqual(rb.missingFiles({ files: [{ path: path.join(base, 'falta.dll') }] }), [path.join(base, 'falta.dll')]);
});

test('atualização que falha no meio: versão anterior e original do jogo voltam exatamente', () => {
  const base = tmp();
  const root = path.join(base, 'game');
  const key = 'meumod';
  // Versão 1 instalada por cima de um arquivo original do jogo (com backup).
  const manifest = { version: 1, mods: {} };
  const orig = path.join(root, 'config.ini');
  write(orig, 'ORIGINAL DO JOGO');
  const stage1 = path.join(base, 'stage1');
  write(path.join(stage1, 'mod.dll'), 'v1');
  write(path.join(stage1, 'config.ini'), 'config do mod v1');
  const plan1 = { placements: [
    { src: path.join(stage1, 'mod.dll'), dest: path.join(root, 'plugins', 'mod.dll'), root },
    { src: path.join(stage1, 'config.ini'), dest: orig, root },
  ], generated: [], skipped: [] };
  router.applyPlan(plan1, { manifest, key, meta: { name: key, version: '1' } });
  assert.equal(read(orig), 'config do mod v1');

  // Versão 2: um dos arquivos "some" no meio (simula falha de disco).
  const stage2 = path.join(base, 'stage2');
  write(path.join(stage2, 'mod.dll'), 'v2');
  const plan2 = { placements: [
    { src: path.join(stage2, 'mod.dll'), dest: path.join(root, 'plugins', 'mod.dll'), root },
    { src: path.join(stage2, 'novo.dll'), dest: path.join(root, 'plugins', 'novo.dll'), root }, // não existe → falha
  ], generated: [], skipped: [] };
  const previous = manifest.mods[key];
  const j = rb.createJournal(path.join(base, 'journal'));
  for (const p of rb.pathsForInstall({ previous, plan: plan2, key, backupPathFor: router.backupPathFor })) rb.record(j, p);

  assert.throws(() => {
    router.removeEntryFiles(previous);
    delete manifest.mods[key];
    router.applyPlan(plan2, { manifest, key, meta: { name: key, version: '2' } });
  });
  // No meio da falha: v1 já tinha saído e o mod.dll v2 entrado.
  assert.equal(read(path.join(root, 'plugins', 'mod.dll')), 'v2');

  const r = rb.rollback(j);
  assert.deepEqual(r.errors, []);
  assert.equal(read(path.join(root, 'plugins', 'mod.dll')), 'v1');
  assert.equal(read(orig), 'config do mod v1');
  // A cópia de segurança do original do jogo continua guardada (desinstalar devolve ela).
  const bk = previous.backups.find((b) => b.path === orig);
  assert.equal(read(bk.backup), 'ORIGINAL DO JOGO');
  assert.equal(fs.existsSync(path.join(root, 'plugins', 'novo.dll')), false);
  // E desinstalar a v1 depois disso ainda devolve o original.
  router.removeEntryFiles(previous);
  assert.equal(read(orig), 'ORIGINAL DO JOGO');
  rb.discard(j);
});
