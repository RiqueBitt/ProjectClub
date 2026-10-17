// Engine do servidor de mídia PRÓPRIO do Project Club (media-server/,
// mediasoup). Mesma "interface" do engine do Stream, então encaixa na MESMA
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
// RECONEXÃO AUTOMÁTICA: se o wi-fi cair, o celular bloquear ou o transport
// ICE falhar, o engine NÃO derruba a pessoa da sala. Ele guarda as faixas
// locais (mic/câmera/tela), refaz a sessão inteira (sinalização → Device →
// transports → republica → reassina) com espera crescente (1s, 2s, 4s, 8s…)
// por até ~40s, avisando a UI por onReconnecting(tentativa) / onReconnected().
// Só desiste (onLeft) se nada voltar nesse tempo. Ser expulso ou sair por
// vontade própria nunca reconecta.
//
// QUALIDADE DA CONEXÃO: a cada 2s lê as estatísticas WebRTC reais (RTT do
// par ICE, perda de pacotes de envio e de cada consumer) e entrega por
// onNetQuality({ uid: 1..6 }) na MESMA escala que o Agora usa na UI
// (1 excelente … 5 péssima, 6 sem conexão) e o ping por onRtt(ms).
//
// REDUTOR DE RUÍDO: com `noiseSuppression: true` no join, o microfone passa
// pelo RNNoise (voice/noiseSuppressor.js) antes de ser publicado;
// setNoiseSuppression(on) liga/desliga na hora sem recriar a faixa.
//
// Carregado de forma preguiçosa (o SDK só baixa quando entra numa call por
// este provedor), igual Agora/Stream — não entra no bundle inicial.
//
// Callbacks (iguais ao engine do Stream, mais os de reconexão/qualidade):
//   onJoined(myId), onLeft()
//   onReconnecting(attempt), onReconnected()
//   onNetQuality({ uid: quality }), onRtt(ms)
//   onLocalSpeaking(bool), onRemoteSpeaking(uid, bool)
//   onSelfMute(bool), onSelfCamera(bool), onSelfScreen(bool)
//   onMediaUser(uid, present)
//   onRemoteAudio(uid, MediaStream), onRemoteVideo(uid, MediaStream, kind)
//   onRemoteRemove(uid, 'audio'|'video'|'all')
//   onError(err, info)
import { createNoiseSuppressedTrack } from './noiseSuppressor.js';
import { summarizeWebRtcStats, serverHost } from './connectionStats.js';

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
// Tela: qualidade escolhida em "Transmitir tela" (resolução + FPS) vira
// tamanho de captura e teto de bitrate. 1080p60 ≈ 7 Mbps (jogos/vídeos).
const SCREEN_PROFILES = {
  '720p': { width: 1280, height: 720, bitrate: { 15: 1_200_000, 30: 2_000_000, 60: 3_500_000 } },
  '1080p': { width: 1920, height: 1080, bitrate: { 15: 2_500_000, 30: 4_000_000, 60: 7_000_000 } },
};
export function screenProfile({ quality, frameRate } = {}) {
  const prof = SCREEN_PROFILES[quality] || SCREEN_PROFILES['720p'];
  const fps = [15, 30, 60].includes(Number(frameRate)) ? Number(frameRate) : 30;
  return { width: prof.width, height: prof.height, fps, maxBitrate: prof.bitrate[fps], motion: fps >= 60 };
}

const REQUEST_TIMEOUT_MS = 15000;
const STATS_INTERVAL_MS = 2000;
// Reconexão: esperas entre tentativas (ms). Soma ≈ 40s antes de desistir.
export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 8000, 8000, 8000];
// Transport "disconnected" costuma se recuperar sozinho (ICE); só agimos
// se continuar assim por este tempo.
const DISCONNECTED_GRACE_MS = 4000;

// Converte perda (0..1) + RTT (ms) na escala de qualidade da UI (1..6).
export function qualityFrom({ loss = 0, rtt = 0, connected = true } = {}) {
  if (!connected) return 6;
  if (loss >= 0.2 || rtt >= 1000) return 5;
  if (loss >= 0.1 || rtt >= 600) return 4;
  if (loss >= 0.05 || rtt >= 350) return 3;
  if (loss >= 0.02 || rtt >= 180) return 2;
  return 1;
}

const isLive = (t) => !!t && t.readyState === 'live';

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
    // Estado que sobrevive à reconexão.
    this.joinOpts = null;
    this.micMuted = false;
    this.noise = null; // { track, setEnabled, dispose } do RNNoise
    this.noiseEnabled = false;
    // Reconexão / estatísticas.
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.reconnecting = false;
    this.leaving = false;
    this.disconnectedTimer = null;
    this.statsTimer = null;
    this.statsPrev = new Map(); // key -> { lost, received }
    this.connStatsPrev = null; // contadores da última leitura do painel de conexão
  }

  getNode() { return null; }

  capabilities() {
    return { camera: true, screen: true, perUserVolume: true, speakingIndicator: true, customGrid: true, netQuality: true, reconnect: true, noiseSuppression: true };
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
        if (!welcomed) { reject(new Error(`conexão recusada (${ev.code})`)); return; }
        if (this.ws !== ws) return; // socket antigo de uma sessão já substituída
        if (this.disposed || this.leaving) return;
        // 4401 = token recusado (venceu?) e 4409 = substituído por outra
        // sessão minha: reconectar não resolve — sai de vez.
        if (ev.code === 4401 || ev.code === 4409) { this._giveUp(); return; }
        this._scheduleReconnect(`sinalização fechada (${ev.code})`);
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
  async join({ url, token, userId, iceServers = [], startMuted = false, noiseSuppression = false } = {}) {
    await loadMediasoup();
    if (this.disposed) return;
    if (!url || !token) throw new Error('credenciais do servidor de mídia ausentes');
    this.myId = String(userId);
    this.iceServers = Array.isArray(iceServers) ? iceServers : [];
    this.joinOpts = { url, token };
    this.micMuted = !!startMuted;
    this.noiseEnabled = !!noiseSuppression;

    await this._session({ first: true });
  }

  // Uma sessão completa: sinalização → Device → transports → mídia local →
  // mídia dos outros. Usada no join e em cada reconexão.
  async _session({ first }) {
    const { Device } = await loadMediasoup();
    const welcome = await this._connect(this.joinOpts.url, this.joinOpts.token);
    if (this.disposed) { this._closeAll(); return; }

    this.device = new Device();
    await this.device.load({ routerRtpCapabilities: welcome.routerRtpCapabilities });

    this.sendTransport = await this._createTransport('send');
    this.recvTransport = await this._createTransport('recv');
    if (this.disposed) { this._closeAll(); return; }

    if (first) this.cb.onJoined?.(this.myId);

    // Quem já estava na sala.
    for (const p of welcome.peers || []) { this.peers.add(String(p.id)); this.cb.onMediaUser?.(String(p.id), true); }

    // Microfone (publica e, se entrou/estava mudo, deixa pausado — desmutar
    // é instantâneo). Na reconexão reaproveita a faixa local se ainda vive.
    try { await this._publishMic(this.micMuted); } catch (err) { this.cb.onError?.(err, { where: 'enableMic' }); }
    // Câmera/tela que estavam ligadas antes da queda voltam sozinhas.
    if (!first) {
      if (isLive(this.localTracks.camera)) { try { await this._produceCamera(this.localTracks.camera); } catch (err) { this.cb.onError?.(err, { where: 'reCamera' }); } }
      if (isLive(this.localTracks.screen)) { try { await this._produceScreen(this.localTracks.screen, this.localTracks.screenAudio); } catch (err) { this.cb.onError?.(err, { where: 'reScreen' }); } }
    }

    // Mídia que os outros já publicavam.
    for (const prod of welcome.producers || []) {
      this._consume(prod).catch((err) => this.cb.onError?.(err, { where: 'consumeExisting' }));
    }
    this._startStats();
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
      if (this.disposed || this.leaving) return;
      if (transport !== this.sendTransport && transport !== this.recvTransport) return; // de uma sessão antiga
      if (state === 'connected') { clearTimeout(this.disconnectedTimer); this.disconnectedTimer = null; return; }
      if (state === 'failed' || state === 'closed') {
        this.cb.onError?.(new Error(`transport ${direction} ${state}`), { where: 'transport', state });
        this._scheduleReconnect(`transport ${direction} ${state}`);
      } else if (state === 'disconnected' && !this.disconnectedTimer) {
        this.disconnectedTimer = setTimeout(() => {
          this.disconnectedTimer = null;
          if (this.disposed || this.leaving || this.reconnecting) return;
          const t = this.sendTransport;
          if (t && t.connectionState !== 'connected') this._scheduleReconnect(`transport ${direction} desconectado`);
        }, DISCONNECTED_GRACE_MS);
      }
    });
    return transport;
  }

  // ---------- reconexão ----------
  _scheduleReconnect(reason) {
    if (this.disposed || this.leaving) return;
    if (this.reconnectTimer) return; // já agendada
    const attempt = this.reconnectAttempt;
    if (attempt >= RECONNECT_DELAYS_MS.length) { this._giveUp(); return; }
    this.reconnecting = true;
    this._teardownSession();
    this.cb.onReconnecting?.(attempt + 1, reason);
    const delay = RECONNECT_DELAYS_MS[attempt];
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempt = attempt + 1;
      this._session({ first: false }).then(() => {
        if (this.disposed) return;
        this.reconnectAttempt = 0;
        this.reconnecting = false;
        this.cb.onReconnected?.();
      }).catch((err) => {
        if (this.disposed) return;
        this.cb.onError?.(err, { where: 'reconnect', attempt: attempt + 1 });
        this._scheduleReconnect(`tentativa ${attempt + 1} falhou`);
      });
    }, delay);
  }

  _giveUp() {
    if (this.disposed) return;
    this.disposed = true;
    this._closeAll();
    this.cb.onLeft?.();
  }

  // Derruba transports/consumers/producers da sessão atual SEM parar as
  // faixas locais (pra republicar depois) e avisa a grade que as mídias
  // remotas sumiram por enquanto.
  _teardownSession() {
    this._stopStats();
    clearTimeout(this.disconnectedTimer); this.disconnectedTimer = null;
    for (const c of this.consumers.values()) {
      try { c.consumer.close(); } catch { /* ok */ }
    }
    const peersSeen = new Set([...this.consumers.values()].map((c) => c.peerId));
    this.consumers.clear();
    for (const uid of peersSeen) this.cb.onRemoteRemove?.(uid, 'all');
    for (const key of Object.keys(this.producers)) {
      const p = this.producers[key];
      if (p) { try { p.close(); } catch { /* ok */ } }
      this.producers[key] = null;
    }
    try { this.sendTransport?.close(); } catch { /* ok */ }
    try { this.recvTransport?.close(); } catch { /* ok */ }
    this.sendTransport = null; this.recvTransport = null;
    const ws = this.ws; this.ws = null;
    if (ws) { try { ws.onclose = null; ws.close(); } catch { /* ok */ } }
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('reconectando')); }
    this.pending.clear();
  }

  // ---------- mídia local ----------
  async _getMicTrack() {
    if (isLive(this.localTracks.mic)) return this.localTracks.mic;
    if (this.noise) { try { this.noise.dispose(); } catch { /* ok */ } this.noise = null; }
    const stream = await navigator.mediaDevices.getUserMedia({
      // Com o RNNoise ligado, o supressor do navegador fica desligado (dois
      // supressores em série "comem" a voz); o resto do tratamento fica.
      audio: { echoCancellation: true, noiseSuppression: !this.noiseEnabled, autoGainControl: true, channelCount: 1 }, video: false,
    });
    const raw = stream.getAudioTracks()[0];
    let track = raw;
    if (this.noiseEnabled) {
      const sup = await createNoiseSuppressedTrack(raw, { enabled: true });
      if (sup) { this.noise = sup; track = sup.track; }
    }
    this.localTracks.mic = track;
    return track;
  }

  async _publishMic(startMuted) {
    if (this.producers.mic) return;
    const track = await this._getMicTrack();
    if (!this.sendTransport) return;
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

  async _produceCamera(track) {
    this.localTracks.camera = track;
    const producer = await this.sendTransport.produce({
      track, encodings: CAMERA_ENCODINGS,
      codecOptions: { videoGoogleStartBitrate: 600 },
      appData: { source: 'camera' },
    });
    this.producers.camera = producer;
    return producer;
  }

  async _produceScreen(vtrack, atrack, prof = screenProfile()) {
    this.localTracks.screen = vtrack;
    this.producers.screen = await this.sendTransport.produce({
      track: vtrack,
      encodings: [{ maxBitrate: prof.maxBitrate, maxFramerate: prof.fps, priority: 'high', networkPriority: 'high' }],
      codecOptions: { videoGoogleStartBitrate: Math.round(prof.maxBitrate / 2000) },
      appData: { source: 'screen' },
    });
    if (atrack && isLive(atrack)) {
      this.localTracks.screenAudio = atrack;
      this.producers.screenAudio = await this.sendTransport.produce({
        track: atrack, codecOptions: { opusStereo: true, opusDtx: false }, appData: { source: 'screenAudio' },
      });
    }
  }

  async _consume({ producerId, peerId, kind, appData }) {
    if (!this.recvTransport || this.disposed) return;
    const uid = String(peerId);
    const info = await this._request('consume', {
      transportId: this.recvTransport.id, producerId, rtpCapabilities: this.device.rtpCapabilities,
    });
    if (this.disposed || !this.recvTransport) return;
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

  // ---------- estatísticas / qualidade ----------
  _startStats() {
    this._stopStats();
    this.statsPrev.clear();
    if (!this.cb.onNetQuality && !this.cb.onRtt) return;
    this.statsTimer = setInterval(() => { this._collectStats().catch(() => {}); }, STATS_INTERVAL_MS);
  }

  _stopStats() {
    if (this.statsTimer) { clearInterval(this.statsTimer); this.statsTimer = null; }
  }

  // Delta de perda desde a última leitura (perda recente, não acumulada).
  _lossDelta(key, lost, received) {
    const prev = this.statsPrev.get(key) || { lost: 0, received: 0 };
    this.statsPrev.set(key, { lost, received });
    const dl = Math.max(0, lost - prev.lost);
    const dr = Math.max(0, received - prev.received);
    const total = dl + dr;
    return total > 0 ? dl / total : 0;
  }

  async _collectStats() {
    if (this.disposed || this.reconnecting || !this.sendTransport) return;
    const quality = {};
    let rtt = null;
    // RTT do par ICE ativo (ida e volta até o servidor de mídia).
    try {
      const stats = await this.sendTransport.getStats();
      stats.forEach((s) => {
        if (s.type === 'candidate-pair' && (s.nominated || s.state === 'succeeded') && Number.isFinite(s.currentRoundTripTime)) {
          rtt = Math.round(s.currentRoundTripTime * 1000);
        }
      });
    } catch { /* sem stats */ }
    // Minha qualidade: perda relatada pelo servidor sobre o que EU envio.
    let myLoss = 0;
    const mic = this.producers.mic;
    if (mic && !mic.closed) {
      try {
        const stats = await mic.getStats();
        stats.forEach((s) => {
          if (s.type === 'remote-inbound-rtp' && Number.isFinite(s.fractionLost)) myLoss = Math.max(myLoss, s.fractionLost);
        });
      } catch { /* ok */ }
    }
    const connected = this.sendTransport?.connectionState === 'connected' || this.recvTransport?.connectionState === 'connected';
    quality[this.myId] = qualityFrom({ loss: myLoss, rtt: rtt || 0, connected });
    // Qualidade de cada pessoa: perda no que RECEBO dela (pior entre as faixas).
    const perPeer = new Map();
    for (const [cid, c] of this.consumers) {
      if (c.consumer.closed) continue;
      try {
        const stats = await c.consumer.getStats();
        stats.forEach((s) => {
          if (s.type !== 'inbound-rtp') return;
          const loss = this._lossDelta(cid, s.packetsLost || 0, s.packetsReceived || 0);
          perPeer.set(c.peerId, Math.max(perPeer.get(c.peerId) || 0, loss));
        });
      } catch { /* ok */ }
    }
    for (const [uid, loss] of perPeer) quality[uid] = qualityFrom({ loss, rtt: 0, connected: true });
    if (this.disposed) return;
    this.cb.onNetQuality?.(quality);
    if (rtt != null) this.cb.onRtt?.(rtt);
  }

  // Painel "Qualidade da conexão": leitura detalhada sob demanda (ping,
  // perda, jitter, bitrate, codec, resolução/FPS da tela). As duas
  // transports são PeerConnections separadas — junta as stats das duas.
  async getConnectionStats() {
    if (this.disposed || !this.sendTransport) return null;
    const reports = [];
    try { reports.push(await this.sendTransport.getStats()); } catch { /* sem stats */ }
    try { if (this.recvTransport) reports.push(await this.recvTransport.getStats()); } catch { /* sem stats */ }
    let screen = null;
    const sp = this.producers.screen;
    if (sp && !sp.closed) { try { screen = await sp.getStats(); } catch { /* ok */ } }
    const { snapshot, counters } = summarizeWebRtcStats(reports, this.connStatsPrev, Date.now(), screen);
    this.connStatsPrev = counters;
    return { ...snapshot, server: serverHost(this.joinOpts?.url) };
  }

  // ---------- controles ----------
  // enabled=true => quero FALAR. Espelha o estado real por onSelfMute.
  async setMicEnabled(enabled) {
    this.micMuted = !enabled;
    const p = this.producers.mic;
    try {
      if (!p) { if (enabled && this.sendTransport) await this._publishMic(false); else this.cb.onSelfMute?.(!enabled); return; }
      if (enabled) { p.resume(); await this._request('resumeProducer', { producerId: p.id }); }
      else { p.pause(); await this._request('pauseProducer', { producerId: p.id }); }
      this.cb.onSelfMute?.(!enabled);
    } catch (err) { this.cb.onError?.(err, { where: 'setMicEnabled' }); }
  }

  // Liga/desliga o RNNoise na hora. Se a faixa atual foi criada SEM o
  // processador (redutor estava desligado ao entrar), recria o microfone.
  async setNoiseSuppression(on) {
    this.noiseEnabled = !!on;
    if (this.noise) { this.noise.setEnabled(!!on); return; }
    if (!on || !this.producers.mic) return;
    try {
      const wasMuted = this.micMuted;
      await this._closeProducer('mic');
      await this._publishMic(wasMuted);
    } catch (err) { this.cb.onError?.(err, { where: 'setNoiseSuppression' }); }
  }

  // `deviceId`: câmera escolhida (ex.: no "Testar antes de entrar"). Vai
  // como `ideal` — se ela sumiu, o navegador usa outra em vez de falhar.
  async setCamera(on, { deviceId } = {}) {
    try {
      if (!on) { await this._closeProducer('camera'); this.cb.onSelfCamera?.(false); return null; }
      if (this.producers.camera) return new MediaStream([this.localTracks.camera]);
      const video = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
      if (deviceId) video.deviceId = { ideal: deviceId };
      const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      const track = stream.getVideoTracks()[0];
      await this._produceCamera(track);
      track.addEventListener('ended', () => { this._closeProducer('camera'); this.cb.onSelfCamera?.(false); });
      this.cb.onSelfCamera?.(true);
      return new MediaStream([track]);
    } catch (err) { this.cb.onError?.(err, { where: 'setCamera' }); return null; }
  }

  async setScreen(on, options = {}) {
    try {
      if (!on) { await this._closeProducer('screen'); await this._closeProducer('screenAudio'); this.cb.onSelfScreen?.(false); return null; }
      if (this.producers.screen) return new MediaStream([this.localTracks.screen]);
      const prof = screenProfile(options);
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: prof.width, max: prof.width }, height: { ideal: prof.height, max: prof.height }, frameRate: { ideal: prof.fps, max: prof.fps } },
        audio: options.audio !== false,
      });
      const vtrack = stream.getVideoTracks()[0];
      // Jogos (60 FPS): prioriza fluidez; texto/slides: prioriza nitidez.
      try { vtrack.contentHint = prof.motion ? 'motion' : 'detail'; } catch { /* opcional */ }
      try { await vtrack.applyConstraints({ width: { max: prof.width }, height: { max: prof.height }, frameRate: { ideal: prof.fps, max: prof.fps } }); } catch { /* o navegador decide */ }
      await this._produceScreen(vtrack, stream.getAudioTracks()[0], prof);
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
    if (key === 'mic' && this.noise) { try { this.noise.dispose(); } catch { /* ok */ } this.noise = null; }
    if (t) { try { t.stop(); } catch { /* ok */ } }
    if (!p) return;
    try { p.close(); } catch { /* ok */ }
    await this._request('closeProducer', { producerId: p.id }).catch(() => {});
  }

  hangup() { this.dispose(); }

  _closeAll() {
    this.leaving = true;
    this._stopStats();
    clearTimeout(this.reconnectTimer); this.reconnectTimer = null;
    clearTimeout(this.disconnectedTimer); this.disconnectedTimer = null;
    for (const key of Object.keys(this.producers)) {
      const p = this.producers[key]; const t = this.localTracks[key];
      if (t) { try { t.stop(); } catch { /* ok */ } }
      if (p) { try { p.close(); } catch { /* ok */ } }
      this.producers[key] = null; this.localTracks[key] = null;
    }
    if (this.noise) { try { this.noise.dispose(); } catch { /* ok */ } this.noise = null; }
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
