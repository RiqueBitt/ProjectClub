// Atualização automática de mods (app de PC): configuração, "o jogo está
// aberto?" e a decisão de rodar — com dependências falsas, sem Electron.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const au = require('../modAutoUpdate');

test('configuração: desligada por padrão; arquivo estragado não quebra', () => {
  assert.deepEqual(au.sanitizeSettings(undefined), { enabled: false, games: {} });
  assert.deepEqual(au.sanitizeSettings({ enabled: 'sim', games: { abc: true, 10: 'x', 20: false, '-1': true } }), { enabled: false, games: { 20: false } });
  assert.deepEqual(au.applyPatch({ enabled: false }, { enabled: true, game: { steamAppId: 892970, enabled: false } }), { enabled: true, games: { 892970: false } });
  assert.deepEqual(au.applyPatch({ enabled: true }, { game: { steamAppId: 'lixo', enabled: true } }), { enabled: true, games: {} });
});

test('configuração: grava em disco (troca atômica) e lê de volta', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-autoupd-'));
  const store = au.createSettingsStore(dir);
  assert.equal(store.get().enabled, false);
  store.set({ enabled: true });
  store.set({ game: { steamAppId: 1966720, enabled: false } });
  const again = au.createSettingsStore(dir).get();
  assert.deepEqual(again, { enabled: true, games: { 1966720: false } });
  assert.equal(fs.existsSync(path.join(dir, `${au.SETTINGS_FILE}.tmp`)), false);
  fs.writeFileSync(path.join(dir, au.SETTINGS_FILE), '{quebrado');
  assert.deepEqual(au.createSettingsStore(dir).get(), { enabled: false, games: {} });
});

test('jogo ligado = global ligado e o jogo não desligado', () => {
  assert.equal(au.isGameEnabled({ enabled: false, games: { 5: true } }, 5), false);
  assert.equal(au.isGameEnabled({ enabled: true, games: {} }, 5), true);
  assert.equal(au.isGameEnabled({ enabled: true, games: { 5: false } }, 5), false);
  assert.equal(au.isGameEnabled({ enabled: true }, 'x'), false);
});

test('processo dentro da pasta do jogo (Windows ignora maiúsculas; nunca casa com a raiz do disco)', () => {
  const procs = ['C:\\Program Files (x86)\\Steam\\steamapps\\common\\Lethal Company\\Lethal Company.exe', 'C:\\Windows\\explorer.exe'];
  assert.equal(au.anyPathInside(procs, 'c:\\program files (x86)\\steam\\steamapps\\common\\lethal company\\', 'win32'), true);
  assert.equal(au.anyPathInside(procs, 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Lethal', 'win32'), false, 'prefixo de outro nome não conta');
  assert.equal(au.anyPathInside(procs, 'C:\\', 'win32'), false);
  assert.equal(au.anyPathInside(['/home/a/.steam/steamapps/common/Valheim/valheim.x86_64'], '/home/a/.steam/steamapps/common/Valheim', 'linux'), true);
  assert.equal(au.anyPathInside(['/home/a/.steam/steamapps/common/valheim/x'], '/home/a/.steam/steamapps/common/Valheim', 'linux'), false, 'Linux diferencia maiúsculas');
});

test('Linux: lista executáveis e caminhos do Wine/Proton na linha de comando', async () => {
  const fakeFs = {
    readdirSync: () => ['1', 'self', '22'],
    readlinkSync: (p) => { if (p === '/proc/1/exe') return '/usr/bin/wine64-preloader'; throw new Error('EACCES'); },
    readFileSync: (p) => (p === '/proc/1/cmdline' ? 'Z:\\home\\a\\Game\\game.exe\0-arg\0' : ''),
  };
  const list = await au.listProcessPaths('linux', { fs: fakeFs });
  assert.ok(list.includes('/usr/bin/wine64-preloader'));
  assert.ok(list.includes('\\home\\a\\Game\\game.exe'));
  assert.equal(au.anyPathInside(list, '/home/a/Game', 'linux'), true);
  assert.equal(await au.listProcessPaths('win32', { execText: async () => null }), null, 'PowerShell falhou = não sabe');
});

test('jogo aberto: atividade, Steam ou processo; sem lista de processos = "não sei"', async () => {
  const base = { gameInstallPath: '/jogos/Valheim', steamAppId: 892970 };
  const closed = { platform: 'linux', listProcessPaths: async () => ['/usr/bin/bash'] };
  assert.deepEqual(await au.checkGameRunning(base, closed), { running: false, known: true, reason: 'closed' });
  assert.equal((await au.checkGameRunning(base, { ...closed, currentActivity: () => ({ type: 'spotify', playingGame: { steamAppId: 892970 } }) })).reason, 'activity');
  assert.equal((await au.checkGameRunning(base, { ...closed, getRunningSteamAppId: async () => 892970 })).reason, 'steam');
  assert.equal((await au.checkGameRunning(base, { ...closed, getRunningSteamAppId: async () => 440 })).running, false);
  assert.equal((await au.checkGameRunning(base, { platform: 'linux', listProcessPaths: async () => ['/jogos/Valheim/valheim.x86_64'] })).reason, 'process');
  assert.deepEqual(await au.checkGameRunning(base, { platform: 'linux', listProcessPaths: async () => null }), { running: false, known: false, reason: 'no-process-list' });
  assert.equal((await au.checkGameRunning({ steamAppId: 1 }, closed)).known, false);
});

test('decisão: nunca com o jogo aberto, nem sem saber, nem desligado, nem cedo demais', () => {
  const on = { enabled: true, games: {} };
  const closed = { running: false, known: true };
  const NOW = 10_000_000;
  assert.deepEqual(au.decide({ settings: on, steamAppId: 5, running: closed, now: NOW }), { ok: true, reason: 'ok' });
  assert.equal(au.decide({ settings: { enabled: false }, steamAppId: 5, running: closed, now: NOW }).reason, 'disabled');
  assert.equal(au.decide({ settings: { enabled: true, games: { 5: false } }, steamAppId: 5, running: closed, now: NOW }).reason, 'game-disabled');
  assert.equal(au.decide({ settings: on, steamAppId: 5, running: { running: true, known: true }, now: NOW }).reason, 'game-running');
  assert.equal(au.decide({ settings: on, steamAppId: 5, running: { running: false, known: false }, now: NOW }).reason, 'unknown-running');
  assert.equal(au.decide({ settings: on, steamAppId: 5, running: null, now: NOW }).reason, 'unknown-running');
  assert.equal(au.decide({ settings: on, steamAppId: 5, running: closed, lastRunAt: NOW - 60_000, now: NOW }).reason, 'too-soon');
  assert.equal(au.decide({ settings: on, steamAppId: 5, running: closed, lastRunAt: NOW - au.MIN_INTERVAL_MS, now: NOW }).ok, true);
});

test('aviso final: resume nomes e falhas', () => {
  assert.equal(au.notificationText({ updated: [], failed: 0 }), null);
  assert.deepEqual(au.notificationText({ updated: ['BepInEx'] }), { title: 'Mod atualizado', body: 'BepInEx' });
  const many = au.notificationText({ updated: ['A', 'B', 'C', 'D', 'E'], failed: 1 });
  assert.equal(many.title, '5 mods atualizados');
  assert.equal(many.body, 'A, B, C e mais 2 · 1 não pôde ser atualizado (versão anterior mantida)');
  assert.equal(au.notificationText({ updated: [], failed: 2 }).title, 'Atualização de mods');
});
