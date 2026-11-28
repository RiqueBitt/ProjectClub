// Presets da tela (voice/screenPresets.js): tabela de bitrate, camadas do
// simulcast, contentHint pelo fps, opções do getDisplayMedia e a escolha de
// camada/pausa na recepção pelo tamanho do vídeo.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCREEN_BITRATES, normalizeScreenPreset, nearestScreenFps, screenBitrate, screenContentHint, screenEncodings,
  screenVideoConstraints, displayMediaOptions, spatialLayersOf, pickSpatialLayer, viewportDecision, CONSUMER_PRIORITY,
} from '../src/voice/screenPresets.js';

test('tabela de bitrate: 720p/1080p/1440p × 5/15/30/60', () => {
  const want = {
    '720p': { 5: 0.8, 15: 1.5, 30: 2, 60: 3.5 },
    '1080p': { 5: 1.5, 15: 2.5, 30: 5, 60: 8 },
    '1440p': { 5: 2.5, 15: 4, 30: 7, 60: 10 },
  };
  for (const [q, row] of Object.entries(want)) {
    for (const [f, mbps] of Object.entries(row)) {
      assert.equal(SCREEN_BITRATES[q][f], mbps * 1_000_000, `${q}@${f}`);
      assert.equal(screenBitrate(q, Number(f)), mbps * 1_000_000);
    }
  }
});

test('preset inválido cai no padrão seguro; fps vai pro mais próximo', () => {
  assert.deepEqual(normalizeScreenPreset({}), { quality: '1080p', frameRate: 30 });
  assert.deepEqual(normalizeScreenPreset({ quality: '4k', frameRate: 999 }), { quality: '1080p', frameRate: 60 });
  assert.deepEqual(normalizeScreenPreset({ quality: '1440p', frameRate: 12 }), { quality: '1440p', frameRate: 15 });
  assert.equal(nearestScreenFps(4), 5);
  assert.equal(nearestScreenFps(45), 30);
  assert.equal(nearestScreenFps('abc'), 30);
});

test('contentHint pela regra do Jitsi: ≤15 fps nitidez, 30+ fluidez', () => {
  assert.deepEqual(screenContentHint(5), { contentHint: 'detail', degradationPreference: 'maintain-resolution' });
  assert.deepEqual(screenContentHint(15), { contentHint: 'detail', degradationPreference: 'maintain-resolution' });
  assert.deepEqual(screenContentHint(30), { contentHint: 'motion', degradationPreference: 'maintain-framerate' });
  assert.deepEqual(screenContentHint(60), { contentHint: 'motion', degradationPreference: 'maintain-framerate' });
});

test('simulcast da tela: 2 camadas (metade da resolução ≤15 fps a max(300k, br/4); cheia no bitrate do preset)', () => {
  const e = screenEncodings({ quality: '1080p', frameRate: 60 });
  assert.equal(e.length, 2);
  assert.deepEqual(e[0], { scaleResolutionDownBy: 2, maxBitrate: 2_000_000, maxFramerate: 15, scalabilityMode: 'L1T3' });
  assert.deepEqual(e[1], { scaleResolutionDownBy: 1, maxBitrate: 8_000_000, maxFramerate: 60, scalabilityMode: 'L1T3' });
  const low = screenEncodings({ quality: '720p', frameRate: 5 });
  assert.equal(low[0].maxBitrate, 300_000, 'piso de 300 kbps na camada baixa');
  assert.equal(low[0].maxFramerate, 5, 'camada baixa nunca passa do fps do preset');
  assert.equal(low[1].maxBitrate, 800_000);
  // maxBitrate explícito (legado) manda na camada cheia.
  const custom = screenEncodings({ quality: '720p', frameRate: 30, maxBitrate: 4_000_000 });
  assert.equal(custom[1].maxBitrate, 4_000_000);
  assert.equal(custom[0].maxBitrate, 1_000_000);
});

test('constraints e opções do getDisplayMedia', () => {
  assert.deepEqual(screenVideoConstraints({ quality: '1440p', frameRate: 60 }), {
    width: { ideal: 2560, max: 2560 }, height: { ideal: 1440, max: 1440 }, frameRate: { ideal: 60, max: 60 },
  });
  const o = displayMediaOptions({ quality: '720p', frameRate: 15 });
  assert.equal(o.systemAudio, 'include');
  assert.equal(o.selfBrowserSurface, 'exclude');
  assert.equal(o.surfaceSwitching, 'include');
  assert.equal(o.audio.echoCancellation, false);
  assert.equal(o.audio.noiseSuppression, false);
  assert.equal(o.audio.autoGainControl, false);
  assert.equal(o.audio.restrictOwnAudio, true);
  const mute = displayMediaOptions({ audio: false });
  assert.equal(mute.audio, false);
  assert.equal(mute.systemAudio, undefined, 'sem áudio: nem pede o som do sistema');
});

test('recepção: camadas pelo scalabilityMode e camada pelo tamanho na tela', () => {
  assert.equal(spatialLayersOf({ encodings: [{ scalabilityMode: 'L3T3' }] }), 3);
  assert.equal(spatialLayersOf({ encodings: [{ scalabilityMode: 'L2T3_KEY' }] }), 2);
  assert.equal(spatialLayersOf({ encodings: [{}] }), 1);
  assert.equal(spatialLayersOf(null), 1);
  // Tela (2 camadas)
  assert.equal(pickSpatialLayer(540, 2), 1);
  assert.equal(pickSpatialLayer(539, 2), 0);
  assert.equal(pickSpatialLayer(null, 2), 1, 'sem altura: a mais alta');
  // Câmera (3 camadas)
  assert.equal(pickSpatialLayer(720, 3), 2);
  assert.equal(pickSpatialLayer(300, 3), 1);
  assert.equal(pickSpatialLayer(120, 3), 0);
  assert.equal(pickSpatialLayer(720, 1), 0, 'sem simulcast: camada única');
});

test('viewportDecision: pausa escondido/aba oculta; vários blocos usam o maior visível × devicePixelRatio', () => {
  assert.deepEqual(viewportDecision({ views: [], spatialLayers: 2 }), { paused: false, spatialLayer: 1 }, 'ninguém informou: como antes');
  assert.deepEqual(viewportDecision({ views: [{ visible: true, height: 900 }], documentHidden: true, spatialLayers: 2 }), { paused: true, spatialLayer: null });
  assert.deepEqual(viewportDecision({ views: [{ visible: false, height: 900 }], spatialLayers: 2 }), { paused: true, spatialLayer: null });
  assert.deepEqual(viewportDecision({ views: [{ visible: true, height: 200 }, { visible: false, height: 900 }], spatialLayers: 2 }), { paused: false, spatialLayer: 0 });
  assert.deepEqual(viewportDecision({ views: [{ visible: true, height: 300 }], dpr: 2, spatialLayers: 2 }), { paused: false, spatialLayer: 1 }, '300px × 2 = 600px físicos → alta');
  assert.ok(CONSUMER_PRIORITY.screen > CONSUMER_PRIORITY.camera, 'tela com prioridade maior que a câmera');
});
