// Pingu Turbo: filtro de imagem, intenções, calculadora/conversões, horário
// dos lembretes, cache/carona, streaming (acelerador com relógio falso),
// validação de imagem, escolha do provedor (fetch falso) e o fluxo ao vivo
// do pinguBot com banco/socket de mentira. Nada de rede, banco ou Ollama.
const test = require('node:test');
const assert = require('node:assert');

const safety = require('../src/services/pingu/safety');
const intents = require('../src/services/pingu/intents');
const calc = require('../src/services/pingu/calc');
const { convert } = require('../src/services/pingu/convert');
const tp = require('../src/services/pingu/timeparse');
const tools = require('../src/services/pingu/tools');
const { createLru, createInflight, cacheKeyFor } = require('../src/services/pingu/cache');
const { createThrottle, readNdjson } = require('../src/services/pingu/stream');
const image = require('../src/services/pingu/image');
const prompt = require('../src/services/pingu/prompt');
const { createMemory, isFollowUp } = require('../src/services/pingu/memory');
const actions = require('../src/services/pingu/actions');
const wiki = require('../src/services/pingu/wiki');
const { WIKI_SEED } = require('../src/data/wikiSeed');
const bot = require('../src/services/pinguBot');

const pages = WIKI_SEED.map((p) => ({ ...p, body: p.body.trim() }));
// Segunda, 02/11/2026, 12:00 em Brasília.
const NOW = Date.parse('2026-11-02T15:00:00Z');

// ---------------- filtro de segurança ----------------

test('segurança: pedidos normais passam (sem falso positivo com palavras parecidas)', () => {
  for (const p of ['um pinguim astronauta', 'uma lula gigante no fundo do mar', 'pinguim com pele azul', 'armadura medieval épica',
    'castelo nas nuvens ao pôr do sol', 'uma cpu gamer com RGB', 'dragão cuspindo fogo', 'gato fofo dormindo', 'a cat in space']) {
    assert.equal(safety.checkImagePrompt(p).ok, true, p);
  }
});

test('segurança: recusa sexual, menores, gore, ódio, pessoas reais e automutilação (PT e EN)', () => {
  const cases = [
    ['mulher nua na praia', 'sexual'], ['naked woman', 'sexual'], ['n4ked girl', 'minors'], ['menina com arma', 'minors'],
    ['criança sangrando', 'minors'], ['loli fofa', 'abuse'], ['cena gore de zumbi', 'gore'], ['decapitated knight', 'gore'],
    ['bandeira nazista', 'hate'], ['swastika flag', 'hate'], ['foto do Bolsonaro', 'person'], ['Donald Trump de palhaço', 'person'],
    ['pessoa se matando', 'selfHarm'], ['self harm art', 'selfHarm'],
  ];
  for (const [p, cat] of cases) {
    const r = safety.checkImagePrompt(p);
    assert.equal(r.ok, false, p);
    assert.equal(r.category, cat, p);
    assert.ok(r.message.length > 10);
  }
  assert.equal(safety.checkImagePrompt('').category, 'empty');
  assert.equal(safety.checkImagePrompt('retrato do Fulano Ciclano', { blockedNames: ['fulano ciclano'] }).category, 'person');
});

// ---------------- intenções ----------------

test('intenções: imagem em português e inglês, com tamanho', () => {
  assert.deepEqual(intents.parseIntent('desenhe um pinguim astronauta'), { type: 'image', prompt: 'um pinguim astronauta', size: null });
  assert.deepEqual(intents.parseIntent('crie uma imagem de um gato em formato paisagem'), { type: 'image', prompt: 'um gato', size: 'paisagem' });
  assert.equal(intents.parseIntent('gere uma imagem: castelo, retrato').size, 'retrato');
  assert.equal(intents.parseIntent('imagem de um dragão').type, 'image');
  assert.equal(intents.parseIntent('draw a cat').prompt, 'a cat');
  assert.equal(intents.parseIntent('generate image of a forest').prompt, 'a forest');
  // "crie/faça" sem "imagem" não é pedido de imagem.
  assert.equal(intents.parseIntent('crie uma senha forte').type, 'question');
  assert.equal(intents.parseIntent('faça um resumo do canal').type, 'question');
  assert.deepEqual(intents.parseIntent('de novo'), { type: 'reroll', size: null });
  assert.deepEqual(intents.parseIntent('outra paisagem'), { type: 'reroll', size: 'paisagem' });
});

test('intenções: lembrete, enquete, ajuda e explicar/resumir/reescrever (só respondendo alguém)', () => {
  assert.equal(intents.parseIntent('me lembra em 20 min de tirar o bolo').type, 'reminder');
  assert.equal(intents.parseIntent('lembrete: reunião sexta às 10h').type, 'reminder');
  assert.deepEqual(intents.parseIntent('enquete Qual o melhor? A / B'), { type: 'poll', body: 'Qual o melhor? A / B' });
  assert.equal(intents.parseIntent('ajuda').type, 'help');
  assert.equal(intents.parseIntent('o que você sabe fazer?').type, 'help');
  assert.equal(intents.parseIntent('explica isso', { hasReply: true }).type, 'explain');
  assert.equal(intents.parseIntent('resume isso', { hasReply: true }).type, 'summarizeThis');
  assert.equal(intents.parseIntent('melhora esse texto', { hasReply: true }).type, 'rewrite');
  assert.equal(intents.parseIntent('explica isso').type, 'question'); // sem resposta: pergunta normal
  assert.equal(intents.parseIntent('qual a capital do brasil?').type, 'question');
});

test('enquete: pergunta e opções em vários formatos, duração e erros', () => {
  assert.deepEqual(intents.parsePoll('Qual o melhor jogo? Minecraft / Terraria / Roblox'), { question: 'Qual o melhor jogo?', options: ['Minecraft', 'Terraria', 'Roblox'], duration: '24h' });
  assert.deepEqual(intents.parsePoll('Pizza ou hambúrguer: pizza, hambúrguer por 4h'), { question: 'Pizza ou hambúrguer', options: ['pizza', 'hambúrguer'], duration: '4h' });
  assert.equal(intents.parsePoll('Melhor jogo / Minecraft / Terraria (3d)').duration, '3d');
  assert.deepEqual(intents.parsePoll('Time? A | B | a').options, ['A', 'B']); // repetida sai
  assert.ok(intents.parsePoll('sem opções').error);
  assert.ok(intents.parsePoll(`P? ${Array.from({ length: 8 }, (_, i) => `o${i}`).join(' / ')}`).error);
});

// ---------------- calculadora e conversões ----------------

test('calculadora: parser próprio (sem eval), palavras em português e vírgula decimal', () => {
  const v = (q) => calc.evaluate(q)?.value;
  assert.equal(v('2+2*3'), 8);
  assert.equal(v('(3+4)*2^3'), 56);
  assert.equal(v('quanto é 15% de 200?'), 30);
  assert.equal(v('raiz de 144'), 12);
  assert.equal(v('2,5 x 4'), 10);
  assert.equal(v('5 mais 3 vezes 2'), 11);
  assert.equal(v('10 % 3'), 1);
  assert.equal(v('-2^2'), -4);
  assert.equal(calc.evaluate('2 e 3'), null);
  assert.equal(calc.evaluate('oi tudo bem'), null);
  assert.equal(calc.evaluate('process.exit(1)'), null);
  assert.equal(calc.evaluate('constructor.constructor("x")()'), null);
  assert.throws(() => calc.evaluate('1/0'), (e) => e.code === 'DIV0');
  assert.equal(calc.evaluate(`${'('.repeat(60)}1${')'.repeat(60)}`), null); // longa/funda demais
  assert.equal(calc.formatNumber(1234.5), '1.234,5');
});

test('conversões: só unidades fixas; moeda só com cotação configurada', () => {
  assert.equal(convert('10 km em milhas').text, '10 km = 6,2137 milhas');
  assert.equal(convert('100 f para c').text, '100 °F = 37,7778 °C');
  assert.equal(convert('30 graus em fahrenheit').text, '30 °C = 86 °F');
  assert.equal(convert('2 kg em libras').text, '2 kg = 4,4092 libras');
  assert.equal(convert('1 gb em mb').text, '1 gb = 1.024 mb');
  assert.match(convert('10 km em kg').text, /tipos diferentes/);
  assert.equal(convert('30 dólares em reais', { rates: null }).noRate, true);
  assert.match(convert('30 dolares em reais', { rates: { BRL: 1, USD: 5.4 } }).text, /162 BRL/);
  assert.equal(convert('quanto custa um carro'), null);
});

// ---------------- ferramentas instantâneas ----------------

test('ferramentas: hora, data, dado, moeda, sorteio, escolha, contagem e conta — sem IA', () => {
  const seq = [0.1, 0.7, 0.4, 0.99];
  let i = 0;
  const rng = () => seq[i++ % seq.length];
  const t = (q) => tools.tryLocalTool(q, { now: NOW, rng, pages, wiki });
  assert.equal(t('que horas são?').text, '🕐 Agora são 12:00 (horário de Brasília).');
  assert.match(t('que dia é hoje?').text, /segunda-feira, 2 de novembro de 2026/);
  assert.match(t('rola um d20').text, /^🎲 d20: \d+$/);
  assert.match(t('rola 3d6+2').text, /= \d+$/);
  assert.match(t('cara ou coroa').text, /^🪙 Deu (cara|coroa)!$/);
  assert.match(t('sorteia um número de 1 a 100').text, /Sorteei: \d+ \(de 1 a 100\)/);
  assert.match(t('escolhe entre pizza, hambúrguer ou sushi').text, /^🎯 Escolhi: (pizza|hambúrguer|sushi)$/);
  assert.equal(t('quanto falta pro natal?').text, '⏳ Faltam 53 dias para o Natal (25/12/2026).');
  assert.equal(t('quanto é 15% de 200?').text, '🧮 30');
  assert.equal(t('10 km em milhas').tool, 'convert');
  assert.equal(t('qual a capital da frança?'), null);
  assert.equal(t('me conta uma piada'), null);
});

test('ferramentas: FAQ da wiki só quando a seção ganha com folga (cita /wiki/slug)', () => {
  const faq = tools.tryLocalTool('como funciona o baú diário?', { now: NOW, pages, wiki });
  assert.equal(faq.tool, 'wiki');
  assert.match(faq.text, /Baú diário/);
  assert.match(faq.text, /\(veja \/wiki\/economia\)$/);
  assert.match(tools.tryLocalTool('o que é o Project Club?', { pages, wiki }).text, /comunidade brasileira.*\/wiki\/regras/);
  // Pergunta vaga não vira FAQ (vai pra IA com o trecho).
  assert.equal(tools.tryLocalTool('como ganho moedas', { pages, wiki }), null);
  assert.match(tools.helpText(), /desenhe/);
});

// ---------------- horário dos lembretes ----------------

test('lembretes: expressões de tempo em português', () => {
  const r = (q) => tp.parseReminderRequest(q, NOW);
  const when = (q) => tp.formatWhen(r(q).dueAt);
  assert.equal(when('me lembra em 20 min de tirar o bolo'), '02/11 às 12:20');
  assert.equal(r('me lembra em 20 min de tirar o bolo').text, 'tirar o bolo');
  assert.equal(when('me lembra de pagar a conta amanhã às 9h'), '03/11 às 09:00');
  assert.equal(r('me lembra de pagar a conta amanhã às 9h').text, 'pagar a conta');
  assert.equal(when('me lembre amanhã de manhã de ligar pra vó'), '03/11 às 09:00');
  assert.equal(when('lembrete: reunião sexta às 10h'), '06/11 às 10:00');
  assert.equal(r('lembrete: reunião sexta às 10h').text, 'reunião');
  assert.equal(when('me lembra daqui a 2 horas e 30 minutos de beber água'), '02/11 às 14:30');
  assert.equal(when('me lembra em meia hora'), '02/11 às 12:30');
  assert.equal(when('me lembra em uma hora e meia de sair'), '02/11 às 13:30');
  assert.equal(when('me lembra dia 15 às 14h do aniversário'), '15/11 às 14:00');
  assert.equal(when('me lembra 15/12 de comprar presente'), '15/12 às 09:00');
  assert.equal(when('me lembra às 18:30 de jogar'), '02/11 às 18:30');
  assert.equal(when('me lembra hoje à noite de estudar'), '02/11 às 20:00');
  assert.equal(when('me lembra segunda às 8h'), '09/11 às 08:00'); // hoje já passou das 8h
  assert.ok(r('me lembra de algo').error);
  assert.equal(r('qual a capital'), null);
  assert.equal(tp.formatIn(20 * 60000), 'daqui a 20 min');
});

test('lembretes: cria pelo serviço de lembretes (deps falsas) e recusa horário passado', async () => {
  const created = [];
  const deps = {
    now: () => NOW,
    validate: (v, now) => (v.dueAt.getTime() <= now ? { error: 'Escolha um horário no futuro.' } : { ok: true, ...v }),
    countActive: async () => 0,
    create: async (data) => { created.push(data); return data; },
  };
  const ok = await actions.createReminder({ userId: 'u1', question: 'me lembra em 20 min de tirar o bolo', link: '/canal/geral?m=1', messageId: 'm1' }, deps);
  assert.equal(ok.ok, true);
  assert.match(ok.text, /tirar o bolo.*02\/11 às 12:20.*daqui a 20 min/);
  assert.equal(created[0].userId, 'u1');
  assert.equal(created[0].link, '/canal/geral?m=1');
  const full = await actions.createReminder({ userId: 'u1', question: 'me lembra em 2h de x' }, { ...deps, countActive: async () => 50 });
  assert.equal(full.ok, false);
  const bad = await actions.createReminder({ userId: 'u1', question: 'me lembra de nada' }, deps);
  assert.equal(bad.ok, false);
});

// ---------------- cache e carona ----------------

test('cache: LRU com validade e versão (wiki/instruções mudaram → limpa)', () => {
  let t = 0;
  const c = createLru({ max: 2, ttlMs: 1000, now: () => t });
  c.setVersion('v1');
  c.set('a', 1); c.set('b', 2);
  assert.equal(c.get('a'), 1); // 'a' vira o mais recente
  c.set('c', 3); // sai o 'b'
  assert.equal(c.get('b'), null);
  t = 1500;
  assert.equal(c.get('a'), null); // venceu
  c.set('x', 9);
  c.setVersion('v1');
  assert.equal(c.get('x'), 9);
  c.setVersion('v2');
  assert.equal(c.get('x'), null);
  assert.equal(cacheKeyFor('Como funciona o baú, por favor?'), 'como funciona o bau');
  assert.equal(cacheKeyFor('que dia é hoje'), null); // depende da hora
  assert.equal(cacheKeyFor('e ele?'), null);
});

test('carona: pedidos iguais ao mesmo tempo geram UMA vez e todos recebem os parciais', async () => {
  const inf = createInflight();
  let calls = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const seenA = [];
  const seenB = [];
  const a = inf.run('k', async (emit) => { calls += 1; emit('Ol'); await gate; emit('Olá!'); return 'Olá!'; }, (t) => seenA.push(t));
  const b = inf.run('k', async () => { calls += 1; return 'outro'; }, (t) => seenB.push(t));
  assert.equal(b.shared, true);
  await new Promise((r) => setImmediate(r));
  release();
  assert.deepEqual(await Promise.all([a.promise, b.promise]), ['Olá!', 'Olá!']);
  assert.equal(calls, 1);
  assert.deepEqual(seenA, ['Ol', 'Olá!']);
  assert.deepEqual(seenB, ['Ol', 'Olá!']); // o carona recebe o que já tinha saído
  assert.equal(inf.has('k'), false);
});

// ---------------- streaming ----------------

function fakeClock() {
  let t = 0;
  const timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { const h = { at: t + ms, fn, done: false }; timers.push(h); return h; },
    clearTimer: (h) => { if (h) h.done = true; },
    advance(ms) {
      t += ms;
      for (const h of timers.filter((x) => !x.done && x.at <= t).sort((x, y) => x.at - y.at)) { h.done = true; h.fn(); }
    },
  };
}

test('streaming: acelerador publica no máximo a cada ~500 ms e sempre o texto mais novo', () => {
  const clock = fakeClock();
  const sent = [];
  const th = createThrottle({ intervalMs: 500, firstMs: 150, publish: (t) => sent.push([clock.now(), t]), ...clock });
  th.push('O');
  th.push('Ol');
  clock.advance(149);
  assert.equal(sent.length, 0);
  clock.advance(1);
  assert.deepEqual(sent, [[150, 'Ol']]);
  th.push('Olá'); th.push('Olá, tu');
  clock.advance(300);
  assert.equal(sent.length, 1); // ainda dentro dos 500 ms
  clock.advance(200);
  assert.deepEqual(sent.at(-1), [650, 'Olá, tu']);
  th.push('Olá, tudo bem?');
  th.finish(); // versão final é gravada por quem chamou
  clock.advance(1000);
  assert.equal(sent.length, 2);
  assert.equal(th.published, 2);
});

test('streaming: lê NDJSON do Ollama mesmo com linha quebrada no meio', async () => {
  const enc = new TextEncoder();
  async function* body() {
    yield enc.encode('{"message":{"content":"Oi"},"done":false}\n{"message":{"con');
    yield enc.encode('tent":", tudo"},"done":false}\n');
    yield enc.encode('{"message":{"content":" bem?"},"done":true,"done_reason":"stop","eval_count":5,"eval_duration":500000000}');
  }
  const parts = [];
  const r = await readNdjson(body(), (p, all) => parts.push(all));
  assert.equal(r.text, 'Oi, tudo bem?');
  assert.equal(r.doneReason, 'stop');
  assert.equal(r.stats.evalTokens, 5);
  assert.deepEqual(parts, ['Oi', 'Oi, tudo', 'Oi, tudo bem?']);
  async function* cut() { yield '{"message":{"content":"meia resposta"},"done":false}\n'; }
  await assert.rejects(readNdjson(cut()), (e) => e.code === 'STREAM_CUT' && e.partial === 'meia resposta');
});

// ---------------- imagens: validação e provedor ----------------

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

test('imagem: bytes mágicos e limite de 4 MB', () => {
  assert.equal(image.sniffImage(PNG).mime, 'image/png');
  assert.equal(image.sniffImage(JPG).ext, '.jpg');
  assert.equal(image.sniffImage(Buffer.from('RIFF0000WEBPVP8 ')).mime, 'image/webp');
  assert.equal(image.sniffImage(Buffer.from('GIF89a000000')).mime, 'image/gif');
  assert.equal(image.sniffImage(Buffer.from('<html>not an image</html>')), null);
  assert.throws(() => image.validateImage(Buffer.from('<html>oops</html>')), (e) => e.code === 'NOT_IMAGE');
  assert.throws(() => image.validateImage(Buffer.alloc(0)), (e) => e.code === 'EMPTY');
  const big = Buffer.concat([PNG, Buffer.alloc(image.MAX_BYTES)]);
  assert.throws(() => image.validateImage(big), (e) => e.code === 'TOO_BIG');
});

function fakeResponse(buf, { status = 200, type = 'image/png', length = null } = {}) {
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? type : h.toLowerCase() === 'content-length' ? (length ?? String(buf.length)) : null) },
    body: (async function* gen() { yield buf; }()),
    json: async () => JSON.parse(buf.toString()),
  };
}

test('imagem: escolha do provedor pelo ambiente', () => {
  assert.equal(image.providerName({}), 'pollinations');
  assert.equal(image.providerName({ PINGU_IMAGE_PROVIDER: 'off' }), 'off');
  assert.equal(image.providerName({ PINGU_IMAGE_PROVIDER: 'local' }), 'off'); // sem URL
  assert.equal(image.providerName({ PINGU_IMAGE_PROVIDER: 'local', PINGU_IMAGE_URL: 'http://sd:7860/gen' }), 'local');
});

test('imagem: Pollinations recebe tamanho, semente, flux, safe e private (fetch falso)', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return fakeResponse(PNG); };
  const r = await image.fetchImage({ prompt: 'a penguin, high quality', width: 768, height: 768, seed: 42 }, { provider: 'pollinations', fetchImpl, env: {} });
  assert.equal(r.mime, 'image/png');
  const u = new URL(calls[0].url);
  assert.equal(u.origin, 'https://image.pollinations.ai');
  assert.equal(decodeURIComponent(u.pathname), '/prompt/a penguin, high quality');
  for (const [k, v] of [['width', '768'], ['height', '768'], ['seed', '42'], ['model', 'flux'], ['nologo', 'true'], ['safe', 'true'], ['private', 'true']]) assert.equal(u.searchParams.get(k), v);
  // Resposta que não é imagem / grande demais / HTTP ruim.
  await assert.rejects(image.fetchImage({ prompt: 'x', width: 1, height: 1, seed: 1 }, { provider: 'pollinations', fetchImpl: async () => fakeResponse(Buffer.from('<html>'), { type: 'text/html' }), env: {} }), (e) => e.code === 'NOT_IMAGE');
  await assert.rejects(image.fetchImage({ prompt: 'x', width: 1, height: 1, seed: 1 }, { provider: 'pollinations', fetchImpl: async () => fakeResponse(PNG, { length: String(10 * 1024 * 1024) }), env: {} }), (e) => e.code === 'TOO_BIG');
  await assert.rejects(image.fetchImage({ prompt: 'x', width: 1, height: 1, seed: 1 }, { provider: 'pollinations', fetchImpl: async () => fakeResponse(PNG, { status: 502 }), env: {} }), (e) => e.code === 'HTTP');
  await assert.rejects(image.fetchImage({ prompt: 'x', width: 1, height: 1, seed: 1 }, { provider: 'off', fetchImpl, env: {} }), (e) => e.code === 'OFF');
});

test('imagem: provedor local faz POST JSON com chave e aceita base64 em JSON; tempo esgotado vira TIMEOUT', async () => {
  const calls = [];
  const env = { PINGU_IMAGE_URL: 'http://sd.local/txt2img', PINGU_IMAGE_KEY: 'segredo' };
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return fakeResponse(PNG); };
  await image.fetchImage({ prompt: 'p', width: 576, height: 1024, seed: 7 }, { provider: 'local', fetchImpl, env });
  assert.equal(calls[0].url, 'http://sd.local/txt2img');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer segredo');
  const body = JSON.parse(calls[0].opts.body);
  assert.deepEqual({ prompt: body.prompt, width: body.width, height: body.height, seed: body.seed }, { prompt: 'p', width: 576, height: 1024, seed: 7 });
  assert.match(body.negative_prompt, /nsfw/);
  const jsonRes = fakeResponse(Buffer.from(JSON.stringify({ images: [PNG.toString('base64')] })), { type: 'application/json' });
  assert.equal((await image.fetchImage({ prompt: 'p', width: 1, height: 1, seed: 1 }, { provider: 'local', fetchImpl: async () => jsonRes, env })).mime, 'image/png');
  const hang = (url, opts) => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new Error('abortado'))));
  // O timer do tempo limite não segura o processo (unref): mantém o teste vivo.
  const keepAlive = setInterval(() => {}, 5);
  try {
    await assert.rejects(image.fetchImage({ prompt: 'p', width: 1, height: 1, seed: 1 }, { provider: 'local', fetchImpl: hang, env, timeoutMs: 20 }), (e) => e.code === 'TIMEOUT');
  } finally { clearInterval(keepAlive); }
});

test('imagem: tradução local PT→EN com etiquetas de qualidade', () => {
  const r = image.localEnhance('um pinguim astronauta no espaço');
  assert.match(r.prompt, /penguin astronaut in the space, high quality/);
  assert.ok(r.unknownRatio < 0.34);
  assert.ok(image.localEnhance('um ornitorrinco tocando berimbau').unknownRatio > 0.34);
});

// ---------------- imagens: fluxo com dependências falsas ----------------

function fakeImages(overrides = {}) {
  let clock = NOW;
  const calls = { replies: [], placeholders: [], updates: [], finished: [], fails: [], removed: [], logs: [], fetches: 0 };
  const gates = [];
  const deps = {
    getConfig: () => ({ imageEnabled: true, imageDailyLimit: 2, imageCooldownSec: 30, imageConcurrency: 1 }),
    provider: () => 'pollinations',
    fetchImage: async (req) => {
      calls.fetches += 1;
      if (overrides.gate) await new Promise((r) => gates.push(r));
      return { buffer: PNG, mime: 'image/png', ext: '.png', req };
    },
    enhance: async (p) => image.localEnhance(p).prompt,
    tierOf: async () => 'NONE',
    countToday: async () => 0,
    store: async ({ name }) => ({ url: `/media/${name}`, storageKey: name }),
    createLog: async (data) => { calls.logs.push({ ...data }); return { id: `log${calls.logs.length}` }; },
    updateLog: async (id, data) => { calls.logs.push({ id, ...data }); },
    ui: {
      placeholder: async (target, text) => { const m = { id: `pm${calls.placeholders.length + 1}`, text }; calls.placeholders.push(m); return m; },
      update: async (m, text) => { calls.updates.push([m.id, text]); },
      finish: async (m, att) => { calls.finished.push([m.id, att]); },
      fail: async (m, text) => { calls.fails.push([m.id, text]); },
      reply: async (target, text) => { calls.replies.push(text); },
      remove: async (m) => { calls.removed.push(m.id); },
    },
    now: () => clock,
    rng: () => 0.5,
    ...overrides.deps,
  };
  return { svc: image.createImageService(deps), calls, tick: (ms) => { clock += ms; }, gates };
}
const flush = () => new Promise((r) => setImmediate(r));

test('imagens: pedido ok vira a imagem guardada com a descrição, e fica registrado', async () => {
  const { svc, calls } = fakeImages();
  const r = await svc.request({ userId: 'u1', target: { channelId: 'c1' }, prompt: 'um pinguim pirata', size: 'paisagem', sourceMessageId: 'src1' });
  assert.equal(r.status, 'queued');
  for (let i = 0; i < 5; i += 1) await flush(); // eslint-disable-line no-await-in-loop
  assert.equal(calls.placeholders[0].text, '🎨 Criando sua imagem…');
  assert.equal(calls.finished.length, 1);
  const [, att] = calls.finished[0];
  assert.equal(att.caption, '🎨 "um pinguim pirata"');
  assert.match(att.url, /^\/media\/pingu-log1\.png$/);
  assert.equal(att.req === undefined, true);
  const done = calls.logs.find((l) => l.status === 'DONE');
  assert.ok(done && done.url && done.finalPrompt.includes('penguin'));
  assert.equal(calls.logs[0].width, 1024); // paisagem
});

test('imagens: filtro recusa e registra BLOCKED; intervalo de 30 s e limite por dia (apoiador tem mais)', async () => {
  const { svc, calls, tick } = fakeImages();
  assert.equal((await svc.request({ userId: 'u1', target: {}, prompt: 'mulher nua' })).status, 'blocked');
  assert.equal(calls.logs[0].status, 'BLOCKED');
  assert.equal((await svc.request({ userId: 'u1', target: {}, prompt: 'gato' })).status, 'queued');
  const cd = await svc.request({ userId: 'u1', target: {}, prompt: 'cachorro' });
  assert.equal(cd.status, 'cooldown');
  assert.match(calls.replies.at(-1), /30 s/);
  tick(31_000);
  assert.equal((await svc.request({ userId: 'u1', target: {}, prompt: 'cachorro' })).status, 'queued');

  const used = fakeImages({ deps: { countToday: async () => 2 } });
  assert.equal((await used.svc.request({ userId: 'u2', target: {}, prompt: 'gato' })).status, 'daily');
  const sup = fakeImages({ deps: { countToday: async () => 2, tierOf: async () => 'SUBSCRIBER' } });
  assert.equal((await sup.svc.request({ userId: 'u3', target: {}, prompt: 'gato' })).status, 'queued');
  assert.equal(sup.svc.dailyLimitFor('SUPER'), 6);
  const off = fakeImages({ deps: { provider: () => 'off' } });
  assert.equal((await off.svc.request({ userId: 'u4', target: {}, prompt: 'gato' })).status, 'off');
});

test('imagens: uma por vez com posição na fila; apagar o pedido cancela; "de novo" usa nova semente', async () => {
  const { svc, calls, gates } = fakeImages({ gate: true });
  await svc.request({ userId: 'a', target: {}, prompt: 'gato', sourceMessageId: 's1' });
  const second = await svc.request({ userId: 'b', target: {}, prompt: 'cachorro', sourceMessageId: 's2' });
  const third = await svc.request({ userId: 'c', target: {}, prompt: 'pato', sourceMessageId: 's3' });
  assert.equal(second.position, 1);
  assert.equal(third.position, 2);
  assert.match(calls.placeholders[1].text, /posição 1/);
  await flush();
  assert.equal(svc.status().running, 1);
  assert.equal(svc.status().pending, 2);
  assert.equal(await svc.cancelBySource('s2'), true); // na fila: sai e some
  assert.deepEqual(calls.removed, ['pm2']);
  gates.shift()();
  for (let i = 0; i < 6; i += 1) await flush(); // eslint-disable-line no-await-in-loop
  assert.equal(calls.finished.length, 1);
  assert.ok(calls.updates.some(([id, t]) => id === 'pm3' && /posição 1|Criando/.test(t)));
  gates.shift()();
  for (let i = 0; i < 6; i += 1) await flush(); // eslint-disable-line no-await-in-loop
  assert.equal(calls.finished.length, 2);
  assert.equal(calls.fetches, 2);
  // "de novo": mesmo pedido, outra semente.
  const rr = fakeImages();
  let n = 0;
  const seeds = [];
  rr.svc._state.lastReq.set('a', { prompt: 'dragão azul', size: 'retrato', at: NOW });
  const svc2 = image.createImageService({
    ...rr.calls && {},
    getConfig: () => ({ imageEnabled: true, imageDailyLimit: 10, imageCooldownSec: 0, imageConcurrency: 1 }),
    provider: () => 'pollinations',
    fetchImage: async (req) => { seeds.push(req.seed); return { buffer: PNG, mime: 'image/png', ext: '.png' }; },
    enhance: async (p) => p, tierOf: async () => 'NONE', countToday: async () => 0,
    store: async () => ({ url: '/media/x.png', storageKey: 'x.png' }), createLog: async () => ({ id: 'l' }), updateLog: async () => {},
    ui: { placeholder: async () => ({ id: 'p' }), update: async () => {}, finish: async () => {}, fail: async () => {}, reply: async () => {}, remove: async () => {} },
    now: () => NOW, rng: () => [0.1, 0.9][n++ % 2],
  });
  assert.equal(svc2.hasRecent('z'), false);
  assert.equal((await svc2.request({ userId: 'z', target: {}, reroll: true })).status, 'noprev');
  await svc2.request({ userId: 'z', target: {}, prompt: 'dragão azul' });
  await svc2.request({ userId: 'z', target: {}, reroll: true });
  for (let i = 0; i < 8; i += 1) await flush(); // eslint-disable-line no-await-in-loop
  assert.equal(seeds.length, 2);
  assert.notEqual(seeds[0], seeds[1]);
});

// ---------------- prompt e memória ----------------

test('prompt: system prompt idêntico entre pedidos; contexto e data vão no fim', () => {
  const sys = prompt.systemPrompt({ name: 'Pingu', instructions: 'Baú todo dia.' });
  assert.equal(sys, prompt.systemPrompt({ name: 'Pingu', instructions: 'Baú todo dia.' }));
  assert.doesNotMatch(sys, /\d{2}\/\d{2}\/\d{4}/); // sem data no prefixo
  const turn = prompt.buildUserTurn({ question: 'que dia é amanhã?', normalized: 'que dia e amanha', wiki: { text: 'X (veja /wiki/x)' }, now: NOW });
  assert.match(turn, /^\[Wiki do Project Club\]/);
  assert.match(turn, /\[Agora: segunda, 02\/11\/2026, 12:00 \(Brasília\)\]/);
  assert.match(turn, /que dia é amanhã\?$/);
  assert.equal(prompt.buildUserTurn({ question: 'oi', normalized: 'oi' }), 'oi');
  assert.match(prompt.buildUserTurn({ question: 'melhora', task: 'rewrite', reply: { author: 'Ana', content: 'oi gente tudo bom' }, normalized: 'melhora' }), /Mensagem de Ana[\s\S]*Responda só com o texto reescrito/);
  // Orçamento por tipo e temperatura: 0,3 pra fatos, 0,7 pra criativo.
  assert.equal(prompt.budgetFor('question', 'oi').temperature, 0.3);
  assert.equal(prompt.budgetFor('question', 'me conta uma piada').temperature, 0.7);
  assert.ok(prompt.budgetFor('rewrite', 'x'.repeat(2000)).numPredict <= 360);
  const msgs = prompt.buildMessages({ system: sys, memory: [{ q: 'qual o maior planeta?', a: 'Júpiter.' }], userTurn: 'e o menor?' });
  assert.deepEqual(msgs.map((m) => m.role), ['system', 'user', 'assistant', 'user']);
});

test('memória curta: 2 últimas trocas por pessoa+sala, somem em 10 min', () => {
  let t = 0;
  const m = createMemory({ now: () => t });
  m.remember('u', 'c1', 'q1', 'a1');
  m.remember('u', 'c1', 'q2', 'a2');
  m.remember('u', 'c1', 'q3', 'a3');
  assert.deepEqual(m.recall('u', 'c1').map((x) => x.q), ['q2', 'q3']);
  assert.deepEqual(m.recall('u', 'c2'), []);
  assert.deepEqual(m.recall('outra', 'c1'), []);
  t = 11 * 60 * 1000;
  assert.deepEqual(m.recall('u', 'c1'), []);
  assert.equal(isFollowUp('e o outro'), true);
  assert.equal(isFollowUp('qual e a melhor forma de ganhar moedas jogando no servidor de minecraft'), false);
});

// ---------------- pinguBot: resposta ao vivo (banco e socket de mentira) ----------------

function fakeWorld() {
  const emits = [];
  const rows = new Map();
  let n = 0;
  const io = { to: (room) => ({ emit: (ev, payload) => emits.push({ room, ev, payload }) }), notifyUser: (uid, ev, payload) => emits.push({ room: `user:${uid}`, ev, payload }) };
  const db = {
    message: {
      create: async ({ data }) => { n += 1; const m = { id: `pm${n}`, deleted: false, attachments: [], ...data }; rows.set(m.id, m); return { ...m }; },
      updateMany: async ({ where, data }) => {
        const m = rows.get(where.id);
        if (!m || (where.deleted === false && m.deleted)) return { count: 0 };
        Object.assign(m, data);
        return { count: 1 };
      },
      findUnique: async ({ where }) => (rows.has(where.id) ? { ...rows.get(where.id) } : null),
    },
    reaction: { create: async () => ({}) },
  };
  return { io, db, emits, rows };
}

function setupBot(world) {
  bot._test.reset();
  bot._test.setIo(world.io);
  bot._test.setDeps({ db: world.db, include: {} });
  bot._test.setPinguId('pingu');
  bot._test.setEnabled(true);
  bot._test.setOnline(true);
}
function teardownBot() {
  bot._test.setStream(null);
  bot._test.setChat(null);
  bot._test.setDeps({});
  bot._test.setIo(null);
  bot._test.setEnabled(false);
  bot._test.setOnline(false);
  bot._test.reset();
}
const ask = (id, content, extra = {}) => ({
  message: { id, channelId: 'c1', authorId: extra.authorId || `u-${id}`, content: `@pingu ${content}`, author: { displayName: 'Ana' }, replyTo: null, ...extra.message },
  channel: { id: 'c1', name: 'geral' }, isDm: false, roomId: 'c:c1:', target: { channelId: 'c1', replyToId: id },
});
const waitFor = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10)); // eslint-disable-line no-await-in-loop
  }
  throw new Error('demorou demais');
};

test('pingu ao vivo: posta "digitando…" na hora, atualiza aos poucos e grava a resposta limpa', async (t) => {
  const world = fakeWorld();
  setupBot(world);
  t.after(teardownBot);
  const bodies = [];
  bot._test.setStream(async (body, { onDelta }) => {
    bodies.push(body);
    let text = '';
    for (const piece of ['O baú ', 'diário dá ', 'moedas **todo** dia @everyone.']) {
      text += piece;
      onDelta(piece, text);
      await new Promise((r) => setTimeout(r, 260)); // eslint-disable-line no-await-in-loop
    }
    return { text, doneReason: 'stop' };
  });
  await bot._test.handleIncoming(ask('m1', 'como funciona o bau e as moedas por favor me explica tudo'));
  await waitFor(() => world.emits.some((e) => e.ev === 'message:new'));
  const first = world.emits.find((e) => e.ev === 'message:new');
  assert.equal(first.payload.content, '🐧 digitando…');
  assert.equal(first.payload.pinguStreaming, true);
  assert.equal(first.payload.replyToId, 'm1');
  await waitFor(() => world.rows.get('pm1')?.content !== '🐧 digitando…');
  const partials = world.emits.filter((e) => e.ev === 'message:update' && e.payload.pinguStreaming);
  assert.ok(partials.length >= 1 && partials.length <= 4, `parciais: ${partials.length}`);
  assert.equal(world.rows.get('pm1').content, 'O baú diário dá moedas todo dia @​everyone.');
  assert.equal(world.emits.at(-1).ev, 'message:update');
  assert.equal(world.emits.at(-1).payload.pinguStreaming, undefined);
  // Prefixo fixo, contexto no fim, opções que não recarregam o modelo.
  assert.equal(bodies[0].messages[0].content, bot._test.systemPrompt());
  assert.equal(bodies[0].stream, true);
  assert.equal(bodies[0].options.num_ctx, 1024);
  assert.equal(bodies[0].options.num_thread, 2);
  assert.equal(bodies[0].options.temperature, 0.3);
});

test('pingu ao vivo: pergunta repetida sai do cache; iguais ao mesmo tempo geram uma vez só', async (t) => {
  const world = fakeWorld();
  setupBot(world);
  t.after(teardownBot);
  let calls = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  bot._test.setStream(async (body, { onDelta }) => { calls += 1; await gate; onDelta('Júpiter.', 'Júpiter.'); return { text: 'Júpiter.', doneReason: 'stop' }; });
  const a = bot._test.handleIncoming(ask('a1', 'qual o maior planeta do sistema solar'));
  const b = bot._test.handleIncoming(ask('b1', 'Qual o maior planeta do sistema solar?'));
  await Promise.all([a, b]);
  await new Promise((r) => setTimeout(r, 20));
  release();
  await waitFor(() => [...world.rows.values()].filter((m) => m.content === 'Júpiter.').length === 2);
  assert.equal(calls, 1);
  assert.ok(bot._test.perf.sharedHits >= 1);
  await bot._test.handleIncoming(ask('c1x', 'qual o maior planeta do sistema solar?!'));
  await waitFor(() => [...world.rows.values()].filter((m) => m.content === 'Júpiter.').length === 3);
  assert.equal(calls, 1); // veio do cache
  assert.ok(bot._test.perf.cacheHits >= 1);
});

test('pingu ao vivo: apagar a pergunta cancela a geração e some com o "digitando…"', async (t) => {
  const world = fakeWorld();
  setupBot(world);
  t.after(teardownBot);
  let aborted = false;
  bot._test.setStream((body, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(new Error('abortado')); });
  }));
  await bot._test.handleIncoming(ask('d1', 'me conta a história do universo inteiro'));
  await waitFor(() => world.rows.has('pm1'));
  await new Promise((r) => setTimeout(r, 20));
  bot.onMessageDeleted('d1');
  await waitFor(() => aborted && world.emits.some((e) => e.ev === 'message:delete' && e.payload.id === 'pm1'));
  assert.equal(world.rows.get('pm1').deleted, true);
});

test('pingu ao vivo: streaming quebrado cai pro modo normal; contas e hora não usam a IA', async (t) => {
  const world = fakeWorld();
  setupBot(world);
  t.after(teardownBot);
  let normal = 0;
  bot._test.setStream(async () => { throw Object.assign(new Error('proxy sem streaming'), { code: 'STREAM_UNSUPPORTED' }); });
  bot._test.setChat(async (body) => { normal += 1; assert.equal(body.stream, false); return { message: { content: 'Resposta sem streaming.' }, done_reason: 'stop' }; });
  await bot._test.handleIncoming(ask('e1', 'por que o céu é azul de dia'));
  await waitFor(() => world.rows.get('pm1')?.content === 'Resposta sem streaming.');
  assert.equal(normal, 1);
  await bot._test.handleIncoming(ask('e2', 'quanto é 12 vezes 12', { authorId: 'calc-user' }));
  await waitFor(() => [...world.rows.values()].some((m) => m.content === '🧮 144'));
  assert.equal(normal, 1); // a conta não passou pela IA
});

test('pingu na DM: responde sem cache compartilhado e sem moderação; imagem só em canal', async (t) => {
  const world = fakeWorld();
  setupBot(world);
  t.after(teardownBot);
  bot._test.setStream(async (body, { onDelta }) => { onDelta('Oi!', 'Oi!'); return { text: 'Oi! Tudo certo?', doneReason: 'stop' }; });
  const dm = { message: { id: 'dm1', conversationId: 'conv1', authorId: 'u9', content: 'qual o maior planeta', replyTo: null }, isDm: true, conversationId: 'conv1', roomId: 'd:conv1', target: { conversationId: 'conv1', replyToId: 'dm1' } };
  await bot._test.handleIncoming(dm);
  await waitFor(() => [...world.rows.values()].some((m) => m.content === 'Oi! Tudo certo?'));
  const posted = [...world.rows.values()][0];
  assert.equal(posted.conversationId, 'conv1');
  assert.equal(posted.channelId, null);
  assert.equal(bot._test.cache.size, 0); // DM nunca vai pro cache
  assert.ok(world.emits.every((e) => !String(e.room).startsWith('channel:')));
  await bot._test.handleIncoming({ ...dm, message: { ...dm.message, id: 'dm2', content: 'desenhe um gato' }, target: { conversationId: 'conv1', replyToId: 'dm2' } });
  await waitFor(() => [...world.rows.values()].some((m) => /só nos canais/.test(m.content || '')));
});
