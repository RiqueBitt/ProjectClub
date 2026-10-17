// Sinalização por WebSocket (PDF, seção 2: "Node.js + WebSocket seguro").
//
// Protocolo (JSON):
//   cliente → servidor: { id, method, data }   → resposta { id, ok:true, data } | { id, ok:false, error }
//   servidor → cliente: { event, data }        (notificações)
//
// Métodos: createTransport{direction} · connectTransport{transportId,dtlsParameters}
//          produce{transportId,kind,rtpParameters,appData{source,paused}} · closeProducer{producerId}
//          pauseProducer{producerId} · resumeProducer{producerId}
//          consume{transportId,producerId,rtpCapabilities} · resumeConsumer{consumerId}
//          pauseConsumer{consumerId} (ensurdecido / vídeo fora da tela: economiza banda) · closeConsumer{consumerId}
//          setConsumerPreferredLayers{consumerId,spatialLayer,temporalLayer?} (camada do simulcast pelo tamanho do vídeo)
//          setConsumerPriority{consumerId,priority 1..255} (tela recebe mais banda que a câmera)
//          restartIce{transportId} → { iceParameters } · leave · ping
// Eventos: welcome · peerJoined · peerLeft · newProducer · producerClosed
//          producerPaused · producerResumed · activeSpeakers · consumerClosed
//          consumerPaused · consumerResumed · transportClosed · kicked · error
//          serverState {canSpeak,canVideo,role,serverMuted,serverDeafened,closedProducerIds}
//
// Códigos de fechamento: 4401 token recusado (detalhe em error.reason/detail:
// 'expired' | 'invalid') · 4403 expulso pela moderação (NÃO reconectar) ·
// 4409 substituído por outra sessão sua (NÃO reconectar) · 4429 muitas
// tentativas · 4503 sala cheia/indisponível · 1012 servidor de mídia
// reiniciando a sala (reconectar) · 1008 abuso.
//
// Autenticação: o Project Club assina um JWT (HS256, MEDIA_SERVER_SECRET)
// com { sub: userId, room, name, jti, exp, canSpeak, canVideo, role,
// serverMuted, serverDeafened } e o cliente conecta em wss://.../?token=... .
// Sem JWT válido a conexão é recusada antes de qualquer coisa — o servidor
// de mídia nunca consulta banco nem sabe de contas: confia só nessa
// assinatura (PDF, seção 6). As permissões (falar/vídeo/palco/mudo do
// servidor) valem AQUI, não só na interface — ver permissions.js.
//
// Controle backend → mídia: POST /control (header x-media-secret) com
// { room, peerId, action: 'pause-audio'|'resume-allowed'|'kick'|'set-perms', perms? }
// — ver handleControlRequest/control abaixo.
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const { config } = require('./config');
const rooms = require('./rooms');
const perm = require('./permissions');

const log = (...a) => console.log('[media]', ...a);

function verifyToken(token) {
  let payload;
  try {
    // clockTolerance: o relógio da VM e o da hospedagem do Project Club
    // podem divergir alguns segundos.
    payload = jwt.verify(String(token || ''), config.secret, { algorithms: ['HS256'], clockTolerance: 30 });
  } catch (err) {
    const e = new Error(err?.name === 'TokenExpiredError' ? 'token vencido' : 'token inválido');
    e.detail = err?.name === 'TokenExpiredError' ? 'expired' : 'invalid';
    throw e;
  }
  const userId = String(payload.sub || '').trim();
  const room = String(payload.room || '').trim();
  const invalid = (m) => { const e = new Error(m); e.detail = 'invalid'; return e; };
  if (!userId || !room) throw invalid('token sem sub/room');
  if (userId.length > 128) throw invalid('sub inválido');
  if (!/^[a-zA-Z0-9_:\-.]{1,128}$/.test(room)) throw invalid('nome de sala inválido');
  // Sessão = jti do token (um por /api/voice/join). Tokens antigos sem jti:
  // usa um hash do próprio token — a reconexão do MESMO aparelho reaproveita
  // o mesmo token, então continua sendo a mesma sessão.
  const session = payload.jti ? String(payload.jti).slice(0, 64) : crypto.createHash('sha1').update(String(token)).digest('hex').slice(0, 16);
  return {
    userId, room, name: String(payload.name || userId).slice(0, 64), session,
    // Permissões de mídia das claims (token antigo sem elas = tudo permitido).
    perms: perm.permsFromClaims(payload),
    iat: Number.isFinite(payload.iat) ? payload.iat : null,
  };
}

function send(socket, msg) {
  if (socket && socket.readyState === socket.OPEN) {
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

// ---- Mesma pessoa em dois aparelhos (ping-pong "saiu/entrou") ----
// `superseded`: sessões (jti) que foram SUBSTITUÍDAS por outra sessão da
// mesma pessoa na mesma sala. Se aquela sessão velha tentar reconectar com o
// mesmo token, é recusada (4409) — antes ela voltava, derrubava o aparelho
// novo, que reconectava e derrubava o velho... pra sempre. Entrar de novo de
// propósito pede um token novo (/api/voice/join) e funciona normalmente.
// `swaps`: trocas recentes por pessoa+sala — passou do limite, novas trocas
// ficam recusadas um tempo e quem está na sala fica.
const SUPERSEDED_TTL_MS = 10 * 60 * 1000;
const superseded = new Map(); // `${room}|${user}|${session}` -> expiresAt
const swaps = new Map();      // `${room}|${user}` -> { times: number[], blockedUntil }

// ---- Ordens do backend (POST /control) ----
// `overrides`: a última ordem de permissão por pessoa+sala. Vale pra quem
// reconectar com um token emitido ANTES dela (o token novo já vem com o
// estado certo calculado pelo backend). `kickedAt`: expulsões — token
// emitido antes da expulsão não entra de novo nesta sala.
const overrides = new Map(); // `${room}|${user}` -> { patch, at }
const kickedAt = new Map();  // `${room}|${user}` -> at

// O token foi emitido antes de `at`? (iat em segundos; sem iat = antigo)
function issuedBefore(iat, at) {
  if (!Number.isFinite(iat)) return true;
  return (iat + 1) * 1000 <= at;
}

function pruneMaps(now) {
  const ttl = config.controlOverrideTtlMs;
  for (const [k, v] of overrides) if (now - v.at > ttl) overrides.delete(k);
  for (const [k, at] of kickedAt) if (now - at > ttl) kickedAt.delete(k);
  for (const [k, exp] of superseded) if (exp <= now) superseded.delete(k);
  for (const [k, v] of swaps) {
    v.times = v.times.filter((t) => now - t < 60000);
    if (!v.times.length && v.blockedUntil <= now) swaps.delete(k);
  }
}

// ---- Limite de tentativas de conexão por IP ----
const connectHits = new Map(); // ip -> { count, resetAt }
function clientIp(req) {
  const remote = req.socket?.remoteAddress || '';
  // Atrás do Caddy (mesma máquina) o IP real vem no X-Forwarded-For.
  if (/^(::ffff:)?127\.|^::1$/.test(remote)) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return remote;
}
function allowConnect(ip, now = Date.now()) {
  let e = connectHits.get(ip);
  if (!e || e.resetAt <= now) { e = { count: 0, resetAt: now + 60000 }; connectHits.set(ip, e); }
  e.count += 1;
  return e.count <= config.connectsPerMinutePerIp;
}

function refuse(socket, code, reason, data) {
  send(socket, { event: data?.kicked ? 'kicked' : 'error', data: data?.kicked ? { reason: data.kicked } : { reason, ...(data || {}) } });
  try { socket.close(code, reason); } catch { /* ok */ }
}

// Pausa/retoma um consumer conforme o que o cliente pediu E o que o
// servidor manda (ensurdecido pela moderação mantém o áudio pausado).
async function applyConsumerPause(peer, consumer) {
  if (!consumer || consumer.closed) return;
  const want = perm.consumerShouldPause(peer.perms, { kind: consumer.kind, clientPaused: !!consumer.appData.clientPaused });
  if (want && !consumer.paused) await consumer.pause();
  else if (!want && consumer.paused) {
    await consumer.resume();
    // Pede um quadro-chave na hora (vídeo aparece sem esperar o próximo).
    if (consumer.kind === 'video') consumer.requestKeyFrame().catch(() => {});
  }
}

// Aplica as permissões atuais da pessoa na mídia que JÁ está no ar:
// microfone pausado (sem SPEAK / mudo do servidor), câmera/tela fechadas
// (sem VIDEO), áudio recebido pausado (ensurdecido). Avisa a própria pessoa
// (serverState) e os outros (producerPaused/producerClosed).
async function applyPeerPerms(room, peer) {
  const closedProducerIds = [];
  for (const p of [...peer.producers.values()]) {
    if (p.closed) continue;
    const source = p.appData?.source;
    if (perm.isMicSource(p.kind, source)) {
      const blocked = !peer.perms.canSpeak || peer.perms.serverMuted;
      if (blocked && !p.paused) {
        try { await p.pause(); } catch { /* fechou no meio */ }
        rooms.modPaused.add(p);
        broadcast(room, 'producerPaused', { peerId: peer.id, producerId: p.id }, peer.id);
      } else if (!blocked && p.paused && rooms.modPaused.has(p)) {
        // A moderação liberou e a pessoa queria falar (não se mutou nesse
        // meio-tempo): retoma aqui — o cliente ANTIGO não conhece o
        // serverState e ficaria mudo pra sempre sem saber.
        rooms.modPaused.delete(p);
        try { await p.resume(); } catch { /* fechou no meio */ }
        if (!p.closed && !p.paused) broadcast(room, 'producerResumed', { peerId: peer.id, producerId: p.id }, peer.id);
      }
    } else if (!peer.perms.canVideo) {
      try { p.close(); } catch { /* já */ }
      closedProducerIds.push(p.id);
      broadcast(room, 'producerClosed', { peerId: peer.id, producerId: p.id }, peer.id);
    }
  }
  for (const c of [...peer.consumers.values()]) {
    try { await applyConsumerPause(peer, c); } catch { /* fechou no meio */ }
  }
  send(peer.socket, { event: 'serverState', data: { ...peer.perms, closedProducerIds } });
}

// Ordem do backend (já autenticada). Devolve { ok, found }.
async function control({ room: roomName, peerId, action, perms: patch, reason } = {}) {
  const name = String(roomName || '').trim();
  const uid = String(peerId || '').trim();
  if (!name || !/^[a-zA-Z0-9_:\-.]{1,128}$/.test(name)) return { ok: false, error: 'sala inválida' };
  if (!uid || uid.length > 128) return { ok: false, error: 'peerId inválido' };
  if (!perm.CONTROL_ACTIONS.has(action)) return { ok: false, error: 'ação inválida' };
  const now = Date.now();
  pruneMaps(now);
  const key = `${name}|${uid}`;
  const room = rooms.rooms.get(name);
  const peer = room && !room.closed ? room.peers.get(uid) : null;
  if (action === 'kick') {
    kickedAt.set(key, now);
    overrides.delete(key);
    if (peer) {
      log(`expulso pela moderação: ${uid} de ${name} (${reason || 'moderator'})`);
      send(peer.socket, { event: 'kicked', data: { reason: String(reason || 'moderator').slice(0, 32) } });
      try { peer.socket.close(4403, 'kicked'); } catch { /* ok */ }
    }
    return { ok: true, found: !!peer };
  }
  const safePatch = patch && typeof patch === 'object' ? patch : {};
  // Guarda a ordem acumulada (vale pra reconexão com token antigo).
  const prev = overrides.get(key);
  const accumulated = perm.permsForAction(prev ? prev.patch : {}, action, safePatch);
  overrides.set(key, { patch: accumulated, at: now });
  if (!peer) return { ok: true, found: false };
  peer.perms = perm.permsForAction(peer.perms, action, safePatch);
  await applyPeerPerms(room, peer);
  return { ok: true, found: true, perms: { ...peer.perms } };
}

// POST /control — chamado pelo backend (server/src/services/mediaControl.js).
// Autenticado pelo header x-media-secret (o mesmo segredo do JWT).
function handleControlRequest(req, res, { secretOk }) {
  const reply = (status, body) => {
    if (res.headersSent) return;
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  if (!secretOk(req.headers['x-media-secret'])) { reply(401, { ok: false, error: 'unauthorized' }); return; }
  let size = 0; const chunks = []; let aborted = false;
  req.on('data', (c) => {
    if (aborted) return;
    size += c.length;
    if (size > 16 * 1024) { aborted = true; reply(413, { ok: false, error: 'corpo grande demais' }); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    if (aborted) return;
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { reply(400, { ok: false, error: 'JSON inválido' }); return; }
    control(body).then((r) => reply(r.ok ? 200 : 400, r)).catch((err) => reply(500, { ok: false, error: String(err?.message || err) }));
  });
}

function attach(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 256 * 1024, perMessageDeflate: false });

  wss.on('connection', async (socket, req) => {
    // Batimento já desde o começo (inclusive enquanto a sala é criada).
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });
    // Mensagens que chegarem antes do handler de verdade são ignoradas sem
    // erro (o cliente só pede algo depois do welcome).
    socket.on('error', () => { /* tratado no close */ });

    const ip = clientIp(req);
    if (!allowConnect(ip)) { refuse(socket, 4429, 'too_many_connections'); return; }

    // --- autenticação ---
    let auth;
    try {
      const url = new URL(req.url, 'http://x');
      const token = url.searchParams.get('token') || (req.headers['sec-websocket-protocol'] || '').replace(/^bearer\./i, '');
      auth = verifyToken(token);
    } catch (err) {
      refuse(socket, 4401, 'unauthorized', { detail: err.detail || 'invalid' });
      return;
    }

    const now = Date.now();
    pruneMaps(now);
    const userKey = `${auth.room}|${auth.userId}`;
    if (superseded.has(`${userKey}|${auth.session}`)) {
      // Sessão já substituída por outro aparelho: não volta (fim do ping-pong).
      refuse(socket, 4409, 'replaced', { kicked: 'replaced' });
      return;
    }

    // Expulso pela moderação: token emitido antes da expulsão não volta.
    const kAt = kickedAt.get(userKey);
    if (kAt && issuedBefore(auth.iat, kAt)) { refuse(socket, 4403, 'kicked', { kicked: 'kicked' }); return; }
    // Ordem do backend mais nova que o token (ex.: mudo do servidor e a
    // pessoa reconectou com o token velho): a ordem vence.
    let peerPerms = auth.perms;
    const ov = overrides.get(userKey);
    if (ov && issuedBefore(auth.iat, ov.at)) peerPerms = perm.mergePerms(auth.perms, ov.patch);

    const peer = new rooms.Peer({ id: auth.userId, name: auth.name, socket, session: auth.session, perms: peerPerms });
    let room;
    let replaced = null;
    try {
      room = await rooms.joinRoom(auth.room, peer, {
        // Roda SEM await entre a checagem e a entrada (atômico).
        beforeAdd: (r) => {
          const previous = r.peers.get(auth.userId);
          if (!previous) return;
          if (previous.session && previous.session !== auth.session) {
            const sw = swaps.get(userKey) || { times: [], blockedUntil: 0 };
            if (sw.blockedUntil > Date.now()) {
              const e = new Error('flapping'); e.flapping = true; throw e;
            }
            sw.times = sw.times.filter((t) => Date.now() - t < 60000);
            sw.times.push(Date.now());
            if (sw.times.length > config.maxReplacementsPerMinute) {
              sw.blockedUntil = Date.now() + config.replacementCooldownMs;
              swaps.set(userKey, sw);
              const e = new Error('flapping'); e.flapping = true; throw e;
            }
            swaps.set(userKey, sw);
            superseded.set(`${userKey}|${previous.session}`, Date.now() + SUPERSEDED_TTL_MS);
          }
          // Mesma pessoa conectando de novo (outra aba / reconexão): a sessão
          // antiga sai — a identidade na grade é uma só por usuário.
          r.removePeer(auth.userId);
          replaced = previous;
        },
      });
    } catch (err) {
      if (err.flapping) {
        log(`troca de aparelho em loop: ${auth.userId} em ${auth.room} — mantendo a sessão atual`);
        refuse(socket, 4409, 'replaced', { kicked: 'flapping' });
        return;
      }
      refuse(socket, 4503, 'room', { detail: err.message });
      if (!/sala cheia/.test(err.message)) console.error(`[media] entrada falhou (${auth.userId} em ${auth.room}): ${err.message}`);
      return;
    }

    if (replaced) {
      send(replaced.socket, { event: 'kicked', data: { reason: 'replaced' } });
      try { replaced.socket.close(4409, 'replaced'); } catch { /* ok */ }
      // (Sem peerLeft: a pessoa continua na sala; os outros recebem
      // consumerClosed das mídias antigas e newProducer das novas.)
    }

    // O socket pode ter caído enquanto a sala era criada.
    if (socket.readyState !== socket.OPEN) {
      if (room.peers.get(peer.id) === peer) room.removePeer(peer.id);
      rooms.closeRoomIfEmpty(room.name);
      return;
    }

    if (!room.onActiveSpeakers) {
      room.onActiveSpeakers = (peerIds) => broadcast(room, 'activeSpeakers', { peerIds });
    }
    peer.onTransportClosed = (transportId, reason) => send(socket, { event: 'transportClosed', data: { transportId, reason } });
    log(`entrou: ${auth.userId} em ${room.name} (${room.size} na sala)${replaced ? ' [substituiu sessão anterior]' : ''}`);

    send(socket, {
      event: 'welcome',
      data: {
        peerId: peer.id,
        routerRtpCapabilities: room.router.rtpCapabilities,
        ...room.snapshotFor(peer.id),
        // Estado imposto pelo servidor (permissões, mudo/ensurdecer da moderação).
        serverState: { ...peer.perms },
      },
    });
    broadcast(room, 'peerJoined', { peerId: peer.id, name: peer.name }, peer.id);

    // Balde de fichas por conexão (anti-flood).
    let tokens = config.msgBurst;
    let lastRefill = Date.now();
    let violations = 0;

    socket.on('message', async (raw) => {
      const t = Date.now();
      tokens = Math.min(config.msgBurst, tokens + ((t - lastRefill) / 1000) * config.msgRatePerSec);
      lastRefill = t;
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      const { id, method } = msg || {};
      const data = (msg && msg.data && typeof msg.data === 'object') ? msg.data : {};
      if (typeof method !== 'string') return;
      const reply = (ok, payload) => send(socket, ok ? { id, ok: true, data: payload } : { id, ok: false, error: String((payload && payload.message) || payload) });
      if (tokens < 1) {
        violations += 1;
        if (violations > 200) { try { socket.close(1008, 'flood'); } catch { /* ok */ } return; }
        reply(false, 'muitas requisições — devagar');
        return;
      }
      tokens -= 1;
      // Pessoa já substituída/removida: nada mais vale pra ela.
      if (peer.closed && method !== 'ping' && method !== 'leave') { reply(false, 'sessão encerrada'); return; }
      try {
        switch (method) {
          case 'ping': reply(true, { t: Date.now() }); return;

          case 'createTransport': {
            const direction = data.direction === 'recv' ? 'recv' : 'send';
            const tr = await room.createWebRtcTransport(peer, direction);
            reply(true, {
              id: tr.id, iceParameters: tr.iceParameters, iceCandidates: tr.iceCandidates,
              dtlsParameters: tr.dtlsParameters, direction,
            });
            return;
          }
          case 'connectTransport': {
            const tr = peer.transports.get(String(data.transportId));
            if (!tr) throw new Error('transport não encontrado');
            await tr.connect({ dtlsParameters: data.dtlsParameters });
            reply(true, {});
            return;
          }
          case 'restartIce': {
            // Rede do cliente mudou/caiu (transport 'disconnected'/'failed'):
            // credenciais ICE novas do lado do servidor; o cliente aplica com
            // transport.restartIce({ iceParameters }) — sem refazer a sessão.
            const tr = peer.transports.get(String(data.transportId));
            if (!tr) throw new Error('transport não encontrado');
            const iceParameters = await tr.restartIce();
            reply(true, { iceParameters });
            return;
          }
          case 'produce': {
            if (data.kind !== 'audio' && data.kind !== 'video') throw new Error('kind inválido');
            const producer = await room.produce(peer, {
              transportId: String(data.transportId), kind: data.kind, rtpParameters: data.rtpParameters, appData: data.appData,
            });
            // Transport fechou (DTLS falhou / pessoa saiu): avisa os outros.
            producer.on('transportclose', () => { broadcast(room, 'producerClosed', { peerId: peer.id, producerId: producer.id }, peer.id); });
            broadcast(room, 'newProducer', producerInfo(peer.id, producer), peer.id);
            reply(true, { producerId: producer.id });
            return;
          }
          case 'closeProducer': {
            const p = peer.producers.get(String(data.producerId));
            if (!p) { reply(true, {}); return; }
            p.close();
            broadcast(room, 'producerClosed', { peerId: peer.id, producerId: p.id }, peer.id);
            reply(true, {});
            return;
          }
          case 'pauseProducer': {
            const p = peer.producers.get(String(data.producerId));
            if (!p) throw new Error('producer não encontrado');
            rooms.modPaused.delete(p); // a pessoa se mutou: não retoma sozinho
            await p.pause();
            broadcast(room, 'producerPaused', { peerId: peer.id, producerId: p.id }, peer.id);
            reply(true, {});
            return;
          }
          case 'resumeProducer': {
            const p = peer.producers.get(String(data.producerId));
            if (!p) throw new Error('producer não encontrado');
            // Mudo da moderação / sem SPEAK / plateia do palco: não desmuta.
            const denied = perm.checkResume(peer.perms, { kind: p.kind, source: p.appData?.source });
            if (denied) throw perm.forbiddenError(denied);
            rooms.modPaused.delete(p);
            await p.resume();
            broadcast(room, 'producerResumed', { peerId: peer.id, producerId: p.id }, peer.id);
            reply(true, {});
            return;
          }
          case 'consume': {
            const { consumer, ownerId } = await room.consume(peer, {
              transportId: String(data.transportId), producerId: String(data.producerId), rtpCapabilities: data.rtpCapabilities,
            });
            consumer.on('producerclose', () => { send(socket, { event: 'consumerClosed', data: { consumerId: consumer.id } }); });
            consumer.on('transportclose', () => { send(socket, { event: 'consumerClosed', data: { consumerId: consumer.id } }); });
            consumer.on('producerpause', () => { send(socket, { event: 'consumerPaused', data: { consumerId: consumer.id } }); });
            consumer.on('producerresume', () => { send(socket, { event: 'consumerResumed', data: { consumerId: consumer.id } }); });
            reply(true, {
              consumerId: consumer.id, producerId: consumer.producerId, peerId: ownerId,
              kind: consumer.kind, rtpParameters: consumer.rtpParameters, appData: consumer.appData,
              producerPaused: consumer.producerPaused,
            });
            return;
          }
          case 'resumeConsumer': {
            const c = peer.consumers.get(String(data.consumerId));
            if (!c) throw new Error('consumer não encontrado');
            c.appData.clientPaused = false;
            // Retoma (e pede quadro-chave no vídeo) — a não ser que a
            // moderação tenha ensurdecido a pessoa (áudio fica pausado).
            await applyConsumerPause(peer, c);
            reply(true, { paused: c.paused });
            return;
          }
          case 'closeConsumer': {
            // O cliente vai recriar um consumer que travou (resume nunca
            // respondeu): fecha o antigo pra não ficar pendurado.
            const c = peer.consumers.get(String(data.consumerId));
            if (c) { try { c.close(); } catch { /* já */ } }
            reply(true, {});
            return;
          }
          case 'pauseConsumer': {
            // Cliente se ensurdeceu: o servidor para de mandar o áudio
            // (economia de banda — igual ao Discord).
            const c = peer.consumers.get(String(data.consumerId));
            if (!c) throw new Error('consumer não encontrado');
            c.appData.clientPaused = true;
            await applyConsumerPause(peer, c);
            reply(true, { paused: c.paused });
            return;
          }
          case 'setConsumerPreferredLayers': {
            // Recepção sob medida: o cliente mostra o vídeo pequeno → pede a
            // camada baixa do simulcast (menos banda); grande → a alta.
            const c = peer.consumers.get(String(data.consumerId));
            if (!c) throw new Error('consumer não encontrado');
            const spatialLayer = Math.max(0, Math.min(15, Math.floor(Number(data.spatialLayer))));
            if (!Number.isFinite(spatialLayer)) throw new Error('spatialLayer inválido');
            // Consumer "simple" (sem simulcast/SVC) não tem camadas: nada a fazer.
            if (c.kind !== 'video' || c.type === 'simple' || c.type === 'pipe') { reply(true, { applied: false }); return; }
            const layers = { spatialLayer };
            if (data.temporalLayer != null) {
              const tl = Math.floor(Number(data.temporalLayer));
              if (Number.isFinite(tl)) layers.temporalLayer = Math.max(0, Math.min(15, tl));
            }
            await c.setPreferredLayers(layers);
            reply(true, { applied: true, preferredLayers: c.preferredLayers || null });
            return;
          }
          case 'setConsumerPriority': {
            // Prioridade na divisão da banda de saída (1..255): a tela vale
            // mais que a câmera quando a banda aperta.
            const c = peer.consumers.get(String(data.consumerId));
            if (!c) throw new Error('consumer não encontrado');
            const priority = Math.floor(Number(data.priority));
            if (!Number.isFinite(priority) || priority < 1 || priority > 255) throw new Error('prioridade inválida (1..255)');
            await c.setPriority(priority);
            reply(true, { priority: c.priority });
            return;
          }
          case 'leave': {
            reply(true, {});
            socket.close(1000, 'leave');
            return;
          }
          default:
            reply(false, `método desconhecido: ${method}`);
        }
      } catch (err) {
        reply(false, err);
      }
    });

    const cleanup = () => {
      peer.onTransportClosed = null;
      if (room.peers.get(peer.id) !== peer) { peer.close(); return; } // já substituído/removido
      room.removePeer(peer.id);
      broadcast(room, 'peerLeft', { peerId: peer.id });
      log(`saiu: ${peer.id} de ${room.name} (${room.size} na sala)`);
      rooms.closeRoomIfEmpty(room.name);
    };
    socket.on('close', cleanup);
  });

  // Ping periódico; quem não responder em 2 ciclos cai.
  const beat = setInterval(() => {
    for (const s of wss.clients) {
      if (s.isAlive === false) { try { s.terminate(); } catch { /* ok */ } continue; }
      s.isAlive = false;
      try { s.ping(); } catch { /* ok */ }
    }
    const now = Date.now();
    for (const [k, e] of connectHits) if (e.resetAt <= now) connectHits.delete(k);
    pruneMaps(now);
  }, config.heartbeatMs);
  beat.unref?.();
  wss.on('close', () => clearInterval(beat));
  return wss;
}

function _resetGuards() { superseded.clear(); swaps.clear(); connectHits.clear(); overrides.clear(); kickedAt.clear(); }

module.exports = { attach, verifyToken, control, handleControlRequest, issuedBefore, _resetGuards };
