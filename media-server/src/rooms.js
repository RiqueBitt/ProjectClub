// Salas e participantes em cima do mediasoup.
//
// Modelo (PDF, seções 1 e 3): cada SALA tem um Router (num Worker, o menos
// carregado). Cada PARTICIPANTE tem um transport de envio e um de recepção,
// publica Producers (mic / câmera / tela / áudio da tela) e assina
// Consumers dos producers dos outros. O servidor só ENCAMINHA RTP (SFU):
// não decodifica nem mistura nada. A sinalização (quem entrou, novo
// producer, etc) vive em signaling.js; aqui é só estado + mediasoup.
//
// Robustez (revisão "voz à prova de falhas"):
//  - criação de sala serializada por nome (dois entrando AO MESMO TEMPO numa
//    sala vazia caíam em dois Room/Router diferentes e não se ouviam);
//  - sala/participante têm flag `closed`: tudo que termina DEPOIS de um
//    await confere se a sala/pessoa ainda existe (senão fecha o que criou —
//    antes um transport criado pra quem já tinha saído vazava pra sempre);
//  - worker morto NÃO derruba mais o processo: as salas dele fecham com
//    código 1012 (o cliente reconecta sozinho e cai numa sala nova, num
//    worker vivo) e um worker novo sobe no lugar;
//  - WebRtcServer por worker (uma porta UDP + TCP) com reserva automática
//    pra portas por transport se ele não subir.
const mediasoup = require('mediasoup');
const { config, transportPortRange, WEBRTC_SERVER_PORT_RESERVE } = require('./config');
const perm = require('./permissions');

const log = (...a) => console.log('[media]', ...a);

// Fecha o WebSocket de um participante sem nunca lançar.
function closeSocket(socket, code, reason) {
  if (!socket) return;
  try { socket.close(code, reason); } catch { /* já fechado */ }
}

// ---------------- Workers ----------------
// Cada entrada: { worker, webRtcServer | null, index }.
const workers = [];
let nextWorker = 0;
let stopping = false;
const deathTimes = [];
const respawnTimers = new Set();
const listeners = { workerDied: new Set() }; // ganchos pros testes/monitor

async function createWorkerEntry(index) {
  const range = transportPortRange();
  const worker = await mediasoup.createWorker({
    logLevel: config.logLevel,
    logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
    // Faixa dos transports avulsos (reserva quando não há WebRtcServer).
    rtcMinPort: range.min,
    rtcMaxPort: range.max,
    appData: { index },
  });
  const entry = { worker, webRtcServer: null, index };
  if (config.useWebRtcServer && index < WEBRTC_SERVER_PORT_RESERVE) {
    const port = config.webRtcServerPort + index;
    const base = { ip: config.listenIp, announcedAddress: config.publicIp, port };
    try {
      entry.webRtcServer = await worker.createWebRtcServer({
        listenInfos: [{ protocol: 'udp', ...base }, { protocol: 'tcp', ...base }],
      });
    } catch (err) {
      // Porta ocupada (ex.: worker anterior ainda morrendo): segue com portas
      // por transport — funciona igual, só usa mais portas da faixa.
      console.error(`[media] WebRtcServer na porta ${port} falhou (${err.message}) — usando portas por transport`);
    }
  }
  worker.on('died', (err) => onWorkerDied(entry, err));
  return entry;
}

function onWorkerDied(entry, err) {
  const i = workers.indexOf(entry);
  if (i !== -1) workers.splice(i, 1);
  console.error('[media] worker mediasoup morreu (pid %d): %s', entry.worker.pid, err?.message || err);
  // Salas daquele worker já perderam o Router: fecha e manda o pessoal
  // reconectar (1012 = "service restart" — o cliente tenta de novo sozinho).
  for (const room of [...rooms.values()]) {
    if (room.workerEntry === entry) closeRoom(room, { code: 1012, reason: 'media_restart' });
  }
  for (const fn of listeners.workerDied) { try { fn(entry); } catch { /* ok */ } }
  if (stopping) return;
  const now = Date.now();
  deathTimes.push(now);
  while (deathTimes.length && now - deathTimes[0] > 60000) deathTimes.shift();
  if (deathTimes.length > config.maxWorkerDeathsPerMinute) {
    console.error(`[media] ${deathTimes.length} workers morreram em 1 minuto — encerrando pro docker reiniciar limpo`);
    setTimeout(() => process.exit(1), 500).unref?.();
    return;
  }
  respawn(entry.index, 1);
}

function respawn(index, attempt) {
  const delay = Math.min(10000, 500 * 2 ** (attempt - 1));
  const t = setTimeout(async () => {
    respawnTimers.delete(t);
    if (stopping) return;
    try {
      const entry = await createWorkerEntry(index);
      if (stopping) { try { entry.worker.close(); } catch { /* ok */ } return; }
      workers.push(entry);
      log(`worker ${index} recriado (pid ${entry.worker.pid})`);
    } catch (e) {
      console.error(`[media] falha ao recriar worker ${index} (tentativa ${attempt}): ${e.message}`);
      respawn(index, attempt + 1);
    }
  }, delay);
  respawnTimers.add(t);
}

async function startWorkers() {
  stopping = false;
  for (let i = 0; i < config.numWorkers; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    workers.push(await createWorkerEntry(i));
  }
  const ws = workers.filter((w) => w.webRtcServer).map((w) => config.webRtcServerPort + w.index);
  log(`${workers.length} worker(s) mediasoup prontos · ${ws.length ? `WebRtcServer UDP/TCP em ${ws.join(', ')}` : 'sem WebRtcServer'} · faixa por transport ${transportPortRange().min}-${transportPortRange().max}`);
}

function aliveWorkers() {
  return workers.filter((w) => !w.worker.closed && !w.worker.died);
}

// Worker com MENOS gente (empate: rodízio) — sala nova não cai no worker
// mais cheio só porque era a vez dele.
function pickWorker() {
  const alive = aliveWorkers();
  if (!alive.length) throw new Error('servidor de mídia sem worker disponível');
  const load = new Map(alive.map((w) => [w, 0]));
  for (const r of rooms.values()) if (load.has(r.workerEntry)) load.set(r.workerEntry, load.get(r.workerEntry) + 1 + r.size);
  const start = nextWorker % alive.length;
  nextWorker += 1;
  let best = alive[start];
  for (let k = 1; k < alive.length; k += 1) {
    const w = alive[(start + k) % alive.length];
    if (load.get(w) < load.get(best)) best = w;
  }
  return best;
}

// ---------------- Salas ----------------
const rooms = new Map(); // name -> Room
const creating = new Map(); // name -> Promise<Room> (criação em andamento)
// Producers de microfone pausados pela MODERAÇÃO (não pelo próprio cliente).
const modPaused = new WeakSet();

class Peer {
  constructor({ id, name, socket, session, perms }) {
    this.id = id;           // = userId do Project Club (identidade na grade)
    this.name = name;
    this.socket = socket;   // WebSocket da sinalização
    this.session = session || null; // jti do token (identifica a sessão/aparelho)
    // Permissões de mídia (ver permissions.js): claims do token + ordens do
    // backend (POST /control). Sem claims = tudo permitido.
    this.perms = perms || perm.permsFromClaims({});
    this.transports = new Map(); // id -> WebRtcTransport
    this.producers = new Map();  // id -> Producer
    this.consumers = new Map();  // id -> Consumer
    this.pendingProduce = 0;
    this.rtpCapabilities = null;
    this.joinedAt = Date.now();
    this.closed = false;
  }

  close() {
    this.closed = true;
    for (const c of this.consumers.values()) { try { c.close(); } catch { /* já */ } }
    for (const p of this.producers.values()) { try { p.close(); } catch { /* já */ } }
    for (const t of this.transports.values()) { try { t.close(); } catch { /* já */ } }
    this.consumers.clear(); this.producers.clear(); this.transports.clear();
  }
}

// Erro de "a sala/pessoa sumiu no meio da operação" (não é bug do cliente).
function goneError() { return new Error('participante saiu da sala'); }

class Room {
  constructor(name, router, audioLevelObserver, workerEntry) {
    this.name = name;
    this.router = router;
    this.audioLevelObserver = audioLevelObserver;
    this.workerEntry = workerEntry || null;
    this.peers = new Map(); // peerId -> Peer
    this.createdAt = Date.now();
    this.closed = false;
    this.onActiveSpeakers = null; // (peerIds[]) => void — ligado pela sinalização
    // Detector de fala com "segura" (hold): peerId -> último instante em que
    // o observer o ouviu acima do limiar. Só avisa quando o conjunto MUDA.
    this._lastHeard = new Map();
    this._activeKey = '';
    this._speakTimer = null;
    this._wireAudioLevels();
    // Router fechado por fora (worker morreu → 'workerclose'): a sala inteira
    // morre junto e o pessoal reconecta numa sala nova.
    router.observer.once('close', () => {
      if (!this.closed) closeRoom(this, { code: 1012, reason: 'media_restart' });
    });
  }

  _wireAudioLevels() {
    // Quem está falando (PDF 4.1 / UX): o observer entrega os producers de
    // áudio com mais volume a cada intervalo (200ms); mapeamos pra peerId.
    // Com a "segura" (config.speakingHoldMs) a pessoa continua acesa um
    // pouco depois da última sílaba — sem piscar entre palavras — e o aviso
    // só sai quando o conjunto de quem fala MUDA (menos tráfego).
    this.audioLevelObserver.on('volumes', (volumes) => {
      const now = Date.now();
      for (const { producer } of volumes) {
        const peerId = producer.appData && producer.appData.peerId;
        if (peerId) this._lastHeard.set(peerId, now);
      }
      this._emitSpeakers(now);
    });
    this.audioLevelObserver.on('silence', () => { this._emitSpeakers(Date.now()); });
  }

  // Recalcula quem está falando (com a segura) e avisa se mudou. Agenda um
  // novo cálculo pra quando a próxima segura vencer (o 'silence' do
  // observer não repete enquanto continua tudo quieto).
  _emitSpeakers(now) {
    if (this.closed) return;
    const { active, nextExpiry } = activeSpeakers(this._lastHeard, now, config.speakingHoldMs);
    for (const id of [...this._lastHeard.keys()]) if (!active.includes(id)) this._lastHeard.delete(id);
    const key = active.slice().sort().join('|');
    if (key !== this._activeKey) {
      this._activeKey = key;
      this.onActiveSpeakers?.(active);
    }
    clearTimeout(this._speakTimer);
    this._speakTimer = null;
    if (nextExpiry != null) {
      this._speakTimer = setTimeout(() => this._emitSpeakers(Date.now()), Math.max(20, nextExpiry - now + 5));
      this._speakTimer.unref?.();
    }
  }

  get size() { return this.peers.size; }

  // A pessoa ainda é ESTA na sala (não saiu nem foi substituída)?
  _alive(peer) { return !this.closed && !peer.closed && this.peers.get(peer.id) === peer; }

  // Lista pros recém-chegados: quem está aqui e o que cada um publica.
  snapshotFor(excludePeerId) {
    const peers = [];
    const producers = [];
    for (const p of this.peers.values()) {
      if (p.id === excludePeerId) continue;
      peers.push({ id: p.id, name: p.name });
      for (const prod of p.producers.values()) {
        producers.push({ peerId: p.id, producerId: prod.id, kind: prod.kind, appData: prod.appData, paused: prod.paused });
      }
    }
    return { peers, producers };
  }

  _transportOptions(peer) {
    const opts = {
      enableUdp: true,
      enableTcp: true,          // reserva pra rede que bloqueia UDP
      preferUdp: true,
      iceConsentTimeout: config.iceConsentTimeout,
      initialAvailableOutgoingBitrate: config.initialAvailableOutgoingBitrate,
      appData: { peerId: peer.id },
    };
    const srv = this.workerEntry && this.workerEntry.webRtcServer;
    if (srv && !srv.closed) {
      opts.webRtcServer = srv;
    } else {
      const portRange = transportPortRange();
      const base = { ip: config.listenIp, announcedAddress: config.publicIp, portRange };
      opts.listenInfos = [{ protocol: 'udp', ...base }, { protocol: 'tcp', ...base }];
    }
    return opts;
  }

  async createWebRtcTransport(peer, direction) {
    if (!this._alive(peer)) throw goneError();
    if (peer.transports.size >= config.maxTransportsPerPeer) throw new Error('limite de transports por participante');
    const transport = await this.router.createWebRtcTransport(this._transportOptions(peer));
    transport.appData.direction = direction === 'recv' ? 'recv' : 'send';
    if (!this._alive(peer)) { try { transport.close(); } catch { /* ok */ } throw goneError(); }
    if (config.maxIncomingBitrate > 0) {
      try { await transport.setMaxIncomingBitrate(config.maxIncomingBitrate); } catch { /* opcional */ }
    }
    transport.on('dtlsstatechange', (state) => {
      if (state === 'failed' || state === 'closed') {
        try { transport.close(); } catch { /* ok */ }
        peer.onTransportClosed?.(transport.id, `dtls_${state}`);
      }
    });
    transport.on('icestatechange', (state) => {
      if (state === 'disconnected') log(`ICE desconectado: ${peer.id} em ${this.name} (${transport.appData.direction})`);
    });
    transport.observer.on('close', () => { peer.transports.delete(transport.id); });
    if (!this._alive(peer)) { try { transport.close(); } catch { /* ok */ } throw goneError(); }
    peer.transports.set(transport.id, transport);
    return transport;
  }

  async produce(peer, { transportId, kind, rtpParameters, appData }) {
    if (!this._alive(peer)) throw goneError();
    const transport = peer.transports.get(transportId);
    if (!transport) throw new Error('transport não encontrado');
    // Conta as publicações EM ANDAMENTO também: dois produce simultâneos
    // passavam juntos pela checagem do limite.
    if (peer.producers.size + peer.pendingProduce >= config.maxProducersPerPeer) throw new Error('limite de mídias publicadas por participante');
    const source = perm.normalizeSource(kind, appData?.source);
    // Permissões NO SERVIDOR (SPEAK / VIDEO / palco): o cliente pode estar
    // adulterado — sem permissão, a mídia nem chega a existir.
    const hasScreen = [...peer.producers.values()].some((p) => p.appData?.source === 'screen' && !p.closed);
    const denied = perm.checkProduce(peer.perms, { kind, source, hasScreen });
    if (denied) throw perm.forbiddenError(denied);
    // Nasce pausado: o cliente pediu (estava mudo — nada de "vazar" o
    // começo da fala) ou o servidor manda (mudo da moderação).
    const clientPaused = appData?.paused === true;
    const forced = !clientPaused && perm.forcePausedOnProduce(peer.perms, { kind, source });
    const paused = clientPaused || forced;
    peer.pendingProduce += 1;
    let producer;
    try {
      producer = await transport.produce({
        kind, rtpParameters, paused, appData: { peerId: peer.id, source },
        // Vídeo: no máximo 1 pedido de quadro-chave por segundo pro
        // publicador (vários ouvintes entrando/trocando de camada ao mesmo
        // tempo não viram uma rajada de quadros-chave pesados).
        ...(kind === 'video' ? { keyFrameRequestDelay: 1000 } : {}),
      });
    } finally {
      peer.pendingProduce -= 1;
    }
    if (!this._alive(peer)) { try { producer.close(); } catch { /* ok */ } throw goneError(); }
    producer.observer.on('close', () => { peer.producers.delete(producer.id); });
    peer.producers.set(producer.id, producer);
    // Pausado SÓ pela moderação (o cliente queria falar): volta sozinho quando
    // a moderação liberar — cliente antigo não sabe do serverState.
    if (forced) modPaused.add(producer);
    if (kind === 'audio' && source === 'mic') {
      // Só o microfone entra no detector de fala (não o áudio da tela).
      try { await this.audioLevelObserver.addProducer({ producerId: producer.id }); } catch { /* ok */ }
    }
    return producer;
  }

  async consume(peer, { transportId, producerId, rtpCapabilities }) {
    if (!this._alive(peer)) throw goneError();
    const transport = peer.transports.get(transportId);
    if (!transport) throw new Error('transport não encontrado');
    if (peer.consumers.size >= config.maxConsumersPerPeer) throw new Error('limite de mídias recebidas por participante');
    // Acha o producer em qualquer peer da sala.
    let producer = null; let ownerId = null;
    for (const p of this.peers.values()) {
      const found = p.producers.get(producerId);
      if (found) { producer = found; ownerId = p.id; break; }
    }
    if (!producer || producer.closed) throw new Error('producer não encontrado');
    if (ownerId === peer.id) throw new Error('não consome a própria mídia');
    if (!this.router.canConsume({ producerId, rtpCapabilities })) throw new Error('capacidades RTP incompatíveis com este producer');
    // Começa PAUSADO (recomendação do mediasoup): o cliente cria o consumer
    // local e manda resumeConsumer — evita perder os primeiros quadros.
    const consumer = await transport.consume({
      producerId, rtpCapabilities, paused: true,
      // Áudio também retransmite pacote perdido (NACK do Opus — o cliente
      // publica o mic com opusNack). Vídeo já retransmite por padrão.
      ...(producer.kind === 'audio' ? { enableRtx: true } : {}),
      // clientPaused: o cliente ainda não pediu o resume (ou pausou de
      // propósito — ensurdecido, economia de banda).
      appData: { peerId: ownerId, source: producer.appData.source, clientPaused: true },
    });
    if (!this._alive(peer)) { try { consumer.close(); } catch { /* ok */ } throw goneError(); }
    consumer.observer.on('close', () => { peer.consumers.delete(consumer.id); });
    peer.consumers.set(consumer.id, consumer);
    return { consumer, ownerId };
  }

  addPeer(peer) {
    if (this.closed) throw new Error('sala fechada');
    if (this.peers.size >= config.maxPeersPerRoom) throw new Error('sala cheia');
    this.peers.set(peer.id, peer);
  }

  removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return null;
    this.peers.delete(peerId);
    peer.close();
    return peer;
  }

  // Fecha a sala. Com `code`, derruba também o WebSocket de quem estava
  // dentro (worker morreu / desligando) pra que reconectem na hora em vez
  // de ficar numa sala sem mídia até o batimento perceber.
  close({ code, reason } = {}) {
    if (this.closed) return;
    this.closed = true;
    const peers = [...this.peers.values()];
    this.peers.clear();
    for (const p of peers) {
      p.close();
      if (code) closeSocket(p.socket, code, reason || 'room_closed');
    }
    clearTimeout(this._speakTimer); this._speakTimer = null;
    try { this.audioLevelObserver.close(); } catch { /* ok */ }
    try { this.router.close(); } catch { /* ok */ }
  }
}

// Quem conta como "falando" agora: ouvido há no máximo `holdMs`. Devolve
// também quando a próxima segura vence (pra recalcular sem novo evento).
function activeSpeakers(lastHeard, now, holdMs) {
  const active = [];
  let nextExpiry = null;
  for (const [id, at] of lastHeard) {
    const until = at + holdMs;
    if (until >= now) {
      active.push(id);
      if (nextExpiry == null || until < nextExpiry) nextExpiry = until;
    }
  }
  return { active, nextExpiry };
}

// Tira do mapa (só se ainda for ESTA sala com esse nome) e fecha.
function closeRoom(room, opts) {
  if (rooms.get(room.name) === room) rooms.delete(room.name);
  const had = room.size;
  room.close(opts);
  log(`sala fechada: ${room.name}${opts?.reason ? ` (${opts.reason}, ${had} reconectando)` : ''}`);
}

async function createRoom(name) {
  const entry = pickWorker();
  const router = await entry.worker.createRouter({ mediaCodecs: config.mediaCodecs });
  let audioLevelObserver;
  try {
    audioLevelObserver = await router.createAudioLevelObserver({ maxEntries: 8, threshold: config.speakingThresholdDb, interval: config.speakingIntervalMs });
  } catch (err) {
    try { router.close(); } catch { /* ok */ }
    throw err;
  }
  if (router.closed) throw new Error('worker de mídia caiu durante a criação da sala');
  const room = new Room(name, router, audioLevelObserver, entry);
  rooms.set(name, room);
  log(`sala criada: ${name} (worker pid ${entry.worker.pid})`);
  return room;
}

// Sala existente ou nova — UMA criação por nome: quem chega enquanto a sala
// está sendo criada espera a MESMA promessa (antes os dois criavam um Router
// cada e o segundo sobrescrevia o primeiro no mapa: cada um numa sala).
function getOrCreateRoom(name) {
  const existing = rooms.get(name);
  if (existing && !existing.closed) return Promise.resolve(existing);
  const pending = creating.get(name);
  if (pending) return pending;
  if (rooms.size + creating.size >= config.maxRooms) return Promise.reject(new Error('limite de salas atingido'));
  const p = createRoom(name).finally(() => { creating.delete(name); });
  creating.set(name, p);
  return p;
}

// Entra na sala de forma atômica: pega/cria a sala e adiciona a pessoa sem
// nenhum await no meio. Se a sala fechou enquanto esperávamos (último saiu,
// worker morreu), tenta de novo numa sala nova.
async function joinRoom(name, peer, { beforeAdd } = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const room = await getOrCreateRoom(name);
    if (room.closed) continue;
    if (beforeAdd) beforeAdd(room);
    room.addPeer(peer);
    return room;
  }
  throw new Error('sala indisponível, tente de novo');
}

function closeRoomIfEmpty(name) {
  const room = rooms.get(name);
  if (!room || room.size > 0) return;
  closeRoom(room);
}

// Desligamento: fecha tudo avisando os clientes (1012) e não recria worker.
function shutdown() {
  stopping = true;
  for (const t of respawnTimers) clearTimeout(t);
  respawnTimers.clear();
  for (const r of [...rooms.values()]) closeRoom(r, { code: 1012, reason: 'shutdown' });
  for (const w of workers.splice(0)) { try { w.worker.close(); } catch { /* ok */ } }
}

function stats() {
  let peers = 0; let producers = 0; let consumers = 0;
  for (const r of rooms.values()) {
    peers += r.size;
    for (const p of r.peers.values()) { producers += p.producers.size; consumers += p.consumers.size; }
  }
  return { rooms: rooms.size, peers, producers, consumers, workers: aliveWorkers().length, workersExpected: config.numWorkers };
}

module.exports = {
  startWorkers, getOrCreateRoom, joinRoom, closeRoomIfEmpty, closeRoom, shutdown, rooms, stats,
  workers, aliveWorkers, listeners, Peer, Room, activeSpeakers, modPaused,
};
