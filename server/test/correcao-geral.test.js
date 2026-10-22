// Correção geral (out/2026): GIFs pelo servidor, voz (tolerância consultando
// o servidor de mídia), métricas do processo, cache sem "stampede", canal
// em destaque unificado e atividade com capa limitada.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

// ---------- GIFs ----------
test('GIFs: resposta da KLIPY vira {id, preview, full} e descarta itens sem GIF', () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://u:p@localhost:3306/db';
  let gif;
  try { gif = require('../src/controllers/gifController'); } catch (err) {
    // Sem o cliente Prisma gerado (ambiente de teste sem binários): confere pelo código.
    const src = read('controllers/gifController.js');
    assert.match(src, /media_formats\?\.tinygif\?\.url/);
    return;
  }
  const out = gif._mapResults({ results: [
    { id: '1', media_formats: { gif: { url: 'https://static.klipy.com/a.gif' }, tinygif: { url: 'https://static.klipy.com/a-t.gif' } } },
    { id: '2', media_formats: { tinygif: { url: 'https://static.klipy.com/b-t.gif' } } },
    { id: '3', media_formats: { gif: { url: 'https://static.klipy.com/c.gif' } } },
  ] });
  assert.deepEqual(out, [
    { id: '1', preview: 'https://static.klipy.com/a-t.gif', full: 'https://static.klipy.com/a.gif' },
    { id: '3', preview: 'https://static.klipy.com/c.gif', full: 'https://static.klipy.com/c.gif' },
  ]);
  assert.deepEqual(gif._mapResults(null), []);
});

test('GIFs: a chave fica no servidor, aceita KLIPY_KEY ou VITE_KLIPY_KEY e nunca é logada', () => {
  const src = read('controllers/gifController.js');
  assert.match(src, /process\.env\.KLIPY_KEY \|\| process\.env\.VITE_KLIPY_KEY/);
  assert.doesNotMatch(src, /console\.\w+\([^)]*\$\{KLIPY_BASE\}/, 'não pode logar a URL com a chave');
  const routes = read('routes/gifs.js');
  assert.match(routes, /requireAuth/);
  assert.match(routes, /rateLimit/);
  assert.match(read('app.js'), /app\.use\('\/api\/gifs'/);
  // O cliente não usa mais a chave embutida no bundle.
  const picker = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'src', 'components', 'EmojiPickerPanel.jsx'), 'utf8');
  assert.doesNotMatch(picker, /import\.meta\.env\.VITE_KLIPY_KEY/);
  assert.doesNotMatch(picker, /api\.klipy\.com/);
});

// ---------- Voz: "a mídia ainda está viva?" ----------
test('mediaControl.isPeerAlive: pergunta GET /peer com o segredo e lê found+alive', async () => {
  const mediaControl = require('../src/services/mediaControl');
  const env = { MEDIA_SERVER_URL: 'wss://midia.exemplo.com/ws', MEDIA_SERVER_SECRET: 's3gr3d0', VOICE_ROOM_SALT: 'sal' };
  let seen = null;
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => ({ found: true, alive: true }) }; };
  assert.equal(await mediaControl.isPeerAlive({ channelId: 'c1', peerId: 'u1' }, { env, fetchImpl }), true);
  const u = new URL(seen.url);
  assert.equal(u.protocol, 'https:');
  assert.equal(u.pathname, '/peer');
  assert.equal(u.searchParams.get('room'), mediaControl.mediaRoomName('c1', env));
  assert.equal(u.searchParams.get('peerId'), 'u1');
  assert.equal(seen.opts.headers['x-media-secret'], 's3gr3d0');

  const dead = async () => ({ ok: true, json: async () => ({ found: true, alive: false }) });
  assert.equal(await mediaControl.isPeerAlive({ channelId: 'c1', peerId: 'u1' }, { env, fetchImpl: dead }), false);
  // Servidor de mídia antigo (sem /peer), fora do ar ou não configurado: null (não sabe).
  const notFound = async () => ({ ok: false, status: 404 });
  assert.equal(await mediaControl.isPeerAlive({ channelId: 'c1', peerId: 'u1' }, { env, fetchImpl: notFound }), null);
  const boom = async () => { throw new Error('ECONNREFUSED'); };
  assert.equal(await mediaControl.isPeerAlive({ channelId: 'c1', peerId: 'u1' }, { env, fetchImpl: boom }), null);
  assert.equal(await mediaControl.isPeerAlive({ channelId: 'c1', peerId: 'u1' }, { env: {}, fetchImpl }), null);
});

test('voz: tolerância de queda consulta o servidor de mídia antes de tirar da lista; sync não expulsa reconexão', () => {
  const src = read('sockets/index.js');
  assert.match(src, /mediaControl\.isPeerAlive\(\{ channelId, peerId: userId \}\)/);
  assert.match(src, /VOICE_GRACE_MAX_EXTENSIONS/);
  // voice:sync serializado com o voice:join (mesma trava)
  assert.match(src, /socket\.on\('voice:sync'[\s\S]{0,200}withLock\(`join:\$\{userId\}:\$\{channelId\}`/);
  // só expulsa se a dona da vaga for uma conexão MAIS NOVA
  assert.match(src, /ownerIssued > mineIssued/);
  // "está falando" de canal restrito não vai pra comunidade inteira
  assert.match(src, /publicRoster \? socket\.to\(`voice:\$\{channelId\}`\)\.to\(rosterRoomFor\(channelId\)\) : socket\.to\(`voice:\$\{channelId\}`\)/);
});

test('socket.io: heartbeat não derruba todo mundo num pico de carga', () => {
  const src = read('sockets/index.js');
  const iv = Number(src.match(/pingInterval:\s*(\d+)/)[1]);
  const to = Number(src.match(/pingTimeout:\s*(\d+)/)[1]);
  assert.ok(iv >= 15000 && to >= 20000, `ping ${iv}/${to}`);
});

// ---------- Cache sem stampede ----------
test('cacheGetOrSet: chamadas simultâneas com cache vazio calculam UMA vez e cada uma recebe sua cópia', async () => {
  const Module = require('node:module');
  const store = new Map();
  const fakeRedis = {
    get: async (k) => (store.has(k) ? store.get(k) : null),
    set: async (k, v) => { store.set(k, v); return 'OK'; },
    del: async (k) => { store.delete(k); return 1; },
    on() {},
  };
  // Carrega config/redis.js com um ioredis falso.
  const file = require.resolve('../src/config/redis');
  delete require.cache[file];
  const origLoad = Module._load;
  Module._load = function patched(req, parent, isMain) {
    if (req === 'ioredis') return function FakeRedis() { return fakeRedis; };
    return origLoad.call(this, req, parent, isMain);
  };
  let mod;
  try { mod = require('../src/config/redis'); } finally { Module._load = origLoad; delete require.cache[file]; }
  let calls = 0;
  const compute = async () => { calls += 1; await new Promise((r) => { setTimeout(r, 30); }); return { list: [1, 2, 3] }; };
  const results = await Promise.all(Array.from({ length: 8 }, () => mod.cacheGetOrSet('k', 60, compute)));
  assert.equal(calls, 1);
  results.forEach((r) => assert.deepEqual(r, { list: [1, 2, 3] }));
  results[1].list.push(4);
  assert.deepEqual(results[2].list, [1, 2, 3], 'quem esperou recebe cópia própria');
});

// ---------- Atividade: capa limitada ----------
test('atividade: capa em data URL acima de 64KB é descartada (não cortada pela metade)', () => {
  const src = read('sockets/index.js');
  const fnSrc = src.match(/function cleanActivityImage\(raw\) \{[\s\S]*?\n\}/)[0];
  // eslint-disable-next-line no-new-func
  const cleanActivityImage = new Function(`${fnSrc}; return cleanActivityImage;`)();
  const small = `data:image/jpeg;base64,${'A'.repeat(30000)}`;
  const big = `data:image/jpeg;base64,${'A'.repeat(70000)}`;
  assert.equal(cleanActivityImage(small), small);
  assert.equal(cleanActivityImage(big), undefined);
  assert.equal(cleanActivityImage('data:text/html;base64,PGgxPg=='), undefined);
  assert.equal(cleanActivityImage('https://is1-ssl.mzstatic.com/x.jpg'), 'https://is1-ssl.mzstatic.com/x.jpg');
  assert.equal(cleanActivityImage('javascript:alert(1)'), undefined);
  assert.equal(cleanActivityImage(null), undefined);
});

// ---------- Canal em destaque unificado ----------
test('canais em destaque: "anuncios" (Anúncios e Eventos) pode ser escondido pela staff', () => {
  const { FEATURED_KEYS, featuredVisibility } = require('../src/utils/channelNames');
  assert.ok(FEATURED_KEYS.includes('anuncios'));
  assert.equal(featuredVisibility('["anuncios"]').anuncios, false);
  assert.equal(featuredVisibility('[]').anuncios, true);
  // dados antigos continuam valendo
  assert.equal(featuredVisibility('["eventos","loja"]').loja, false);
});

// ---------- Métricas do processo ----------
test('métricas: uma linha sem dados pessoais, com memória, event loop e sockets', () => {
  const { startRuntimeMetrics } = require('../src/services/runtimeMetrics');
  const lines = [];
  const m = startRuntimeMetrics({ io: { engine: { clientsCount: 7 } }, intervalMs: 3_600_000, log: (l) => lines.push(l) });
  try {
    const s = m.sample();
    assert.equal(s.sockets, 7);
    assert.match(lines[0], /rss=\d+MB .*heap=\d+MB\/\d+MB .*loop p50=.*sockets=7/);
  } finally { m.stop(); }
});
