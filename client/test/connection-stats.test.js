// Painel "Qualidade da conexão": normalização das stats dos provedores e
// o sparkline do ping. Funções puras (sem DOM/WebRTC).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prettyCodec, bitrateKbps, summarizeWebRtcStats, screenFromStats, summarizeAgoraStats,
  pushSample, sparklinePath, serverHost,
} from '../src/voice/connectionStats.js';

const asReport = (arr) => new Map(arr.map((s, i) => [s.id || `s${i}`, s]));

test('prettyCodec / serverHost', () => {
  assert.equal(prettyCodec('audio/opus'), 'Opus');
  assert.equal(prettyCodec('video/VP8'), 'VP8');
  assert.equal(prettyCodec('AV1X'), 'AV1');
  assert.equal(prettyCodec(undefined), null);
  assert.equal(serverHost('wss://voz.exemplo.com:4443/ws?x=1'), 'voz.exemplo.com:4443');
  assert.equal(serverHost('não é url'), null);
});

test('bitrateKbps: delta em kbps; contador zerado não gera número falso', () => {
  assert.equal(bitrateKbps(250_000, 0, 2000), 1000);
  assert.equal(bitrateKbps(100, 500, 2000), null);
  assert.equal(bitrateKbps(100, 0, 0), null);
});

test('summarizeWebRtcStats: RTT, perda recente, jitter, bitrate e codec', () => {
  const send = asReport([
    { id: 'cp', type: 'candidate-pair', nominated: true, currentRoundTripTime: 0.042 },
    { id: 'c1', type: 'codec', mimeType: 'audio/opus' },
    { id: 'o1', type: 'outbound-rtp', kind: 'audio', codecId: 'c1', bytesSent: 10_000 },
    { id: 'ri', type: 'remote-inbound-rtp', kind: 'audio', fractionLost: 0.01, jitter: 0.004 },
  ]);
  const recv = asReport([
    { id: 'cp2', type: 'candidate-pair', state: 'succeeded', currentRoundTripTime: 0.05 },
    { id: 'i1', type: 'inbound-rtp', kind: 'audio', bytesReceived: 20_000, packetsLost: 2, packetsReceived: 98, jitter: 0.012 },
  ]);
  const first = summarizeWebRtcStats([send, recv], null, 1000);
  assert.equal(first.snapshot.rttMs, 42);
  assert.equal(first.snapshot.audioCodec, 'Opus');
  assert.equal(first.snapshot.jitterMs, 12);
  assert.equal(first.snapshot.outKbps, null, 'sem leitura anterior não há bitrate');
  assert.equal(first.snapshot.lossPct, 1, 'sem anterior usa a perda relatada pelo servidor');

  const send2 = asReport([...send.values()].map((s) => (s.id === 'o1' ? { ...s, bytesSent: 260_000 } : s)));
  const recv2 = asReport([...recv.values()].map((s) => (s.id === 'i1' ? { ...s, bytesReceived: 520_000, packetsLost: 7, packetsReceived: 193 } : s)));
  const second = summarizeWebRtcStats([send2, recv2], first.counters, 3000);
  assert.equal(second.snapshot.outKbps, 1000);
  assert.equal(second.snapshot.inKbps, 2000);
  assert.equal(second.snapshot.lossPct, 5, '5 perdidos em 100 desde a última leitura');
  assert.equal(second.snapshot.screen, null);
});

test('summarizeWebRtcStats: sem nada medido devolve nulls', () => {
  const { snapshot } = summarizeWebRtcStats([], null, 0);
  assert.deepEqual(snapshot, { rttMs: null, lossPct: null, jitterMs: null, outKbps: null, inKbps: null, audioCodec: null, videoCodec: null, screen: null });
});

test('screenFromStats: pega a maior camada de vídeo que está saindo', () => {
  const r = asReport([
    { type: 'outbound-rtp', kind: 'video', frameWidth: 1280, frameHeight: 720, framesPerSecond: 29.6 },
    { type: 'outbound-rtp', kind: 'video', frameWidth: 1920, frameHeight: 1080, framesPerSecond: 59.8 },
    { type: 'outbound-rtp', kind: 'audio' },
  ]);
  assert.deepEqual(screenFromStats(r), { width: 1920, height: 1080, fps: 60 });
  assert.equal(screenFromStats(null), null);
});

test('summarizeAgoraStats: converte bps→kbps e usa a pior perda', () => {
  const s = summarizeAgoraStats({
    rtc: { RTT: 63, SendBitrate: 128_000, RecvBitrate: 256_000 },
    localAudio: { codecType: 'opus', currentPacketLossRate: 0.5, sendJitterMs: 3 },
    remoteAudio: { u2: { currentPacketLossRate: 2.25 } },
    localVideo: { codecType: 'VP8', sendResolutionWidth: 1920, sendResolutionHeight: 1080, sendFrameRate: 30 },
    screenOn: true, cameraOn: false,
  });
  assert.equal(s.rttMs, 63);
  assert.equal(s.outKbps, 128);
  assert.equal(s.inKbps, 256);
  assert.equal(s.lossPct, 2.3);
  assert.equal(s.audioCodec, 'Opus');
  assert.deepEqual(s.screen, { width: 1920, height: 1080, fps: 30 });
  assert.equal(summarizeAgoraStats({}).rttMs, null);
});

test('pushSample mantém só a janela; sparklinePath gera um caminho dentro da caixa', () => {
  let h = [];
  for (let t = 0; t <= 90_000; t += 2000) h = pushSample(h, 40 + (t % 7), t);
  assert.ok(h.every((p) => 90_000 - p.t <= 60_000));
  assert.equal(pushSample(h, NaN, 90_000).length, h.length);
  const d = sparklinePath(h, 120, 28, 90_000);
  assert.match(d, /^M [\d.]+ [\d.]+( L [\d.]+ [\d.]+)+$/);
  const nums = d.match(/[\d.]+/g).map(Number);
  assert.ok(nums.every((n) => n >= 0 && n <= 120));
  assert.equal(sparklinePath([], 120, 28, 0), '');
});
