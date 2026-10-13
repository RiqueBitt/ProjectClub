// Sinalização por WebSocket (PDF, seção 2: "Node.js + WebSocket seguro").
//
// Protocolo (JSON):
//   cliente → servidor: { id, method, data }   → resposta { id, ok:true, data } | { id, ok:false, error }
//   servidor → cliente: { event, data }        (notificações)
//
// Métodos: createTransport{direction} · connectTransport{transportId,dtlsParameters}
//          produce{transportId,kind,rtpParameters,appData} · closeProducer{producerId}
//          pauseProducer{producerId} · resumeProducer{producerId}
//          consume{transportId,producerId,rtpCapabilities} · resumeConsumer{consumerId}
//          leave · ping
// Eventos: welcome · peerJoined · peerLeft · newProducer · producerClosed
//          producerPaused · producerResumed · activeSpeakers
//
// Autenticação: o Project Club assina um JWT (HS256, MEDIA_SERVER_SECRET)
// com { sub: userId, room, name, exp } e o cliente conecta em
// wss://.../?token=... . Sem JWT válido a conexão é recusada antes de
// qualquer coisa — o servidor de mídia nunca consulta banco nem sabe de
// contas: confia só nessa assinatura (PDF, seção 6).
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const { config } = require('./config');
const rooms = require('./rooms');

const log = (...a) => console.log('[media]', ...a);

function verifyToken(token) {
  const payload = jwt.verify(token, config.secret, { algorithms: ['HS256'] });
  const userId = String(payload.sub || '').trim();
  const room = String(payload.room || '').trim();
  if (!userId || !room) throw new Error('token sem sub/room');
  if (!/^[a-zA-Z0-9_:\-.]{1,128}$/.test(room)) throw new Error('nome de sala inválido');
  return { userId, room, name: String(payload.name || userId).slice(0, 64) };
}

function send(socket, msg) {
  if (socket.readyState === socket.OPEN) {
    try { socket.send(JSON.stringify(msg)); } catch { /* fechando */ }
  }
}

function broadcast(room, event, data, exceptPeerId) {
  for (const p of room.peers.values()) {
    if (p.id === exceptPeerId) continue;
    send(p.socket, { event, data });
  }
}

// Resumo seguro de um producer pra avisar os outros (sem parâmetros RTP).
const producerInfo = (peerId, producer) => ({
  peerId, producerId: producer.id, kind: producer.kind, appData: producer.appData, paused: producer.paused,
});

function attach(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 256 * 1024 });

  wss.on('connection', async (socket, req) => {
    // --- autenticação ---
    let auth;
    try {
      const url = new URL(req.url, 'http://x');
      const token = url.searchParams.get('token') || (req.headers['sec-websocket-protocol'] || '').replace(/^bearer\./i, '');
      auth = verifyToken(token);
    } catch (err) {
      send(socket, { event: 'error', data: { reason: 'unauthorized' } });
      socket.close(4401, 'unauthorized');
      return;
    }

    let room;
    try { room = await rooms.getOrCreateRoom(auth.room); } catch (err) {
      send(socket, { event: 'error', data: { reason: err.message } });
      socket.close(4503, 'room');
      return;
    }

    // Mesma pessoa conectando de novo (outra aba / reconexão): a sessão
    // antiga sai — a identidade na grade é uma só por usuário.
    const previous = room.peers.get(auth.userId);
    if (previous) {
      try { send(previous.socket, { event: 'kicked', data: { reason: 'replaced' } }); previous.socket.close(4409, 'replaced'); } catch { /* ok */ }
      room.removePeer(auth.userId);
    }

    const peer = new rooms.Peer({ id: auth.userId, name: auth.name, socket });
    try { room.addPeer(peer); } catch (err) {
      send(socket, { event: 'error', data: { reason: err.message } });
      socket.close(4503, 'full');
      rooms.closeRoomIfEmpty(room.name);
      return;
    }
    if (!room.onActiveSpeakers) {
      room.onActiveSpeakers = (peerIds) => broadcast(room, 'activeSpeakers', { peerIds });
    }
    log(`entrou: ${auth.userId} em ${room.name} (${room.size} na sala)`);

    send(socket, {
      event: 'welcome',
      data: {
        peerId: peer.id,
        routerRtpCapabilities: room.router.rtpCapabilities,
        ...room.snapshotFor(peer.id),
      },
    });
    broadcast(room, 'peerJoined', { peerId: peer.id, name: peer.name }, peer.id);

    // Batimento: fecha sockets mortos (celular bloqueado, wifi caiu).
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });

    socket.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      const { id, method, data = {} } = msg || {};
      if (typeof method !== 'string') return;
      const reply = (ok, payload) => send(socket, ok ? { id, ok: true, data: payload } : { id, ok: false, error: String(payload && payload.message || payload) });
      try {
        switch (method) {
          case 'ping': return reply(true, { t: Date.now() });

          case 'createTransport': {
            const t = await room.createWebRtcTransport(peer);
            return reply(true, {
              id: t.id, iceParameters: t.iceParameters, iceCandidates: t.iceCandidates,
              dtlsParameters: t.dtlsParameters, direction: data.direction === 'recv' ? 'recv' : 'send',
            });
          }
          case 'connectTransport': {
            const t = peer.transports.get(String(data.transportId));
            if (!t) throw new Error('transport não encontrado');
            await t.connect({ dtlsParameters: data.dtlsParameters });
            return reply(true, {});
          }
          case 'produce': {
            if (data.kind !== 'audio' && data.kind !== 'video') throw new Error('kind inválido');
            const producer = await room.produce(peer, {
              transportId: String(data.transportId), kind: data.kind, rtpParameters: data.rtpParameters, appData: data.appData,
            });
            broadcast(room, 'newProducer', producerInfo(peer.id, producer), peer.id);
            producer.on('transportclose', () => { broadcast(room, 'producerClosed', { peerId: peer.id, producerId: producer.id }, peer.id); });
            return reply(true, { producerId: producer.id });
          }
          case 'closeProducer': {
            const p = peer.producers.get(String(data.producerId));
            if (!p) return reply(true, {});
            p.close();
            broadcast(room, 'producerClosed', { peerId: peer.id, producerId: p.id }, peer.id);
            return reply(true, {});
          }
          case 'pauseProducer': {
            const p = peer.producers.get(String(data.producerId));
            if (!p) throw new Error('producer não encontrado');
            await p.pause();
            broadcast(room, 'producerPaused', { peerId: peer.id, producerId: p.id }, peer.id);
            return reply(true, {});
          }
          case 'resumeProducer': {
            const p = peer.producers.get(String(data.producerId));
            if (!p) throw new Error('producer não encontrado');
            await p.resume();
            broadcast(room, 'producerResumed', { peerId: peer.id, producerId: p.id }, peer.id);
            return reply(true, {});
          }
          case 'consume': {
            const { consumer, ownerId } = await room.consume(peer, {
              transportId: String(data.transportId), producerId: String(data.producerId), rtpCapabilities: data.rtpCapabilities,
            });
            consumer.on('producerclose', () => { send(socket, { event: 'consumerClosed', data: { consumerId: consumer.id } }); });
            consumer.on('producerpause', () => { send(socket, { event: 'consumerPaused', data: { consumerId: consumer.id } }); });
            consumer.on('producerresume', () => { send(socket, { event: 'consumerResumed', data: { consumerId: consumer.id } }); });
            return reply(true, {
              consumerId: consumer.id, producerId: consumer.producerId, peerId: ownerId,
              kind: consumer.kind, rtpParameters: consumer.rtpParameters, appData: consumer.appData,
              producerPaused: consumer.producerPaused,
            });
          }
          case 'resumeConsumer': {
            const c = peer.consumers.get(String(data.consumerId));
            if (!c) throw new Error('consumer não encontrado');
            await c.resume();
            return reply(true, {});
          }
          case 'leave': {
            reply(true, {});
            socket.close(1000, 'leave');
            return undefined;
          }
          default:
            return reply(false, `método desconhecido: ${method}`);
        }
      } catch (err) {
        return reply(false, err);
      }
    });

    const cleanup = () => {
      if (room.peers.get(peer.id) !== peer) return; // já substituído/removido
      room.removePeer(peer.id);
      broadcast(room, 'peerLeft', { peerId: peer.id });
      log(`saiu: ${peer.id} de ${room.name} (${room.size} na sala)`);
      rooms.closeRoomIfEmpty(room.name);
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });

  // Ping a cada 15s; quem não responder em 2 ciclos cai.
  const beat = setInterval(() => {
    for (const s of wss.clients) {
      if (s.isAlive === false) { try { s.terminate(); } catch { /* ok */ } continue; }
      s.isAlive = false;
      try { s.ping(); } catch { /* ok */ }
    }
  }, 15000);
  beat.unref?.();
  wss.on('close', () => clearInterval(beat));
  return wss;
}

module.exports = { attach, verifyToken };
