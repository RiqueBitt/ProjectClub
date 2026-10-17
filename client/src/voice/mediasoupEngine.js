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
//   4. assina a mídia dos outros (um consumer por producer remoto) e, EM
//      PARALELO, publica o microfone (câmera/tela sob demanda)
//   5. ao sair, fecha tudo
//
// À PROVA DE FALHAS (ver também voice/resilience.js):
//   - Microfone negado/ausente NÃO impede de entrar: a pessoa entra só
//     ouvindo (onMicUnavailable) e pode tentar o mic de novo depois. Antes a
//     mídia dos outros só era assinada DEPOIS do pedido de permissão do mic —
//     com o aviso do navegador aberto, a pessoa entrava e não ouvia ninguém.
//   - Mic desconectado no meio da call (faixa 'ended') → pega o microfone
//     padrão sozinho e troca a faixa no producer (replaceTrack), sem refazer
//     nada.
//   - Rede piscou: transport 'disconnected' espera um pouco e 'failed' faz
//     ICE RESTART (pede iceParameters novos ao servidor — restartIce — e
//     aplica com transport.restartIce), que é o recomendado pelo mediasoup
//     pra troca de rede. Só se o ICE não voltar é que refaz a sessão inteira.
//   - Sessão inteira caiu (wi-fi, servidor reiniciou a sala com 1012): refaz
//     tudo (sinalização → Device → transports → republica → reassina) com
//     espera crescente (1s, 2s, 4s, 8s…) por até ~40s, avisando a UI por
//     onReconnecting(tentativa) / onReconnected().
//   - Token vencido (4401 'expired', call longa): pede um token novo
//     (refreshCredentials, que chama /api/voice/join) e reconecta.
//   - Entrou na call em OUTRO aparelho (4409 / kicked 'replaced'|'flapping'):
//     NÃO reconecta (senão os dois aparelhos ficam se derrubando) e sai com
//     onLeft({ reason: 'replaced' }).
//   - Join "verdadeiro": com gente publicando na sala, o join só termina
//     quando a recepção CONECTA (ICE/DTLS) — se não conectar em 12s, falha
//     (o VoiceContext troca de provedor). Envio que nunca conecta depois do
//     join → onMediaFailed (o VoiceContext também troca).
//
// QUALIDADE DA CONEXÃO: a cada 2s lê as estatísticas WebRTC reais (RTT do
// par ICE, perda de pacotes de envio e de cada consumer) e entrega por
// onNetQuality({ uid: 1..6 }) na escala que a UI usa
// (1 excelente … 5 péssima, 6 sem conexão) e o ping por onRtt(ms). Também
// guarda os bytes de áudio recebidos por pessoa (getInboundAudioBytes) — o
// AudioSink usa pra perceber "bytes chegando mas nada tocando".
//
// REDUTOR DE RUÍDO: com `noiseSuppression: true` no join, o microfone passa
// pelo RNNoise (voice/noiseSuppressor.js) antes de ser publicado;
// setNoiseSuppression(on) liga/desliga na hora sem recriar a faixa.
//
// PORTÃO DO MICROFONE (apertar-pra-falar / sensibilidade de entrada):
// setMicGate(aberto) manda silêncio enquanto fechado SEM mexer no "mudo" da
// pessoa (o producer continua no ar; só a faixa fica desabilitada). Vale
// também pra faixa nova depois de trocar de microfone/reconectar.
//
// TELA: setScreen(true, { quality, frameRate, audio, track }) — `track`
// permite publicar uma faixa pronta (ex.: captura nativa do app Android) em
// vez de chamar getDisplayMedia; setScreenQuality troca resolução/fps AO
// VIVO (applyConstraints), sem parar a transmissão.
//
// Carregado de forma preguiçosa (o SDK só baixa quando entra numa call por
// este provedor), igual o LiveKit — não entra no bundle inicial. Falha
// no download do pedaço (deploy novo) tenta de novo e, por fim, recarrega
// a página UMA vez (fora de call).
//
// Callbacks (iguais ao LiveKitEngine, mais os de reconexão/qualidade):
//   onJoined(myId), onLeft({ reason })   reason: 'replaced'|'kicked'|'token'|'gave-up'|'closed'
//   onReconnecting(attempt, why), onReconnected()
//   onNetQuality({ uid: quality }), onRtt(ms)
//   onLocalSpeaking(bool), onRemoteSpeaking(uid, bool)
//   onSelfMute(bool), onSelfCamera(bool), onSelfScreen(bool)
//   onMicUnavailable({ reason: 'denied'|'missing'|'busy', error }), onMicRecovered()
//   onMediaFailed({ code })
//   onMediaUser(uid, present)
//   onRemoteAudio(uid, MediaStream), onRemoteVideo(uid, MediaStream, kind)
//   onRemoteRemove(uid, 'audio'|'video'|'all')
//   onError(err, info)
import { createNoiseSuppressedTrack } from './noiseSuppressor.js';
import { classifyClose, iceAction, importWithRetry, browserGuardedReload, micErrorReason } from './resilience.js';
import { SCREEN_QUALITY_PRESETS } from '../utils/screenShareTracks.js';

let msPromise = null;
function loadMediasoup() {
  if (!msPromise) {
    // BUG CORRIGIDO: uma falha no import() ficava guardada pra sempre (a
    // promise rejeitada era reaproveitada) — depois de um deploy, nenhuma
    // call pelo servidor próprio funcionava até recarregar a página.
    msPromise = importWithRetry(() => import('mediasoup-client'), { onChunkFailure: browserGuardedReload })
      .catch((err) => { msPromise = null; throw err; });
  }
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
// Sem `welcome` nesse tempo, a conexão conta como falha (antes esperava pra sempre).
const CONNECT_TIMEOUT_MS = 10000;
const STATS_INTERVAL_MS = 2000;
// Reconexão: esperas entre tentativas (ms). Soma ≈ 40s antes de desistir.
export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 8000, 8000, 8000];
// ICE "disconnected" costuma voltar sozinho; depois disso, ICE restart.
const ICE_DISCONNECTED_GRACE_MS = 2500;
// Depois de um ICE restart, quanto esperar o transport voltar a 'connected'.
const ICE_RESTART_TIMEOUT_MS = 8000;
const MAX_ICE_RESTARTS = 2;
// Join: com mídia dos outros pra receber, a recepção tem que conectar nisso.
const MEDIA_CONNECT_TIMEOUT_MS = 12000;
// Transport usado (produce/consume) que NUNCA conectou nesse tempo → falha do provedor.
const FIRST_CONNECT_WATCH_MS = 15000;
const MAX_TOKEN_REFRESHES = 2;

// Converte perda (0..1) + RTT (ms) na escala de qualidade da UI (1..6).
export function qualityFrom({ loss = 0, rtt = 0, connected = true } = {}) {
  if (!connected) return 6;
  if (loss >= 0.2 || rtt >= 1000) return 5;
  if (loss >= 0.1 || rtt >= 600) return 4;
  if (loss >= 0.05 || rtt >= 350) return 3;
  if (loss >= 0.02 || rtt >= 180) return 2;
  return 1;
}

export { micErrorReason };

const isLive = (t) => !!t && t.readyState === 'live';
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

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
    this.consumingProducers = new Set(); // producerIds com consume em andamento (sem duplicar)
    this.peers = new Set(); // peerIds remotos conhecidos
    this.lastLocalSpeaking = false;
    this.iceServers = [];
    this.node = null;
    // Estado que sobrevive à reconexão.
    this.joinOpts = null;
    this.refreshCredentials = null;
    this.needsFreshToken = false;
    this.tokenRefreshes = 0;
    this.micMuted = false;
    this.micGateOpen = true; // portão do apertar-pra-falar/sensibilidade
    this.micDeviceId = null;
    this.rawMic = null; // faixa crua do mic (o RNNoise publica outra)
    this.noise = null; // { track, setEnabled, dispose } do RNNoise
    this.noiseEnabled = false;
    this._micPublishing = null;
    this._micPublishingFor = null;
    this._micRecovering = false;
    // Reconexão / ICE / estatísticas.
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.reconnecting = false;
    this.leaving = false;
    this.tstate = new Map(); // transportId -> { iceRestarts, graceTimer, restartTimer, watchTimer, everConnected, restarting }
    this.mediaFailedReported = false;
    this.statsTimer = null;
    this.statsPrev = new Map(); // key -> { lost, received }
    this.inboundAudio = new Map(); // peerId -> bytes de áudio recebidos
  }

  getNode() { return null; }

  capabilities() {
    return { camera: true, screen: true, perUserVolume: true, speakingIndicator: true, customGrid: true, netQuality: true, reconnect: true, noiseSuppression: true, iceRestart: true, receiveOnly: true, nativeScreenTrack: true };
  }

  // Bytes de áudio recebidos dessa pessoa (última leitura das estatísticas).
  getInboundAudioBytes(uid) {
    const v = this.inboundAudio.get(String(uid));
    return Number.isFinite(v) ? v : null;
  }

  // ---------- sinalização ----------
  _request(method, data = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { reject(new Error('sinalização desconectada')); return; }
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout em ${method}`)); }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      try { this.ws.send(JSON.stringify({ id, method, data })); } catch (err) { clearTimeout(timer); this.pending.delete(id); reject(err); }
    });
  }

  _rejectPending(reason) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(reason)); }
    this.pending.clear();
  }

  _connect(url, token) {
    return new Promise((resolve, reject) => {
      const sep = url.includes('?') ? '&' : '?';
      let ws;
      try { ws = new WebSocket(`${url}${sep}token=${encodeURIComponent(token)}`); } catch (err) { reject(err); return; }
      this.ws = ws;
      let welcomed = false;
      // Aviso do servidor ANTES de fechar ('error' com detalhe do 4401,
      // 'kicked' com o motivo do 4409) — decide o que fazer no onclose.
      let notice = null;
      const timer = setTimeout(() => {
        if (welcomed) return;
        const e = new Error('o servidor de mídia não respondeu');
        e.code = 'WS_TIMEOUT';
        try { ws.onclose = null; ws.onmessage = null; ws.close(); } catch { /* ok */ }
        if (this.ws === ws) this.ws = null;
        reject(e);
      }, CONNECT_TIMEOUT_MS);
      ws.onmessage = (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.id && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id); this.pending.delete(msg.id); clearTimeout(p.timer);
          if (msg.ok) p.resolve(msg.data); else p.reject(new Error(msg.error || 'erro'));
          return;
        }
        if (msg.event === 'error' || msg.event === 'kicked') notice = { event: msg.event, ...(msg.data || {}) };
        if (msg.event === 'welcome' && !welcomed) { welcomed = true; clearTimeout(timer); resolve(msg.data); return; }
        if (!welcomed) return;
        if (msg.event && this.ws === ws) {
          try { this._onEvent(msg.event, msg.data || {}); } catch (err) { this.cb.onError?.(err, { where: `event:${msg.event}` }); }
        }
      };
      ws.onerror = () => { /* o onclose decide */ };
      ws.onclose = (ev) => {
        clearTimeout(timer);
        if (this.ws === ws) this._rejectPending('sinalização fechada');
        const info = {
          code: ev.code,
          detail: notice?.detail || notice?.reason || ev.reason || null,
          kicked: notice?.event === 'kicked' ? (notice.reason || 'kicked') : null,
        };
        if (!welcomed) {
          const e = new Error(`conexão recusada (${ev.code}${info.detail ? ` ${info.detail}` : ''})`);
          e.code = `WS_${ev.code}`;
          e.closeInfo = info;
          reject(e);
          return;
        }
        if (this.ws !== ws) return; // socket antigo de uma sessão já substituída
        if (this.disposed || this.leaving) return;
        this._onSessionClosed(info);
      };
    });
  }

  _onSessionClosed(info) {
    const action = classifyClose(info);
    if (action === 'replaced') { this._giveUp('replaced'); return; }
    if (action === 'give-up') { this._giveUp(info.kicked ? 'kicked' : 'closed'); return; }
    if (action === 'refresh-token') this.needsFreshToken = true;
    this._scheduleReconnect(`sinalização fechada (${info.code})`);
  }

  _findConsumer(consumerId) {
    const c = this.consumers.get(String(consumerId));
    return c || null;
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
        this.inboundAudio.delete(uid);
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
        for (const [cid, c] of [...this.consumers]) {
          const match = data.consumerId ? cid === data.consumerId : c.consumer.producerId === data.producerId;
          if (match) this._dropConsumer(cid);
        }
        break;
      }
      // Quem eu ouço pausou/retomou (mudo): espelha no consumer local.
      case 'consumerPaused': {
        const c = this._findConsumer(data.consumerId);
        if (c && !c.consumer.closed) { try { c.consumer.pause(); } catch { /* ok */ } }
        break;
      }
      case 'consumerResumed': {
        const c = this._findConsumer(data.consumerId);
        if (c && !c.consumer.closed) { try { c.consumer.resume(); } catch { /* ok */ } }
        break;
      }
      // DTLS do meu transport falhou/fechou NO SERVIDOR: não tem ICE restart
      // que salve — refaz a sessão.
      case 'transportClosed': {
        const id = String(data.transportId || '');
        if ((this.sendTransport && this.sendTransport.id === id) || (this.recvTransport && this.recvTransport.id === id)) {
          this._scheduleReconnect(`transport fechado no servidor (${data.reason || '?'})`);
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
      case 'kicked': {
        const r = String(data.reason || '');
        this._giveUp(r === 'replaced' || r === 'flapping' ? 'replaced' : 'kicked');
        break;
      }
      default: break; // producerPaused/producerResumed/error: nada a fazer aqui
    }
  }

  // ---------- entrar ----------
  async join({ url, token, userId, iceServers = [], startMuted = false, noiseSuppression = false, micDeviceId = null, refreshCredentials = null } = {}) {
    await loadMediasoup();
    if (this.disposed) return;
    if (!url || !token) throw new Error('credenciais do servidor de mídia ausentes');
    this.myId = String(userId);
    this.iceServers = Array.isArray(iceServers) ? iceServers : [];
    this.joinOpts = { url, token };
    this.refreshCredentials = typeof refreshCredentials === 'function' ? refreshCredentials : null;
    this.micMuted = !!startMuted;
    this.micDeviceId = micDeviceId || null;
    this.noiseEnabled = !!noiseSuppression;

    await this._session({ first: true });
  }

  // Uma sessão completa: sinalização → Device → transports → mídia dos outros
  // + mídia local. Usada no join e em cada reconexão.
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

    // Mídia que os outros já publicavam — PRIMEIRO e sem esperar o microfone
    // (o aviso de permissão do mic pode ficar aberto; ouvir não depende dele).
    const consumes = (welcome.producers || []).map((prod) => this._consume(prod).catch((err) => this.cb.onError?.(err, { where: 'consumeExisting' })));

    // Microfone em paralelo. Negado/ausente → entra só ouvindo.
    this._publishMic().catch((err) => this._onMicError(err));
    // Câmera/tela que estavam ligadas antes da queda voltam sozinhas.
    if (!first) {
      if (isLive(this.localTracks.camera)) { this._produceCamera(this.localTracks.camera).catch((err) => this.cb.onError?.(err, { where: 'reCamera' })); }
      if (isLive(this.localTracks.screen)) { this._produceScreen(this.localTracks.screen, this.localTracks.screenAudio).catch((err) => this.cb.onError?.(err, { where: 'reScreen' })); }
    }
    this._startStats();

    // Join "verdadeiro": com mídia pra receber, só termina quando a recepção
    // conecta — senão o provedor falhou (o VoiceContext troca de provedor).
    if (first && consumes.length) {
      await Promise.allSettled(consumes);
      if (this.disposed) return;
      if (this.consumers.size > 0 && this.recvTransport) await this._waitConnected(this.recvTransport, MEDIA_CONNECT_TIMEOUT_MS);
    }
  }

  _waitConnected(transport, ms) {
    if (!transport || transport.connectionState === 'connected') return Promise.resolve();
    return new Promise((resolve, reject) => {
      let timer = null;
      const off = () => { clearTimeout(timer); try { transport.removeListener('connectionstatechange', on); } catch { /* ok */ } };
      const on = (s) => {
        if (s === 'connected') { off(); resolve(); }
        else if (s === 'closed') { off(); const e = new Error('transport fechado antes de conectar'); e.code = 'TRANSPORT_CLOSED'; reject(e); }
      };
      timer = setTimeout(() => {
        off();
        if (this.disposed) { resolve(); return; }
        // A sessão foi refeita no meio e a nova já conectou: tudo certo.
        if (this.recvTransport && this.recvTransport !== transport && this.recvTransport.connectionState === 'connected') { resolve(); return; }
        const e = new Error('a mídia não conectou (ICE/DTLS)');
        e.code = 'ICE_TIMEOUT';
        reject(e);
      }, ms);
      transport.on('connectionstatechange', on);
    });
  }

  _ts(transport) {
    let st = this.tstate.get(transport.id);
    if (!st) { st = { iceRestarts: 0, graceTimer: null, restartTimer: null, watchTimer: null, everConnected: false, restarting: false }; this.tstate.set(transport.id, st); }
    return st;
  }

  _clearTransportTimers() {
    for (const st of this.tstate.values()) {
      clearTimeout(st.graceTimer); clearTimeout(st.restartTimer); clearTimeout(st.watchTimer);
    }
    this.tstate.clear();
  }

  _isCurrent(transport) {
    return !this.disposed && !this.leaving && (transport === this.sendTransport || transport === this.recvTransport);
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
      try { this._onTransportState(transport, direction, state); } catch (err) { this.cb.onError?.(err, { where: 'transportState' }); }
    });
    return transport;
  }

  _onTransportState(transport, direction, state) {
    if (!this._isCurrent(transport)) return; // de uma sessão antiga / saindo
    const st = this._ts(transport);
    const action = iceAction(state, { iceRestarts: st.iceRestarts, maxIceRestarts: MAX_ICE_RESTARTS });
    if (action === 'connected') {
      clearTimeout(st.graceTimer); st.graceTimer = null;
      clearTimeout(st.restartTimer); st.restartTimer = null;
      clearTimeout(st.watchTimer); st.watchTimer = null;
      st.iceRestarts = 0;
      st.everConnected = true;
      return;
    }
    if (action === 'grace') {
      if (st.graceTimer) return;
      st.graceTimer = setTimeout(() => {
        st.graceTimer = null;
        if (!this._isCurrent(transport) || this.reconnecting) return;
        if (transport.connectionState !== 'connected') this._restartIce(transport, direction);
      }, ICE_DISCONNECTED_GRACE_MS);
      return;
    }
    if (action === 'restart-ice') { this._restartIce(transport, direction); return; }
    if (action === 'reconnect') {
      this.cb.onError?.(new Error(`transport ${direction} ${state}`), { where: 'transport', state });
      this._scheduleReconnect(`transport ${direction} ${state}`);
    }
  }

  // ICE restart (recomendação do mediasoup pra rede que mudou/caiu): o
  // servidor gera credenciais ICE novas e o cliente as aplica — sem refazer
  // transports, producers nem consumers.
  async _restartIce(transport, direction) {
    if (!this._isCurrent(transport) || this.reconnecting) return;
    const st = this._ts(transport);
    if (st.restarting) return;
    if (st.iceRestarts >= MAX_ICE_RESTARTS) { this._scheduleReconnect(`ICE não voltou (${direction})`); return; }
    st.restarting = true;
    st.iceRestarts += 1;
    try {
      const { iceParameters } = await this._request('restartIce', { transportId: transport.id });
      if (!this._isCurrent(transport)) return;
      await transport.restartIce({ iceParameters });
    } catch (err) {
      if (!this._isCurrent(transport)) return;
      // Servidor antigo (sem restartIce) ou sinalização fora: refaz a sessão.
      this._scheduleReconnect(`restartIce falhou (${direction}): ${err?.message || err}`);
      return;
    } finally {
      st.restarting = false;
    }
    clearTimeout(st.restartTimer);
    st.restartTimer = setTimeout(() => {
      st.restartTimer = null;
      if (!this._isCurrent(transport) || this.reconnecting) return;
      if (transport.connectionState !== 'connected') {
        if (st.iceRestarts < MAX_ICE_RESTARTS) this._restartIce(transport, direction);
        else this._scheduleReconnect(`ICE não voltou (${direction})`);
      }
    }, ICE_RESTART_TIMEOUT_MS);
  }

  // Transport em uso que NUNCA conectou → o provedor não serve pra esta rede.
  _watchFirstConnect(transport, label) {
    if (!transport) return;
    const st = this._ts(transport);
    if (st.everConnected || st.watchTimer || this.mediaFailedReported) return;
    st.watchTimer = setTimeout(() => {
      st.watchTimer = null;
      if (!this._isCurrent(transport) || this.reconnecting || st.everConnected) return;
      if (transport.connectionState === 'connected') return;
      this.mediaFailedReported = true;
      this.cb.onMediaFailed?.({ code: `ICE_TIMEOUT_${label}` });
    }, FIRST_CONNECT_WATCH_MS);
  }

  // ---------- reconexão ----------
  _scheduleReconnect(reason) {
    if (this.disposed || this.leaving) return;
    if (this.reconnectTimer) return; // já agendada
    const attempt = this.reconnectAttempt;
    if (attempt >= RECONNECT_DELAYS_MS.length) { this._giveUp('gave-up'); return; }
    this.reconnecting = true;
    this._teardownSession();
    this.cb.onReconnecting?.(attempt + 1, reason);
    const delay = RECONNECT_DELAYS_MS[attempt];
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempt = attempt + 1;
      (async () => {
        if (this.needsFreshToken) await this._refreshToken();
        await this._session({ first: false });
      })().then(() => {
        if (this.disposed) return;
        this.reconnectAttempt = 0;
        this.tokenRefreshes = 0;
        this.reconnecting = false;
        this.cb.onReconnected?.();
      }).catch((err) => {
        if (this.disposed) return;
        if (err?.code === 'TOKEN_REFRESH') { this._giveUp('token'); return; }
        const action = err?.closeInfo ? classifyClose(err.closeInfo) : 'reconnect';
        if (action === 'replaced') { this._giveUp('replaced'); return; }
        if (action === 'give-up') { this._giveUp('closed'); return; }
        if (action === 'refresh-token') this.needsFreshToken = true;
        this.cb.onError?.(err, { where: 'reconnect', attempt: attempt + 1 });
        this._scheduleReconnect(`tentativa ${attempt + 1} falhou`);
      });
    }, delay);
  }

  // Token novo (4401: venceu na call longa / foi trocado): pede ao app.
  async _refreshToken() {
    const fail = (m) => { const e = new Error(m); e.code = 'TOKEN_REFRESH'; return e; };
    if (!this.refreshCredentials) throw fail('sem como renovar o token');
    this.tokenRefreshes += 1;
    if (this.tokenRefreshes > MAX_TOKEN_REFRESHES) throw fail('token recusado de novo');
    let creds = null;
    try { creds = await this.refreshCredentials(); } catch (err) { throw fail(`não foi possível renovar o token: ${err?.message || err}`); }
    if (this.disposed) return;
    if (!creds || !creds.token) throw fail('token novo indisponível');
    this.joinOpts = { url: creds.url || this.joinOpts.url, token: creds.token };
    if (Array.isArray(creds.iceServers)) this.iceServers = creds.iceServers;
    this.needsFreshToken = false;
  }

  _giveUp(reason = 'gave-up') {
    if (this.disposed) return;
    this.disposed = true;
    this._closeAll();
    this.cb.onLeft?.({ reason });
  }

  // Derruba transports/consumers/producers da sessão atual SEM parar as
  // faixas locais (pra republicar depois) e avisa a grade que as mídias
  // remotas sumiram por enquanto.
  _teardownSession() {
    this._stopStats();
    this._clearTransportTimers();
    const peersSeen = new Set([...this.consumers.values()].map((c) => c.peerId));
    for (const c of this.consumers.values()) {
      try { c.consumer.close(); } catch { /* ok */ }
    }
    this.consumers.clear();
    this.consumingProducers.clear();
    this.inboundAudio.clear();
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
    if (ws) { try { ws.onclose = null; ws.onmessage = null; ws.onerror = null; ws.close(); } catch { /* ok */ } }
    this._rejectPending('reconectando');
  }

  // ---------- mídia local ----------
  async _getMicTrack({ forceDefault = false } = {}) {
    if (isLive(this.localTracks.mic)) return this.localTracks.mic;
    if (this.noise) { try { this.noise.dispose(); } catch { /* ok */ } this.noise = null; }
    // Com o RNNoise ligado, o supressor do navegador fica desligado (dois
    // supressores em série "comem" a voz); o resto do tratamento fica.
    const base = { echoCancellation: true, noiseSuppression: !this.noiseEnabled, autoGainControl: true, channelCount: 1 };
    const wantId = !forceDefault && this.micDeviceId;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: wantId ? { ...base, deviceId: { exact: wantId } } : base, video: false });
    } catch (err) {
      // Microfone escolhido sumiu (outro fone, driver mudou o id) → o padrão.
      if (!wantId || micErrorReason(err) === 'denied') throw err;
      stream = await navigator.mediaDevices.getUserMedia({ audio: base, video: false });
    }
    const raw = stream.getAudioTracks()[0];
    if (!raw) { const e = new Error('nenhum microfone'); e.name = 'NotFoundError'; throw e; }
    if (this.disposed) { try { raw.stop(); } catch { /* ok */ } throw new Error('engine encerrado'); }
    this.rawMic = raw;
    raw.addEventListener('ended', () => { this._onMicEnded(raw); });
    let track = raw;
    if (this.noiseEnabled) {
      const sup = await createNoiseSuppressedTrack(raw, { enabled: true });
      if (sup) { this.noise = sup; track = sup.track; }
    }
    this.localTracks.mic = track;
    track.enabled = this.micGateOpen;
    return track;
  }

  // Publica o microfone com o mudo ATUAL (this.micMuted). Uma publicação por
  // vez por transport (a da sessão antiga desiste sozinha).
  _publishMic() {
    if (this.producers.mic) return Promise.resolve();
    const transport = this.sendTransport;
    if (this._micPublishing && this._micPublishingFor === transport) return this._micPublishing;
    const task = (async () => {
      const track = await this._getMicTrack();
      if (this.disposed || !transport || transport !== this.sendTransport) return;
      let producer;
      try {
        producer = await transport.produce({
          track,
          codecOptions: { opusStereo: false, opusDtx: true, opusFec: true },
          appData: { source: 'mic' },
        });
      } catch (err) {
        // Transport fechou no meio (reconexão): a próxima sessão publica.
        if (this.disposed || transport !== this.sendTransport) return;
        throw err;
      }
      if (this.disposed || transport !== this.sendTransport) { try { producer.close(); } catch { /* ok */ } return; }
      this.producers.mic = producer;
      producer.on('trackended', () => { this._onMicEnded(null); });
      producer.on('transportclose', () => { if (this.producers.mic === producer) this.producers.mic = null; });
      this._watchFirstConnect(transport, 'SEND');
      if (this.micMuted) { producer.pause(); await this._request('pauseProducer', { producerId: producer.id }).catch(() => {}); }
      this.cb.onSelfMute?.(!!this.micMuted);
    })();
    this._micPublishing = task;
    this._micPublishingFor = transport;
    const clear = () => { if (this._micPublishing === task) { this._micPublishing = null; this._micPublishingFor = null; } };
    task.then(clear, clear);
    return task;
  }

  _onMicError(err) {
    if (this.disposed) return;
    const reason = micErrorReason(err);
    this.cb.onSelfMute?.(true);
    if (reason && this.cb.onMicUnavailable) this.cb.onMicUnavailable({ reason, error: err });
    else this.cb.onError?.(err, { where: 'enableMic' });
  }

  // Microfone desconectado/encerrado pelo sistema no meio da call: pega o
  // padrão e troca a faixa no MESMO producer (sem renegociar nada).
  async _onMicEnded(raw) {
    if (this.disposed || this.leaving) return;
    if (raw && raw !== this.rawMic) return; // faixa antiga, já trocada
    if (this._micRecovering) return;
    this._micRecovering = true;
    try {
      const old = this.localTracks.mic;
      this.localTracks.mic = null;
      if (this.noise) { try { this.noise.dispose(); } catch { /* ok */ } this.noise = null; }
      if (old) { try { old.stop(); } catch { /* ok */ } }
      let track = null;
      for (let i = 0; i < 2 && !track; i += 1) {
        try { track = await this._getMicTrack({ forceDefault: true }); } catch (err) { if (i === 1 || micErrorReason(err) === 'denied') throw err; await sleep(1000); }
      }
      if (this.disposed) return;
      const p = this.producers.mic;
      if (p && !p.closed) {
        await p.replaceTrack({ track });
        if (this.micMuted && !p.paused) p.pause();
      } else if (this.sendTransport) {
        await this._publishMic();
      }
      this.cb.onMicRecovered?.();
    } catch (err) {
      this._onMicError(err);
    } finally {
      this._micRecovering = false;
    }
  }

  // Troca de microfone escolhida pela pessoa (menu da barra/configurações).
  async setMicDevice(deviceId) {
    this.micDeviceId = deviceId || null;
    const p = this.producers.mic;
    if (!p || p.closed) return true;
    const oldTrack = this.localTracks.mic; const oldNoise = this.noise; const oldRaw = this.rawMic;
    this.localTracks.mic = null; this.noise = null;
    try {
      const track = await this._getMicTrack();
      await p.replaceTrack({ track });
      if (this.micMuted && !p.paused) p.pause();
      try { oldNoise?.dispose(); } catch { /* ok */ }
      try { oldTrack?.stop(); } catch { /* ok */ }
      try { if (oldRaw && oldRaw !== this.rawMic) oldRaw.stop(); } catch { /* ok */ }
      return true;
    } catch (err) {
      this.localTracks.mic = oldTrack; this.noise = oldNoise; this.rawMic = oldRaw;
      this.cb.onError?.(err, { where: 'setMicDevice' });
      return false;
    }
  }

  async _produceCamera(track) {
    if (!this.sendTransport) throw new Error('sem transport de envio');
    this.localTracks.camera = track;
    const producer = await this.sendTransport.produce({
      track, encodings: CAMERA_ENCODINGS,
      codecOptions: { videoGoogleStartBitrate: 600 },
      appData: { source: 'camera' },
    });
    this.producers.camera = producer;
    return producer;
  }

  async _produceScreen(vtrack, atrack) {
    if (!this.sendTransport) throw new Error('sem transport de envio');
    this.localTracks.screen = vtrack;
    this.producers.screen = await this.sendTransport.produce({
      track: vtrack, encodings: SCREEN_ENCODINGS,
      codecOptions: { videoGoogleStartBitrate: 1000 },
      appData: { source: 'screen' },
    });
    if (atrack && isLive(atrack)) {
      this.localTracks.screenAudio = atrack;
      this.producers.screenAudio = await this.sendTransport.produce({
        track: atrack, codecOptions: { opusStereo: true, opusDtx: false }, appData: { source: 'screenAudio' },
      });
    }
  }

  // Todas as faixas de ÁUDIO vivas da pessoa (mic + áudio da tela) num
  // stream só. BUG CORRIGIDO: o áudio da tela substituía o do microfone na
  // grade (um stream por pessoa) — quem transmitia com som ficava sem voz,
  // e ao parar a transmissão a voz sumia de vez até reconectar.
  _emitPeerAudio(uid) {
    const tracks = [];
    for (const c of this.consumers.values()) {
      if (c.peerId === uid && c.kind === 'audio' && !c.consumer.closed && c.consumer.track) tracks.push(c.consumer.track);
    }
    try {
      if (tracks.length) this.cb.onRemoteAudio?.(uid, new MediaStream(tracks));
      else this.cb.onRemoteRemove?.(uid, 'audio');
    } catch (err) { this.cb.onError?.(err, { where: 'remoteTrack' }); }
  }

  _dropConsumer(cid) {
    const c = this.consumers.get(cid);
    if (!c) return;
    this.consumers.delete(cid);
    try { c.consumer.close(); } catch { /* ok */ }
    if (c.kind === 'audio') this._emitPeerAudio(c.peerId);
    else this.cb.onRemoteRemove?.(c.peerId, 'video');
  }

  async _consume({ producerId, peerId, kind, appData }) {
    if (!this.recvTransport || this.disposed || !producerId) return;
    if (this.consumingProducers.has(producerId)) return;
    for (const c of this.consumers.values()) if (c.consumer.producerId === producerId) return;
    const transport = this.recvTransport;
    const uid = String(peerId);
    this.consumingProducers.add(producerId);
    try {
      const info = await this._request('consume', {
        transportId: transport.id, producerId, rtpCapabilities: this.device.rtpCapabilities,
      });
      if (this.disposed || this.recvTransport !== transport) return;
      const consumer = await transport.consume({
        id: info.consumerId, producerId: info.producerId, kind: info.kind, rtpParameters: info.rtpParameters, appData: info.appData,
      });
      if (this.disposed || this.recvTransport !== transport) { try { consumer.close(); } catch { /* ok */ } return; }
      const source = (info.appData && info.appData.source) || (appData && appData.source) || (kind === 'audio' ? 'mic' : 'camera');
      this.consumers.set(consumer.id, { consumer, peerId: uid, kind: consumer.kind, source });
      // Limpeza: transport fechou / faixa encerrada por fora.
      consumer.on('transportclose', () => { this.consumers.delete(consumer.id); });
      consumer.on('trackended', () => { this._dropConsumer(consumer.id); });
      this.peers.add(uid);
      this.cb.onMediaUser?.(uid, true);
      if (consumer.kind === 'audio') this._emitPeerAudio(uid);
      else {
        try { this.cb.onRemoteVideo?.(uid, new MediaStream([consumer.track]), source === 'screen' ? 'screen' : 'camera'); } catch (err) { this.cb.onError?.(err, { where: 'remoteTrack' }); }
      }
      this._watchFirstConnect(transport, 'RECV');
      await this._resumeConsumer(consumer);
    } catch (err) {
      // Sessão derrubada no meio (reconexão/saída) ou a mídia acabou antes do
      // consume chegar (a pessoa saiu/desligou a câmera): não é erro de verdade.
      if (this.disposed || this.recvTransport !== transport) return;
      if (/producer não encontrado/.test(String(err?.message))) return;
      throw err;
    } finally {
      this.consumingProducers.delete(producerId);
    }
  }

  // O servidor cria o consumer PAUSADO; sem o resume a pessoa não ouve nada.
  // Tenta de novo (pedido perdido / sinalização lenta) antes de desistir.
  async _resumeConsumer(consumer) {
    let lastErr = null;
    for (let i = 0; i < 3; i += 1) {
      if (this.disposed || consumer.closed || !this.consumers.has(consumer.id)) return;
      try {
        await this._request('resumeConsumer', { consumerId: consumer.id });
        return;
      } catch (err) {
        lastErr = err;
        if (/não encontrado|desconectada|reconectando|fechada/.test(String(err?.message))) return;
        await sleep(400 * (i + 1));
      }
    }
    if (!this.disposed && !consumer.closed) this.cb.onError?.(lastErr, { where: 'resumeConsumer' });
  }

  // ---------- estatísticas / qualidade ----------
  _startStats() {
    this._stopStats();
    this.statsPrev.clear();
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
    const audioBytes = new Map();
    for (const [cid, c] of this.consumers) {
      if (c.consumer.closed) continue;
      try {
        const stats = await c.consumer.getStats();
        stats.forEach((s) => {
          if (s.type !== 'inbound-rtp') return;
          const loss = this._lossDelta(cid, s.packetsLost || 0, s.packetsReceived || 0);
          perPeer.set(c.peerId, Math.max(perPeer.get(c.peerId) || 0, loss));
          if (c.kind === 'audio') audioBytes.set(c.peerId, (audioBytes.get(c.peerId) || 0) + (s.bytesReceived || 0));
        });
      } catch { /* ok */ }
    }
    if (this.disposed) return;
    this.inboundAudio = audioBytes;
    for (const [uid, loss] of perPeer) quality[uid] = qualityFrom({ loss, rtt: 0, connected: true });
    this.cb.onNetQuality?.(quality);
    if (rtt != null) this.cb.onRtt?.(rtt);
  }

  // ---------- controles ----------
  // enabled=true => quero FALAR. Espelha o estado real por onSelfMute.
  async setMicEnabled(enabled) {
    this.micMuted = !enabled;
    const p = this.producers.mic;
    try {
      if (!p) {
        // Sem producer (mic negado/ausente ao entrar): tenta o microfone de novo.
        if (enabled && this.sendTransport) {
          try { await this._publishMic(); } catch (err) { this._onMicError(err); }
        } else this.cb.onSelfMute?.(!enabled);
        return;
      }
      if (enabled) {
        p.resume();
        // resume() reabilita a faixa: reaplica o portão (apertar-pra-falar).
        this._applyMicGate();
        await this._request('resumeProducer', { producerId: p.id });
      }
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
      await this._closeProducer('mic');
      await this._publishMic();
    } catch (err) { this.cb.onError?.(err, { where: 'setNoiseSuppression' }); }
  }

  async setCamera(on) {
    try {
      if (!on) { await this._closeProducer('camera'); this.cb.onSelfCamera?.(false); return null; }
      if (this.producers.camera) return new MediaStream([this.localTracks.camera]);
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false });
      const track = stream.getVideoTracks()[0];
      await this._produceCamera(track);
      track.addEventListener('ended', () => { this._closeProducer('camera'); this.cb.onSelfCamera?.(false); });
      this.cb.onSelfCamera?.(true);
      return new MediaStream([track]);
    } catch (err) { this.cb.onError?.(err, { where: 'setCamera' }); return null; }
  }

  // Portão do microfone: fechado = manda silêncio, sem mudar o mudo.
  setMicGate(open) {
    this.micGateOpen = !!open;
    this._applyMicGate();
  }

  _applyMicGate() {
    const t = this.localTracks.mic;
    const p = this.producers.mic;
    if (!t || (p && p.paused)) return; // pausado (mudo): a faixa já está desligada
    try { t.enabled = this.micGateOpen; } catch { /* faixa encerrada */ }
  }

  // Faixa do microfone (MediaStreamTrack). raw=true devolve a captura crua
  // (antes do RNNoise e do portão) — usada pra medir o nível de entrada.
  getLocalMicTrack({ raw = false } = {}) {
    const t = raw ? (this.rawMic || this.localTracks.mic) : this.localTracks.mic;
    return isLive(t) ? t : null;
  }

  // Resolução/fps da tela AO VIVO, sem parar de transmitir.
  async setScreenQuality({ quality, frameRate } = {}) {
    const t = this.localTracks.screen;
    const dims = SCREEN_QUALITY_PRESETS[quality];
    if (!isLive(t) || !dims || typeof t.applyConstraints !== 'function') return false;
    await t.applyConstraints({ width: { ideal: dims.width }, height: { ideal: dims.height }, frameRate: { ideal: frameRate || 30 } });
    return true;
  }

  async setScreen(on, options = {}) {
    try {
      if (!on) { await this._closeProducer('screen'); await this._closeProducer('screenAudio'); this.cb.onSelfScreen?.(false); return null; }
      if (this.producers.screen) return new MediaStream([this.localTracks.screen]);
      const dims = SCREEN_QUALITY_PRESETS[options.quality] || SCREEN_QUALITY_PRESETS['1080p'];
      const frameRate = [15, 30, 60].includes(options.frameRate) ? options.frameRate : 30;
      let vtrack;
      let atrack = null;
      if (options.track) {
        // Faixa pronta (captura nativa do app Android).
        vtrack = options.track;
      } else {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: dims.width }, height: { ideal: dims.height }, frameRate: { ideal: frameRate } },
          audio: options.audio !== false,
        });
        vtrack = stream.getVideoTracks()[0];
        atrack = stream.getAudioTracks()[0] || null;
      }
      try { vtrack.contentHint = 'detail'; } catch { /* opcional */ }
      await this._produceScreen(vtrack, atrack);
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
    if (key === 'mic' && this.rawMic) { try { this.rawMic.stop(); } catch { /* ok */ } this.rawMic = null; }
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
    this._clearTransportTimers();
    for (const key of Object.keys(this.producers)) {
      const p = this.producers[key]; const t = this.localTracks[key];
      if (t) { try { t.stop(); } catch { /* ok */ } }
      if (p) { try { p.close(); } catch { /* ok */ } }
      this.producers[key] = null; this.localTracks[key] = null;
    }
    if (this.noise) { try { this.noise.dispose(); } catch { /* ok */ } this.noise = null; }
    if (this.rawMic) { try { this.rawMic.stop(); } catch { /* ok */ } this.rawMic = null; }
    for (const c of this.consumers.values()) { try { c.consumer.close(); } catch { /* ok */ } }
    this.consumers.clear();
    this.consumingProducers.clear();
    this.inboundAudio.clear();
    try { this.sendTransport?.close(); } catch { /* ok */ }
    try { this.recvTransport?.close(); } catch { /* ok */ }
    this.sendTransport = null; this.recvTransport = null;
    const ws = this.ws; this.ws = null;
    if (ws) {
      try { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id: ++this.seq, method: 'leave' })); } catch { /* ok */ }
      try { ws.onclose = null; ws.onmessage = null; ws.onerror = null; ws.close(); } catch { /* ok */ }
    }
    this._rejectPending('saindo');
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
