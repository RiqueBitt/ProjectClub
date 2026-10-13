// Engine do servidor de mídia PRÓPRIO do Project Club (media-server/,
// mediasoup). Mesma "interface" do LiveKitEngine, então encaixa na MESMA
// grade/AudioSink do VoiceContext: entrega faixas por participante, e a
// identidade na sala é o nosso userId (o servidor assina o JWT com
// sub = userId, ver services/voiceTokens.js mintProjectClub).
//
// Fluxo (PDF, seção 1 "Fluxo simplificado de uma chamada"):
//   1. conecta no wss://.../ws?token=<jwt>  → recebe `welcome` (capacidades
//      RTP do roteador + quem já está + o que cada um publica)
//   2. carrega o Device do mediasoup-client com essas capacidades
//   3. cria 1 transport de ENVIO e 1 de RECEPÇÃO (ICE/DTLS; STUN/TURN vêm do
//      servidor nas credenciais — credencial TURN temporária)
//   4. publica o microfone (câmera/tela sob demanda) e assina a mídia dos
//      outros (um consumer por producer remoto)
//   5. ao sair, fecha tudo
//
// Carregado de forma preguiçosa (o SDK só baixa quando entra numa call por
// este provedor), igual Agora/LiveKit — não entra no bundle inicial.
//
// Callbacks (iguais ao LiveKitEngine):
//   onJoined(myId), onLeft()
//   onLocalSpeaking(bool), onRemoteSpeaking(uid, bool)
//   onSelfMute(bool), onSelfCamera(bool), onSelfScreen(bool)
//   onMediaUser(uid, present)
//   onRemoteAudio(uid, MediaStream), onRemoteVideo(uid, MediaStream, kind)
//   onRemoteRemove(uid, 'audio'|'video'|'all')
//   onError(err, info)

let msPromise = null;
function loadMediasoup() {
  if (!msPromise) msPromise = import('mediasoup-client');
  return msPromise;
}
export function preloadMediasoup() { loadMediasoup().catch(() => {}); }

// Camadas de simulcast da câmera: o SFU escolhe por ouvinte conforme a banda
// (PDF 4.4). Tela: uma camada só, priorizando nitidez.
const CAMERA_ENCODINGS = [
  { scaleResolutionDownBy: 4, maxBitrate: 150_000, scalabilityMode: 'L1T3' },
  { scaleResolutionDownBy: 2, maxBitrate: 500_000, scalabilityMode: 'L1T3' },
  { scaleResolutionDownBy: 1, maxBitrate: 1_200_000, scalabilityMode: 'L1T3' },
];
const SCREEN_ENCODINGS = [{ maxBitrate: 2_500_000 }];

const REQUEST_TIMEOUT_MS = 15000;

export class MediasoupEngine {
  constructor({ callbacks = {} } = {}) {
    this.cb = callbacks;
    this.ws = null;
    this.device = null;
    this.sendTransport = null;
    this.recvTransport = null;
    this.myId = null;
    this.disposed = false;
    this.seq = 0;
    this.pending = new Map(); // id -> { resolve, reject, timer }
    this.producers = { mic: null, camera: null, screen: null, screenAudio: null };
    this.localTracks = { mic: null, camera: null, screen: null, screenAudio: null };
    this.consumers = new Map(); // consumerId -> { consumer, peerId, kind, source }
    this.peers = new Set(); // peerIds remotos conhecidos
    this.lastLocalSpeaking = false;
    this.iceServers = [];
    this.node = null;
  }

  getNode() { return null; }

  capabilities() {
    return { camera: true, screen: true, perUserVolume: true, speakingIndicator: true, customGrid: true };
  }

  // ---------- sinalização ----------
  _request(method, data = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return reject(new Error('sinalização desconectada'));
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout em ${method}`)); }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      try { this.ws.send(JSON.stringify({ id, method, data })); } catch (err) { clearTimeout(timer); this.pending.delete(id); reject(err); }
    });
  }

  _connect(url, token) {
    return new Promise((resolve, reject) => {
      const sep = url.includes('?') ? '&' : '?';
      const ws = new WebSocket(`${url}${sep}token=${encodeURIComponent(token)}`);
      this.ws = ws;
      let welcomed = false;
      ws.onmessage = (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.id && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id); this.pending.delete(msg.id); clearTimeout(p.timer);
          if (msg.ok) p.resolve(msg.data); else p.reject(new Error(msg.error || 'erro'));
          return;
        }
        if (msg.event === 'welcome' && !welcomed) { welcomed = true; resolve(msg.data); return; }
        if (msg.event) this._onEvent(msg.event, msg.data || {});
      };
      ws.onerror = () => { if (!welcomed) reject(new Error('não foi possível conectar no servidor de mídia')); };
      ws.onclose = (ev) => {
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('sinalização fechada')); }
        this.pending.clear();
        if (!welcomed) reject(new Error(`conexão recusada (${ev.code})`));
        else if (!this.disposed) { this.cb.onLeft?.(); }
      };
    });
  }

  _onEvent(event, data) {
    const cb = this.cb;
    switch (event) {
      case 'peerJoined':
        this.peers.add(String(data.peerId));
        cb.onMediaUser?.(String(data.peerId), true);
        break;
      case 'peerLeft': {
        const uid = String(data.peerId);
        this.peers.delete(uid);
        for (const [cid, c] of this.consumers) { if (c.peerId === uid) { try { c.consumer.close(); } catch { /* ok */ } this.consumers.delete(cid); } }
        cb.onRemoteRemove?.(uid, 'all');
        cb.onMediaUser?.(uid, false);
        break;
      }
      case 'newProducer':
        this._consume(data).catch((err) => cb.onError?.(err, { where: 'consume' }));
        break;
      case 'producerClosed':
      case 'consumerClosed': {
        // producerClosed traz {peerId, producerId}; consumerClosed traz {consumerId}.
        for (const [cid, c] of this.consumers) {
          const match = data.consumerId ? cid === data.consumerId : c.consumer.producerId === data.producerId;
          if (!match) continue;
          try { c.consumer.close(); } catch { /* ok */ }
          this.consumers.delete(cid);
          cb.onRemoteRemove?.(c.peerId, c.kind === 'audio' ? 'audio' : 'video');
        }
        break;
      }
      case 'activeSpeakers': {
        const ids = new Set((data.peerIds || []).map(String));
        const local = ids.has(this.myId);
        if (local !== this.lastLocalSpeaking) { this.lastLocalSpeaking = local; cb.onLocalSpeaking?.(local); }
        for (const uid of this.peers) cb.onRemoteSpeaking?.(uid, ids.has(uid));
        break;
      }
      case 'kicked':
        if (!this.disposed) { this.disposed = true; this._closeAll(); cb.onLeft?.(); }
        break;
      default: break;
    }
  }

  // ---------- entrar ----------
  async join({ url, token, userId, iceServers = [], startMuted = false } = {}) {
    const { Device } = await loadMediasoup();
    if (this.disposed) return;
    if (!url || !token) throw new Error('credenciais do servidor de mídia ausentes');
    this.myId = String(userId);
    this.iceServers = Array.isArray(iceServers) ? iceServers : [];

    const welcome = await this._connect(url, token);
    if (this.disposed) { this._closeAll(); return; }

    this.device = new Device();
    await this.device.load({ routerRtpCapabilities: welcome.routerRtpCapabilities });

    this.sendTransport = await this._createTransport('send');
    this.recvTransport = await this._createTransport('recv');
    if (this.disposed) { this._closeAll(); return; }

    this.cb.onJoined?.(this.myId);

    // Quem já estava na sala.
    for (const p of welcome.peers || []) { this.peers.add(String(p.id)); this.cb.onMediaUser?.(String(p.id), true); }

    // Microfone (publica e, se entrou mudo, deixa pausado — desmutar é instantâneo).
    try { await this._publishMic(startMuted); } catch (err) { this.cb.onError?.(err, { where: 'enableMic' }); }

    // Mídia que os outros já publicavam.
    for (const prod of welcome.producers || []) {
      this._consume(prod).catch((err) => this.cb.onError?.(err, { where: 'consumeExisting' }));
    }
  }

  async _createTransport(direction) {
    const info = await this._request('createTransport', { direction });
    const params = {
      id: info.id, iceParameters: info.iceParameters, iceCandidates: info.iceCandidates,
      dtlsParameters: info.dtlsParameters, iceServers: this.iceServers,
    };
    const transport = direction === 'send' ? this.device.createSendTransport(params) : this.device.createRecvTransport(params);
    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      this._request('connectTransport', { transportId: transport.id, dtlsParameters }).then(() => callback()).catch(errback);
    });
    if (direction === 'send') {
      transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
        this._request('produce', { transportId: transport.id, kind, rtpParameters, appData })
          .then(({ producerId }) => callback({ id: producerId })).catch(errback);
      });
    }
    transport.on('connectionstatechange', (state) => {
      if (state === 'failed' && !this.disposed) this.cb.onError?.(new Error(`transport ${direction} falhou`), { where: 'transport', state });
    });
    return transport;
  }

  async _publishMic(startMuted) {
    if (this.producers.mic) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false,
    });
    const track = stream.getAudioTracks()[0];
    this.localTracks.mic = track;
    const producer = await this.sendTransport.produce({
      track,
      codecOptions: { opusStereo: false, opusDtx: true, opusFec: true },
      appData: { source: 'mic' },
    });
    this.producers.mic = producer;
    producer.on('trackended', () => { this.cb.onSelfMute?.(true); });
    if (startMuted) { producer.pause(); await this._request('pauseProducer', { producerId: producer.id }).catch(() => {}); }
    this.cb.onSelfMute?.(!!startMuted);
  }

  async _consume({ producerId, peerId, kind, appData }) {
    if (!this.recvTransport || this.disposed) return;
    const uid = String(peerId);
    const info = await this._request('consume', {
      transportId: this.recvTransport.id, producerId, rtpCapabilities: this.device.rtpCapabilities,
    });
    if (this.disposed) return;
    const consumer = await this.recvTransport.consume({
      id: info.consumerId, producerId: info.producerId, kind: info.kind, rtpParameters: info.rtpParameters, appData: info.appData,
    });
    const source = (info.appData && info.appData.source) || (appData && appData.source) || (kind === 'audio' ? 'mic' : 'camera');
    this.consumers.set(consumer.id, { consumer, peerId: uid, kind: consumer.kind, source });
    this.peers.add(uid);
    this.cb.onMediaUser?.(uid, true);
    try {
      const stream = new MediaStream([consumer.track]);
      if (consumer.kind === 'audio') this.cb.onRemoteAudio?.(uid, stream);
      else this.cb.onRemoteVideo?.(uid, stream, source === 'screen' ? 'screen' : 'camera');
    } catch (err) { this.cb.onError?.(err, { where: 'remoteTrack' }); }
    await this._request('resumeConsumer', { consumerId: consumer.id });
  }

  // ---------- controles ----------
  // enabled=true => quero FALAR. Espelha o estado real por onSelfMute.
  async setMicEnabled(enabled) {
    const p = this.producers.mic;
    try {
      if (!p) { if (enabled) await this._publishMic(false); return; }
      if (enabled) { p.resume(); await this._request('resumeProducer', { producerId: p.id }); }
      else { p.pause(); await this._request('pauseProducer', { producerId: p.id }); }
      this.cb.onSelfMute?.(!enabled);
    } catch (err) { this.cb.onError?.(err, { where: 'setMicEnabled' }); }
  }

  async setCamera(on) {
    try {
      if (!on) { await this._closeProducer('camera'); this.cb.onSelfCamera?.(false); return null; }
      if (this.producers.camera) return new MediaStream([this.localTracks.camera]);
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false });
      const track = stream.getVideoTracks()[0];
      this.localTracks.camera = track;
      const producer = await this.sendTransport.produce({
        track, encodings: CAMERA_ENCODINGS,
        codecOptions: { videoGoogleStartBitrate: 600 },
        appData: { source: 'camera' },
      });
      this.producers.camera = producer;
      track.addEventListener('ended', () => { this._closeProducer('camera'); this.cb.onSelfCamera?.(false); });
      this.cb.onSelfCamera?.(true);
      return new MediaStream([track]);
    } catch (err) { this.cb.onError?.(err, { where: 'setCamera' }); return null; }
  }

  async setScreen(on, options = {}) {
    try {
      if (!on) { await this._closeProducer('screen'); await this._closeProducer('screenAudio'); this.cb.onSelfScreen?.(false); return null; }
      if (this.producers.screen) return new MediaStream([this.localTracks.screen]);
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } }, audio: options.audio !== false,
      });
      const vtrack = stream.getVideoTracks()[0];
      try { vtrack.contentHint = 'detail'; } catch { /* opcional */ }
      this.localTracks.screen = vtrack;
      this.producers.screen = await this.sendTransport.produce({
        track: vtrack, encodings: SCREEN_ENCODINGS,
        codecOptions: { videoGoogleStartBitrate: 1000 },
        appData: { source: 'screen' },
      });
      const atrack = stream.getAudioTracks()[0];
      if (atrack) {
        this.localTracks.screenAudio = atrack;
        this.producers.screenAudio = await this.sendTransport.produce({
          track: atrack, codecOptions: { opusStereo: true, opusDtx: false }, appData: { source: 'screenAudio' },
        });
      }
      // "Parar compartilhamento" pelo navegador.
      vtrack.addEventListener('ended', () => { this.setScreen(false); });
      this.cb.onSelfScreen?.(true);
      return new MediaStream([vtrack]);
    } catch (err) { this.cb.onError?.(err, { where: 'setScreen' }); return null; }
  }

  async _closeProducer(key) {
    const p = this.producers[key];
    const t = this.localTracks[key];
    this.producers[key] = null; this.localTracks[key] = null;
    if (t) { try { t.stop(); } catch { /* ok */ } }
    if (!p) return;
    try { p.close(); } catch { /* ok */ }
    await this._request('closeProducer', { producerId: p.id }).catch(() => {});
  }

  hangup() { this.dispose(); }

  _closeAll() {
    for (const key of Object.keys(this.producers)) {
      const p = this.producers[key]; const t = this.localTracks[key];
      if (t) { try { t.stop(); } catch { /* ok */ } }
      if (p) { try { p.close(); } catch { /* ok */ } }
      this.producers[key] = null; this.localTracks[key] = null;
    }
    for (const c of this.consumers.values()) { try { c.consumer.close(); } catch { /* ok */ } }
    this.consumers.clear();
    try { this.sendTransport?.close(); } catch { /* ok */ }
    try { this.recvTransport?.close(); } catch { /* ok */ }
    this.sendTransport = null; this.recvTransport = null;
    if (this.ws) { try { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ id: ++this.seq, method: 'leave' })); } catch { /* ok */ } try { this.ws.close(); } catch { /* ok */ } }
    this.ws = null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._closeAll();
  }
}

export function createMediasoupEngine(callbacks) {
  return new MediasoupEngine({ callbacks });
}

export default MediasoupEngine;
