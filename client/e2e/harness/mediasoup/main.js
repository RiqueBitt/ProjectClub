// Página-teste do engine próprio (media-server). Usada só pelo
// media-server/test/e2e-webrtc.mjs (Chromium com mídia fake).
// O áudio remoto toca pelo MESMO caminho do app (voice/audioPlayback.js:
// um <audio> por faixa), pra o teste provar que a reprodução funciona.
import { createMediasoupEngine } from '../../../src/voice/mediasoupEngine.js';
import { RemoteTrackPlayer } from '../../../src/voice/audioPlayback.js';

window.events = [];
const pack = (x) => (x instanceof MediaStream ? { stream: true, active: x.active, tracks: x.getTracks().map((t) => t.kind) } : x);
const log = (type, ...a) => window.events.push({ type, a: a.map(pack) });

// Reprodução: uid -> [RemoteTrackPlayer]
window.players = {};
function playStream(uid, stream) {
  (window.players[uid] || []).forEach((p) => p.dispose());
  window.players[uid] = stream.getAudioTracks().map((track) => new RemoteTrackPlayer({
    track, userId: uid, healMs: 1000,
    getInboundBytes: () => window.engine?.getInboundAudioBytes(uid) ?? null,
    onBlocked: () => log('playBlocked', uid),
  }));
}
function stopStream(uid) {
  (window.players[uid] || []).forEach((p) => p.dispose());
  delete window.players[uid];
}
window.playback = (uid) => (window.players[uid] || []).map((p) => p.state());
window.setVolume = (uid, v) => (window.players[uid] || []).forEach((p) => p.setVolume(v));
window.audioElements = () => document.querySelectorAll('audio[data-voice-uid]').length;

window.refreshCalls = 0;
window.nextToken = null;

window.joinRoom = async ({ url, token, userId, startMuted = false, noiseSuppression = false }) => {
  const engine = createMediasoupEngine({
    onJoined: (id) => log('joined', id),
    onLeft: (info) => log('left', info || null),
    onReconnecting: (n, why) => log('reconnecting', n, why),
    onReconnected: () => log('reconnected'),
    onNetQuality: (q) => log('netQuality', q),
    onRtt: (ms) => log('rtt', ms),
    onLocalSpeaking: (b) => log('localSpeaking', b),
    onRemoteSpeaking: (u, b) => log('remoteSpeaking', u, b),
    onSelfMute: (b) => log('selfMute', b),
    onSelfCamera: (b) => log('selfCamera', b),
    onSelfScreen: (b) => log('selfScreen', b),
    onMicUnavailable: (info) => log('micUnavailable', { reason: info.reason }),
    onMicRecovered: () => log('micRecovered'),
    onMediaFailed: (info) => log('mediaFailed', info),
    onMediaUser: (u, p) => log('mediaUser', u, p),
    onRemoteAudio: (u, s) => { log('remoteAudio', u, s); window.lastAudio = s; playStream(u, s); },
    onRemoteVideo: (u, s, k) => { log('remoteVideo', u, s, k); window.lastVideo = s; },
    onRemoteRemove: (u, k) => { log('remoteRemove', u, k); if (k === 'audio' || k === 'all') stopStream(u); },
    onError: (e, i) => log('error', String((e && e.message) || e), i),
  });
  window.engine = engine;
  await engine.join({
    url, token, userId, iceServers: [], startMuted, noiseSuppression,
    refreshCredentials: async () => { window.refreshCalls += 1; return window.nextToken ? { token: window.nextToken } : null; },
  });
  return true;
};

// Bytes RTP recebidos em todos os consumers (prova que a mídia passa pelo SFU).
window.bytesReceived = async () => {
  let total = 0;
  for (const { consumer } of window.engine.consumers.values()) {
    const stats = await consumer.getStats();
    stats.forEach((r) => { if (r.type === 'inbound-rtp') total += r.bytesReceived || 0; });
  }
  return total;
};
window.bytesSent = async () => {
  let total = 0;
  for (const p of Object.values(window.engine.producers)) {
    if (!p) continue;
    const stats = await p.getStats();
    stats.forEach((r) => { if (r.type === 'outbound-rtp') total += r.bytesSent || 0; });
  }
  return total;
};
