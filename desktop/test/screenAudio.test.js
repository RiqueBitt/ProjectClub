// Áudio da tela: escolha do loopback no Windows (sem o som da própria call
// no 22H2+) e montagem do link do venmic no Linux. Roda com `node --test`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sa = require('../screenAudio');

const NEW_CHROME = '146.0.0.0';

test('Windows 10 22H2 (19045) + Chromium novo usa loopbackWithoutChrome', () => {
  assert.equal(sa.pickLoopbackAudio({ platform: 'win32', osRelease: '10.0.19045', chromeVersion: NEW_CHROME, env: {} }), 'loopbackWithoutChrome');
  assert.equal(sa.pickLoopbackAudio({ platform: 'win32', osRelease: '10.0.26100', chromeVersion: NEW_CHROME, env: {} }), 'loopbackWithoutChrome');
});

test('Windows antigo ou Chromium antigo cai pro loopback comum', () => {
  assert.equal(sa.pickLoopbackAudio({ platform: 'win32', osRelease: '10.0.19044', chromeVersion: NEW_CHROME, env: {} }), 'loopback');
  assert.equal(sa.pickLoopbackAudio({ platform: 'win32', osRelease: '6.1.7601', chromeVersion: NEW_CHROME, env: {} }), 'loopback');
  assert.equal(sa.pickLoopbackAudio({ platform: 'win32', osRelease: '10.0.22631', chromeVersion: '126.0.6478.234', env: {} }), 'loopback');
  assert.equal(sa.pickLoopbackAudio({ platform: 'win32', osRelease: 'lixo', chromeVersion: NEW_CHROME, env: {} }), 'loopback');
});

test('variável PROJECT_CLUB_SCREEN_AUDIO força o modo', () => {
  const base = { platform: 'win32', osRelease: '10.0.22631', chromeVersion: NEW_CHROME };
  assert.equal(sa.pickLoopbackAudio({ ...base, env: { PROJECT_CLUB_SCREEN_AUDIO: 'loopback' } }), 'loopback');
  assert.equal(sa.pickLoopbackAudio({ ...base, env: { PROJECT_CLUB_SCREEN_AUDIO: 'off' } }), null);
});

test('Linux: com venmic só vídeo; sem venmic mantém loopback', () => {
  assert.equal(sa.pickLoopbackAudio({ platform: 'linux', env: {}, linuxVirtualMic: true }), null);
  assert.equal(sa.pickLoopbackAudio({ platform: 'linux', env: {}, linuxVirtualMic: false }), 'loopback');
});

test('exclui o processo Audio Service do app e fluxos de entrada', () => {
  const data = sa.buildLinkData([
    { pid: 10, type: 'Browser' },
    { pid: 22, type: 'Utility', name: 'Audio Service', serviceName: 'audio.mojom.AudioService' },
    { pid: 30, type: 'Tab' },
  ]);
  const pids = data.exclude.filter((n) => n['application.process.id']).map((n) => n['application.process.id']);
  assert.ok(pids.includes('22'));
  assert.ok(!pids.includes('30'));
  assert.ok(data.exclude.some((n) => n['media.class'] === 'Stream/Input/Audio'));
  assert.equal(data.ignore_devices, true);
});

test('sem processo de áudio identificado, exclui todos os processos do app', () => {
  const pids = sa.ownAudioPids([{ pid: 10 }, { pid: 30 }]);
  assert.ok(pids.includes(10) && pids.includes(30));
});

test('sem venmic/PipeWire nunca quebra: supported false, start devolve erro', () => {
  sa._reset();
  if (process.platform !== 'linux') {
    assert.equal(sa.isSupported(), false);
    assert.deepEqual(sa.start(() => []), { ok: false, error: 'unsupported' });
  } else {
    assert.equal(typeof sa.isSupported(), 'boolean');
  }
  assert.deepEqual(sa.stop(), { ok: true });
});
