// Engine de voz do Stream (GetStream Video) — terceiro provedor da cadeia
// (servidor próprio → Agora → Stream). Mesma interface do engine próprio
// (mediasoupEngine.js): join/setMicEnabled/setCamera/setScreen/dispose e os
// mesmos callbacks, então a grade, o AudioSink, o "quem está falando" e a
// troca de provedor no meio da chamada funcionam igual.
//
// O SDK (@stream-io/video-client) é carregado só quando o Stream é usado
// (import dinâmico) — não pesa no carregamento do site.

// Tipos de faixa do SFU do Stream (SfuModels.TrackType).
const TT = { AUDIO: 1, VIDEO: 2, SCREEN_SHARE: 3, SCREEN_SHARE_AUDIO: 4 };
const CALL_TYPE = 'default';

let sdkPromise = null;
function loadSdk() {
  if (!sdkPromise) sdkPromise = import('@stream-io/video-client').catch((err) => { sdkPromise = null; throw err; });
  return sdkPromise;
}
export function preloadGetStream() { loadSdk().catch(() => {}); }

export class GetStreamEngine {
  constructor({ callbacks = {} } = {}) {
    this.cb = callbacks;
    this.client = null;
    this.call = null;
    this.subs = [];
    this.disposed = false;
    // Estado por pessoa (userId → o que já avisamos pra UI).
    this.known = new Map(); // userId -> { sessionId, audio, video, screen, speaking }
    this.micEnabled = true;
  }

  getNode() { return null; }

  capabilities() {
    return { camera: true, screen: true, perUserVolume: true, speakingIndicator: true, customGrid: true, netQuality: false, reconnect: true, noiseSuppression: false };
  }

  async join({ apiKey, token, userId, callId, displayName, startMuted = false } = {}) {
    if (!apiKey || !token || !userId || !callId) throw new Error('Credenciais do Stream incompletas.');
    const { StreamVideoClient } = await loadSdk();
    if (this.disposed) throw new Error('cancelado');
    this.userId = String(userId);
    this.client = new StreamVideoClient({
      apiKey,
      user: { id: this.userId, name: displayName || this.userId },
      token,
      options: { logLevel: 'warn' },
    });
    const call = this.client.call(CALL_TYPE, String(callId));
    this.call = call;
    // Câmera desligada ao entrar (é chamada de voz); microfone conforme o mudo.
    try { await call.camera.disable(); } catch { /* sem câmera */ }
    if (startMuted) { try { await call.microphone.disable(); } catch { /* ok */ } }
    await call.join({ create: true });
    if (this.disposed) { this._leaveQuietly(); throw new Error('cancelado'); }

    this.micEnabled = !startMuted;
    if (!startMuted) {
      try { await call.microphone.enable(); } catch (err) { this.micEnabled = false; this.cb.onError?.(err, { where: 'microphone' }); }
    }
    this.cb.onSelfMute?.(!this.micEnabled);

    // Pessoas e faixas.
    this.subs.push(call.state.participants$.subscribe((list) => this._sync(list || [])));
    // Reconexão (o SDK reconecta sozinho; só espelhamos na UI).
    this.subs.push(call.state.callingState$.subscribe((s) => {
      const v = String(s || '').toLowerCase();
      if (v === 'reconnecting' || v === 'migrating' || v === 'offline') this.cb.onReconnecting?.(1, v);
      else if (v === 'joined') this.cb.onReconnected?.();
      else if (v === 'left' && !this.disposed) this.cb.onLeft?.();
    }));
    this.cb.onJoined?.(this.userId);
    return true;
  }

  _sync(list) {
    const seen = new Set();
    const call = this.call;
    if (!call) return;
    const wantVideo = {};
    const wantScreen = {};
    for (const p of list) {
      const uid = String(p.userId || '');
      if (!uid) continue;
      const tracks = p.publishedTracks || [];
      if (p.isLocalParticipant) {
        const speaking = !!p.isSpeaking && this.micEnabled;
        if (speaking !== this.localSpeaking) { this.localSpeaking = speaking; this.cb.onLocalSpeaking?.(speaking); }
        continue;
      }
      seen.add(uid);
      const prev = this.known.get(uid) || {};
      if (!this.known.has(uid)) this.cb.onMediaUser?.(uid, true);
      // Pede o vídeo/tela de quem está publicando (o áudio vem sozinho).
      if (tracks.includes(TT.VIDEO) && !p.videoDimension) wantVideo[p.sessionId] = { dimension: { width: 1280, height: 720 } };
      if (tracks.includes(TT.SCREEN_SHARE) && !p.screenShareDimension) wantScreen[p.sessionId] = { dimension: { width: 1920, height: 1080 } };

      const audio = tracks.includes(TT.AUDIO) ? p.audioStream || null : null;
      if (audio !== (prev.audio || null)) {
        if (audio) this.cb.onRemoteAudio?.(uid, audio);
        else if (prev.audio) this.cb.onRemoteRemove?.(uid, 'audio');
      }
      const screen = tracks.includes(TT.SCREEN_SHARE) ? p.screenShareStream || null : null;
      const video = tracks.includes(TT.VIDEO) ? p.videoStream || null : null;
      // A grade mostra UM vídeo por pessoa: a tela tem prioridade sobre a câmera.
      const shown = screen || video;
      const kind = screen ? 'screen' : 'camera';
      if (shown !== (prev.shown || null)) {
        if (shown) this.cb.onRemoteVideo?.(uid, shown, kind);
        else if (prev.shown) this.cb.onRemoteRemove?.(uid, 'video');
      }
      const speaking = !!p.isSpeaking && tracks.includes(TT.AUDIO);
      if (speaking !== !!prev.speaking) this.cb.onRemoteSpeaking?.(uid, speaking);
      this.known.set(uid, { sessionId: p.sessionId, audio, shown, speaking });
    }
    for (const uid of [...this.known.keys()]) {
      if (seen.has(uid)) continue;
      this.known.delete(uid);
      this.cb.onRemoteRemove?.(uid, 'all');
      this.cb.onMediaUser?.(uid, false);
    }
    try {
      if (Object.keys(wantVideo).length) call.state.updateParticipantTracks('videoTrack', wantVideo);
      if (Object.keys(wantScreen).length) call.state.updateParticipantTracks('screenShareTrack', wantScreen);
      if (Object.keys(wantVideo).length || Object.keys(wantScreen).length) call.trackSubscriptionManager?.apply?.();
    } catch (err) { this.cb.onError?.(err, { where: 'subscriptions' }); }
  }

  // enabled=true => quero FALAR.
  async setMicEnabled(enabled) {
    if (!this.call) return;
    try {
      if (enabled) await this.call.microphone.enable();
      else await this.call.microphone.disable();
      this.micEnabled = !!enabled;
      this.cb.onSelfMute?.(!enabled);
    } catch (err) { this.cb.onError?.(err, { where: 'setMicEnabled' }); }
  }

  async setNoiseSuppression() { /* o Stream tem o próprio filtro do navegador */ }

  async setCamera(on) {
    if (!this.call) return null;
    try {
      if (!on) { await this.call.camera.disable(); this.cb.onSelfCamera?.(false); return null; }
      await this.call.camera.enable();
      this.cb.onSelfCamera?.(true);
      return this.call.camera.state.mediaStream || null;
    } catch (err) { this.cb.onError?.(err, { where: 'setCamera' }); return null; }
  }

  async setScreen(on, options = {}) {
    if (!this.call) return null;
    try {
      if (!on) { await this.call.screenShare.disable(); this.cb.onSelfScreen?.(false); return null; }
      try { if (options.audio === false) this.call.screenShare.disableScreenShareAudio?.(); else this.call.screenShare.enableScreenShareAudio?.(); } catch { /* ok */ }
      await this.call.screenShare.enable();
      const stream = this.call.screenShare.state.mediaStream || null;
      stream?.getVideoTracks?.()[0]?.addEventListener('ended', () => { this.setScreen(false); });
      this.cb.onSelfScreen?.(true);
      return stream;
    } catch (err) { this.cb.onError?.(err, { where: 'setScreen' }); return null; }
  }

  _leaveQuietly() {
    const call = this.call; const client = this.client;
    this.call = null; this.client = null;
    for (const u of this.subs) { try { u.unsubscribe(); } catch { /* ok */ } }
    this.subs = [];
    if (call) call.leave().catch(() => {});
    if (client) client.disconnectUser().catch(() => {});
  }

  hangup() { this.dispose(); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.known.clear();
    this._leaveQuietly();
  }
}

export function createGetStreamEngine(callbacks) {
  return new GetStreamEngine({ callbacks });
}
