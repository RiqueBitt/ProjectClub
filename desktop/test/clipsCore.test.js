// Clipes: configuração, atalho, áudio (sem a call), codec, janela do jogo e
// nome do arquivo — regras puras.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const c = require('../clipsCore');

test('configuração: desligado por padrão, Alt+F10, sem áudio; valores estranhos voltam ao padrão', () => {
  assert.deepEqual(c.sanitizeSettings(undefined), { ...c.DEFAULT_SETTINGS });
  assert.equal(c.DEFAULT_SETTINGS.enabled, false);
  assert.equal(c.DEFAULT_SETTINGS.audio, false);
  assert.equal(c.DEFAULT_SETTINGS.hotkey, 'Alt+F10');
  const s = c.sanitizeSettings({ enabled: 'sim', audio: 1, source: 'webcam', quality: '4k', fps: 144, displayId: 'abc', hotkey: 'banana' });
  assert.deepEqual(s, { ...c.DEFAULT_SETTINGS });
  assert.deepEqual(c.sanitizeSettings({ enabled: true, source: 'game', quality: '720p', fps: 60, displayId: 2779098405, hotkey: 'ctrl+shift+s' }),
    { ...c.DEFAULT_SETTINGS, enabled: true, source: 'game', quality: '720p', fps: 60, displayId: 2779098405, hotkey: 'CommandOrControl+Shift+S' });
});

test('atalho: normaliza e recusa combinações perigosas', () => {
  assert.equal(c.normalizeAccelerator('alt + f10'), 'Alt+F10');
  assert.equal(c.normalizeAccelerator('F9'), 'F9');
  assert.equal(c.normalizeAccelerator('Shift+Alt+Ctrl+K'), 'CommandOrControl+Alt+Shift+K');
  assert.equal(c.normalizeAccelerator('Alt+PageDown'), 'Alt+PageDown');
  for (const bad of ['K', 'Shift+K', 'Alt+F10+F11', 'Alt+', '', 'Alt+Ç', null, 'A+B', 'Ctrl+Alt+Shift+Super+K']) {
    assert.equal(c.normalizeAccelerator(bad), null, String(bad));
  }
});

test('áudio: só no Windows com captura que exclui o próprio app (as vozes da call)', () => {
  assert.equal(c.pickClipAudio({ platform: 'win32', osRelease: '10.0.22631', chromeVersion: '140.0.1', env: {} }), 'loopbackWithoutChrome');
  assert.equal(c.pickClipAudio({ platform: 'win32', osRelease: '10.0.19041', chromeVersion: '140.0.1', env: {} }), null, 'Windows antigo: loopback pegaria a call');
  assert.equal(c.pickClipAudio({ platform: 'win32', osRelease: '10.0.22631', chromeVersion: '120.0', env: {} }), null);
  assert.equal(c.pickClipAudio({ platform: 'linux', osRelease: '6.8', chromeVersion: '140', env: {} }), null);
  assert.equal(c.pickClipAudio({ platform: 'win32', osRelease: '10.0.22631', chromeVersion: '140', env: { PROJECT_CLUB_SCREEN_AUDIO: 'off' } }), null);
  // Nem o modo de diagnóstico "loopback" (pegaria a call) liga o som dos clipes.
  assert.equal(c.pickClipAudio({ platform: 'win32', osRelease: '10.0.19041', chromeVersion: '140', env: { PROJECT_CLUB_SCREEN_AUDIO: 'loopback' } }), null);
});

test('formato: VP9 > VP8 > H.264, com opus só quando tem áudio', () => {
  const all = () => true;
  assert.equal(c.pickMimeType(all), 'video/webm;codecs=vp9');
  assert.equal(c.pickMimeType(all, { audio: true }), 'video/webm;codecs=vp9,opus');
  assert.equal(c.pickMimeType((m) => !m.includes('vp9')), 'video/webm;codecs=vp8');
  assert.equal(c.pickMimeType((m) => m.includes('h264')), 'video/webm;codecs=h264');
  assert.equal(c.pickMimeType(() => false), null);
  assert.equal(c.pickMimeType(() => { throw new Error('x'); }), null);
});

test('qualidade: 720p/1080p e taxa maior em 60 fps', () => {
  assert.deepEqual(c.videoProfile({ quality: '720p', fps: 30 }), { width: 1280, height: 720, fps: 30, videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 128_000 });
  assert.equal(c.videoProfile({ quality: '1080p', fps: 60 }).videoBitsPerSecond, 12_000_000);
});

test('janela do jogo: casa pelo título, nunca o próprio Project Club', () => {
  const sources = [
    { id: 'screen:0:0', name: 'Tela 1' },
    { id: 'window:1:0', name: 'Project Club' },
    { id: 'window:2:0', name: 'Discord' },
    { id: 'window:3:0', name: 'Lethal Company' },
    { id: 'window:4:0', name: 'Lethal Company Wiki - Navegador' },
  ];
  assert.equal(c.pickGameWindow(sources, 'Lethal Company').id, 'window:3:0');
  assert.equal(c.pickGameWindow(sources, 'Pokémon'), null);
  assert.equal(c.pickGameWindow([{ id: 'window:9:0', name: 'Counter-Strike 2' }], 'Counter Strike 2').id, 'window:9:0');
  assert.equal(c.pickGameWindow(sources, 'Project Club'), null);
  assert.equal(c.pickGameWindow(sources, ''), null);
});

test('tela escolhida: pelo display_id, senão a primeira', () => {
  const sources = [{ id: 'window:1:0' }, { id: 'screen:0:0', display_id: '111' }, { id: 'screen:1:0', display_id: '222' }];
  assert.equal(c.pickScreenSource(sources, 222).id, 'screen:1:0');
  assert.equal(c.pickScreenSource(sources, 999).id, 'screen:0:0');
  assert.equal(c.pickScreenSource(sources, null).id, 'screen:0:0');
  assert.equal(c.pickScreenSource([], null), null);
});

test('arquivo: nome com data/jogo, sem caracteres proibidos e sem sobrescrever', () => {
  const d = new Date(2026, 10, 2, 14, 3, 9);
  assert.equal(c.clipFileName(d), 'Clipe 2026-11-02 14-03-09.webm');
  assert.equal(c.clipFileName(d, 'Half-Life: Alyx / VR'), 'Half-Life Alyx VR 2026-11-02 14-03-09.webm');
  const taken = new Set([path.join('/v', 'a.webm'), path.join('/v', 'a (2).webm')]);
  assert.equal(c.uniquePath('/v', 'a.webm', (p) => taken.has(p)), path.join('/v', 'a (3).webm'));
  assert.equal(c.uniquePath('/v', 'b.webm', (p) => taken.has(p)), path.join('/v', 'b.webm'));
});
