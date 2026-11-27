'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { repointPinnedShortcuts, samePath } = require('../pinnedShortcuts');

const APPDATA = 'C:\\Users\\ana\\AppData\\Roaming';
const PINNED = `${APPDATA}\\Microsoft\\Internet Explorer\\Quick Launch\\User Pinned`;
const OLD = 'C:\\Users\\ana\\AppData\\Local\\Programs\\project-club-desktop\\Project Club.exe';
const NEW = 'C:\\Users\\ana\\AppData\\Local\\Programs\\Project Club\\Project Club.exe';

// Disco e atalhos de mentira: { pasta: { arquivo.lnk: { target, icon, ... } } }
function fakes(tree) {
  const written = [];
  const fs = {
    readdirSync(dir) {
      if (!tree[dir]) { const err = new Error('ENOENT'); err.code = 'ENOENT'; throw err; }
      return Object.keys(tree[dir]);
    },
  };
  const shell = {
    readShortcutLink(file) {
      const dir = file.slice(0, file.lastIndexOf('\\'));
      const link = tree[dir] && tree[dir][file.slice(dir.length + 1)];
      if (!link || link.broken) throw new Error('atalho ilegível');
      return link;
    },
    writeShortcutLink(file, operation, options) { written.push({ file, operation, options }); return true; },
  };
  return { fs, shell, written };
}

test('atalho fixado que apontava pro .exe antigo passa a apontar pro novo', () => {
  const { fs, shell, written } = fakes({
    [`${PINNED}\\TaskBar`]: { 'Project Club.lnk': { target: OLD, icon: OLD, iconIndex: 0 } },
  });
  assert.strictEqual(repointPinnedShortcuts({ oldExe: OLD, newExe: NEW, appData: APPDATA, fs, shell }), 1);
  assert.deepStrictEqual(written, [{
    file: `${PINNED}\\TaskBar\\Project Club.lnk`,
    operation: 'update',
    options: { target: NEW, cwd: 'C:\\Users\\ana\\AppData\\Local\\Programs\\Project Club', icon: NEW, iconIndex: 0 },
  }]);
});

test('atalho de outro programa não é tocado', () => {
  const { fs, shell, written } = fakes({
    [`${PINNED}\\TaskBar`]: {
      'Bloco de Notas.lnk': { target: 'C:\\Windows\\notepad.exe' },
      'leia-me.txt': {},
      'Quebrado.lnk': { broken: true },
    },
  });
  assert.strictEqual(repointPinnedShortcuts({ oldExe: OLD, newExe: NEW, appData: APPDATA, fs, shell }), 0);
  assert.deepStrictEqual(written, []);
});

test('compara caminho sem ligar pra maiúscula e mantém o ícone próprio do atalho', () => {
  const { fs, shell, written } = fakes({
    [`${PINNED}\\TaskBar`]: { 'PC.lnk': { target: OLD.toUpperCase(), icon: 'C:\\icones\\meu.ico', iconIndex: 2 } },
  });
  assert.strictEqual(repointPinnedShortcuts({ oldExe: OLD, newExe: NEW, appData: APPDATA, fs, shell }), 1);
  assert.deepStrictEqual(written[0].options, { target: NEW, cwd: 'C:\\Users\\ana\\AppData\\Local\\Programs\\Project Club' });
});

test('também corrige os atalhos de ImplicitAppShortcuts', () => {
  const { fs, shell, written } = fakes({
    [`${PINNED}\\TaskBar`]: {},
    [`${PINNED}\\ImplicitAppShortcuts`]: { '1a2b3c': {} },
    [`${PINNED}\\ImplicitAppShortcuts\\1a2b3c`]: { 'Project Club.lnk': { target: OLD } },
  });
  assert.strictEqual(repointPinnedShortcuts({ oldExe: OLD, newExe: NEW, appData: APPDATA, fs, shell }), 1);
  assert.strictEqual(written[0].file, `${PINNED}\\ImplicitAppShortcuts\\1a2b3c\\Project Club.lnk`);
});

test('sem pasta de atalhos fixados, ou sem mudança de pasta, não faz nada', () => {
  const { fs, shell, written } = fakes({});
  assert.strictEqual(repointPinnedShortcuts({ oldExe: OLD, newExe: NEW, appData: APPDATA, fs, shell }), 0);
  assert.strictEqual(repointPinnedShortcuts({ oldExe: NEW, newExe: NEW, appData: APPDATA, fs, shell }), 0);
  assert.strictEqual(repointPinnedShortcuts({ oldExe: '', newExe: NEW, appData: APPDATA, fs, shell }), 0);
  assert.deepStrictEqual(written, []);
});

test('samePath', () => {
  assert.strictEqual(samePath('C:\\A\\b.exe', 'c:\\a\\B.EXE'), true);
  assert.strictEqual(samePath('C:\\A\\..\\A\\b.exe', 'C:\\A\\b.exe'), true);
  assert.strictEqual(samePath('C:\\A\\b.exe', 'C:\\A\\c.exe'), false);
  assert.strictEqual(samePath('', ''), false);
});
