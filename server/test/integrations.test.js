// Fase 6: status do Minecraft (protocolo de verdade num servidor falso),
// webhooks (token, limpeza, limite) e YouTube → Novidades.
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const mc = require('../src/services/minecraftStatus');
const wh = require('../src/services/webhooks');
const yt = require('../src/services/youtubeAnnouncer');

function fakeMcServer(status) {
  return new Promise((resolve) => {
    const srv = net.createServer((sock) => {
      let got = Buffer.alloc(0);
      sock.on('data', (c) => {
        got = Buffer.concat([got, c]);
        // handshake + pedido de status chegaram: responde o JSON.
        if (got.length >= 5) {
          const json = Buffer.from(JSON.stringify(status));
          const body = Buffer.concat([mc.varint(0), mc.varint(json.length), json]);
          sock.end(Buffer.concat([mc.varint(body.length), body]));
        }
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

test('Minecraft: lê jogadores, versão e MOTD sem cores', async () => {
  mc._reset();
  const srv = await fakeMcServer({ version: { name: '§aPurpur 1.21' }, players: { online: 7, max: 100, sample: [{ name: 'Ana' }] }, description: { text: '§6Rede', extra: [{ text: '§eSun' }] } });
  const { port } = srv.address();
  const st = await mc.getStatus({ host: 'localhost', port, name: 'RedeSun' }, { resolver: async () => ({ host: '127.0.0.1', port }) });
  srv.close();
  assert.equal(st.online, true);
  assert.equal(st.players.online, 7);
  assert.deepEqual(st.players.sample, ['Ana']);
  assert.equal(st.version, 'Purpur 1.21');
  assert.equal(st.motd, 'RedeSun');
});

test('Minecraft: servidor fora do ar vira "offline" (sem quebrar)', async () => {
  mc._reset();
  const st = await mc.getStatus({ host: 'localhost', port: 1 }, { resolver: async (h, p) => ({ host: '127.0.0.1', port: p }) });
  assert.equal(st.online, false);
  assert.equal((await mc.getStatus({ host: 'x y', port: 25565 })).error, 'endereço inválido');
});

test('webhook: aceita o formato do Discord e desarma @everyone', () => {
  const p = wh.parsePayload({ content: 'Oi @everyone e @here', embeds: [{ title: 'Deploy', url: 'https://ok', color: 0x00ff00, image: { url: 'http://inseguro' }, fields: [{ name: 'a', value: 'b' }] }] });
  assert.ok(!/@everyone(?!​)/.test(p.content.replace('@​everyone', '')));
  assert.match(p.content, /@​everyone/);
  assert.equal(p.embed.color, '#00ff00');
  assert.equal(p.embed.titleUrl, 'https://ok');
  assert.equal(p.embed.imageUrl, undefined); // só https
  assert.throws(() => wh.parsePayload({}), /content/);
});

test('webhook: token errado não posta; certo posta; limite por minuto', async () => {
  wh._reset();
  const token = 'a'.repeat(64);
  const id = '11111111-2222-3333-4444-555555555555';
  const db = { channelWebhook: { findUnique: async () => ({ id, channelId: 'c1', userId: 'bot', tokenHash: wh.sha256(token) }), update: async () => ({}) } };
  const posts = [];
  const post = async (m) => { posts.push(m); return { id: `m${posts.length}`, ...m }; };
  await assert.rejects(wh.execute(id, 'b'.repeat(64), { content: 'x' }, { db, post }), (e) => e.status === 401);
  await assert.rejects(wh.execute(id, 'curto', { content: 'x' }, { db, post }), (e) => e.status === 401);
  const m = await wh.execute(id, token, { content: 'olá' }, { db, post });
  assert.equal(m.channelId, 'c1');
  assert.equal(m.authorId, 'bot');
  for (let i = 1; i < wh.RATE_MAX; i += 1) await wh.execute(id, token, { content: 'x' }, { db, post }); // eslint-disable-line no-await-in-loop
  await assert.rejects(wh.execute(id, token, { content: 'x' }, { db, post }), (e) => e.status === 429);
});

test('YouTube: 1ª rodada só marca como visto; depois publica só os novos', async () => {
  const feed = (ids) => `<feed><title>Canal RB</title>${ids.map((id) => `<entry><yt:videoId>${id}</yt:videoId><title>Vídeo ${id}</title><published>2026-11-01</published></entry>`).join('')}</feed>`;
  let xml = feed(['aaa', 'bbb']);
  const store = {};
  const config = {
    getConfig: async (k, d) => ({ ...d, ...(store[k] || {}) }),
    setConfig: async (k, data) => { store[k] = data; return data; },
  };
  store[yt.KEY] = { enabled: true, channelId: 'UCxxxxxxxxxxxxxxxxxxxxxx' };
  const fetchImpl = async () => ({ ok: true, text: async () => xml });
  const published = [];
  const publish = async (_io, { video }) => { published.push(video.videoId); };
  const shortCheck = async (id) => id === 'sss';
  assert.deepEqual(await yt.tick(null, { db: {}, config, fetchImpl, publish, shortCheck }), []);
  xml = feed(['ccc', 'sss', 'aaa', 'bbb']);
  assert.deepEqual(await yt.tick(null, { db: {}, config, fetchImpl, publish, shortCheck }), ['ccc']);
  assert.deepEqual(published, ['ccc']); // o Short não vira anúncio
  assert.deepEqual(await yt.tick(null, { db: {}, config, fetchImpl, publish, shortCheck }), []);
});

test('YouTube: reconhece id, link do canal e @handle', async () => {
  assert.equal(await yt.resolveChannelId('UCGC7KnI2123nCXRBgI8cnVw'), 'UCGC7KnI2123nCXRBgI8cnVw');
  assert.equal(await yt.resolveChannelId('https://www.youtube.com/channel/UCGC7KnI2123nCXRBgI8cnVw'), 'UCGC7KnI2123nCXRBgI8cnVw');
  const fetchImpl = async () => ({ ok: true, text: async () => 'xx "channelId":"UCabcdefghijklmnopqrstuv" yy' });
  assert.equal(await yt.resolveChannelId('https://youtube.com/@canalrb', { fetchImpl }), 'UCabcdefghijklmnopqrstuv');
  assert.equal(await yt.resolveChannelId('qualquer coisa'), null);
});

test('ranking por jogo: só quem deixa a biblioteca visível pra você', async () => {
  const gr = require('../src/services/gameRanking');
  const db = {
    userSettings: { findMany: async ({ where }) => (where.gamesVisibility === 'everyone' ? [{ userId: 'pub' }] : [{ userId: 'amigoOculto' }]) },
    friendship: { findMany: async () => [{ requesterId: 'eu', addresseeId: 'amigo' }, { requesterId: 'amigoOculto', addresseeId: 'eu' }] },
  };
  const ids = await gr.visibleUserIds('eu', { db });
  assert.deepEqual(ids.sort(), ['amigo', 'eu', 'pub']);
});
