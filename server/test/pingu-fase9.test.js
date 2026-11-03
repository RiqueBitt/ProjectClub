// Fase 9 — Pingu: wiki (busca de trechos), resumo, tradução, quiz,
// boas-vindas, moderação assistida e a fila única da IA. Tudo com dados
// falsos: nada de banco, Redis ou Ollama de verdade.
const test = require('node:test');
const assert = require('node:assert');

const wiki = require('../src/services/pingu/wiki');
const { WIKI_SEED } = require('../src/data/wikiSeed');
const summary = require('../src/services/pingu/summary');
const translate = require('../src/services/pingu/translate');
const quiz = require('../src/services/pingu/quiz');
const welcome = require('../src/services/pingu/welcome');
const mod = require('../src/services/pingu/modAssist');
const pcfg = require('../src/services/pingu/config');
const { createLimiter, normalize } = require('../src/services/pingu/text');
const bot = require('../src/services/pinguBot');

const pages = WIKI_SEED.map((p) => ({ ...p, body: p.body.trim() }));

// ---------------- wiki ----------------

test('wiki: pergunta sobre baú diário acha a página da economia', () => {
  const ranked = wiki.scoreSections('como funciona o baú diário?', pages);
  assert.ok(ranked.length > 0);
  assert.equal(ranked[0].slug, 'economia');
  assert.match(ranked[0].heading, /Baú diário/);
});

test('wiki: pergunta sobre sala de voz temporária acha canais de voz (sem acento também)', () => {
  const ranked = wiki.scoreSections('como criar sala temporaria de voz', pages);
  assert.equal(ranked[0].slug, 'canais-de-voz');
});

test('wiki: contexto tem no máximo 600 caracteres de trecho e cita /wiki/slug', () => {
  const ctx = wiki.buildWikiContext('quais são as regras sobre spam e flood?', pages);
  assert.ok(ctx);
  assert.ok(ctx.slugs.includes('regras'));
  assert.match(ctx.text, /\(veja \/wiki\/regras\)/);
  // Tira os rótulos/citações e confere o tamanho dos trechos.
  const excerpts = ctx.text.split('\n').map((l) => l.replace(/^[^:]+: /, '').replace(/ \(veja \/wiki\/[a-z0-9-]+\)$/, ''));
  assert.ok(excerpts.reduce((n, e) => n + e.length, 0) <= 600);
  assert.ok(ctx.text.split('\n').length <= 2);
});

test('wiki: pergunta sem nada a ver não traz trecho', () => {
  assert.equal(wiki.buildWikiContext('xyzzy qwerty', pages), null);
  assert.equal(wiki.buildWikiContext('', pages), null);
  assert.equal(wiki.buildWikiContext('oi', []), null);
});

test('wiki: trecho longo é cortado sem quebrar palavra e começa no assunto', () => {
  const text = `${'Texto de introdução sem nada. '.repeat(30)}O baú diário dá moedas todo dia. ${'Mais texto. '.repeat(80)}`;
  const ex = wiki.excerpt(text, 'baú diário', 200);
  assert.ok(ex.length <= 200);
  assert.ok(ex.startsWith('O baú diário'));
  assert.ok(ex.endsWith('…'));
});

test('wiki: seções saem dos títulos markdown e busca da lista funciona', () => {
  const secs = wiki.splitSections(pages.find((p) => p.slug === 'pingu'));
  assert.ok(secs.some((s) => s.heading === 'Tradução'));
  assert.equal(wiki.searchPages('apps', pages)[0].slug, 'apps');
  assert.equal(wiki.slugify('Canais de Voz!'), 'canais-de-voz');
});

test('pingu: o trecho da wiki entra nas instruções da pergunta', () => {
  const chat = bot._test.buildChat({ question: 'baú?', wiki: { text: 'Economia: abre um baú por dia (veja /wiki/economia)' } });
  assert.match(chat[0].content, /veja \/wiki\/economia/);
  assert.equal(chat.at(-1).content, 'baú?');
});

// ---------------- resumo ----------------

const msg = (i, extra = {}) => ({
  id: `m${i}`, authorId: `u${i % 3}`, author: { displayName: `Pessoa ${i % 3}` },
  content: `mensagem número ${i}`, createdAt: new Date(2026, 0, 1, 0, 0, i), ...extra,
});

test('resumo: linhas "nome: texto" em ordem e sem as mensagens do Pingu', () => {
  const t = summary.buildTranscript([msg(2), msg(1), msg(3, { authorId: 'pingu', author: { displayName: 'Pingu' } })], { skipAuthorId: 'pingu' });
  assert.equal(t.count, 2);
  assert.deepEqual(t.lines, ['Pessoa 1: mensagem número 1', 'Pessoa 2: mensagem número 2']);
});

test('resumo: no máximo 60 mensagens e ~1500 caracteres, ficando as mais recentes', () => {
  const many = Array.from({ length: 200 }, (_, i) => msg(i, { content: `texto comprido ${'x'.repeat(40)} ${i}` }));
  const t = summary.buildTranscript(many);
  assert.ok(t.count <= 60);
  assert.ok(t.text.length <= 1500);
  assert.match(t.lines.at(-1), / 199$/);
});

test('resumo: links, anexos, figurinhas e quebras de linha ficam compactos', () => {
  const t = summary.buildTranscript([
    msg(1, { content: 'olha https://exemplo.com/abc\n\nque legal' }),
    msg(2, { content: '', attachmentCount: 1 }),
    msg(3, { content: null, stickerUrl: 'x' }),
    msg(4, { content: 'apagada', deleted: true }),
    msg(5, { content: 'y'.repeat(500) }),
  ]);
  assert.equal(t.lines[0], 'Pessoa 1: olha [link] que legal');
  assert.equal(t.lines[1], 'Pessoa 2: [anexo]');
  assert.equal(t.lines[2], 'Pessoa 0: [figurinha]');
  assert.equal(t.count, 4);
  assert.ok(t.lines[3].length <= 'Pessoa 2: '.length + 160);
});

test('resumo: resposta vira 3–5 tópicos "• " sem markdown nem @todos', () => {
  const out = summary.cleanBullets('Resumo:\n- **Fulano** falou do quiz\n2. Ciclano avisou @everyone\n* a\n* b\n* c\n* d');
  const lines = out.split('\n');
  assert.ok(lines.length <= 5);
  assert.ok(lines.every((l) => l.startsWith('• ')));
  assert.ok(!/\*\*/.test(out));
  assert.ok(!/@everyone\b/.test(out));
});

// ---------------- tradução ----------------

test('tradução: português vai pro idioma da pessoa (ou inglês); o resto vai pra pt-BR', () => {
  assert.equal(translate.pickTarget('Hello, how are you doing today?', 'pt-BR'), 'pt-BR');
  assert.equal(translate.pickTarget('Oi gente, tudo bem com vocês?', 'pt-BR'), 'en');
  assert.equal(translate.pickTarget('Oi gente, tudo bem com vocês?', 'es-ES'), 'es');
  assert.equal(translate.normalizeLang('pt'), 'pt-BR');
  assert.equal(translate.normalizeLang('klingon'), null);
});

test('tradução: cache por mensagem + idioma + conteúdo', () => {
  translate._test.clear();
  const k = translate._test.keyFor('m1', 'en', 'oi');
  translate._test.cacheSet(k, 'hi');
  assert.equal(translate.cached({ id: 'm1', content: 'oi' }, 'en'), 'hi');
  assert.equal(translate.cached({ id: 'm1', content: 'oi editado' }, 'en'), null);
  assert.equal(translate.cached({ id: 'm1', content: 'oi' }, 'es'), null);
});

// ---------------- quiz ----------------

test('quiz: resposta sem acento, maiúscula ou "acho que é" vale', () => {
  assert.equal(quiz.isCorrect('brasilia', ['Brasília']), true);
  assert.equal(quiz.isCorrect('Acho que é BRASÍLIA!', ['Brasília']), true);
  assert.equal(quiz.isCorrect('cinco', ['5', 'cinco']), true);
  assert.equal(quiz.isCorrect('Pacifico', JSON.stringify(['Pacífico', 'Oceano Pacífico'])), true);
  assert.equal(quiz.isCorrect('obsidiama', ['Obsidiana']), true); // um errinho
});

test('quiz: resposta errada, chute múltiplo ou número diferente não vale', () => {
  assert.equal(quiz.isCorrect('rio de janeiro', ['Brasília']), false);
  assert.equal(quiz.isCorrect('3 ou 5', ['5']), false);
  assert.equal(quiz.isCorrect('6', ['5']), false);
  assert.equal(quiz.isCorrect('', ['5']), false);
  assert.equal(quiz.isCorrect('marte jupiter venus', ['Marte']), false);
});

test('quiz: sugestão da IA no formato PERGUNTA/RESPOSTA', () => {
  assert.deepEqual(quiz.parseGenerated('PERGUNTA: Qual a cor do céu?\nRESPOSTA: Azul | azul claro'), { question: 'Qual a cor do céu?', answers: ['Azul', 'azul claro'] });
  assert.equal(quiz.parseGenerated('blá blá'), null);
});

function fakeQuiz(overrides = {}) {
  const calls = { award: [], posts: [], claims: 0 };
  let winner = null;
  let clock = 1_000_000;
  const timers = [];
  const deps = {
    getConfig: () => ({ ...pcfg.DEFAULTS, quizWindowSec: 60, quizCoins: 20, quizXp: 30 }),
    pickQuestion: async () => ({ id: 'q1', question: 'Qual é a capital do Brasil?', answers: '["Brasília"]' }),
    createRound: async (data) => ({ id: 'r1', ...data }),
    // Igual ao updateMany do banco: só o primeiro grava.
    claimRound: async () => { calls.claims += 1; await new Promise((r) => setImmediate(r)); if (winner) return false; winner = true; return true; },
    award: async (...a) => { calls.award.push(a); },
    economyOff: async () => false,
    post: async (channelId, text, opts) => { calls.posts.push({ channelId, text, opts }); return {}; },
    botId: () => 'pingu',
    now: () => clock,
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => {},
    ...overrides,
  };
  return { engine: quiz.createQuiz(deps), calls, tick: (ms) => { clock += ms; }, timers };
}

const answer = (authorId, content, extra = {}) => ({ id: `${authorId}-${content}`, channelId: 'c1', authorId, content, author: { username: authorId }, ...extra });

test('quiz: o primeiro acerto ganha uma vez só (mesmo com dois ao mesmo tempo)', async () => {
  const { engine, calls } = fakeQuiz();
  await engine.startRound(null, { channelId: 'c1' });
  assert.match(calls.posts[0].text, /Qual é a capital do Brasil\?/);
  const [a, b] = await Promise.all([engine.onMessage(null, answer('ana', 'brasilia')), engine.onMessage(null, answer('bia', 'Brasília'))]);
  assert.equal(a, true);
  assert.equal(b, false);
  assert.equal(calls.award.length, 1);
  assert.deepEqual(calls.award[0], ['ana', 30, { coins: 20, kind: 'QUIZ', label: 'Quiz do Pingu' }]);
  assert.match(calls.posts.at(-1).text, /@ana acertou/);
  // Depois de acabar, ninguém mais ganha.
  assert.equal(await engine.onMessage(null, answer('caio', 'brasilia')), false);
  assert.equal(calls.award.length, 1);
});

test('quiz: banco recusando (outra instância já gravou) não paga', async () => {
  const { engine, calls } = fakeQuiz({ claimRound: async () => false });
  await engine.startRound(null, { channelId: 'c1' });
  assert.equal(await engine.onMessage(null, answer('ana', 'brasilia')), false);
  assert.equal(calls.award.length, 0);
});

test('quiz: anti-spam limita tentativas e ignora mensagens rápidas demais', async () => {
  const { engine, calls, tick } = fakeQuiz();
  await engine.startRound(null, { channelId: 'c1' });
  assert.equal(await engine.onMessage(null, answer('ana', 'rio')), false);
  // Rápido demais: ignorada, mesmo certa.
  assert.equal(await engine.onMessage(null, answer('ana', 'brasilia')), false);
  for (let i = 0; i < quiz.MAX_ATTEMPTS; i += 1) { tick(2000); await engine.onMessage(null, answer('ana', `chute ${i}`)); }
  tick(2000);
  assert.equal(await engine.onMessage(null, answer('ana', 'brasilia')), false); // acabaram as tentativas
  assert.equal(await engine.onMessage(null, answer('bia', 'brasilia')), true);
  assert.equal(calls.award.length, 1);
  assert.equal(calls.award[0][0], 'bia');
});

test('quiz: fora do tempo não vale e o fim avisa a resposta; o Pingu não responde a si mesmo', async () => {
  const { engine, calls, tick, timers } = fakeQuiz();
  await engine.startRound(null, { channelId: 'c1' });
  assert.equal(await engine.onMessage(null, answer('pingu', 'brasilia')), false);
  await assert.rejects(engine.startRound(null, { channelId: 'c1' }), /Já tem um quiz/);
  tick(61_000);
  assert.equal(await engine.onMessage(null, answer('ana', 'brasilia')), false);
  await timers[0]();
  await new Promise((r) => setImmediate(r));
  assert.match(calls.posts.at(-1).text, /Tempo esgotado.*Brasília/);
  assert.equal(calls.award.length, 0);
  // Canal liberado pra outro quiz.
  await engine.startRound(null, { channelId: 'c1' });
});

test('quiz: com a Economia desligada não dá moedas nem XP', async () => {
  const { engine, calls } = fakeQuiz({ economyOff: async () => true });
  await engine.startRound(null, { channelId: 'c1' });
  assert.equal(await engine.onMessage(null, answer('ana', 'brasilia')), true);
  assert.equal(calls.award.length, 0);
});

test('quiz: dia e hora de Brasília', () => {
  assert.deepEqual(quiz.brNow(new Date('2026-11-02T02:30:00Z')), { day: '2026-11-01', hour: 23 });
});

// ---------------- boas-vindas ----------------

test('boas-vindas: modelo troca as chaves e some com a linha vazia da IA', () => {
  const out = welcome.renderTemplate(pcfg.DEFAULT_WELCOME, { usuario: '@ana', nome: 'Ana', canais: '<#c1>', ia: null });
  assert.match(out, /^Seja bem-vindo\(a\) ao Project Club, @ana! 🐧\nPra começar/);
  assert.match(out, /\/wiki\/regras/);
  assert.match(out, /Canais em destaque: <#c1>\./);
  assert.ok(!/\{|\}/.test(out));
});

test('boas-vindas: canal configurado, depois "boas-vindas", depois "geral"', () => {
  const chans = [
    { id: 'v', name: 'Voz', type: 'VOICE' }, { id: 'p', name: 'boas-vindas', type: 'TEXT', isPrivate: true },
    { id: 'g', name: 'chat-geral', type: 'TEXT' }, { id: 'b', name: 'Bem-vindos', type: 'TEXT' }, { id: 'r', name: 'regras', type: 'TEXT' },
  ];
  assert.equal(welcome.pickWelcomeChannel(chans, 'g').id, 'g');
  assert.equal(welcome.pickWelcomeChannel(chans, 'sumiu').id, 'b');
  assert.equal(welcome.pickWelcomeChannel(chans.filter((c) => c.id !== 'b'), null).id, 'g');
  assert.equal(welcome.pickWelcomeChannel([{ id: 'v', name: 'Voz', type: 'VOICE' }], null), null);
  assert.deepEqual(welcome.pickFeaturedChannels(chans, 'b').map((c) => c.id), ['r', 'g']);
});

// ---------------- moderação assistida ----------------

function fakeMod(cfg = {}, { online = true, verdict = 'NAO' } = {}) {
  const calls = { ai: 0, alerts: [], notices: 0 };
  let clock = 5_000_000;
  const engine = mod.createModAssist({
    getConfig: () => ({ ...pcfg.DEFAULTS, ...cfg }),
    extraWords: (c) => pcfg.extraWords(c),
    isOnline: () => online,
    askModel: async (messages) => {
      calls.ai += 1;
      assert.ok(!/Pessoa|@/.test(messages[1].content.replace(/"""[\s\S]*"""/, ''))); // só o texto vai
      return { text: verdict };
    },
    createAlert: async (data) => { calls.alerts.push(data); return { id: `a${calls.alerts.length}`, ...data }; },
    notifyStaff: async () => { calls.notices += 1; },
    now: () => clock,
  });
  return { engine, calls, tick: (ms) => { clock += ms; } };
}
const chanMsg = (content, authorId = 'u1', id = `m-${Math.random()}`) => ({ message: { id, channelId: 'c1', authorId, content }, channel: { id: 'c1', name: 'geral' } });

test('moderação: mensagens normais NUNCA chegam na IA nem viram alerta', async () => {
  const { engine, calls, tick } = fakeMod();
  const clean = ['bom dia gente', 'alguém joga minecraft hoje?', 'KKKKK', 'Olha esse link https://exemplo.com', 'Vamos no quiz às 20h!', 'que jogo bom, recomendo demais'];
  for (const c of clean) { tick(3000); await engine.check(null, chanMsg(c)); }
  assert.equal(calls.ai, 0);
  assert.equal(calls.alerts.length, 0);
});

test('moderação: suspeita vai pra IA; "NAO" da IA não vira alerta', async () => {
  const { engine, calls } = fakeMod({}, { verdict: 'NAO' });
  const r = await engine.check(null, chanMsg('seu idiota'));
  assert.equal(r.aiChecked, true);
  assert.equal(calls.ai, 1);
  assert.equal(calls.alerts.length, 0);
});

test('moderação: "SIM" da IA vira alerta pra equipe (sem punir ninguém)', async () => {
  const { engine, calls } = fakeMod({}, { verdict: 'SIM.' });
  const r = await engine.check(null, chanMsg('seu idiota'));
  assert.equal(r.alerted, true);
  assert.equal(calls.alerts[0].aiVerdict, 'SIM');
  assert.equal(calls.notices, 1);
  assert.ok(JSON.parse(calls.alerts[0].reasons).some((x) => /ofensiva/.test(x)));
});

test('moderação: IA fora do ar só alerta o que é bem suspeito', async () => {
  const off = fakeMod({}, { online: false });
  await off.engine.check(null, chanMsg('seu idiota'));
  assert.equal(off.calls.ai, 0);
  assert.equal(off.calls.alerts.length, 0);
  await off.engine.check(null, chanMsg('SEU IDIOTA, VOCÊ É RIDÍCULO DEMAIS', 'u2'));
  assert.equal(off.calls.alerts.length, 1);
  assert.equal(off.calls.alerts[0].aiVerdict, null);
});

test('moderação: desligada no painel não faz nada; palavras extras da equipe contam', async () => {
  const offCfg = fakeMod({ modAssistEnabled: false }, { verdict: 'SIM' });
  await offCfg.engine.check(null, chanMsg('seu idiota'));
  assert.equal(offCfg.calls.ai + offCfg.calls.alerts.length, 0);
  assert.ok(mod.heuristic('isso é um golpezinho', { extraWords: ['golpezinho'] }).score >= 2);
});

test('moderação: flood e mensagem repetida aparecem na nota', () => {
  const now = 100_000;
  const recent = Array.from({ length: 6 }, (_, i) => ({ at: now - i * 500, text: normalize('compra aqui') }));
  const h = mod.heuristic('compra aqui', { recent, now });
  assert.ok(h.reasons.includes('flood (muitas mensagens seguidas)'));
  assert.ok(h.reasons.includes('mesma mensagem repetida'));
  assert.equal(mod.parseVerdict('Não.'), false);
  assert.equal(mod.parseVerdict('sim'), true);
  assert.equal(mod.parseVerdict('talvez'), null);
});

// ---------------- configurações e limites ----------------

test('config: valida números, textos e booleanos do painel', () => {
  assert.deepEqual(pcfg.sanitize({ welcomeEnabled: 0, quizHour: 9, welcomeTemplate: '  oi {usuario}  ' }), { welcomeEnabled: false, quizHour: 9, welcomeTemplate: 'oi {usuario}' });
  assert.throws(() => pcfg.sanitize({ quizHour: 24 }), /hora do quiz/);
  assert.throws(() => pcfg.sanitize({ quizWindowSec: 5 }), /tempo para responder/);
  assert.deepEqual(pcfg.extraWords({ modExtraWords: 'golpe, PIX falso\n a' }), ['golpe', 'pix falso']);
});

test('limite por pessoa: 1 a cada janela, com devolução', () => {
  let t = 0;
  const lim = createLimiter({ windowMs: 1000, max: 1, now: () => t });
  assert.equal(lim.take('a').ok, true);
  assert.equal(lim.take('a').ok, false);
  assert.equal(lim.take('b').ok, true);
  lim.refund('a');
  assert.equal(lim.take('a').ok, true);
  t = 1500;
  assert.equal(lim.take('a').ok, true);
});

// ---------------- fila única da IA ----------------

test('fila: IA desligada → "O Pingu está offline agora"', async () => {
  bot._test.setEnabled(false);
  await assert.rejects(bot.askModel([{ role: 'user', content: 'oi' }]), (err) => err.code === 'OFFLINE' && /offline agora/.test(err.message));
});

test('fila: perguntas diretas passam na frente e tiram o trabalho de fundo quando lota', async () => {
  bot._test.reset();
  bot._test.setEnabled(true);
  bot._test.setOnline(true);
  const order = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  bot._test.setChat(async (body) => {
    order.push(body.messages.at(-1).content);
    if (body.messages.at(-1).content === 'primeira') await gate;
    assert.equal(body.stream, false);
    assert.equal(body.think, false);
    assert.equal(body.options.num_ctx, 1024);
    return { message: { content: `ok ${body.messages.at(-1).content}` } };
  });
  const ask = (content, priority) => bot.askModel([{ role: 'user', content }], { priority }).then((r) => r.text, (e) => e.code);
  const first = ask('primeira', bot.PRIORITY.USER); // ocupa a IA
  await new Promise((r) => setImmediate(r));
  const bg = Array.from({ length: 6 }, (_, i) => ask(`fundo${i}`, bot.PRIORITY.BACKGROUND)); // lota a fila
  const direct = ask('direta', bot.PRIORITY.QUESTION);
  release();
  const results = await Promise.all([first, ...bg, direct]);
  assert.equal(results[0], 'ok primeira');
  assert.equal(results.at(-1), 'ok direta');
  assert.equal(results.filter((r) => r === 'BUSY').length, 1); // um de fundo saiu da fila
  assert.equal(order[1], 'direta'); // logo depois da que já estava rodando
  bot._test.setChat(null);
  bot._test.setEnabled(false);
  bot._test.setOnline(false);
  bot._test.reset();
});
