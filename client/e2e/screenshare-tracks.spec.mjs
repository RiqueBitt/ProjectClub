import { test, expect } from '@playwright/test';
import {
  buildScreenShareConfig, collectScreenPublishTracks, assertNoMicInScreenShare, SCREEN_QUALITY_PRESETS,
} from '../src/utils/screenShareTracks.js';

// Item pedido C: o compartilhamento de tela NÃO pode carregar a voz do
// microfone — só o som do sistema/aba. Estes testes conferem a montagem
// das faixas direto, sem navegador nem Agora de verdade.

// Faixas de mentira com o mesmo formato das do Agora (getMediaStreamTrack).
function fakeTrack(label) {
  const media = { kind: label.includes('audio') ? 'audio' : 'video', _label: label };
  return { _label: label, getMediaStreamTrack: () => media };
}

test('buildScreenShareConfig: "auto" captura áudio do sistema; "disable" não — nunca o mic', () => {
  const withAudio = buildScreenShareConfig({ quality: '1080p', frameRate: 30, audio: true });
  expect(withAudio.audioParam).toBe('auto');
  expect(withAudio.encoderConfig).toEqual({ ...SCREEN_QUALITY_PRESETS['1080p'], frameRate: 30 });

  const noAudio = buildScreenShareConfig({ quality: '720p', frameRate: 60, audio: false });
  expect(noAudio.audioParam).toBe('disable');
  expect(noAudio.encoderConfig.width).toBe(1280);

  // Valores inválidos caem no padrão seguro (1080p/30).
  const bad = buildScreenShareConfig({ quality: '4k', frameRate: 999 });
  expect(bad.quality).toBe('1080p');
  expect(bad.frameRate).toBe(30);
});

test('collectScreenPublishTracks: publica tela + áudio do sistema, e NUNCA a faixa do mic', () => {
  const screenVideo = fakeTrack('screen-video');
  const systemAudio = fakeTrack('system-audio');
  const mic = fakeTrack('mic-audio');

  const toPublish = collectScreenPublishTracks(screenVideo, systemAudio, mic);
  expect(toPublish).toContain(screenVideo);
  expect(toPublish).toContain(systemAudio);
  expect(toPublish).not.toContain(mic);
  expect(toPublish).toHaveLength(2);

  // Mesmo que o mic fosse passado por engano como "áudio do sistema", ele é removido.
  const sneaky = collectScreenPublishTracks(screenVideo, mic, mic);
  expect(sneaky).not.toContain(mic);
  expect(sneaky).toEqual([screenVideo]);

  // Sem áudio do sistema: só o vídeo da tela.
  expect(collectScreenPublishTracks(screenVideo, null, mic)).toEqual([screenVideo]);
});

test('assertNoMicInScreenShare: confirma que a voz do mic não está na transmissão', () => {
  const screenVideo = fakeTrack('screen-video');
  const systemAudio = fakeTrack('system-audio');
  const mic = fakeTrack('mic-audio');

  // Conjunto correto (só tela + som do sistema): passa.
  expect(assertNoMicInScreenShare([screenVideo, systemAudio], mic)).toBe(true);
  // Conjunto com o mic dentro (a mesma referência): falha.
  expect(assertNoMicInScreenShare([screenVideo, mic], mic)).toBe(false);
  // Conjunto com uma faixa que embrulha a MESMA MediaStreamTrack do mic: falha.
  const micWrapper = { getMediaStreamTrack: () => mic.getMediaStreamTrack() };
  expect(assertNoMicInScreenShare([screenVideo, micWrapper], mic)).toBe(false);
});
