// Salas e participantes em cima do mediasoup.
//
// Modelo (PDF, seções 1 e 3): cada SALA tem um Router (num Worker, round-
// robin). Cada PARTICIPANTE tem um transport de envio e um de recepção,
// publica Producers (mic / câmera / tela / áudio da tela) e assina
// Consumers dos producers dos outros. O servidor só ENCAMINHA RTP (SFU):
// não decodifica nem mistura nada. A sinalização (quem entrou, novo
// producer, etc) vive em signaling.js; aqui é só estado + mediasoup.
const mediasoup = require('mediasoup');
const { config } = require('./config');

const log = (...a) => console.log('[media]', ...a);

// ---------------- Workers ----------------
const workers = [];
let nextWorker = 0;

async function startWorkers() {
  for (let i = 0; i < config.numWorkers; i += 1) {
    const worker = await mediasoup.createWorker({
      logLevel: config.logLevel,
      logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
      rtcMinPort: config.rtcMinPort,
      rtcMaxPort: config.rtcMaxPort,
    });
    worker.on('died', () => {
      // Um worker morto derruba as salas dele; o processo reinicia inteiro
      // (o docker/systemd sobe de novo) — é mais seguro que seguir capenga.
      console.error('[media] worker morreu (pid %d) — encerrando pra reiniciar', worker.pid);
      setTimeout(() => process.exit(1), 1000);
    });
    workers.push(worker);
  }
  log(`${workers.length} worker(s) mediasoup prontos (portas ${config.rtcMinPort}-${config.rtcMaxPort})`);
}

function pickWorker() {
  const w = workers[nextWorker % workers.length];
  nextWorker += 1;
  return w;
}

// ---------------- Salas ----------------
const rooms = new Map(); // name -> Room

class Peer {
  constructor({ id, name, socket }) {
    this.id = id;           // = userId do Project Club (identidade na grade)
    this.name = name;
    this.socket = socket;   // WebSocket da sinalização
    this.transports = new Map(); // id -> WebRtcTransport
    this.producers = new Map();  // id -> Producer
    this.consumers = new Map();  // id -> Consumer
    this.rtpCapabilities = null;
    this.joinedAt = Date.now();
  }

  close() {
    for (const c of this.consumers.values()) { try { c.close(); } catch { /* já */ } }
    for (const p of this.producers.values()) { try { p.close(); } catch { /* já */ } }
    for (const t of this.transports.values()) { try { t.close(); } catch { /* já */ } }
    this.consumers.clear(); this.producers.clear(); this.transports.clear();
  }
}

class Room {
  constructor(name, router, audioLevelObserver) {
    this.name = name;
    this.router = router;
    this.audioLevelObserver = audioLevelObserver;
    this.peers = new Map(); // peerId -> Peer
    this.createdAt = Date.now();
    this.onActiveSpeakers = null; // (peerIds[]) => void — ligado pela sinalização
    this._wireAudioLevels();
  }

  _wireAudioLevels() {
    // Quem está falando (PDF 4.1 / UX): o observer entrega os producers de
    // áudio com mais volume a cada intervalo; mapeamos pra peerId.
    this.audioLevelObserver.on('volumes', (volumes) => {
      const ids = [];
      for (const { producer } of volumes) {
        const peerId = producer.appData && producer.appData.peerId;
        if (peerId && !ids.includes(peerId)) ids.push(peerId);
      }
      this.onActiveSpeakers?.(ids);
    });
    this.audioLevelObserver.on('silence', () => { this.onActiveSpeakers?.([]); });
  }

  get size() { return this.peers.size; }

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

  async createWebRtcTransport(peer) {
    const transport = await this.router.createWebRtcTransport({
      listenIps: [{ ip: config.listenIp, announcedIp: config.publicIp }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: config.initialAvailableOutgoingBitrate,
      appData: { peerId: peer.id },
    });
    if (config.maxIncomingBitrate > 0) {
      try { await transport.setMaxIncomingBitrate(config.maxIncomingBitrate); } catch { /* opcional */ }
    }
    transport.on('dtlsstatechange', (state) => { if (state === 'failed' || state === 'closed') transport.close(); });
    transport.observer.on('close', () => { peer.transports.delete(transport.id); });
    peer.transports.set(transport.id, transport);
    return transport;
  }

  async produce(peer, { transportId, kind, rtpParameters, appData }) {
    const transport = peer.transports.get(transportId);
    if (!transport) throw new Error('transport não encontrado');
    if (peer.producers.size >= config.maxProducersPerPeer) throw new Error('limite de mídias publicadas por participante');
    const source = typeof appData?.source === 'string' ? appData.source : (kind === 'audio' ? 'mic' : 'camera');
    const producer = await transport.produce({
      kind, rtpParameters,
      appData: { peerId: peer.id, source },
    });
    producer.observer.on('close', () => { peer.producers.delete(producer.id); });
    peer.producers.set(producer.id, producer);
    if (kind === 'audio' && source === 'mic') {
      // Só o microfone entra no detector de fala (não o áudio da tela).
      try { await this.audioLevelObserver.addProducer({ producerId: producer.id }); } catch { /* ok */ }
    }
    return producer;
  }

  async consume(peer, { transportId, producerId, rtpCapabilities }) {
    const transport = peer.transports.get(transportId);
    if (!transport) throw new Error('transport não encontrado');
    // Acha o producer em qualquer peer da sala.
    let producer = null; let ownerId = null;
    for (const p of this.peers.values()) {
      const found = p.producers.get(producerId);
      if (found) { producer = found; ownerId = p.id; break; }
    }
    if (!producer) throw new Error('producer não encontrado');
    if (ownerId === peer.id) throw new Error('não consome a própria mídia');
    if (!this.router.canConsume({ producerId, rtpCapabilities })) throw new Error('capacidades RTP incompatíveis com este producer');
    // Começa PAUSADO (recomendação do mediasoup): o cliente cria o consumer
    // local e manda resumeConsumer — evita perder os primeiros quadros.
    const consumer = await transport.consume({
      producerId, rtpCapabilities, paused: true,
      appData: { peerId: ownerId, source: producer.appData.source },
    });
    consumer.observer.on('close', () => { peer.consumers.delete(consumer.id); });
    peer.consumers.set(consumer.id, consumer);
    return { consumer, ownerId };
  }

  addPeer(peer) {
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

  close() {
    for (const p of this.peers.values()) p.close();
    this.peers.clear();
    try { this.audioLevelObserver.close(); } catch { /* ok */ }
    try { this.router.close(); } catch { /* ok */ }
  }
}

async function getOrCreateRoom(name) {
  let room = rooms.get(name);
  if (room) return room;
  if (rooms.size >= config.maxRooms) throw new Error('limite de salas atingido');
  const worker = pickWorker();
  const router = await worker.createRouter({ mediaCodecs: config.mediaCodecs });
  const audioLevelObserver = await router.createAudioLevelObserver({ maxEntries: 8, threshold: config.speakingThresholdDb, interval: config.speakingIntervalMs });
  room = new Room(name, router, audioLevelObserver);
  rooms.set(name, room);
  log(`sala criada: ${name} (worker pid ${worker.pid})`);
  return room;
}

function closeRoomIfEmpty(name) {
  const room = rooms.get(name);
  if (!room || room.size > 0) return;
  rooms.delete(name);
  room.close();
  log(`sala fechada: ${name}`);
}

function stats() {
  let peers = 0; let producers = 0; let consumers = 0;
  for (const r of rooms.values()) {
    peers += r.size;
    for (const p of r.peers.values()) { producers += p.producers.size; consumers += p.consumers.size; }
  }
  return { rooms: rooms.size, peers, producers, consumers, workers: workers.length };
}

module.exports = { startWorkers, getOrCreateRoom, closeRoomIfEmpty, rooms, stats, Peer, Room };
