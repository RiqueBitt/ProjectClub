// Engine LiveKit (segundo provedor completo da cadeia de voz). Mesma
// "interface" conceitual que o caminho do Agora e o JitsiEngine no
// VoiceContext: join, mute, câmera, tela. Diferente do Jitsi (que renderiza
// a própria UI num iframe), o LiveKit é um SFU que entrega FAIXAS por
// participante — então encaixa na MESMA grade/AudioSink do Agora, porque a
// identidade do participante no LiveKit é o nosso userId (o servidor assina
// o token com sub = userId, ver services/voiceTokens.js). Reações,
// soundboard e lista de participantes seguem pelo NOSSO socket.
//
// Carregado de forma preguiçosa (só baixa o SDK quando realmente entra numa
// call pelo LiveKit), igual ao Agora — não entra no bundle inicial.
//
// Callbacks (superset do JitsiEngine, pra alimentar a grade com faixas):
//   onJoined(myId), onLeft()
//   onLocalSpeaking(bool), onRemoteSpeaking(uid, bool)
//   onSelfMute(bool), onSelfCamera(bool), onSelfScreen(bool)
//   onMediaUser(uid, present)
//   onRemoteAudio(uid, MediaStream), onRemoteVideo(uid, MediaStream, kind)
//   onRemoteRemove(uid, 'audio'|'video'|'all')
//   onError(err, info)

let lkPromise = null;
function loadLiveKit() {
  if (!lkPromise) lkPromise = import('livekit-client');
  return lkPromise;
}
export function preloadLiveKit() { loadLiveKit().catch(() => {}); }

export class LiveKitEngine {
  constructor({ callbacks = {} } = {}) {
    this.cb = callbacks;
    this.room = null;
    this.LK = null;
    this.myId = null;
    this.disposed = false;
    this.lastLocalSpeaking = false;
    // O LiveKit não usa um nó de iframe próprio — a grade é a nossa.
    this.node = null;
  }

  // Compatibilidade com o JitsiEngine (attachJitsi/detachJitsi): sem nó.
  getNode() { return null; }

  capabilities() {
    return { camera: true, screen: true, perUserVolume: true, speakingIndicator: true, customGrid: true };
  }

  _kindOf(pub) {
    try {
      const LK = this.LK;
      if (pub?.source === LK.Track.Source.ScreenShare || pub?.source === LK.Track.Source.ScreenShareAudio) return 'screen';
    } catch { /* fallthrough */ }
    return 'camera';
  }

  _wire() {
    const { RoomEvent } = this.LK;
    const cb = this.cb;
    const room = this.room;
    room.on(RoomEvent.ParticipantConnected, (p) => cb.onMediaUser?.(p.identity, true));
    room.on(RoomEvent.ParticipantDisconnected, (p) => { cb.onRemoteRemove?.(p.identity, 'all'); cb.onMediaUser?.(p.identity, false); });

    room.on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
      const uid = participant.identity;
      cb.onMediaUser?.(uid, true);
      try {
        const stream = new MediaStream([track.mediaStreamTrack]);
        if (track.kind === 'audio') cb.onRemoteAudio?.(uid, stream);
        else if (track.kind === 'video') cb.onRemoteVideo?.(uid, stream, this._kindOf(pub));
      } catch (err) { cb.onError?.(err, { where: 'trackSubscribed' }); }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track, pub, participant) => {
      const uid = participant.identity;
      if (track.kind === 'audio') cb.onRemoteRemove?.(uid, 'audio');
      else if (track.kind === 'video') cb.onRemoteRemove?.(uid, 'video');
    });

    // Indicador de fala (anel verde): o LiveKit já entrega os "active
    // speakers" calculados (inclui o local). Repassa pros mesmos callbacks.
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const ids = new Set(speakers.map((s) => s.identity));
      const localSpeaking = ids.has(this.myId);
      if (localSpeaking !== this.lastLocalSpeaking) {
        this.lastLocalSpeaking = localSpeaking;
        cb.onLocalSpeaking?.(localSpeaking);
      }
      room.remoteParticipants.forEach((p) => cb.onRemoteSpeaking?.(p.identity, ids.has(p.identity)));
    });

    // Reconexão: o SDK do LiveKit refaz a sessão sozinho; só espelhamos na
    // UI (mesmos callbacks do engine próprio).
    room.on(RoomEvent.Reconnecting, () => { if (!this.disposed) cb.onReconnecting?.(1, 'livekit'); });
    room.on(RoomEvent.Reconnected, () => { if (!this.disposed) cb.onReconnected?.(); });
    // Qualidade por participante (escala da UI: 1 excelente … 5 péssima).
    room.on(RoomEvent.ConnectionQualityChanged, () => { if (!this.disposed) this._emitQuality(); });

    room.on(RoomEvent.Disconnected, () => { if (!this.disposed) cb.onLeft?.(); });
  }

  _emitQuality() {
    if (!this.cb.onNetQuality || !this.room) return;
    const { ConnectionQuality } = this.LK;
    const map = { [ConnectionQuality.Excellent]: 1, [ConnectionQuality.Good]: 2, [ConnectionQuality.Poor]: 4, [ConnectionQuality.Lost]: 6 };
    const out = {};
    const put = (p) => { const q = map[p.connectionQuality]; if (q) out[p.identity] = q; };
    put(this.room.localParticipant);
    this.room.remoteParticipants.forEach(put);
    this.cb.onNetQuality(out);
  }

  async join({ url, token, userId, startMuted = false } = {}) {
    this.LK = await loadLiveKit();
    if (this.disposed) return;
    this.myId = String(userId);
    const { Room } = this.LK;
    this.room = new Room({ adaptiveStream: true, dynacast: true });
    this._wire();
    await this.room.connect(url, token);
    if (this.disposed) { try { await this.room.disconnect(); } catch { /* ok */ } return; }
    this.cb.onJoined?.(this.myId);
    // Publica o microfone (a não ser que tenha entrado mudo).
    try {
      await this.room.localParticipant.setMicrophoneEnabled(!startMuted);
    } catch (err) { this.cb.onError?.(err, { where: 'enableMic' }); }
    // Conta quem já estava na sala antes de eu entrar + faixas existentes.
    this.room.remoteParticipants.forEach((p) => {
      this.cb.onMediaUser?.(p.identity, true);
      p.trackPublications.forEach((pub) => {
        if (pub.isSubscribed && pub.track) {
          try {
            const stream = new MediaStream([pub.track.mediaStreamTrack]);
            if (pub.kind === 'audio') this.cb.onRemoteAudio?.(p.identity, stream);
            else if (pub.kind === 'video') this.cb.onRemoteVideo?.(p.identity, stream, this._kindOf(pub));
          } catch { /* faixa não pronta — chega pelo TrackSubscribed */ }
        }
      });
    });
  }

  // enabled=true => quero FALAR (microfone ligado). Espelha o estado real
  // pelo callback onSelfMute, pra o VoiceContext atualizar a UI por um só
  // caminho (igual ao Jitsi).
  async setMicEnabled(enabled) {
    if (!this.room) return;
    try {
      await this.room.localParticipant.setMicrophoneEnabled(!!enabled);
      this.cb.onSelfMute?.(!enabled);
    } catch (err) { this.cb.onError?.(err, { where: 'setMicEnabled' }); }
  }

  async setCamera(on) {
    if (!this.room) return null;
    try {
      await this.room.localParticipant.setCameraEnabled(!!on);
      this.cb.onSelfCamera?.(!!on);
      if (!on) return null;
      const pub = this.room.localParticipant.getTrackPublication(this.LK.Track.Source.Camera);
      const mst = pub?.track?.mediaStreamTrack;
      return mst ? new MediaStream([mst]) : null;
    } catch (err) { this.cb.onError?.(err, { where: 'setCamera' }); return null; }
  }

  async setScreen(on, options = {}) {
    if (!this.room) return null;
    try {
      await this.room.localParticipant.setScreenShareEnabled(!!on, { audio: options.audio !== false });
      this.cb.onSelfScreen?.(!!on);
      if (!on) return null;
      const pub = this.room.localParticipant.getTrackPublication(this.LK.Track.Source.ScreenShare);
      const mst = pub?.track?.mediaStreamTrack;
      return mst ? new MediaStream([mst]) : null;
    } catch (err) { this.cb.onError?.(err, { where: 'setScreen' }); return null; }
  }

  hangup() { this.dispose(); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try { this.room?.disconnect(); } catch { /* já desconectado */ }
    this.room = null;
  }
}

export function createLiveKitEngine(callbacks) {
  return new LiveKitEngine({ callbacks });
}

export default LiveKitEngine;
