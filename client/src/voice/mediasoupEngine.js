// Engine do servidor de mídia PRÓPRIO do Project Club (media-server/,
// mediasoup) — o único engine de mídia da voz. Encaixa na
// grade/AudioSink do VoiceContext: entrega faixas por participante, e a
// identidade na sala é o nosso userId (o servidor assina o JWT com
// sub = userId, ver services/voiceTokens.js mintProjectClub).
//
// Fluxo (PDF, seção 1 "Fluxo simplificado de uma chamada"):
//   1. conecta no wss://.../ws?token=<jwt>  → recebe `welcome` (capacidades
//      RTP do roteador + quem já está + o que cada um publica + o estado
//      imposto pelo servidor: permissões/mudo da moderação)
//   2. carrega o Device do mediasoup-client com essas capacidades
//   3. cria 1 transport de ENVIO e 1 de RECEPÇÃO (ICE/DTLS; STUN/TURN vêm do
//      servidor nas credenciais — credencial TURN temporária)
//   4. assina a mídia dos outros (um consumer por producer remoto) e, EM
//      PARALELO, publica o microfone (câmera/tela sob demanda)
//   5. ao sair, fecha tudo
//
// À PROVA DE FALHAS (ver também voice/resilience.js):
//   - Microfone negado/ausente NÃO impede de entrar: a pessoa entra só
//     ouvindo (onMicUnavailable) e pode tentar o mic de novo depois.
//   - Mic desconectado no meio da call (faixa 'ended') → pega o microfone
//     padrão sozinho e troca a faixa no producer (replaceTrack). Trocou o
//     dispositivo PADRÃO do sistema (fone plugado) e a pessoa usa o padrão
//     → troca sozinho também (devicechange).
//   - Rede piscou: transport 'disconnected' espera um pouco e 'failed' faz
//     ICE RESTART. Mudou de rede (evento online / navigator.connection) →
//     ICE restart NA HORA nos dois transports (ou refaz a sessão se a
//     sinalização morreu). Só se o ICE não voltar é que refaz a sessão.
//   - Sinalização "zumbi" (WebSocket aberto mas o servidor não responde):
//     ping a cada 5s com 3s de prazo; perdeu → refaz a sessão na hora.
//   - Sem internet (navigator.onLine === false) ou o PC acordou do modo
//     suspenso: NÃO desiste — espera o `online` e tenta de novo. Quando
//     desiste por outro motivo, onLeft({ reason:'gave-up', network }) diz
//     se foi rede (não é falha do provedor) ou o provedor mesmo.
//   - Sessão inteira caiu (wi-fi, servidor reiniciou a sala com 1012): refaz
//     tudo com espera crescente (1s, 2s, 4s, 8s…) por até ~40s. Na sessão
//     nova, quem saiu da sala enquanto estávamos fora some da grade.
//   - Token vencido (4401 'expired', call longa): pede um token novo
//     (refreshCredentials, que chama /api/voice/join) e reconecta.
//   - Entrou na call em OUTRO aparelho (4409 / kicked 'replaced'|'flapping'):
//     NÃO reconecta e sai com onLeft({ reason: 'replaced' }).
//   - Sala cheia (4503 "sala cheia"): não reconecta; erro com code
//     'channel-full'. Muitas tentativas (4429): espera e tenta de novo, sem
//     contar como falha do provedor.
//   - Join "verdadeiro": com gente publicando na sala, o join só termina
//     quando a recepção CONECTA (ICE/DTLS) — se não conectar em 12s, falha.
//     Envio que nunca conecta depois do join → onMediaFailed.
//   - resumeConsumer que falha mesmo tentando de novo → recria o consumer
//     uma vez (onTelemetry avisa).
//
// MICROFONE — pipeline único (voice/micPipeline.js):
//   mic cru → [RNNoise] → ganho → PORTÃO → faixa enviada, com um Analyser
//   antes do portão. O portão junta apertar-pra-falar, sensibilidade de
//   entrada (manual em dB ou automática com piso de ruído) e o portão
//   manual setMicGate (ver voice/micGate.js). O anel verde LOCAL vem do
//   Analyser (instantâneo, com 300ms de "segura"); sem Web Audio, vale o
//   detector do servidor (activeSpeakers).
//   Mudo: o microfone é publicado JÁ PAUSADO (faixa desligada antes do
//   produce + appData.paused no servidor) — nenhum pedaço de áudio vaza.
//
// PERMISSÕES NO SERVIDOR: o servidor de mídia recusa microfone sem SPEAK,
// câmera/tela sem VIDEO e desmutar com mudo da moderação; avisa mudanças por
// `serverState` (onServerState). Ensurdecer (setDeafened) pausa o áudio
// recebido NO SERVIDOR (economia de banda).
//
// TELA: setScreen(true, { quality, frameRate, width, height, maxBitrate,
// audio, track }); setScreenQuality(...) troca AO VIVO. Erros de câmera/tela
// viram mensagem amigável (onMediaError / { detailed: true }); fechar o
// seletor de tela é "cancelado" (sem aviso).
//
// Carregado de forma preguiçosa (o SDK só baixa quando entra numa call por
// este provedor). Falha no download do pedaço (deploy novo) tenta de novo e,
// por fim, recarrega a página UMA vez (fora de call).
//
// Callbacks:
//   onJoined(myId)
//   onLeft({ reason, network?, code?, detail?, providerFailure? })
//          reason: 'replaced'|'kicked'|'token'|'gave-up'|'closed'|'full'
//   onReconnecting(attempt, why), onReconnected()
//   onNetQuality({ uid: quality }), onRtt(ms)
//   onLocalSpeaking(bool), onRemoteSpeaking(uid, bool)
//   onLocalLevel(level0a1, { db, gateOpen, transmitting })   (~10/s)
//   onSelfMute(bool), onSelfCamera(bool), onSelfScreen(bool)
//   onServerState({ canSpeak, canVideo, role, serverMuted, serverDeafened })
//   onMicUnavailable({ reason: 'denied'|'missing'|'busy', error }), onMicRecovered()
//   onMediaFailed({ code }), onMediaError({ kind, reason, cancelled, code })
//   onMediaUser(uid, present)
//   onRemoteAudio(uid, MediaStream)          (só o MICROFONE da pessoa)
//   onRemoteScreenAudio(uid, MediaStream|null) (só o SOM DA TELA — volume
//          separado, igual ao "volume da transmissão" do Discord; sem esse
//          callback o som da tela vai junto no onRemoteAudio, como antes)
//   onRemoteVideo(uid, MediaStream, kind)
//   onRemoteRemove(uid, 'audio'|'video'|'all', source?)  source = 'camera'|'screen' (só vídeo)
//   onConnectionStats({ rtt, sendLoss, connected })  (~a cada 2s)
//   onTelemetry({ type, ... }), onError(err, info)
// API nova documentada em docs/voz-discord-api.md.
import { createMicPipeline } from './micPipeline.js';
import { NOISE_MODELS } from './noiseModels.js';
import { createMicGate, createSpeakingDetector, createThrottle, dbToLevel, GATE_DEFAULTS } from './micGate.js';
import {
  classifyClose, iceAction, importWithRetry, browserGuardedReload, micErrorReason, diffPeers, mediaErrorInfo,
} from './resilience.js';
import { SCREEN_QUALITY_PRESETS } from '../utils/screenShareTracks.js';
import {
  normalizeScreenPreset, screenEncodings, screenContentHint, screenVideoConstraints, displayMediaOptions,
  spatialLayersOf, viewportDecision, CONSUMER_PRIORITY,
} from './screenPresets.js';

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
// (PDF 4.4). Tela: 2 camadas (ver voice/screenPresets.js — tabela de
// presets, camada baixa pra miniatura e camada cheia).
const CAMERA_ENCODINGS = [
  { scaleResolutionDownBy: 4, maxBitrate: 150_000, scalabilityMode: 'L1T3' },
  { scaleResolutionDownBy: 2, maxBitrate: 500_000, scalabilityMode: 'L1T3' },
  { scaleResolutionDownBy: 1, maxBitrate: 1_200_000, scalabilityMode: 'L1T3' },
];
// Microfone: prioridade ALTA na fila do navegador e na rede (DSCP) — a voz
// passa na frente da câmera/tela quando a banda aperta (igual ao Discord).
const MIC_ENCODINGS = [{ priority: 'high', networkPriority: 'high' }];
// opusNack: o servidor retransmite pacote de voz perdido (consumer com
// enableRtx) — junto com o FEC, a voz aguenta perda de rede.
const MIC_CODEC_OPTIONS = { opusStereo: false, opusDtx: true, opusFec: true, opusNack: true, opusMaxAverageBitrate: 64000 };
// Som da tela (música/jogo/vídeo): estéreo, sem DTX (silêncio de música não
// é silêncio de voz), FEC e 128 kbps.
const SCREEN_AUDIO_CODEC_OPTIONS = { opusStereo: true, opusDtx: false, opusFec: true, opusMaxAverageBitrate: 128000 };
// Linux (app de PC): nome do microfone virtual do venmic com o som do PC.
const VENMIC_LABEL = 'vencord-screen-share';
const VENMIC_POLL_MS = 150;
const VENMIC_WAIT_MS = 2000;

const REQUEST_TIMEOUT_MS = 15000;
// Sem `welcome` nesse tempo, a conexão conta como falha (antes esperava pra sempre).
const CONNECT_TIMEOUT_MS = 10000;
const STATS_INTERVAL_MS = 2000;
// Batimento da sinalização: ping a cada 5s, 4s de prazo. Só refaz a sessão
// depois de 2 pings perdidos SEGUIDOS — antes UM ping atrasado (4G/wi-fi
// oscilando por 3s) derrubava a chamada inteira e mostrava "reconectando"
// mesmo com o áudio passando normalmente.
const KEEPALIVE_MS = 5000;
const PING_TIMEOUT_MS = 4000;
const PING_MISSES_TO_RECONNECT = 2;
// O relógio pulou mais que isso entre dois batimentos → o PC dormiu.
const SLEEP_JUMP_MS = 15000;
// Sem internet: confere de novo de tempos em tempos (o evento `online` às
// vezes não vem — ex.: Electron depois de suspender).
const OFFLINE_POLL_MS = 10000;
// Medidor/portão do microfone.
const ANALYSIS_TICK_MS = 40;
const LEVEL_EVERY_MS = 100;
// Reconexão: esperas entre tentativas (ms). Soma ≈ 40s antes de desistir.
export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 8000, 8000, 8000];
// ICE "disconnected" costuma voltar sozinho; depois disso, ICE restart.
const ICE_DISCONNECTED_GRACE_MS = 2500;
// Depois de um ICE restart, quanto esperar o transport voltar a 'connected'.
const ICE_RESTART_TIMEOUT_MS = 8000;
const MAX_ICE_RESTARTS = 2;
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
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const isIOS = () => typeof navigator !== 'undefined'
  && (/iP(hone|ad|od)/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const MIC_CONSTRAINTS = { echoCancellation: true, autoGainControl: true, channelCount: 1 };

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
    this.deafened = false;
    this.micGateOpen = true; // portão MANUAL (setMicGate)
    this.micDeviceId = null;
    this.micGroupId = null; // grupo do dispositivo capturado (troca do padrão)
    this.rawMic = null; // faixa crua do mic
    this.pipeline = null; // pipeline único do mic (micPipeline.js)
    this.noiseEnabled = false;
    // Modelo do redutor: 'rnnoise' (padrão) | 'dfn3' (alta qualidade, flag).
    this.noiseModel = NOISE_MODELS.RNNOISE;
    this.inputGain = 1;
    this.gate = createMicGate();
    this.speakingDet = createSpeakingDetector();
    this.levelThrottle = createThrottle(LEVEL_EVERY_MS);
    this.analysisTimer = null;
    this.analysisActive = false; // o Analyser está medindo (anel verde local)
    this.lastLevelDb = null;
    this.lastSoundAt = 0;
    this.pttTimer = null;
    this._micPublishing = null;
    this._micPublishingFor = null;
    this._micRecovering = false;
    // Estado imposto pelo servidor de mídia (claims do token + moderação).
    this.serverState = { canSpeak: true, canVideo: true, role: null, serverMuted: false, serverDeafened: false };
    // Reconexão / ICE / estatísticas / rede.
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.reconnecting = false;
    this.leaving = false;
    this.tstate = new Map(); // transportId -> { iceRestarts, graceTimer, restartTimer, watchTimer, everConnected, restarting }
    this.mediaFailedReported = false;
    this.statsTimer = null;
    this.statsPrev = new Map(); // key -> { lost, received }
    this.inboundAudio = new Map(); // peerId -> bytes de áudio recebidos
    this.keepaliveTimer = null;
    this.lastBeatAt = 0;
    this._pinging = false;
    this.netTrouble = false; // houve queda de internet/sono nesta rodada de reconexão
    this.waitingOnline = false;
    this.offlinePollTimer = null;
    this.closeKind = null; // 'rate-limited' quando o servidor pediu calma (4429)
    this._netWatching = false;
    this._deviceTimer = null;
    this._recreated = new Set(); // producerIds cujo consumer já foi recriado uma vez
    // Tela: preset atual ({ quality, frameRate, maxBitrate? }).
    this.screenOpts = normalizeScreenPreset({});
    this._venmicActive = false; // microfone virtual do venmic ligado (Linux/app de PC)
    // Recepção sob medida: `${uid}|${kind}` -> Map(viewId -> { visible, height }).
    this.viewports = new Map();
  }

  getNode() { return null; }

  capabilities() {
    return {
      camera: true, screen: true, perUserVolume: true, speakingIndicator: true, customGrid: true, netQuality: true, reconnect: true,
      noiseSuppression: true, iceRestart: true, receiveOnly: true, nativeScreenTrack: true,
      pushToTalk: true, inputSensitivity: true, localLevel: true, serverModeration: true, deafenSavesBandwidth: true,
      screenPresets: true, screenSimulcast: true, videoViewport: true, separateScreenAudio: true, inputGain: true, vad: true,
    };
  }

  // Bytes de áudio recebidos dessa pessoa (última leitura das estatísticas).
  getInboundAudioBytes(uid) {
    const v = this.inboundAudio.get(String(uid));
    return Number.isFinite(v) ? v : null;
  }

  // ---------- sinalização ----------
  _request(method, data = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    // Servidor de mídia ANTIGO (atualizado à parte na VM) sem um método novo
    // (pauseConsumer, setConsumerPreferredLayers, setConsumerPriority,
    // closeConsumer…): depois da 1ª recusa, nem pede mais — sem gastar o
    // limite de mensagens da sinalização com pedido que nunca vai dar certo.
    if (this._unsupported?.has(method)) return Promise.reject(new Error(`método desconhecido: ${method}`));
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { reject(new Error('sinalização desconectada')); return; }
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout em ${method}`)); }, timeoutMs);
      this.pending.set(id, {
        resolve,
        reject: (err) => {
          if (/^método desconhecido/.test(String(err?.message))) { if (!this._unsupported) this._unsupported = new Set(); this._unsupported.add(method); }
          reject(err);
        },
        timer,
      });
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
    if (action === 'replaced') { this._giveUp('replaced', { providerFailure: false }); return; }
    if (action === 'full') { this._giveUp('full', { code: 'channel-full', providerFailure: false }); return; }
    if (action === 'give-up') {
      if (info.kicked || info.code === 4403) this._giveUp('kicked', { detail: info.kicked || 'kicked', providerFailure: false });
      else this._giveUp('closed');
      return;
    }
    if (action === 'refresh-token') this.needsFreshToken = true;
    if (action === 'backoff') this.closeKind = 'rate-limited';
    this._scheduleReconnect(`sinalização fechada (${info.code})`);
  }

  _findConsumer(consumerId) {
    const c = this.consumers.get(String(consumerId));
    return c || null;
  }

  // Tira uma pessoa da grade (saiu da sala).
  _forgetPeer(uid) {
    this.peers.delete(uid);
    for (const [cid, c] of [...this.consumers]) { if (c.peerId === uid) { try { c.consumer.close(); } catch { /* ok */ } this.consumers.delete(cid); } }
    this.inboundAudio.delete(uid);
    this.cb.onRemoteRemove?.(uid, 'all');
    this.cb.onMediaUser?.(uid, false);
  }

  _onEvent(event, data) {
    const cb = this.cb;
    switch (event) {
      case 'peerJoined':
        this.peers.add(String(data.peerId));
        cb.onMediaUser?.(String(data.peerId), true);
        break;
      case 'peerLeft':
        this._forgetPeer(String(data.peerId));
        break;
      case 'newProducer':
        // Chegou entre o welcome e a criação do transport de recepção: guarda
        // e assina junto com os do welcome (senão essa pessoa nunca era ouvida).
        if (!this.recvTransport) { if (this._earlyProducers) this._earlyProducers.push(data); break; }
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
        if (c && !c.consumer.closed && !(c.kind === 'audio' && this.deafened) && !c.viewPaused) { try { c.consumer.resume(); } catch { /* ok */ } }
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
        // O MEU anel vem do medidor local (instantâneo); o do servidor só
        // vale quando o medidor não está rodando (sem Web Audio).
        if (!this.analysisActive) {
          const local = ids.has(this.myId) && !this.micMuted;
          if (local !== this.lastLocalSpeaking) { this.lastLocalSpeaking = local; cb.onLocalSpeaking?.(local); }
        }
        for (const uid of this.peers) cb.onRemoteSpeaking?.(uid, ids.has(uid));
        break;
      }
      case 'serverState':
        this._applyServerState(data);
        break;
      case 'kicked': {
        const r = String(data.reason || '');
        if (r === 'replaced' || r === 'flapping') this._giveUp('replaced', { providerFailure: false });
        else this._giveUp('kicked', { detail: r || 'kicked', providerFailure: false });
        break;
      }
      default: break; // producerPaused/producerResumed/error: nada a fazer aqui
    }
  }

  // ---------- entrar ----------
  async join({ url, token, userId, iceServers = [], startMuted = false, startDeafened = false, noiseSuppression = false, noiseModel = NOISE_MODELS.RNNOISE, micDeviceId = null, refreshCredentials = null } = {}) {
    await loadMediasoup();
    if (this.disposed) return;
    if (!url || !token) throw new Error('credenciais do servidor de mídia ausentes');
    this.myId = String(userId);
    this.iceServers = Array.isArray(iceServers) ? iceServers : [];
    this.joinOpts = { url, token };
    this.refreshCredentials = typeof refreshCredentials === 'function' ? refreshCredentials : null;
    this.micMuted = !!startMuted || !!startDeafened;
    this.deafened = !!startDeafened;
    this.micDeviceId = micDeviceId || null;
    this.noiseEnabled = !!noiseSuppression;
    this.noiseModel = noiseModel === NOISE_MODELS.DFN3 ? NOISE_MODELS.DFN3 : NOISE_MODELS.RNNOISE;
    this._startNetWatch();

    try {
      await this._session({ first: true });
    } catch (err) {
      throw this._tagJoinError(err);
    }
  }

  // Erro da entrada com código que diz se é falha do PROVEDOR ou não (canal
  // cheio, entrada abortada, sem internet, expulso…) — ver
  // resilience.isProviderFailure.
  _tagJoinError(err) {
    const e = err instanceof Error ? err : new Error(String(err));
    if (this.disposed) { e.code = 'aborted'; e.providerFailure = false; return e; }
    if (e.closeInfo) {
      const action = classifyClose(e.closeInfo);
      if (action === 'full') { e.code = 'channel-full'; e.message = 'Canal cheio'; e.providerFailure = false; }
      else if (action === 'replaced') { e.code = 'replaced'; e.providerFailure = false; }
      else if (action === 'give-up' && (e.closeInfo.kicked || e.closeInfo.code === 4403)) { e.code = 'kicked'; e.providerFailure = false; }
      else if (action === 'backoff') { e.code = 'rate-limited'; e.providerFailure = false; }
      return e;
    }
    if (isOffline()) { e.code = 'offline'; e.network = true; e.providerFailure = false; }
    return e;
  }

  // Uma sessão completa: sinalização → Device → transports → mídia dos outros
  // + mídia local. Usada no join e em cada reconexão.
  async _session({ first }) {
    const { Device } = await loadMediasoup();
    // Sessão nova pode ser num servidor de mídia já atualizado: esquece as recusas.
    this._unsupported = null;
    this._earlyProducers = [];
    const welcome = await this._connect(this.joinOpts.url, this.joinOpts.token);
    if (this.disposed) { this._closeAll(); return; }
    if (welcome.serverState) this._applyServerState(welcome.serverState, { quiet: true });

    this.device = new Device();
    await this.device.load({ routerRtpCapabilities: welcome.routerRtpCapabilities });

    // Os dois transports em paralelo (antes um esperava o outro: uma ida e
    // volta a mais ao servidor de mídia em toda entrada/reconexão).
    [this.sendTransport, this.recvTransport] = await Promise.all([this._createTransport('send'), this._createTransport('recv')]);
    if (this.disposed) { this._closeAll(); return; }

    if (first) this.cb.onJoined?.(this.myId);
    else {
      // Sessão nova depois de cair: quem saiu enquanto estávamos fora (o
      // peerLeft se perdeu) some da grade agora.
      const { removed } = diffPeers(this.peers, welcome.peers);
      for (const uid of removed) this._forgetPeer(uid);
    }
    this.cb.onServerState?.({ ...this.serverState });

    // Quem já estava na sala.
    for (const p of welcome.peers || []) { this.peers.add(String(p.id)); this.cb.onMediaUser?.(String(p.id), true); }

    // Mídia que os outros já publicavam — PRIMEIRO e sem esperar o microfone
    // (o aviso de permissão do mic pode ficar aberto; ouvir não depende dele).
    const early = this._earlyProducers || [];
    this._earlyProducers = null;
    const consumes = [...(welcome.producers || []), ...early].map((prod) => this._consume(prod).catch((err) => this.cb.onError?.(err, { where: 'consumeExisting' })));

    // Microfone em paralelo. Negado/ausente → entra só ouvindo.
    this._publishMic().catch((err) => this._onMicError(err));
    // Câmera/tela que estavam ligadas antes da queda voltam sozinhas.
    if (!first) {
      if (isLive(this.localTracks.camera)) { this._produceCamera(this.localTracks.camera).catch((err) => this.cb.onError?.(err, { where: 'reCamera' })); }
      if (isLive(this.localTracks.screen)) { this._produceScreen(this.localTracks.screen, this.localTracks.screenAudio).catch((err) => this.cb.onError?.(err, { where: 'reScreen' })); }
    }
    this._startStats();
    this._startKeepalive();

    // Entrada: espera só os consumes serem criados. ANTES também esperava o
    // ICE/DTLS da recepção conectar (até 12s) — herança da época em que
    // havia vários provedores pra trocar. Com o servidor próprio isso só
    // atrasava a entrada (a pessoa ficava "conectando" e não aparecia na
    // lista dos outros) e, em rede que precisa de TURN/TCP, derrubava a
    // entrada inteira com ICE_TIMEOUT em vez de seguir tentando. Quem cuida
    // de "a mídia nunca conectou" agora é o _watchFirstConnect (já armado em
    // cada consume/produce), que avisa onMediaFailed e dispara a recuperação.
    if (first && consumes.length) {
      await Promise.allSettled(consumes);
    }
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
  // transports, producers nem consumers. `force` (rede mudou): zera a conta
  // e reinicia mesmo que o transport ainda pareça conectado.
  async _restartIce(transport, direction, { force = false } = {}) {
    if (!this._isCurrent(transport) || this.reconnecting) return;
    const st = this._ts(transport);
    if (st.restarting) return;
    if (force) st.iceRestarts = 0;
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
      this._scheduleReconnect(`restartIce falhou (${direction}): ${err?.message || err}`, { immediate: force });
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
      // Sem internet não é culpa do provedor: espera a rede voltar.
      if (isOffline()) return;
      this.mediaFailedReported = true;
      this.cb.onMediaFailed?.({ code: `ICE_TIMEOUT_${label}` });
    }, FIRST_CONNECT_WATCH_MS);
  }

  // ---------- rede: batimento, online/offline, troca de rede, sono ----------
  _startNetWatch() {
    if (this._netWatching || typeof window === 'undefined') return;
    this._netWatching = true;
    this._onOnline = () => this._networkUp('internet voltou');
    this._onOffline = () => { this.netTrouble = true; };
    this._onConnChange = () => this._networkChanged('a rede mudou');
    this._onDeviceChange = () => {
      clearTimeout(this._deviceTimer);
      this._deviceTimer = setTimeout(() => { this._checkDefaultMic().catch(() => {}); }, 600);
    };
    try { window.addEventListener('online', this._onOnline); window.addEventListener('offline', this._onOffline); } catch { /* ok */ }
    try { navigator.connection?.addEventListener?.('change', this._onConnChange); } catch { /* ok */ }
    try { navigator.mediaDevices?.addEventListener?.('devicechange', this._onDeviceChange); } catch { /* ok */ }
    // Aba/janela escondida: pausa o vídeo recebido (economia de banda);
    // voltou: retoma na camada certa.
    this._onVisibility = () => { this._applyAllViewports(); };
    try { document.addEventListener('visibilitychange', this._onVisibility); } catch { /* ok */ }
  }

  _stopNetWatch() {
    if (!this._netWatching) return;
    this._netWatching = false;
    try { window.removeEventListener('online', this._onOnline); window.removeEventListener('offline', this._onOffline); } catch { /* ok */ }
    try { navigator.connection?.removeEventListener?.('change', this._onConnChange); } catch { /* ok */ }
    try { navigator.mediaDevices?.removeEventListener?.('devicechange', this._onDeviceChange); } catch { /* ok */ }
    try { document.removeEventListener('visibilitychange', this._onVisibility); } catch { /* ok */ }
    clearTimeout(this._deviceTimer);
  }

  // Internet voltou: quem estava esperando reconecta NA HORA (sem esperar o
  // próximo degrau da espera crescente); quem estava no ar faz ICE restart.
  _networkUp(why) {
    if (this.disposed || this.leaving) return;
    if (this.waitingOnline || this.reconnecting) {
      this.waitingOnline = false;
      clearTimeout(this.offlinePollTimer); this.offlinePollTimer = null;
      this.reconnectAttempt = 0;
      this._scheduleReconnect(why, { immediate: true });
      return;
    }
    this._networkChanged(why);
  }

  // Rede mudou (wi-fi ↔ 4G, VPN, cabo): ICE restart imediato nos dois
  // transports — ou sessão nova se a sinalização já morreu.
  _networkChanged(why) {
    if (this.disposed || this.leaving) return;
    if (isOffline()) { this.netTrouble = true; return; }
    if (this.reconnecting) { if (this.reconnectTimer) this._scheduleReconnect(why, { immediate: true }); return; }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { this._scheduleReconnect(why, { immediate: true }); return; }
    if (this.sendTransport) this._restartIce(this.sendTransport, 'send', { force: true });
    if (this.recvTransport) this._restartIce(this.recvTransport, 'recv', { force: true });
  }

  _startKeepalive() {
    this._stopKeepalive();
    this._pingMisses = 0;
    this.lastBeatAt = Date.now();
    this.keepaliveTimer = setInterval(() => { this._beat(); }, KEEPALIVE_MS);
  }

  _stopKeepalive() {
    if (this.keepaliveTimer) { clearInterval(this.keepaliveTimer); this.keepaliveTimer = null; }
  }

  async _beat() {
    const now = Date.now();
    const gap = now - this.lastBeatAt;
    this.lastBeatAt = now;
    if (this.disposed || this.leaving || this.reconnecting) return;
    // O relógio pulou: o computador dormiu. A conexão quase certamente
    // morreu — não espera o ping falhar.
    if (gap > SLEEP_JUMP_MS) {
      this.netTrouble = true;
      this.reconnectAttempt = 0;
      this._networkChanged('o computador acordou');
      return;
    }
    if (this._pinging || !this.ws) return;
    this._pinging = true;
    try {
      await this._request('ping', {}, PING_TIMEOUT_MS);
      this._pingMisses = 0;
    } catch {
      this._pingMisses = (this._pingMisses || 0) + 1;
      // A mídia ainda passando (transport conectado) e foi só 1 ping: espera o próximo.
      const mediaOk = this.sendTransport?.connectionState === 'connected' || this.recvTransport?.connectionState === 'connected';
      const socketDead = !this.ws || this.ws.readyState !== WebSocket.OPEN;
      if (!this.disposed && !this.leaving && !this.reconnecting && (socketDead || this._pingMisses >= PING_MISSES_TO_RECONNECT || !mediaOk)) {
        this._pingMisses = 0;
        this._scheduleReconnect('sinalização sem resposta (ping)', { immediate: true });
      }
    } finally {
      this._pinging = false;
    }
  }

  // ---------- reconexão ----------
  _scheduleReconnect(reason, { immediate = false } = {}) {
    if (this.disposed || this.leaving) return;
    if (this.reconnectTimer) {
      if (!immediate) return; // já agendada
      clearTimeout(this.reconnectTimer); this.reconnectTimer = null;
    }
    const offline = isOffline();
    if (offline) this.netTrouble = true;
    if (!this.reconnecting) {
      this.reconnecting = true;
      this._teardownSession();
    }
    // Sem internet: NÃO gasta tentativas nem desiste — espera o `online`
    // (e confere de vez em quando, caso o evento não venha).
    if (offline) {
      if (!this.waitingOnline) {
        this.waitingOnline = true;
        this.cb.onReconnecting?.(this.reconnectAttempt + 1, 'sem internet');
      }
      clearTimeout(this.offlinePollTimer);
      this.offlinePollTimer = setTimeout(() => {
        this.offlinePollTimer = null;
        if (this.disposed || !this.waitingOnline) return;
        if (!isOffline()) this._networkUp('internet voltou');
        else this._scheduleReconnect('sem internet');
      }, OFFLINE_POLL_MS);
      return;
    }
    this.waitingOnline = false;
    const attempt = this.reconnectAttempt;
    if (attempt >= RECONNECT_DELAYS_MS.length) {
      const rateLimited = this.closeKind === 'rate-limited';
      this._giveUp('gave-up', {
        network: this.netTrouble,
        code: rateLimited ? 'rate-limited' : (this.netTrouble ? 'offline' : undefined),
        providerFailure: !(this.netTrouble || rateLimited),
      });
      return;
    }
    this.cb.onReconnecting?.(attempt + 1, reason);
    const delay = immediate ? 0 : RECONNECT_DELAYS_MS[attempt];
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
        this.netTrouble = false;
        this.closeKind = null;
        this.cb.onReconnected?.();
      }).catch((err) => {
        if (this.disposed) return;
        if (err?.code === 'TOKEN_REFRESH') { this._giveUp('token'); return; }
        const action = err?.closeInfo ? classifyClose(err.closeInfo) : 'reconnect';
        if (action === 'replaced') { this._giveUp('replaced', { providerFailure: false }); return; }
        if (action === 'full') { this._giveUp('full', { code: 'channel-full', providerFailure: false }); return; }
        if (action === 'give-up') {
          if (err.closeInfo.kicked || err.closeInfo.code === 4403) this._giveUp('kicked', { detail: err.closeInfo.kicked || 'kicked', providerFailure: false });
          else this._giveUp('closed');
          return;
        }
        if (action === 'refresh-token') this.needsFreshToken = true;
        if (action === 'backoff') this.closeKind = 'rate-limited';
        // A sessão que falhou pode ter deixado um socket/transport pela metade.
        this._teardownSession();
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

  _giveUp(reason = 'gave-up', info = {}) {
    if (this.disposed) return;
    this.disposed = true;
    this._closeAll();
    const out = { reason };
    for (const [k, v] of Object.entries(info || {})) if (v !== undefined) out[k] = v;
    this.cb.onLeft?.(out);
  }

  // Derruba transports/consumers/producers da sessão atual SEM parar as
  // faixas locais (pra republicar depois) e avisa a grade que as mídias
  // remotas sumiram por enquanto.
  _teardownSession() {
    this._stopStats();
    this._stopKeepalive();
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

  // ---------- estado imposto pelo servidor (permissões / moderação) ----------
  _serverBlocksMic() { return !this.serverState.canSpeak || !!this.serverState.serverMuted; }

  _applyServerState(st = {}, { quiet = false } = {}) {
    const prev = this.serverState;
    this.serverState = {
      canSpeak: st.canSpeak !== false,
      canVideo: st.canVideo !== false,
      role: st.role === 'audience' || st.role === 'speaker' ? st.role : null,
      serverMuted: st.serverMuted === true,
      serverDeafened: st.serverDeafened === true,
    };
    const blocked = this._serverBlocksMic();
    const p = this.producers.mic;
    if (p && !p.closed) {
      // O servidor já pausou do lado dele: só espelha (faixa desligada).
      if (blocked && !p.paused) { try { p.pause(); } catch { /* ok */ } }
      else if (!blocked && p.paused && !this.micMuted) {
        try { p.resume(); } catch { /* ok */ }
        this._applyMicGate();
        this._request('resumeProducer', { producerId: p.id }).catch((err) => this._onResumeRefused(err));
      }
    } else if (!blocked && prev && !prev.canSpeak && this.sendTransport) {
      // Virou palestrante (palco) / ganhou SPEAK: agora pode publicar.
      this._publishMic().catch((err) => this._onMicError(err));
    }
    // Sem VIDEO: câmera/tela já foram fechadas no servidor.
    const closedIds = new Set((st.closedProducerIds || []).map(String));
    for (const key of ['camera', 'screen', 'screenAudio']) {
      const prod = this.producers[key];
      if (prod && (closedIds.has(prod.id) || !this.serverState.canVideo)) {
        this._closeProducerLocal(key);
        if (key === 'camera') this.cb.onSelfCamera?.(false);
        if (key === 'screen') this.cb.onSelfScreen?.(false);
      }
    }
    if (blocked && this.speakingDet.speaking) { this.speakingDet.reset(); this.lastLocalSpeaking = false; this.cb.onLocalSpeaking?.(false); }
    if (!quiet) this.cb.onServerState?.({ ...this.serverState });
  }

  // Mudo/ensurdecer da moderação avisado pelo BACKEND (socket
  // voice:server-state). Normalmente o servidor de mídia já aplicou e mandou
  // serverState (aí não muda nada); servidor de mídia ANTIGO (sem /control)
  // não manda — aqui garante ao menos o lado do cliente (mic pausado).
  applyModeration({ serverMuted, serverDeafened } = {}) {
    if (this.disposed) return;
    const deaf = typeof serverDeafened === 'boolean' ? serverDeafened : this.serverState.serverDeafened;
    const muted = (typeof serverMuted === 'boolean' ? serverMuted : this.serverState.serverMuted) || deaf;
    if (muted === this.serverState.serverMuted && deaf === this.serverState.serverDeafened) return;
    this._applyServerState({ ...this.serverState, serverMuted: muted, serverDeafened: deaf }, { quiet: true });
  }

  // O servidor recusou desmutar (mudo da moderação / sem SPEAK): volta a
  // pausar aqui e avisa.
  _onResumeRefused(err) {
    const msg = String(err?.message || '');
    const p = this.producers.mic;
    if (/^forbidden:/.test(msg)) {
      if (p && !p.closed && !p.paused) { try { p.pause(); } catch { /* ok */ } }
      this.cb.onServerState?.({ ...this.serverState });
      return;
    }
    this.cb.onError?.(err, { where: 'resumeProducer' });
  }

  // ---------- mídia local: microfone ----------
  async _getMicTrack({ forceDefault = false } = {}) {
    if (this.pipeline && isLive(this.localTracks.mic)) return this.localTracks.mic;
    this._disposePipeline();
    // Com o RNNoise ligado, o supressor do navegador fica desligado (dois
    // supressores em série "comem" a voz); o resto do tratamento fica.
    const base = { ...MIC_CONSTRAINTS, noiseSuppression: !this.noiseEnabled };
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
    try { this.micGroupId = raw.getSettings?.().groupId || null; } catch { this.micGroupId = null; }
    raw.addEventListener('ended', () => { this._onMicEnded(raw); });
    let pipe = null;
    pipe = await createMicPipeline(raw, {
      noise: this.noiseEnabled,
      noiseModel: this.noiseModel,
      // Alta qualidade falhou/lenta → já voltou pro RNNoise; avisa o app.
      onNoiseFallback: (reason) => { this.cb.onTelemetry?.({ type: 'noise-fallback', reason }); },
      // AudioContext suspenso/travado (iOS, sem gesto): manda o mic cru
      // direto, pra pessoa nunca ficar muda sem saber; e volta depois.
      onBypass: (track) => this._swapMicTrack(pipe, track, 'direct'),
      onRestore: (track) => this._swapMicTrack(pipe, track, 'graph'),
      // VAD do RNNoise (~20/s): ajuda o portão automático e acende o anel na hora.
      onVad: (d) => { if (pipe && pipe === this.pipeline) this._onVad(d); },
    });
    if (this.disposed || this.rawMic !== raw) { pipe.dispose(); throw new Error('engine encerrado'); }
    this.pipeline = pipe;
    pipe.setInputGain(this.inputGain);
    // RNNoise pedido mas sem grafo: liga o supressor do navegador no lugar.
    if (this.noiseEnabled && !pipe.noiseActive) this._applyBrowserNoise(true);
    this.localTracks.mic = pipe.track;
    this._applyMicGate();
    this._startAnalysis();
    return pipe.track;
  }

  // Supressor de ruído do NAVEGADOR na captura crua (ligado quando o
  // RNNoise não está processando).
  _applyBrowserNoise(on) {
    const raw = this.rawMic;
    if (!raw || typeof raw.applyConstraints !== 'function') return;
    raw.applyConstraints({ ...MIC_CONSTRAINTS, noiseSuppression: !!on }).catch(() => { /* navegador não deixa mudar ao vivo */ });
  }

  // O pipeline trocou de faixa (modo direto ↔ processado): troca no producer.
  _swapMicTrack(pipe, track, mode) {
    if (this.disposed || pipe !== this.pipeline || !track) return;
    this.localTracks.mic = track;
    if (this.noiseEnabled) this._applyBrowserNoise(mode === 'direct' || !pipe.noiseActive);
    const p = this.producers.mic;
    if (p && !p.closed) {
      p.replaceTrack({ track }).then(() => this._applyMicGate()).catch((err) => this.cb.onError?.(err, { where: 'micBypass' }));
    }
    this.cb.onTelemetry?.({ type: mode === 'direct' ? 'mic-bypass' : 'mic-restored' });
  }

  _disposePipeline() {
    const pipe = this.pipeline;
    this.pipeline = null;
    if (pipe) { try { pipe.dispose(); } catch { /* ok */ } }
  }

  // Publica o microfone com o mudo ATUAL (this.micMuted). Uma publicação por
  // vez por transport (a da sessão antiga desiste sozinha).
  _publishMic() {
    if (this.producers.mic) return Promise.resolve();
    const transport = this.sendTransport;
    if (this._micPublishing && this._micPublishingFor === transport) return this._micPublishing;
    const task = (async () => {
      // Sem SPEAK / plateia do palco: nem publica (o servidor recusaria).
      if (!this.serverState.canSpeak) { this.cb.onSelfMute?.(!!this.micMuted); return; }
      const track = await this._getMicTrack();
      if (this.disposed || !transport || transport !== this.sendTransport) return;
      // Mudo (próprio ou da moderação): publica JÁ PAUSADO — faixa
      // desligada antes do produce e o servidor cria o producer pausado.
      const startPaused = !!this.micMuted || this._serverBlocksMic();
      try { track.enabled = !startPaused; } catch { /* ok */ }
      let producer;
      try {
        producer = await transport.produce({
          track,
          encodings: MIC_ENCODINGS,
          codecOptions: MIC_CODEC_OPTIONS,
          // Pausado (mudo) não manda NEM o silêncio: sem RTP nenhum.
          zeroRtpOnPause: true,
          // A faixa é do pipeline (sobrevive à reconexão): o producer não a para.
          stopTracks: false,
          appData: { source: 'mic', paused: startPaused },
        });
      } catch (err) {
        // Transport fechou no meio (reconexão): a próxima sessão publica.
        if (this.disposed || transport !== this.sendTransport) return;
        if (/^forbidden:/.test(String(err?.message))) { this.cb.onSelfMute?.(!!this.micMuted); this.cb.onServerState?.({ ...this.serverState }); return; }
        throw err;
      }
      if (this.disposed || transport !== this.sendTransport) { try { producer.close(); } catch { /* ok */ } return; }
      this.producers.mic = producer;
      producer.on('trackended', () => { this._onMicEnded(null); });
      producer.on('transportclose', () => { if (this.producers.mic === producer) this.producers.mic = null; });
      this._watchFirstConnect(transport, 'SEND');
      if (startPaused) {
        producer.pause();
        // Servidor antigo (sem appData.paused): pausa explícita.
        await this._request('pauseProducer', { producerId: producer.id }).catch(() => {});
      } else this._applyMicGate();
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
      this.localTracks.mic = null;
      this._disposePipeline();
      let track = null;
      for (let i = 0; i < 2 && !track; i += 1) {
        try { track = await this._getMicTrack({ forceDefault: true }); } catch (err) { if (i === 1 || micErrorReason(err) === 'denied') throw err; await sleep(1000); }
      }
      if (this.disposed) return;
      const p = this.producers.mic;
      if (p && !p.closed) {
        await p.replaceTrack({ track });
        if ((this.micMuted || this._serverBlocksMic()) && !p.paused) p.pause();
        this._applyMicGate();
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
  // deviceId null = o padrão do sistema.
  async setMicDevice(deviceId) {
    this.micDeviceId = deviceId || null;
    const p = this.producers.mic;
    if (!p || p.closed) return true;
    const oldPipe = this.pipeline; const oldTrack = this.localTracks.mic; const oldRaw = this.rawMic; const oldGroup = this.micGroupId;
    // iOS só deixa UMA captura de microfone por vez: solta a antiga antes.
    const ios = isIOS();
    if (ios && oldPipe) { try { oldPipe.dispose(); } catch { /* ok */ } }
    this.pipeline = null; this.localTracks.mic = null;
    try {
      const track = await this._getMicTrack();
      await p.replaceTrack({ track });
      if ((this.micMuted || this._serverBlocksMic()) && !p.paused) p.pause();
      this._applyMicGate();
      if (!ios && oldPipe) { try { oldPipe.dispose(); } catch { /* ok */ } }
      return true;
    } catch (err) {
      if (!ios) {
        // Volta pro microfone que estava funcionando.
        this._disposePipeline();
        this.pipeline = oldPipe; this.localTracks.mic = oldTrack; this.rawMic = oldRaw; this.micGroupId = oldGroup;
        this.cb.onError?.(err, { where: 'setMicDevice' });
      } else {
        // No iOS a antiga já foi solta: tenta o padrão.
        this._onMicEnded(null);
      }
      return false;
    }
  }

  // devicechange: quem usa o microfone PADRÃO e o padrão do sistema mudou
  // (plugou/desplugou fone) → troca sozinho, igual ao Discord.
  async _checkDefaultMic() {
    if (this.disposed || this.leaving || this.micDeviceId || !this.rawMic || !this.producers.mic) return;
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
    if (!md?.enumerateDevices) return;
    const list = await md.enumerateDevices();
    const inputs = list.filter((d) => d.kind === 'audioinput');
    const def = inputs.find((d) => d.deviceId === 'default');
    let changed = false;
    if (def && def.groupId && this.micGroupId) changed = def.groupId !== this.micGroupId;
    else {
      // Sem a entrada "default" (Firefox/Safari): o microfone atual sumiu?
      let cur = null;
      try { cur = this.rawMic.getSettings?.().deviceId || null; } catch { cur = null; }
      changed = !!cur && inputs.length > 0 && !inputs.some((d) => d.deviceId === cur);
    }
    if (!changed) return;
    this.cb.onTelemetry?.({ type: 'default-mic-changed' });
    await this.setMicDevice(null);
  }

  // ---------- portão do microfone (PTT / sensibilidade / manual) ----------
  _gateIsOpen() { return this.micGateOpen && this.gate.open; }

  _applyMicGate() {
    const open = this._gateIsOpen();
    const p = this.producers.mic;
    const pipe = this.pipeline;
    if (pipe) {
      pipe.setGate(open);
      // Modo direto: o portão é a própria faixa — pausado (mudo) fica desligada.
      if (pipe.mode === 'direct' && p && p.paused) { try { this.localTracks.mic.enabled = false; } catch { /* ok */ } }
      return;
    }
    const t = this.localTracks.mic;
    if (!t || (p && p.paused)) return;
    try { t.enabled = open; } catch { /* faixa encerrada */ }
  }

  // Recalcula o portão (sem esperar o próximo tique do medidor).
  _tickGate(now = Date.now()) {
    const r = this.gate.update(this.lastLevelDb, now);
    if (r.changed) this._applyMicGate();
    return r;
  }

  // Portão MANUAL: fechado = manda silêncio, sem mudar o mudo (soma com o
  // apertar-pra-falar e a sensibilidade).
  setMicGate(open) {
    this.micGateOpen = !!open;
    this._applyMicGate();
  }

  // Apertar pra falar. releaseDelayMs: quanto o mic continua aberto depois
  // de soltar a tecla (padrão 200ms).
  setPushToTalk(on, { releaseDelayMs } = {}) {
    this.gate.setPushToTalk(!!on, { releaseMs: Number.isFinite(releaseDelayMs) ? releaseDelayMs : undefined });
    this._tickGate();
  }

  // Tecla do apertar-pra-falar apertada/solta.
  setPttPressed(pressed) {
    const now = Date.now();
    this.gate.setPttPressed(!!pressed, now);
    this._tickGate(now);
    clearTimeout(this.pttTimer); this.pttTimer = null;
    const deadline = this.gate.releaseDeadline();
    if (deadline != null) {
      // Fecha no fim da folga mesmo se o medidor não estiver rodando.
      this.pttTimer = setTimeout(() => { this.pttTimer = null; this._tickGate(); }, Math.max(0, deadline - now) + 5);
    }
  }

  // Sensibilidade de entrada: { auto: true } (piso de ruído adaptativo),
  // { auto: false, db: -50 } (limite manual) ou null (desliga: sempre aberto).
  setInputSensitivity(cfg) {
    this.gate.setSensitivity(cfg || null);
    this._tickGate();
  }

  // Volume de entrada (0..4, 1 = normal).
  setInputGain(gain) {
    this.inputGain = Math.max(0, Math.min(4, Number(gain) || 0));
    this.pipeline?.setInputGain(this.inputGain);
  }

  getMicGateState() {
    return { ...this.gate.state(), manualOpen: this.micGateOpen, open: this._gateIsOpen(), pipelineMode: this.pipeline?.mode || null, gateValue: this.pipeline?.gateValue() ?? null };
  }

  // Medidor está rodando (pro aviso "microfone sem som" só valer quando dá pra medir).
  isMicMeterActive() { return this.analysisActive; }
  getMicLastSoundAt() { return this.lastSoundAt; }

  // Mensagem do VAD do RNNoise: { p, open, off }.
  _onVad(d = {}) {
    if (this.disposed) return;
    const now = Date.now();
    if (d.off || !(Number(d.p) >= 0)) { this.gate.clearVad(); this._tickGate(now); return; }
    this.gate.setVad(Number(d.p), !!d.open, now);
    this._tickGate(now);
    // Anel verde instantâneo: não espera o próximo tique do medidor.
    if (!this.analysisActive) return;
    const sp = this.speakingDet.update({ db: this.lastLevelDb, transmitting: this._transmitting(), now, vad: this.gate.vadVoice(now) === true });
    if (sp.changed) { this.lastLocalSpeaking = sp.speaking; this.cb.onLocalSpeaking?.(sp.speaking); }
  }

  _transmitting() {
    const p = this.producers.mic;
    return !!p && !p.closed && !p.paused && !this.micMuted && !this._serverBlocksMic() && this._gateIsOpen();
  }

  _startAnalysis() {
    if (this.analysisTimer) return;
    this.analysisTimer = setInterval(() => { this._analyze(); }, ANALYSIS_TICK_MS);
  }

  _stopAnalysis() {
    if (this.analysisTimer) { clearInterval(this.analysisTimer); this.analysisTimer = null; }
    this.analysisActive = false;
  }

  _analyze() {
    if (this.disposed) { this._stopAnalysis(); return; }
    const now = Date.now();
    const db = this.pipeline ? this.pipeline.readLevelDb() : null;
    this.lastLevelDb = db;
    this._tickGate(now);
    const active = db != null;
    if (active !== this.analysisActive) {
      this.analysisActive = active;
      // Medidor parou: o anel local volta pro detector do servidor.
      if (!active && this.speakingDet.speaking) { this.speakingDet.reset(); this.lastLocalSpeaking = false; this.cb.onLocalSpeaking?.(false); }
    }
    if (!active) return;
    if (db > -70) this.lastSoundAt = now;
    const transmitting = this._transmitting();
    const sp = this.speakingDet.update({ db, transmitting, now, vad: this.gate.vadVoice(now) === true });
    if (sp.changed) { this.lastLocalSpeaking = sp.speaking; this.cb.onLocalSpeaking?.(sp.speaking); }
    if (this.cb.onLocalLevel && this.levelThrottle(now)) {
      try { this.cb.onLocalLevel(dbToLevel(db), { db, gateOpen: this._gateIsOpen(), transmitting }); } catch { /* ok */ }
    }
  }

  // ---------- câmera / tela ----------
  async _produceCamera(track) {
    if (!this.sendTransport) throw new Error('sem transport de envio');
    this.localTracks.camera = track;
    const producer = await this.sendTransport.produce({
      track, encodings: CAMERA_ENCODINGS,
      codecOptions: { videoGoogleStartBitrate: 600 },
      stopTracks: false,
      appData: { source: 'camera' },
    });
    this.producers.camera = producer;
    return producer;
  }

  async _produceScreen(vtrack, atrack) {
    if (!this.sendTransport) throw new Error('sem transport de envio');
    this.localTracks.screen = vtrack;
    this._applyScreenHint(vtrack);
    // Simulcast de 2 camadas (VP8, L1T3): quem vê em miniatura recebe a
    // camada baixa; quem vê grande, a cheia (o servidor escolhe por ouvinte).
    this.producers.screen = await this.sendTransport.produce({
      track: vtrack, encodings: screenEncodings(this.screenOpts),
      codecOptions: { videoGoogleStartBitrate: 1000 },
      stopTracks: false,
      appData: { source: 'screen' },
    });
    await this._applyScreenSender();
    if (atrack && isLive(atrack)) {
      this.localTracks.screenAudio = atrack;
      this.producers.screenAudio = await this.sendTransport.produce({
        track: atrack, codecOptions: SCREEN_AUDIO_CODEC_OPTIONS, stopTracks: false, appData: { source: 'screenAudio' },
      });
    }
  }

  // contentHint pelo fps (regra do Jitsi): ≤15 fps = texto ('detail'), 30+ = movimento.
  _applyScreenHint(track) {
    try { track.contentHint = screenContentHint(this.screenOpts.frameRate).contentHint; } catch { /* opcional */ }
  }

  // Ajusta o RTCRtpSender da tela pro preset atual: bitrate/fps de cada
  // camada e a preferência de degradação (nitidez × fluidez). Sem acesso ao
  // sender (navegador antigo): só o bitrate, pelo producer.
  async _applyScreenSender() {
    const p = this.producers.screen;
    if (!p || p.closed) return false;
    const encs = screenEncodings(this.screenOpts);
    const { degradationPreference } = screenContentHint(this.screenOpts.frameRate);
    // Camada baixa primeiro, cheia por último (mesma ordem do produce); se o
    // sender tiver menos camadas, ficam as de cima.
    const fill = (list) => {
      const shift = Math.max(0, encs.length - list.length);
      list.forEach((enc, i) => {
        const want = encs[Math.min(i + shift, encs.length - 1)];
        enc.maxBitrate = want.maxBitrate;
        enc.maxFramerate = want.maxFramerate;
      });
    };
    const sender = p.rtpSender;
    if (sender && typeof sender.getParameters === 'function' && typeof sender.setParameters === 'function') {
      try {
        const params = sender.getParameters();
        fill(params.encodings || []);
        params.degradationPreference = degradationPreference;
        await sender.setParameters(params);
        return true;
      } catch {
        // Alguns navegadores recusam degradationPreference: tenta sem.
        try {
          const params = sender.getParameters();
          fill(params.encodings || []);
          await sender.setParameters(params);
          return true;
        } catch { /* cai no caminho do producer */ }
      }
    }
    if (typeof p.setRtpEncodingParameters === 'function') {
      try { await p.setRtpEncodingParameters({ maxBitrate: encs[encs.length - 1].maxBitrate }); return true; } catch { /* ok */ }
    }
    return false;
  }

  // Linux (app de PC com venmic): o getDisplayMedia volta sem áudio e o som
  // do PC (menos o da própria call) vem por um microfone virtual. Devolve a
  // faixa de áudio ou null (segue só com vídeo). Ver docs/voz-discord-api.md.
  async _venmicAudioTrack() {
    const api = typeof window !== 'undefined' ? window.electronAPI?.screenAudio : null;
    if (!api || typeof api.supported !== 'function' || typeof api.start !== 'function') return null;
    let ok = false;
    try { ok = !!(await api.supported()); } catch { ok = false; }
    if (!ok || this.disposed) return null;
    let r = null;
    try { r = await api.start(); } catch (err) { r = { ok: false, error: err }; }
    if (!r || !r.ok) return null;
    this._venmicActive = true;
    const label = String(api.deviceLabel || VENMIC_LABEL);
    let device = null;
    // O nó só aparece depois do start(): procura a cada 150ms por até ~2s.
    for (let waited = 0; !device && waited <= VENMIC_WAIT_MS; waited += VENMIC_POLL_MS) {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        device = list.find((d) => d.kind === 'audioinput' && String(d.label || '').includes(label)) || null;
      } catch { device = null; }
      if (!device) await sleep(VENMIC_POLL_MS);
    }
    if (!device || this.disposed) { await this._stopVenmic(); return null; }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: device.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
      const t = mic.getAudioTracks()[0] || null;
      if (!t) await this._stopVenmic();
      return t;
    } catch {
      await this._stopVenmic();
      return null;
    }
  }

  async _stopVenmic() {
    if (!this._venmicActive) return;
    this._venmicActive = false;
    try { await window.electronAPI?.screenAudio?.stop?.(); } catch { /* ok */ }
  }

  // Resultado de câmera/tela: legado (MediaStream | null) ou detalhado.
  _mediaFailure(err, kind, detailed) {
    const info = mediaErrorInfo(err, kind);
    if (!info.cancelled) this.cb.onError?.(err, { where: kind === 'screen' ? 'setScreen' : 'setCamera' });
    this.cb.onMediaError?.({ kind, ...info });
    return detailed ? { ok: false, ...info } : null;
  }

  async setCamera(on, options = {}) {
    const detailed = !!options.detailed;
    const ok = (stream) => (detailed ? { ok: true, stream } : stream);
    let track = null;
    try {
      if (!on) { await this._closeProducer('camera'); this.cb.onSelfCamera?.(false); return ok(null); }
      if (this.producers.camera) return ok(new MediaStream([this.localTracks.camera]));
      if (!this.serverState.canVideo) { const e = new Error('forbidden:video — sem permissão para vídeo neste canal'); throw e; }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false });
      track = stream.getVideoTracks()[0];
      await this._produceCamera(track);
      track.addEventListener('ended', () => { this._closeProducer('camera'); this.cb.onSelfCamera?.(false); });
      this.cb.onSelfCamera?.(true);
      return ok(new MediaStream([track]));
    } catch (err) {
      if (track) { try { track.stop(); } catch { /* ok */ } if (this.localTracks.camera === track) this.localTracks.camera = null; }
      return this._mediaFailure(err, 'camera', detailed);
    }
  }

  // Preset da tela a partir das opções (quality/frameRate/maxBitrate).
  _screenPresetFrom(options = {}, base = this.screenOpts) {
    const p = normalizeScreenPreset({
      quality: options.quality || base?.quality,
      frameRate: Number.isFinite(options.frameRate) && options.frameRate > 0 ? options.frameRate : base?.frameRate,
    });
    const maxBitrate = Number.isFinite(options.maxBitrate) && options.maxBitrate > 0 ? options.maxBitrate : undefined;
    return maxBitrate ? { ...p, maxBitrate } : p;
  }

  // Constraints da captura de tela: preset (quality) ou width/height
  // explícitos, e fps.
  _screenConstraints(options = {}) {
    const p = this._screenPresetFrom(options, { quality: '1080p', frameRate: 30 });
    return screenVideoConstraints({ ...p, width: options.width, height: options.height });
  }

  // Resolução/fps/bitrate da tela AO VIVO, sem parar de transmitir. Aceita
  // o nome do preset ('720p'/'1080p'/'1440p') ou { quality, frameRate,
  // width, height, maxBitrate }. Muda a captura (applyConstraints), o
  // contentHint e o bitrate/fps de cada camada (setParameters).
  async setScreenQuality(arg = {}) {
    const opts = typeof arg === 'string' ? { quality: arg } : (arg || {});
    const t = this.localTracks.screen;
    if (!isLive(t)) return false;
    if (opts.quality && !SCREEN_QUALITY_PRESETS[opts.quality] && !opts.width) return false;
    const next = this._screenPresetFrom(opts, this.screenOpts);
    this.screenOpts = next;
    let ok = false;
    if (typeof t.applyConstraints === 'function' && (opts.quality || opts.width || opts.height || opts.frameRate)) {
      try { await t.applyConstraints(screenVideoConstraints({ ...next, width: opts.width, height: opts.height })); ok = true; } catch { ok = false; }
    }
    this._applyScreenHint(t);
    if (await this._applyScreenSender()) ok = true;
    return ok;
  }

  // Preset atual da tela ({ quality, frameRate, maxBitrate? }).
  getScreenQuality() { return { ...this.screenOpts }; }

  // Opções: { quality: '720p'|'1080p'|'1440p', frameRate: 5|15|30|60,
  // width, height, maxBitrate, audio (som do PC/aba, padrão true), track
  // (faixa de vídeo pronta — Android), audioTrack (faixa de áudio pronta),
  // detailed }.
  async setScreen(on, options = {}) {
    const detailed = !!options.detailed;
    const ok = (stream) => (detailed ? { ok: true, stream } : stream);
    let vtrack = null; let atrack = null; let own = false; let ownAudio = false;
    try {
      if (!on) { await this._closeProducer('screen'); await this._closeProducer('screenAudio'); await this._stopVenmic(); this.cb.onSelfScreen?.(false); return ok(null); }
      if (this.producers.screen) return ok(new MediaStream([this.localTracks.screen]));
      if (!this.serverState.canVideo) throw new Error('forbidden:video — sem permissão para transmitir neste canal');
      this.screenOpts = this._screenPresetFrom(options, { quality: '1080p', frameRate: 30 });
      const wantAudio = options.audio !== false;
      if (options.track) {
        // Faixa pronta (captura nativa do app Android).
        vtrack = options.track;
        if (options.audioTrack && isLive(options.audioTrack)) atrack = options.audioTrack;
      } else {
        own = true;
        const md = navigator.mediaDevices;
        let stream;
        try {
          stream = await md.getDisplayMedia(displayMediaOptions({ ...this.screenOpts, width: options.width, height: options.height, audio: wantAudio }));
        } catch (err) {
          // Navegador que não entende as opções novas (TypeError): o pedido simples de antes.
          if (err?.name !== 'TypeError') throw err;
          stream = await md.getDisplayMedia({ video: this._screenConstraints(options), audio: wantAudio });
        }
        vtrack = stream.getVideoTracks()[0];
        atrack = stream.getAudioTracks()[0] || null;
        if (!atrack && options.audioTrack && isLive(options.audioTrack)) atrack = options.audioTrack;
        // Linux no app de PC: som do PC pelo microfone virtual do venmic.
        if (!atrack && wantAudio) { atrack = await this._venmicAudioTrack(); ownAudio = !!atrack; }
      }
      await this._produceScreen(vtrack, atrack);
      // "Parar compartilhamento" pelo navegador.
      vtrack.addEventListener('ended', () => { this.setScreen(false); });
      this.cb.onSelfScreen?.(true);
      return ok(new MediaStream([vtrack]));
    } catch (err) {
      // Não deixa captura rodando escondida se a publicação falhou.
      if (own) { try { vtrack?.stop(); } catch { /* ok */ } try { atrack?.stop(); } catch { /* ok */ } }
      if (ownAudio) { try { atrack?.stop(); } catch { /* ok */ } }
      await this._stopVenmic();
      if (this.producers.screen) this._closeProducerLocal('screen');
      if (this.producers.screenAudio) this._closeProducerLocal('screenAudio');
      if (this.localTracks.screen === vtrack) this.localTracks.screen = null;
      if (this.localTracks.screenAudio === atrack) this.localTracks.screenAudio = null;
      return this._mediaFailure(err, 'screen', detailed);
    }
  }

  // ---------- áudio recebido ----------
  // Microfone e som da tela da pessoa saem SEPARADOS (onRemoteAudio /
  // onRemoteScreenAudio) — cada um com o seu volume, igual ao "volume da
  // transmissão" do Discord. App sem onRemoteScreenAudio: tudo junto no
  // onRemoteAudio, como antes. (BUG antigo corrigido: o áudio da tela
  // substituía o do microfone na grade.)
  _emitPeerAudio(uid) {
    const mic = []; const screen = [];
    for (const c of this.consumers.values()) {
      if (c.peerId !== uid || c.kind !== 'audio' || c.consumer.closed || !c.consumer.track) continue;
      if (c.source === 'screenAudio') screen.push(c.consumer.track); else mic.push(c.consumer.track);
    }
    const separate = typeof this.cb.onRemoteScreenAudio === 'function';
    const voice = separate ? mic : [...mic, ...screen];
    try {
      if (voice.length) this.cb.onRemoteAudio?.(uid, new MediaStream(voice));
      else this.cb.onRemoteRemove?.(uid, 'audio');
      if (separate) this.cb.onRemoteScreenAudio(uid, screen.length ? new MediaStream(screen) : null);
    } catch (err) { this.cb.onError?.(err, { where: 'remoteTrack' }); }
  }

  _dropConsumer(cid) {
    const c = this.consumers.get(cid);
    if (!c) return;
    this.consumers.delete(cid);
    try { c.consumer.close(); } catch { /* ok */ }
    if (c.kind === 'audio') this._emitPeerAudio(c.peerId);
    else this.cb.onRemoteRemove?.(c.peerId, 'video', c.source === 'screen' ? 'screen' : 'camera');
  }

  // ---------- recepção sob medida (vídeo) ----------
  // O app conta onde cada vídeo aparece: setVideoViewport(uid, 'screen'|
  // 'camera', { visible, height }, viewId?). Vídeo escondido/fora da tela
  // (ou a aba escondida) → pausado no servidor (sem banda); visível → camada
  // pelo tamanho (altura × devicePixelRatio ≥ 540 → alta). Vários blocos do
  // mesmo vídeo: usa o maior visível. `{ remove: true }` tira o bloco.
  setVideoViewport(uid, kind, view = {}, viewId = 'default') {
    const key = `${String(uid)}|${kind === 'screen' ? 'screen' : 'camera'}`;
    let views = this.viewports.get(key);
    if (view && view.remove) {
      if (views) { views.delete(String(viewId)); if (!views.size) this.viewports.delete(key); }
    } else {
      if (!views) { views = new Map(); this.viewports.set(key, views); }
      views.set(String(viewId), { visible: view?.visible !== false, height: Number(view?.height) || 0 });
    }
    for (const [cid, c] of this.consumers) {
      if (c.kind === 'video' && c.peerId === String(uid)) this._applyViewport(cid);
    }
  }

  _viewsFor(c) {
    const own = this.viewports.get(`${c.peerId}|${c.source === 'screen' ? 'screen' : 'camera'}`);
    if (own && own.size) return [...own.values()];
    // A grade pode ter classificado tela/câmera diferente por um instante:
    // com UM vídeo só dessa pessoa, vale o que foi informado pro outro tipo.
    const videos = [...this.consumers.values()].filter((x) => x.kind === 'video' && x.peerId === c.peerId && !x.consumer.closed);
    if (videos.length === 1) {
      const other = this.viewports.get(`${c.peerId}|${c.source === 'screen' ? 'camera' : 'screen'}`);
      if (other && other.size) return [...other.values()];
    }
    return [];
  }

  _viewportFor(c) {
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    return viewportDecision({ views: this._viewsFor(c), documentHidden: hidden, dpr, spatialLayers: c.spatialLayers || 1 });
  }

  _applyViewport(cid) {
    const c = this.consumers.get(cid);
    if (!c || c.kind !== 'video' || c.consumer.closed || this.disposed) return;
    const d = this._viewportFor(c);
    if (d.paused) {
      if (!c.viewPaused) {
        c.viewPaused = true;
        try { c.consumer.pause(); } catch { /* ok */ }
        this._request('pauseConsumer', { consumerId: cid }).catch(() => {});
      }
      return;
    }
    if (c.viewPaused) {
      c.viewPaused = false;
      try { c.consumer.resume(); } catch { /* ok */ }
      this._request('resumeConsumer', { consumerId: cid }).catch(() => {});
    }
    if ((c.spatialLayers || 1) > 1 && d.spatialLayer != null && d.spatialLayer !== c.spatialLayer) {
      c.spatialLayer = d.spatialLayer;
      this._request('setConsumerPreferredLayers', { consumerId: cid, spatialLayer: d.spatialLayer }).catch(() => { c.spatialLayer = null; });
    }
  }

  _applyAllViewports() {
    for (const [cid, c] of this.consumers) if (c.kind === 'video') this._applyViewport(cid);
  }

  async _consume({ producerId, peerId, kind, appData }) {
    if (!this.recvTransport || this.disposed || !producerId) return;
    if (this.consumingProducers.has(producerId)) return;
    for (const c of this.consumers.values()) if (c.consumer.producerId === producerId) return;
    const transport = this.recvTransport;
    const uid = String(peerId);
    this.consumingProducers.add(producerId);
    try {
      const ask = () => this._request('consume', {
        transportId: transport.id, producerId, rtpCapabilities: this.device.rtpCapabilities,
      });
      // Sala cheia, entrando: muitos consumes de uma vez podiam bater no
      // limite de mensagens do servidor de mídia — e esse consume não era
      // repetido nunca (aquela pessoa ficava muda pra você). Tenta de novo
      // com espera crescente.
      let info;
      for (let attempt = 0; ; attempt += 1) {
        try { info = await ask(); break; } catch (err) {
          if (attempt >= 3 || !/muitas requisi/.test(String(err?.message)) || this.disposed || this.recvTransport !== transport) throw err;
          await sleep(500 * (attempt + 1));
        }
      }
      if (this.disposed || this.recvTransport !== transport) return;
      const consumer = await transport.consume({
        id: info.consumerId, producerId: info.producerId, kind: info.kind, rtpParameters: info.rtpParameters, appData: info.appData,
      });
      if (this.disposed || this.recvTransport !== transport) { try { consumer.close(); } catch { /* ok */ } return; }
      const source = (info.appData && info.appData.source) || (appData && appData.source) || (kind === 'audio' ? 'mic' : 'camera');
      const entry = { consumer, peerId: uid, kind: consumer.kind, source };
      if (consumer.kind === 'video') {
        // Simulcast: quantas camadas dá pra escolher (tela 2, câmera 3).
        entry.spatialLayers = spatialLayersOf(info.rtpParameters);
        entry.spatialLayer = null;
        entry.viewPaused = false;
      }
      this.consumers.set(consumer.id, entry);
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
      // Ensurdecido: o áudio continua pausado no servidor (nem chega aqui).
      if (consumer.kind === 'audio' && this.deafened) { try { consumer.pause(); } catch { /* ok */ } return; }
      if (consumer.kind === 'video') {
        // Tela recebe mais banda que a câmera quando aperta.
        this._request('setConsumerPriority', { consumerId: consumer.id, priority: source === 'screen' ? CONSUMER_PRIORITY.screen : CONSUMER_PRIORITY.camera }).catch(() => {});
        // Vídeo que ninguém está vendo (bloco fora da tela / aba escondida):
        // fica pausado no servidor até aparecer.
        const d = this._viewportFor(entry);
        if (d.paused) { entry.viewPaused = true; try { consumer.pause(); } catch { /* ok */ } return; }
        await this._resumeConsumer(consumer);
        this._applyViewport(consumer.id);
        return;
      }
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
  // Tenta de novo (pedido perdido / sinalização lenta); se mesmo assim não
  // der, recria o consumer UMA vez (o do servidor pode ter ficado preso).
  async _resumeConsumer(consumer) {
    let lastErr = null;
    for (let i = 0; i < 3; i += 1) {
      if (this.disposed || consumer.closed || !this.consumers.has(consumer.id)) return;
      try {
        await this._request('resumeConsumer', { consumerId: consumer.id });
        return;
      } catch (err) {
        lastErr = err;
        if (/não encontrado|desconectada|reconectando|fechada|saindo/.test(String(err?.message))) return;
        await sleep(400 * (i + 1));
      }
    }
    if (this.disposed || consumer.closed) return;
    const entry = this.consumers.get(consumer.id);
    const producerId = consumer.producerId;
    if (entry && !this._recreated.has(producerId)) {
      this._recreated.add(producerId);
      this.cb.onTelemetry?.({ type: 'consumer-recreate', peerId: entry.peerId, kind: entry.kind, error: String(lastErr?.message || lastErr) });
      this._dropConsumer(consumer.id);
      this._request('closeConsumer', { consumerId: consumer.id }).catch(() => {});
      await this._consume({ producerId, peerId: entry.peerId, kind: entry.kind, appData: { source: entry.source } });
      return;
    }
    this.cb.onTelemetry?.({ type: 'consumer-resume-failed', peerId: entry?.peerId, kind: entry?.kind, error: String(lastErr?.message || lastErr) });
    this.cb.onError?.(lastErr, { where: 'resumeConsumer' });
  }

  // Ensurdecer: além de silenciar aqui, pede pro SERVIDOR parar de mandar o
  // áudio dos outros (economia de banda — igual ao Discord). Desensurdecer
  // retoma tudo.
  async setDeafened(deaf) {
    this.deafened = !!deaf;
    const tasks = [];
    for (const [cid, c] of this.consumers) {
      if (c.kind !== 'audio' || c.consumer.closed) continue;
      if (this.deafened) {
        try { c.consumer.pause(); } catch { /* ok */ }
        tasks.push(this._request('pauseConsumer', { consumerId: cid }).catch(() => {}));
      } else {
        try { c.consumer.resume(); } catch { /* ok */ }
        tasks.push(this._request('resumeConsumer', { consumerId: cid }).catch(() => {}));
      }
    }
    await Promise.all(tasks);
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
    const prev = this.statsPrev.get(key) || { lost: 0, received: 0, avg: 0 };
    const dl = Math.max(0, lost - prev.lost);
    const dr = Math.max(0, received - prev.received);
    const total = dl + dr;
    // Poucos pacotes (pessoa em silêncio/DTX, vídeo pausado): não dá pra
    // medir perda direito — mantém a média anterior em vez de pular pra 20%.
    let avg = prev.avg || 0;
    if (total >= 25) avg = avg * 0.5 + (dl / total) * 0.5;
    this.statsPrev.set(key, { lost, received, avg });
    return avg;
  }

  async _collectStats() {
    if (this.disposed || this.reconnecting || !this.sendTransport) return;
    const quality = {};
    let rtt = null;
    // RTT do par ICE EM USO (ida e volta até o servidor de mídia).
    // BUG CORRIGIDO ("ping/sinal vermelho com tudo bom"): pegava QUALQUER par
    // "succeeded" — inclusive os reservas (TCP/relay pelo TURN), mais lentos —
    // e o último da lista vencia. Agora só o par selecionado do transporte.
    try {
      const stats = await this.sendTransport.getStats();
      let selectedId = null;
      const pairs = new Map();
      stats.forEach((s) => {
        if (s.type === 'transport' && s.selectedCandidatePairId) selectedId = s.selectedCandidatePairId;
        if (s.type === 'candidate-pair') pairs.set(s.id, s);
      });
      const pair = (selectedId && pairs.get(selectedId))
        || [...pairs.values()].find((p) => p.selected || (p.nominated && p.state === 'succeeded'));
      if (pair && Number.isFinite(pair.currentRoundTripTime)) rtt = Math.round(pair.currentRoundTripTime * 1000);
    } catch { /* sem stats */ }
    // Suaviza (média móvel) pra um pico isolado não pintar tudo de vermelho.
    if (rtt != null) { this._rttAvg = this._rttAvg == null ? rtt : Math.round(this._rttAvg * 0.6 + rtt * 0.4); rtt = this._rttAvg; }
    // Minha qualidade: perda relatada pelo servidor sobre o que EU envio.
    // BUG CORRIGIDO: o fractionLost de um único relatório RTCP oscila muito
    // (e com o mic em silêncio/DTX quase não há pacotes — 1 perdido em 5
    // virava "20% de perda" = sinal vermelho). Agora: perda acumulada desde a
    // última leitura (perdidos ÷ enviados), só conta com pacotes suficientes,
    // e suavizada.
    let myLoss = this._lossAvg || 0;
    const mic = this.producers.mic;
    if (mic && !mic.closed) {
      try {
        const stats = await mic.getStats();
        let sent = null; let lost = null;
        stats.forEach((s) => {
          if (s.type === 'outbound-rtp' && Number.isFinite(s.packetsSent)) sent = (sent || 0) + s.packetsSent;
          if (s.type === 'remote-inbound-rtp' && Number.isFinite(s.packetsLost)) lost = (lost || 0) + Math.max(0, s.packetsLost);
        });
        if (sent != null && lost != null) {
          const prev = this._sendLossPrev || { sent, lost };
          const ds = sent - prev.sent; const dl = Math.max(0, lost - prev.lost);
          this._sendLossPrev = { sent, lost };
          if (ds >= 25) { // ~0,5 s de áudio falando; em silêncio mantém a última média
            const cur = Math.min(1, dl / (ds + dl));
            this._lossAvg = (this._lossAvg || 0) * 0.5 + cur * 0.5;
          }
          myLoss = this._lossAvg || 0;
        }
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
    // Painel "Voz conectada": ping e perda no ENVIO (o que o servidor
    // relata sobre o que eu mando).
    try { this.cb.onConnectionStats?.({ rtt, sendLoss: myLoss, connected }); } catch { /* ok */ }
  }

  // ---------- controles ----------
  // enabled=true => quero FALAR. Espelha o estado real por onSelfMute. Com
  // mudo da moderação / sem SPEAK, o "quero falar" fica guardado e o
  // microfone continua pausado até o servidor liberar (onServerState).
  async setMicEnabled(enabled) {
    this.micMuted = !enabled;
    const p = this.producers.mic;
    try {
      if (!p) {
        // Sem producer (mic negado/ausente ao entrar): tenta o microfone de novo.
        if (enabled && this.sendTransport && this.serverState.canSpeak) {
          try { await this._publishMic(); } catch (err) { this._onMicError(err); }
        } else this.cb.onSelfMute?.(!enabled);
        return;
      }
      if (enabled) {
        if (this._serverBlocksMic()) { this.cb.onSelfMute?.(false); this.cb.onServerState?.({ ...this.serverState }); return; }
        p.resume();
        // resume() reabilita a faixa: reaplica o portão (apertar-pra-falar).
        this._applyMicGate();
        try {
          await this._request('resumeProducer', { producerId: p.id });
        } catch (err) {
          if (/^forbidden:/.test(String(err?.message))) { this._onResumeRefused(err); this.cb.onSelfMute?.(false); return; }
          throw err;
        }
      } else {
        p.pause();
        if (this.speakingDet.speaking) { this.speakingDet.reset(); this.lastLocalSpeaking = false; this.cb.onLocalSpeaking?.(false); }
        await this._request('pauseProducer', { producerId: p.id });
      }
      this.cb.onSelfMute?.(!enabled);
    } catch (err) { this.cb.onError?.(err, { where: 'setMicEnabled' }); }
  }

  // Liga/desliga o RNNoise na hora (carrega no pipeline se ainda não
  // estava). O supressor do NAVEGADOR faz o papel inverso: ligado quando o
  // RNNoise não está processando (nunca os dois juntos, nunca nenhum).
  // Modelo do redutor ao vivo ('rnnoise' | 'dfn3'). Devolve o que ficou
  // rodando (pode voltar 'rnnoise' se o DeepFilterNet3 não carregar).
  async setNoiseModel(model) {
    this.noiseModel = model === NOISE_MODELS.DFN3 ? NOISE_MODELS.DFN3 : NOISE_MODELS.RNNOISE;
    const pipe = this.pipeline;
    if (!pipe || typeof pipe.setNoiseModel !== 'function') return null;
    try { return await pipe.setNoiseModel(this.noiseModel); } catch (err) { this.cb.onError?.(err, { where: 'setNoiseModel' }); return null; }
  }

  async setNoiseSuppression(on) {
    this.noiseEnabled = !!on;
    if (!on) this.gate.clearVad();
    const pipe = this.pipeline;
    if (!pipe) return;
    try {
      await pipe.setNoise(!!on);
      this._applyBrowserNoise(!(on && pipe.noiseActive));
    } catch (err) { this.cb.onError?.(err, { where: 'setNoiseSuppression' }); }
  }

  // Faixa do microfone (MediaStreamTrack). Padrão: a PROCESSADA (a que vai
  // pra call — gravação usa esta). raw=true: a captura crua.
  getLocalMicTrack({ raw = false } = {}) {
    const t = raw ? (this.rawMic || this.localTracks.mic) : this.localTracks.mic;
    return isLive(t) ? t : null;
  }

  // Fecha só aqui (o servidor já fechou o producer, ou vai fechar sozinho).
  _closeProducerLocal(key) {
    const p = this.producers[key];
    const t = this.localTracks[key];
    this.producers[key] = null; this.localTracks[key] = null;
    if (t) { try { t.stop(); } catch { /* ok */ } }
    if (p) { try { p.close(); } catch { /* ok */ } }
    if (key === 'screenAudio') this._stopVenmic().catch(() => {});
  }

  async _closeProducer(key) {
    const p = this.producers[key];
    const t = this.localTracks[key];
    this.producers[key] = null; this.localTracks[key] = null;
    if (key === 'mic') { this._disposePipeline(); this.rawMic = null; this._stopAnalysis(); }
    if (key === 'screenAudio') this._stopVenmic().catch(() => {});
    if (t) { try { t.stop(); } catch { /* ok */ } }
    if (!p) return;
    try { p.close(); } catch { /* ok */ }
    await this._request('closeProducer', { producerId: p.id }).catch(() => {});
  }

  hangup() { this.dispose(); }

  _closeAll() {
    this.leaving = true;
    this._stopStats();
    this._stopKeepalive();
    this._stopAnalysis();
    this._stopNetWatch();
    clearTimeout(this.reconnectTimer); this.reconnectTimer = null;
    clearTimeout(this.offlinePollTimer); this.offlinePollTimer = null;
    clearTimeout(this.pttTimer); this.pttTimer = null;
    this._clearTransportTimers();
    for (const key of Object.keys(this.producers)) {
      const p = this.producers[key]; const t = this.localTracks[key];
      if (t) { try { t.stop(); } catch { /* ok */ } }
      if (p) { try { p.close(); } catch { /* ok */ } }
      this.producers[key] = null; this.localTracks[key] = null;
    }
    this._disposePipeline();
    this._stopVenmic().catch(() => {});
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

export { GATE_DEFAULTS };
export default MediasoupEngine;
