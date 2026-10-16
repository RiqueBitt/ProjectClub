// Sala grande usando mais de um núcleo: a partir de MEDIA_SPLIT_AT pessoas,
// quem entra fica num Router de outro Worker e as mídias são ligadas entre
// os Routers (pipeToRouter). Aqui: 2 workers, divide a partir de 2 pessoas.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.MEDIA_SERVER_SECRET = 'segredo-de-teste-0123456789';
process.env.MEDIA_PUBLIC_IP = '127.0.0.1';
process.env.MEDIA_WORKERS = '2';
process.env.MEDIA_SPLIT_AT = '2';
process.env.MEDIA_RTC_MIN_PORT = '43000';
process.env.MEDIA_RTC_MAX_PORT = '43100';
process.env.MEDIA_LOG_LEVEL = 'error';

const rooms = require('../src/rooms');

const OPUS = { codecs: [{ mimeType: 'audio/opus', payloadType: 100, clockRate: 48000, channels: 2, parameters: {} }], encodings: [{ ssrc: 11111111 }] };
const VP8 = { codecs: [{ mimeType: 'video/VP8', payloadType: 101, clockRate: 90000, parameters: {} }], encodings: [{ ssrc: 22222222, maxBitrate: 8000000 }] };

async function join(room, id) {
  const peer = new rooms.Peer({ id, name: id, socket: null });
  await room.assignRouter(peer);
  room.addPeer(peer);
  const send = await room.createWebRtcTransport(peer);
  const recv = await room.createWebRtcTransport(peer);
  return { peer, send, recv };
}

before(async () => { await rooms.startWorkers(); });
after(() => { for (const name of [...rooms.rooms.keys()]) { const r = rooms.rooms.get(name); for (const id of [...r.peers.keys()]) r.removePeer(id); rooms.closeRoomIfEmpty(name); } setTimeout(() => process.exit(0), 50); });

test('sala pequena fica num núcleo só; a partir do limite usa o outro núcleo', async () => {
  const room = await rooms.getOrCreateRoom('grande');
  const a = await join(room, 'a');
  const b = await join(room, 'b');
  assert.equal(a.peer.router, room.router);
  assert.equal(b.peer.router, room.router);
  const c = await join(room, 'c');
  assert.equal(room.routers.length, 2, 'criou o Router no segundo núcleo');
  assert.notEqual(c.peer.router, room.router);
  assert.equal(rooms.stats().routers, 2);
});

test('mídia de um núcleo chega em quem está no outro (microfone e tela 1080p60)', async () => {
  const room = rooms.rooms.get('grande');
  const a = room.peers.get('a'); const c = room.peers.get('c');
  const caps = room.router.rtpCapabilities;
  const sendA = [...a.transports.values()][0]; const recvC = [...c.transports.values()][1];
  const mic = await room.produce(a, { transportId: sendA.id, kind: 'audio', rtpParameters: OPUS, appData: { source: 'mic' } });
  const screen = await room.produce(a, { transportId: sendA.id, kind: 'video', rtpParameters: VP8, appData: { source: 'screen' } });
  const r1 = await room.consume(c, { transportId: recvC.id, producerId: mic.id, rtpCapabilities: caps });
  const r2 = await room.consume(c, { transportId: recvC.id, producerId: screen.id, rtpCapabilities: caps });
  assert.equal(r1.ownerId, 'a'); assert.equal(r2.consumer.kind, 'video');
  // consumir de novo não liga de novo (reaproveita o pipe)
  const sendC = [...c.transports.values()][0]; const recvA = [...a.transports.values()][1];
  const micC = await room.produce(c, { transportId: sendC.id, kind: 'audio', rtpParameters: { ...OPUS, encodings: [{ ssrc: 33333333 }] }, appData: { source: 'mic' } });
  const back = await room.consume(a, { transportId: recvA.id, producerId: micC.id, rtpCapabilities: caps });
  assert.equal(back.ownerId, 'c');
  assert.ok(room.pipes.size >= 2);
});

test('quem sai libera o lugar no núcleo; sala vazia fecha os dois Routers', async () => {
  const room = rooms.rooms.get('grande');
  for (const id of ['a', 'b', 'c']) room.removePeer(id);
  rooms.closeRoomIfEmpty('grande');
  assert.equal(rooms.rooms.size, 0);
  assert.equal(rooms.stats().routers, 0);
});
