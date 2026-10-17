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

import { importWithRetry, browserGuardedReload, micErrorReason } from './resilience.js';

let lkPromise = null;
function loadLiveKit() {
  // Falha no download (deploy novo) não fica guardada: tenta de novo.
  if (!lkPromise) {
    lkPromise = importWithRetry(() => import('livekit-client'), { onChunkFailure: browserGuardedReload })
      .catch((err) => { lkPromise = null; throw err; });
  }
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
        if (track.kind === 'audio') this._emitPeerAudio(participant);
        else if (track.kind === 'video') cb.onRemoteVideo?.(uid, new MediaStream([track.mediaStreamTrack]), this._kindOf(pub));
      } catch (err) { cb.onError?.(err, { where: 'trackSubscribed' }); }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track, pub, participant) => {
      const uid = participant.identity;
      if (track.kind === 'audio') this._emitPeerAudio(participant, track);
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

    // Desconectou de vez (o SDK já tentou reconectar): mesma aba em outro
    // aparelho → 'replaced' (não volta); removido/sala apagada → 'kicked';
    // queda que o SDK não recuperou → 'gave-up' (o VoiceContext refaz a mídia).
    room.on(RoomEvent.Disconnected, (reason) => {
      if (this.disposed) return;
      const R = this.LK.DisconnectReason || {};
      if (reason === R.CLIENT_INITIATED) return;
      const why = reason === R.DUPLICATE_IDENTITY ? 'replaced'
        : (reason === R.PARTICIPANT_REMOVED || reason === R.ROOM_DELETED) ? 'kicked' : 'gave-up';
      cb.onLeft?.({ reason: why });
    });
  }

  // Todas as faixas de áudio da pessoa (mic + áudio da tela) num stream só —
  // antes o áudio da tela SUBSTITUÍA o microfone na grade.
  _emitPeerAudio(participant, removedTrack = null) {
    const tracks = [];
    try {
      participant.trackPublications.forEach((pub) => {
        const t = pub.track;
        if (pub.kind === 'audio' && pub.isSubscribed && t && t !== removedTrack && t.mediaStreamTrack) tracks.push(t.mediaStreamTrack);
      });
    } catch { /* participante saindo */ }
    if (tracks.length) this.cb.onRemoteAudio?.(participant.identity, new MediaStream(tracks));
    else this.cb.onRemoteRemove?.(participant.identity, 'audio');
  }

  getInboundAudioBytes() { return null; }

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
    // Mic negado/ausente: segue na sala só ouvindo.
    try {
      await this.room.localParticipant.setMicrophoneEnabled(!startMuted);
    } catch (err) {
      const reason = micErrorReason(err);
      this.cb.onSelfMute?.(true);
      if (reason && this.cb.onMicUnavailable) this.cb.onMicUnavailable({ reason, error: err });
      else this.cb.onError?.(err, { where: 'enableMic' });
    }
    // Conta quem já estava na sala antes de eu entrar + faixas existentes.
    this.room.remoteParticipants.forEach((p) => {
      this.cb.onMediaUser?.(p.identity, true);
      let hasAudio = false;
      p.trackPublications.forEach((pub) => {
        if (pub.isSubscribed && pub.track) {
          try {
            if (pub.kind === 'audio') hasAudio = true;
            else if (pub.kind === 'video') this.cb.onRemoteVideo?.(p.identity, new MediaStream([pub.track.mediaStreamTrack]), this._kindOf(pub));
          } catch { /* faixa não pronta — chega pelo TrackSubscribed */ }
        }
      });
      if (hasAudio) { try { this._emitPeerAudio(p); } catch { /* chega pelo TrackSubscribed */ } }
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
