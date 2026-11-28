// Rodada de leveza (perf2): pacote de abertura (/api/bootstrap), leitura de
// canal agrupada no servidor e otimização de imagem no upload. Sem banco:
// prisma e controllers são trocados por versões falsas em memória.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.resolve(__dirname, '../src', p);
const stub = (rel, exports) => { require.cache[src(rel)] = { id: src(rel), filename: src(rel), loaded: true, exports }; };

// ---------- runHandler ----------
test('runHandler captura status/corpo, params próprios e erros', async () => {
  const { runHandler } = require(src('utils/internalCall.js'));
  const req = { user: { id: 'u1' }, params: { x: 'real' }, query: { a: 1 } };
  const ok = await runHandler(async (r, res) => res.json({ who: r.user.id, p: r.params, q: r.query }), req, { params: { kind: 'EMOJI' } });
  assert.deepEqual(ok, { status: 200, body: { who: 'u1', p: { kind: 'EMOJI' }, q: {} } });
  const st = await runHandler((r, res) => res.status(403).json({ error: 'não' }), req);
  assert.equal(st.status, 403);
  const thrown = await runHandler(async () => { throw Object.assign(new Error('falhou'), { status: 409 }); }, req);
  assert.equal(thrown.status, 409);
  const viaNext = await runHandler((r, res, next) => next(new Error('x')), req);
  assert.equal(viaNext.status, 500);
  assert.equal(req.params.x, 'real'); // o req original não é alterado
});

// ---------- bootstrap ----------
test('bootstrap: só reenvia seções que mudaram e marca as que falharam', async () => {
  let communityVersion = 1;
  const h = (body) => async (req, res) => res.json(body);
  stub('controllers/authController.js', { me: h({ user: { id: 'u1' } }) });
  stub('controllers/communityController.js', { getCommunity: async (req, res) => res.json({ channels: [communityVersion] }) });
  stub('controllers/conversationController.js', { listConversations: h({ conversations: [] }) });
  stub('controllers/friendController.js', { listFriends: h({ friendships: [] }) });
  stub('controllers/clanController.js', { getMyClan: h({ clan: null }) });
  stub('controllers/emojiController.js', { listUsableEmojis: h({ emojis: [] }) });
  stub('controllers/serverStickerController.js', { listStickers: h({ stickers: [] }) });
  stub('controllers/assetCollectionController.js', { listCollections: async (req, res) => res.json({ collections: [req.params.kind] }) });
  stub('controllers/gifController.js', { listFavoriteGifs: h({ gifs: [] }) });
  stub('controllers/communitiesController.js', { listCommunities: h({ communities: [] }) });
  stub('controllers/settingsController.js', { getSettings: h({ settings: { a: 1 } }) });
  stub('controllers/uiEditorController.js', { getUiLayout: h({ PC: {} }) });
  stub('controllers/platformController.js', { getStatus: h({ maintenanceMode: false, disabledSystems: [] }) });
  stub('controllers/announcementController.js', { getActiveAnnouncement: async (req, res) => res.status(500).json({ error: 'boom' }) });
  stub('controllers/eventsController.js', { listEvents: h({ events: [] }) });
  stub('controllers/channelController.js', { getChannelStates: h({ states: {} }) });
  const { getBootstrap } = require(src('controllers/bootstrapController.js'));
  const call = (query) => new Promise((resolve, reject) => {
    const res = { set() { return this; }, json: resolve };
    getBootstrap({ user: { id: 'u1' }, query, params: {} }, res, reject);
  });

  const first = await call({});
  assert.equal(Object.keys(first.data).length, 16); // 17 seções - 1 que falhou
  assert.deepEqual(first.failed, { announcement: 500 });
  assert.deepEqual(first.data.emojiCollections, { collections: ['EMOJI'] });
  assert.deepEqual(first.data.stickerCollections, { collections: ['STICKER'] });

  const have = Object.entries(first.hashes).map(([k, v]) => `${k}:${v}`).join(',');
  const second = await call({ have });
  assert.deepEqual(Object.keys(second.data), []); // nada mudou: corpo vazio
  assert.deepEqual(second.hashes, first.hashes);

  communityVersion = 2;
  const third = await call({ have, only: 'community,friends,naoexiste' });
  assert.deepEqual(Object.keys(third.hashes).sort(), ['community', 'friends']);
  assert.deepEqual(Object.keys(third.data), ['community']);
  assert.deepEqual(third.data.community, { channels: [2] });
});

// ---------- leitura de canal ----------
test('markRead: no máximo 1 gravação por pessoa+canal a cada 2s, sem perder a última', async () => {
  const writes = [];
  stub('config/prisma.js', {
    channelReadState: { upsert: async (q) => { writes.push(q.update.lastReadAt); return {}; } },
    // markRead agora confere VIEW_CHANNEL na 1ª gravação da janela.
    channel: { findUnique: async () => ({ id: 'c1', isPrivate: false, categoryId: null }) },
  });
  stub('services/authz.js', new Proxy({ getEffectivePermissions: async () => 1n }, { get: (t, k) => (k in t ? t[k] : () => {}) }));
  stub('services/permissions.js', new Proxy({ has: () => true }, { get: (t, k) => (k in t ? t[k] : () => {}) }));
  for (const rel of ['controllers/categoryController.js', 'utils/channelNames.js']) {
    if (!require.cache[src(rel)]) stub(rel, new Proxy({}, { get: () => () => {} }));
  }
  delete require.cache[src('controllers/channelController.js')];
  const { markRead } = require(src('controllers/channelController.js'));
  const call = () => new Promise((resolve, reject) => markRead({ params: { id: 'c1' }, user: { id: 'u1' } }, { json: resolve }, reject));
  for (let i = 0; i < 6; i++) { await call(); await new Promise((r) => setTimeout(r, 50)); }
  assert.equal(writes.length, 1); // só a primeira foi direto pro banco
  await new Promise((r) => setTimeout(r, 2200));
  assert.equal(writes.length, 2); // e uma gravação no fim da janela, com o horário mais novo
  assert.ok(writes[1] > writes[0]);
});

// ---------- otimização de imagem ----------
let sharp = null;
try { sharp = require('sharp'); } catch { sharp = null; }

test('imageOptimizer: JPEG de câmera perde EXIF/GPS, gira e vira WebP menor', { skip: !sharp && 'sharp não instalado' }, async () => {
  const { optimizeImage } = require(src('services/imageOptimizer.js'));
  const img = await sharp({ create: { width: 1200, height: 800, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 40 } } })
    .jpeg({ quality: 95 }).withMetadata({ orientation: 6, exif: { IFD0: { Make: 'Phone' } } }).toBuffer();
  const r = await optimizeImage({ buffer: img, mimeType: 'image/jpeg', originalName: 'foto.jpg', field: 'attachments' });
  assert.equal(r.changed, true);
  const m = await sharp(r.buffer).metadata();
  assert.equal(m.width, 800); assert.equal(m.height, 1200); // girado
  assert.ok(!m.exif && !m.orientation);
  assert.ok(r.buffer.length < img.length);
  assert.match(r.originalName, /\.(webp|jpg)$/);
});

test('imageOptimizer: PNG de print vira WebP sem perda (pixels idênticos) e respeita limite do avatar', { skip: !sharp && 'sharp não instalado' }, async () => {
  const { optimizeImage } = require(src('services/imageOptimizer.js'));
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#1e1f22"/><text x="20" y="60" font-size="30" fill="#fff">print de tela</text></svg>');
  const png = await sharp(svg).png().toBuffer();
  const r = await optimizeImage({ buffer: png, mimeType: 'image/png', originalName: 'print.png', field: 'attachments' });
  assert.equal(r.mimeType, 'image/webp'); assert.equal(r.originalName, 'print.webp');
  const a = await sharp(png).ensureAlpha().raw().toBuffer();
  const b = await sharp(r.buffer).ensureAlpha().raw().toBuffer();
  assert.ok(a.equals(b));
  const av = await optimizeImage({ buffer: png, mimeType: 'image/png', originalName: 'a.png', field: 'avatar' });
  const am = await sharp(av.buffer).metadata();
  assert.ok(Math.max(am.width, am.height) <= 512);
});

test('imageOptimizer: GIF fica GIF fora do chat, APNG intacto, lixo devolve o original', { skip: !sharp && 'sharp não instalado' }, async () => {
  const { optimizeImage } = require(src('services/imageOptimizer.js'));
  const frames = await sharp({ create: { width: 64, height: 64 * 3, channels: 4, background: '#f90' } }).raw().toBuffer();
  const gif = await sharp(frames, { raw: { width: 64, height: 192, channels: 4, pageHeight: 64 } }).gif().toBuffer();
  const g = await optimizeImage({ buffer: gif, mimeType: 'image/gif', originalName: 'a.gif', field: 'avatar' });
  assert.equal(g.changed, false); assert.equal(g.mimeType, 'image/gif');
  const fakeApng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('....acTL....IDAT')]);
  const ap = await optimizeImage({ buffer: fakeApng, mimeType: 'image/png', originalName: 'x.png', field: 'image' });
  assert.equal(ap.buffer, fakeApng);
  const junk = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]);
  const j = await optimizeImage({ buffer: junk, mimeType: 'image/jpeg', originalName: 'x.jpg', field: 'attachments' });
  assert.equal(j.buffer, junk); assert.equal(j.changed, false);
});
