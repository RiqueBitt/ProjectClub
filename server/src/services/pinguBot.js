// Pingu — assistente de IA do Project Club.
//
// Uma conta normal da comunidade ("Pingu", @pingu) que responde quando é
// mencionada (@pingu …), quando alguém responde uma mensagem dela ou numa
// mensagem direta com ela. A IA roda num Ollama PRÓPRIO, na VPS do Project
// Club; este servidor só pergunta e posta a resposta como o Pingu.
//
// - Online/offline: o Pingu fica online enquanto a IA responde (conferida a
//   cada 30 s) e some sozinho quando a VPS desliga. A presença usa o mesmo
//   Redis das pessoas (presenceStore) com um "socket" próprio, então a
//   varredura de presença concorda com isso.
// - Uma pergunta por vez (a VPS tem 2 vCPU): fila curta e espera por pessoa.
//   A MESMA fila atende tudo que usa a IA (Fase 9): perguntas diretas
//   primeiro, depois pedidos de uma pessoa (resumo, tradução) e por último
//   o trabalho de fundo (moderação, boas-vindas, gerar pergunta de quiz).
//   Fila cheia: uma pergunta direta tira da fila o trabalho de fundo.
// - Wiki (/wiki): pra cada pergunta, o trecho mais parecido da wiki vai
//   junto (services/pingu/wiki.js), com "(veja /wiki/slug)".
//
// Pingu Turbo (docs/pingu-turbo.md):
// - Resposta AO VIVO: a mensagem do Pingu aparece na hora ("digitando…") e
//   vai sendo preenchida pelo streaming do Ollama (edições a cada ~500 ms,
//   evento 'message:update' que o app já trata). Sem streaming → modo normal.
// - System prompt IDÊNTICO entre pedidos (services/pingu/prompt.js) → o
//   Ollama reaproveita o prefixo em cache; o que muda vai no fim.
// - Respostas instantâneas SEM IA (services/pingu/tools.js), cache de
//   respostas iguais, pedidos iguais simultâneos viram UMA geração, e a
//   geração é cancelada se a mensagem que pediu for apagada.
// - Imagens (services/pingu/image*.js), lembretes, enquetes, explicar/
//   reescrever, memória curta (2 trocas, 10 min) e Pingu na DM.
//
// Configuração (variáveis de ambiente; sem PINGU_OLLAMA_URL a IA fica desligada):
//   PINGU_OLLAMA_URL  ex.: https://38-92-41-54.sslip.io  (proxy na VPS)
//   PINGU_OLLAMA_KEY  senha do proxy (Authorization: Bearer …)
//   PINGU_MODEL       padrão qwen3.5:2b (na VPS: qwen3.5:2b-q4_K_M)
//   PINGU_NUM_CTX (1024), PINGU_NUM_THREAD (2), PINGU_KEEP_ALIVE (-1 = sempre carregado),
//   PINGU_STREAM (1; 0 desliga o streaming), PINGU_REWARM (1; 0 desliga o reaquecimento)
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { normalize } = require('./pingu/text');
const promptLib = require('./pingu/prompt');
const { createLru, createInflight, cacheKeyFor } = require('./pingu/cache');
const { createMemory, isFollowUp } = require('./pingu/memory');
const { createThrottle } = require('./pingu/stream');
const { parseIntent } = require('./pingu/intents');
// Banco e Redis só quando o Pingu está ligado (os testes dos filtros não
// precisam conectar em nada). Os testes trocam o banco e o "include" das
// mensagens por versões de mentira (_test.setDeps).
const injected = { db: null, include: null };
const db = () => injected.db || require('../config/prisma');
const presence = () => require('./presenceStore');
const msgInclude = () => injected.include || require('../controllers/messageController').messageInclude;

const USERNAME = 'pingu';
const DISPLAY_NAME = 'Pingu';
const EMAIL = 'pingu@bot.projectclub.local';
const PRESENCE_SOCKET = 'pingu-ia';
const HEALTH_EVERY_MS = 30_000;
const HEALTH_TIMEOUT_MS = 8_000;
const ANSWER_TIMEOUT_MS = 120_000;
const QUEUE_MAX = 6;
const USER_COOLDOWN_MS = 8_000;
const LOCAL_COOLDOWN_MS = 2_500;
const MAX_QUESTION = 800;
const MAX_ANSWER = 600;
// Velocidade (2 vCPU, sem placa de vídeo): medido na VPS com o
// qwen3.5:2b-q4_K_M ~10 tokens/s escrevendo; lendo o prompt ~33–43 tokens/s
// SEM cache e ~250–290 tokens/s com o prefixo em cache. Então: system
// prompt sempre igual, contexto curto e resposta curta.
const CONTEXT_CHARS = 240;
// num_ctx e num_thread NUNCA mudam entre pedidos: trocar qualquer um faz o
// Ollama recarregar o modelo (vários segundos).
const NUM_CTX = Number(process.env.PINGU_NUM_CTX) || 1024;
const NUM_THREAD = Number(process.env.PINGU_NUM_THREAD) || 2;
const NUM_PREDICT = 120;
const MAX_INSTRUCTIONS = 2000;
const STREAM_EDIT_MS = 500;
const STREAM_OFF_MS = 10 * 60 * 1000;
const WARM_GAP_MS = 20_000;
const WARM_IDLE_MS = 1_500;
// Prioridades da fila única (menor = antes). WARM = reaquecer o cache (sai primeiro se lotar).
const PRIORITY = { QUESTION: 0, USER: 1, BACKGROUND: 2 };
const PRIORITY_WARM = 3;
const OFFLINE_TEXT = 'O Pingu está offline agora (a IA dele está fora do ar). Tenta de novo mais tarde! 🐧';
const BUSY_TEXT = 'O Pingu está com muita gente na fila agora. Tenta de novo em um minutinho! 🐧';
const OFFLINE_REPLY = 'Estou desligado agora (a minha IA está fora do ar). Tenta de novo mais tarde! 🐧';
const BUSY_REPLY = 'Tem muita gente falando comigo agora! Me chama de novo em um minutinho. 🐧';
const TYPING_TEXT = '🐧 digitando…';

function keepAlive() {
  const raw = String(process.env.PINGU_KEEP_ALIVE ?? '').trim();
  if (!raw) return -1;
  return /^-?\d+$/.test(raw) ? Number(raw) : raw;
}

let settings = { name: DISPLAY_NAME, instructions: '' };
const systemPrompt = () => promptLib.systemPrompt(settings);

let io = null;
let pinguId = null;
let online = false;
let started = false;
let healthTimer = null;
const queue = [];
let busy = false;
let seq = 0;
const lastAskAt = new Map();
const lastLocalAt = new Map();
// Testes: dá pra ligar "de mentira" e trocar a chamada da IA.
let forceEnabled = false;
let chatImpl = null;
let streamImpl = null;
let streamOffUntil = 0;
let lastSystem = null;
let lastWarmAt = 0;
let warmTimer = null;

// Cache de respostas, pedidos iguais em andamento e memória curta.
const answerCache = createLru({ max: 300, ttlMs: 30 * 60 * 1000 });
const inflight = createInflight();
const memory = createMemory();
// Gerações em andamento: id da mensagem que pediu → { cancel }; e o id da
// mensagem do Pingu (placeholder) → id da que pediu.
const active = new Map();
const byPlaceholder = new Map();
// Números pro painel e pro docs/pingu-turbo.md.
const perf = { recent: [], localHits: 0, cacheHits: 0, sharedHits: 0, modelCalls: 0, streamed: 0, fallbacks: 0, cancelled: 0, warmups: 0 };

const config = () => ({
  url: String(process.env.PINGU_OLLAMA_URL || '').trim().replace(/\/+$/, ''),
  key: String(process.env.PINGU_OLLAMA_KEY || '').trim(),
  model: String(process.env.PINGU_MODEL || 'qwen3.5:2b').trim(),
});
const enabled = () => forceEnabled || !!config().url;

/** Sinal que cancela no tempo limite OU quando o outro sinal cancelar. */
function timeoutSignal(signal, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error('tempo esgotado')), ms);
  t.unref?.();
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
  }
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
}

async function ollama(path, { body, timeoutMs, signal }) {
  const { url, key } = config();
  const t = timeoutSignal(signal, timeoutMs);
  try {
    const res = await fetch(`${url}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: t.signal,
    });
    if (!res.ok) throw new Error(`IA respondeu HTTP ${res.status}`);
    return await res.json();
  } finally { t.done(); }
}

// ---------------- conta ----------------

async function ensureAccount() {
  const existing = await db().user.findUnique({ where: { username: USERNAME }, select: { id: true } });
  if (existing) return existing.id;
  // Senha aleatória que ninguém sabe: a conta não faz login, só posta daqui.
  const passwordHash = await bcrypt.hash(crypto.randomBytes(48).toString('hex'), 10);
  const created = await db().user.create({
    data: {
      email: EMAIL, username: USERNAME, displayName: DISPLAY_NAME, passwordHash,
      emailVerified: true, status: 'OFFLINE',
      bio: 'Assistente de IA do Project Club. Me chame com @pingu (ou @pingu ajuda) ou mande uma mensagem direta! 🐧',
      profileColor: '#38BDF8', profileNameColor: '#38BDF8',
    },
    select: { id: true },
  });
  require('./sharedCache').invalidateShared('community');
  console.log('[pingu] conta criada');
  return created.id;
}

// ---------------- perfil e o que ele sabe (Painel da Equipe → Pingu) ----------------

const PROFILE_FIELDS = {
  id: true, username: true, displayName: true, avatarUrl: true, bannerUrl: true, bio: true,
  profileColor: true, profileNameColor: true,
};
const HEX = /^#[0-9a-fA-F]{6}$/;

async function loadSettings() {
  const before = systemPrompt();
  const [user, row] = await Promise.all([
    pinguId ? db().user.findUnique({ where: { id: pinguId }, select: { displayName: true } }) : null,
    db().platformSettings.findUnique({ where: { id: 'singleton' }, select: { pinguInstructions: true } }).catch(() => null),
  ]);
  settings = {
    name: user?.displayName || DISPLAY_NAME,
    instructions: String(row?.pinguInstructions || '').trim().slice(0, MAX_INSTRUCTIONS),
  };
  // Instruções novas: o prefixo em cache do Ollama não vale mais → reaquece.
  if (systemPrompt() !== before) scheduleWarm(0);
}

function perfSummary() {
  const r = perf.recent;
  const avg = (k) => {
    const v = r.map((x) => x[k]).filter((n) => typeof n === 'number' && Number.isFinite(n));
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const rate = (tok, ms) => {
    const v = r.filter((x) => x[tok] && x[ms]);
    if (!v.length) return null;
    const t = v.reduce((a, x) => a + x[tok], 0);
    const m = v.reduce((a, x) => a + x[ms], 0);
    return m ? Math.round((t / m) * 10000) / 10 : null;
  };
  return {
    samples: r.length, avgFirstTokenMs: avg('firstTokenMs'), avgTotalMs: avg('totalMs'),
    promptTokPerSec: rate('promptTokens', 'promptMs'), evalTokPerSec: rate('evalTokens', 'evalMs'),
    localHits: perf.localHits, cacheHits: perf.cacheHits, sharedHits: perf.sharedHits, modelCalls: perf.modelCalls,
    streamed: perf.streamed, fallbacks: perf.fallbacks, cancelled: perf.cancelled, warmups: perf.warmups, cacheSize: answerCache.size,
  };
}

async function adminState() {
  if (!pinguId && enabled()) pinguId = await ensureAccount();
  const user = pinguId ? await db().user.findUnique({ where: { id: pinguId }, select: PROFILE_FIELDS }) : null;
  let images = null;
  try { images = require('./pingu/imageRuntime').imageStatus(); } catch { images = null; }
  return {
    enabled: enabled(), online, model: config().model, queue: queue.length + (busy ? 1 : 0),
    user, instructions: settings.instructions, maxInstructions: MAX_INSTRUCTIONS,
    streaming: streamEnabled(), numCtx: NUM_CTX, numThread: NUM_THREAD, perf: perfSummary(), images,
  };
}

/** Avisa todo mundo da mudança no perfil (lista de membros, mensagens antigas, miniperfil). */
async function broadcastProfile() {
  require('./sharedCache').invalidateShared('community');
  const { PUBLIC_USER_FIELDS } = require('../controllers/authController');
  const u = await db().user.findUnique({ where: { id: pinguId }, select: PUBLIC_USER_FIELDS }).catch(() => null);
  if (u) io?.to('community').emit('user:update', u);
}

/**
 * Edita o perfil e o que o Pingu sabe. Só o que veio no corpo muda; texto
 * vazio limpa (bio/instruções). Lança Error com .status 400 pra dado ruim.
 */
async function updateFromAdmin(body = {}) {
  if (!pinguId) pinguId = await ensureAccount();
  const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
  const data = {};
  if (body.displayName !== undefined) {
    const name = String(body.displayName || '').replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 32) throw bad('O nome precisa ter de 2 a 32 caracteres.');
    data.displayName = name;
  }
  if (body.bio !== undefined) data.bio = String(body.bio || '').trim().slice(0, 300) || null;
  for (const k of ['profileColor', 'profileNameColor']) {
    if (body[k] === undefined) continue;
    if (!HEX.test(String(body[k]))) throw bad('Cor inválida (use o formato #RRGGBB).');
    data[k] = String(body[k]);
  }
  if (Object.keys(data).length) await db().user.update({ where: { id: pinguId }, data });
  if (body.instructions !== undefined) {
    const text = String(body.instructions || '').replace(/\r/g, '').trim();
    if (text.length > MAX_INSTRUCTIONS) throw bad(`O texto pode ter até ${MAX_INSTRUCTIONS} caracteres.`);
    await db().platformSettings.upsert({
      where: { id: 'singleton' }, update: { pinguInstructions: text || null }, create: { id: 'singleton', pinguInstructions: text || null },
    });
  }
  await loadSettings();
  if (Object.keys(data).length) await broadcastProfile();
  return adminState();
}

/** Foto (avatarUrl) ou capa (bannerUrl) nova, já enviada pro armazenamento. */
async function setImageFromAdmin(field, url) {
  if (!['avatarUrl', 'bannerUrl'].includes(field) || !url) throw Object.assign(new Error('Envie uma imagem.'), { status: 400 });
  if (!pinguId) pinguId = await ensureAccount();
  await db().user.update({ where: { id: pinguId }, data: { [field]: url } });
  await broadcastProfile();
  return adminState();
}

// ---------------- presença ----------------

async function setOnline(next) {
  if (!pinguId) return;
  if (next) await presence().addSocket(pinguId, PRESENCE_SOCKET).catch(() => {});
  else await presence().removeSocket(pinguId, PRESENCE_SOCKET).catch(() => {});
  if (next === online) return;
  online = next;
  await db().user.update({ where: { id: pinguId }, data: { status: next ? 'ONLINE' : 'OFFLINE' } }).catch(() => {});
  io?.emit('presence:update', { userId: pinguId, status: next ? 'ONLINE' : 'OFFLINE', customStatus: null, mobile: false });
  console.log(`[pingu] ${next ? 'online (a IA respondeu)' : 'offline (a IA não respondeu)'}`);
  // Voltou: carrega o modelo e o prefixo antes da primeira pergunta.
  if (next) scheduleWarm(0);
}

async function checkHealth() {
  if (!enabled()) return setOnline(false);
  try {
    const tags = await ollama('/api/tags', { timeoutMs: HEALTH_TIMEOUT_MS });
    const model = config().model;
    const has = (tags?.models || []).some((m) => m.name === model || m.model === model);
    await setOnline(has);
  } catch {
    await setOnline(false);
  }
}

// ---------------- chamadas da IA ----------------

/** É pra mim? @pingu no texto (sem ligar pra maiúsculas), menção resolvida ou resposta a uma mensagem do Pingu. */
function isForPingu(message, mentionRows = []) {
  if (!pinguId || !message || message.authorId === pinguId) return false;
  if (mentionRows.some((m) => m.targetType === 'USER' && m.targetId === pinguId)) return true;
  if (message.replyTo?.authorId === pinguId) return true;
  return /(^|[^\w@])@pingu\b/i.test(message.content || '');
}

function cleanQuestion(text) {
  return String(text || '').replace(/(^|[^\w@])@pingu\b[,:]?/ig, '$1').replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION);
}

/** Corta no fim da última frase completa (a resposta pode parar no meio por causa do limite). */
function finishSentence(t) {
  if (/[.!?…)"'🐧\p{Extended_Pictographic}]\s*$/u.test(t)) return t;
  const cut = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? '), t.lastIndexOf('.\n'));
  return cut > t.length * 0.4 ? t.slice(0, cut + 1) : `${t.trimEnd()}…`;
}

/**
 * Resposta segura e simples pra postar: sem "pensamento", sem imagens, sem
 * @todos, sem enfeite de markdown. opts.max = tamanho máximo; opts.keepFormat
 * = mantém listas/títulos (texto reescrito).
 */
function cleanAnswer(text, { truncated = false, max = MAX_ANSWER, keepFormat = false } = {}) {
  let t = String(text || '');
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '');
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ''); // imagem em markdown
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1'); // negrito
  if (!keepFormat) {
    t = t.replace(/^\s{0,3}#{1,6}\s+/gm, ''); // títulos
    t = t.replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, ''); // listas viram frases
  }
  t = t.replace(/@(everyone|here|todos|aqui)\b/gi, '@​$1');
  t = t.replace(/\n{3,}/g, '\n\n').trim();
  if (t.length > max) { t = t.slice(0, max); truncated = true; }
  return truncated && t ? finishSentence(t) : t;
}

/** Trecho da wiki pra pergunta (nunca lança; sem wiki = null). */
function wikiContextFor(question) {
  try {
    const wiki = require('./pingu/wiki');
    return wiki.buildWikiContext(question, wiki.cachedPages());
  } catch { return null; }
}

function wikiVersion() {
  try { return require('./pingu/wiki').version(); } catch { return 0; }
}

/** Versão do cache: muda quando muda o system prompt (equipe) ou a wiki. */
function cacheVersion() {
  return `${crypto.createHash('sha1').update(systemPrompt()).digest('hex').slice(0, 12)}|${wikiVersion()}`;
}

/** Mensagens pro /api/chat de uma pergunta (mantido pros testes e pra quem já usava). */
function buildChat(job) {
  const userTurn = promptLib.buildUserTurn({ question: job.question, wiki: job.wiki, reply: job.reply || null, task: job.task || null, normalized: normalize(job.question) });
  return promptLib.buildMessages({ system: systemPrompt(), memory: job.memory || [], previousAnswer: job.previousAnswer || null, userTurn });
}

function chatBody(messages, { numPredict = NUM_PREDICT, temperature = 0.3 } = {}) {
  return {
    model: config().model,
    messages,
    stream: false,
    think: false,
    keep_alive: keepAlive(),
    options: { num_ctx: NUM_CTX, num_thread: NUM_THREAD, num_predict: numPredict, temperature, top_p: 0.9 },
  };
}

function rememberSystem(messages) {
  lastSystem = messages?.[0]?.role === 'system' ? messages[0].content : null;
}

function recordPerf(sample) {
  perf.recent.push({ at: Date.now(), ...sample });
  if (perf.recent.length > 40) perf.recent.shift();
}

/** Uma chamada /api/chat (sem streaming, sem "pensar", contexto curto). */
async function callChat(messages, { numPredict = NUM_PREDICT, temperature = 0.3, timeoutMs = ANSWER_TIMEOUT_MS, signal } = {}) {
  const body = chatBody(messages, { numPredict, temperature });
  rememberSystem(messages);
  if (chatImpl) return chatImpl(body, { timeoutMs, signal });
  const t0 = Date.now();
  const res = await ollama('/api/chat', { timeoutMs, body, signal });
  recordPerf({
    kind: 'chat', totalMs: Date.now() - t0, firstTokenMs: null,
    promptTokens: res?.prompt_eval_count ?? null, promptMs: res?.prompt_eval_duration ? res.prompt_eval_duration / 1e6 : null,
    evalTokens: res?.eval_count ?? null, evalMs: res?.eval_duration ? res.eval_duration / 1e6 : null, streamed: false,
  });
  return res;
}

function streamEnabled() {
  if (streamImpl) return true;
  if (chatImpl || !config().url) return false;
  if (String(process.env.PINGU_STREAM ?? '1').trim() === '0') return false;
  return Date.now() >= streamOffUntil;
}

/**
 * Pergunta com streaming (onDelta(pedaço, textoAtéAgora) a cada pedaço).
 * Se o streaming falhar antes de começar, cai pro modo normal.
 * Devolve { text, truncated, streamed }.
 */
async function chatStreaming(messages, { numPredict = NUM_PREDICT, temperature = 0.3, timeoutMs = ANSWER_TIMEOUT_MS, signal, onDelta } = {}) {
  const body = chatBody(messages, { numPredict, temperature });
  const t0 = Date.now();
  let firstAt = null;
  const wrapped = (piece, text) => { if (firstAt === null) firstAt = Date.now(); onDelta?.(piece, text); };
  if (streamEnabled()) {
    rememberSystem(messages);
    const t = timeoutSignal(signal, timeoutMs);
    try {
      const { url, key } = config();
      const res = streamImpl
        ? await streamImpl({ ...body, stream: true }, { signal: t.signal, onDelta: wrapped })
        : await require('./pingu/stream').streamChat(body, { url, key, signal: t.signal, onDelta: wrapped });
      perf.streamed += 1;
      recordPerf({ kind: 'stream', firstTokenMs: firstAt ? firstAt - t0 : null, totalMs: Date.now() - t0, ...(res.stats || {}), streamed: true });
      return { text: res.text, truncated: res.doneReason === 'length', streamed: true };
    } catch (err) {
      if (signal?.aborted) throw Object.assign(new Error('cancelado'), { code: 'CANCELLED' });
      // Cortou no meio mas já tinha bastante texto: aproveita.
      if (err?.partial && err.partial.length >= 40) return { text: err.partial, truncated: true, streamed: true };
      perf.fallbacks += 1;
      if (err?.code === 'STREAM_UNSUPPORTED' || err?.status === 400 || err?.status === 404) streamOffUntil = Date.now() + STREAM_OFF_MS;
      console.warn('[pingu] streaming falhou, indo pro modo normal:', err?.message || err);
    } finally { t.done(); }
  }
  const res = await callChat(messages, { numPredict, temperature, timeoutMs, signal });
  const text = String(res?.message?.content || '');
  if (text) onDelta?.(text, text);
  return { text, truncated: res?.done_reason === 'length', streamed: false };
}

/** Reaquece: carrega o modelo e deixa o system prompt atual no cache do Ollama. */
function warmUp() {
  if (!config().url || chatImpl || streamImpl || !online) return false;
  if (String(process.env.PINGU_REWARM ?? '1').trim() === '0' && lastSystem !== null) return false;
  if (Date.now() - lastWarmAt < WARM_GAP_MS) return false;
  lastWarmAt = Date.now();
  return enqueue({
    priority: PRIORITY_WARM,
    warm: true,
    run: async () => {
      perf.warmups += 1;
      await callChat([{ role: 'system', content: systemPrompt() }, { role: 'user', content: 'oi' }], { numPredict: 1, temperature: 0, timeoutMs: 60_000 })
        .catch((err) => console.warn('[pingu] reaquecimento falhou:', err?.message || err));
    },
    drop: () => {},
  });
}

function scheduleWarm(delayMs = WARM_IDLE_MS) {
  if (!config().url || chatImpl || streamImpl) return;
  clearTimeout(warmTimer);
  warmTimer = setTimeout(() => {
    warmTimer = null;
    if (!busy && !queue.length && lastSystem !== systemPrompt()) warmUp();
  }, delayMs);
  warmTimer.unref?.();
}

async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const task = queue.shift();
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve().then(task.run).catch((err) => console.error('[pingu] erro:', err?.message || err));
    }
  } finally { busy = false; }
  // Ficou parado e o último pedido usou outro system prompt (resumo,
  // tradução, moderação…): recoloca o das perguntas no cache.
  if (lastSystem !== null && lastSystem !== systemPrompt()) scheduleWarm();
}

/**
 * Põe uma tarefa na fila única, por prioridade (e ordem de chegada).
 * Fila cheia: tira a tarefa menos importante, se a nova for mais
 * importante que ela (o `drop` dela é chamado); senão devolve false.
 */
function enqueue(task) {
  if (queue.length >= QUEUE_MAX) {
    let idx = -1;
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      if (queue[i].priority > task.priority && (idx < 0 || queue[i].priority > queue[idx].priority)) idx = i;
    }
    if (idx < 0) return false;
    const [dropped] = queue.splice(idx, 1);
    try { dropped.drop?.(); } catch { /* ignora */ }
  }
  task.seq = seq++;
  const at = queue.findIndex((t) => t.priority > task.priority);
  if (at < 0) queue.push(task); else queue.splice(at, 0, task);
  pump();
  return true;
}

/** Tira uma tarefa que ainda não começou (devolve true se tirou). */
function dequeue(task) {
  const i = queue.indexOf(task);
  if (i < 0) return false;
  queue.splice(i, 1);
  return true;
}

const pinguError = (code) => Object.assign(new Error(code === 'OFFLINE' ? OFFLINE_TEXT : BUSY_TEXT), { code, status: 503 });

/**
 * Pergunta qualquer coisa pra IA pela fila única. Resolve com
 * { text, truncated } (texto cru, quem chama limpa). Rejeita com
 * err.code 'OFFLINE' (IA fora do ar/desligada) ou 'BUSY' (fila cheia).
 */
function askModel(messages, { priority = PRIORITY.USER, numPredict = NUM_PREDICT, temperature = 0.3, timeoutMs = ANSWER_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    if (!enabled() || !online) { reject(pinguError('OFFLINE')); return; }
    const ok = enqueue({
      priority,
      run: async () => {
        try {
          perf.modelCalls += 1;
          const res = await callChat(messages, { numPredict, temperature, timeoutMs });
          resolve({ text: String(res?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim(), truncated: res?.done_reason === 'length' });
        } catch (err) {
          console.warn('[pingu] falha na IA:', err?.message || err);
          await checkHealth().catch(() => {});
          reject(err?.code ? err : pinguError(online ? 'BUSY' : 'OFFLINE'));
        }
      },
      drop: () => reject(pinguError('BUSY')),
    });
    if (!ok) reject(pinguError('BUSY'));
  });
}

const isOnline = () => enabled() && online;

/** id da conta do Pingu (cria a conta se precisar — boas-vindas e quiz funcionam sem IA). */
async function botId() {
  if (!pinguId) pinguId = await ensureAccount();
  return pinguId;
}

// ---------------- mensagens do Pingu ----------------

const roomOf = (target) => (target.conversationId ? `conversation:${target.conversationId}` : `channel:${target.channelId}`);

/**
 * Cria uma mensagem do Pingu respondendo `target.replyToId` (canal ou DM).
 * streaming = o app mostra o cursor piscando até a versão final.
 * target: { channelId | conversationId, replyToId, threadId, threadRoot, channel }
 */
async function createPinguMessage(target, content, { streaming = false } = {}) {
  const authorId = await botId();
  const messageInclude = msgInclude();
  const data = {
    content, authorId, channelId: target.channelId || null, conversationId: target.conversationId || null,
    replyToId: target.replyToId || null, threadId: target.threadId || null, quickReactions: '[]',
  };
  if (target.conversationId) {
    const exp = await require('./ephemeralMessages').expiryForConversation(target.conversationId).catch(() => null);
    if (exp) data.expiresAt = exp;
  }
  const message = await db().message.create({ data, include: messageInclude });
  io?.to(roomOf(target)).emit('message:new', streaming ? { ...message, pinguStreaming: true } : message);
  if (target.threadRoot) {
    require('./threads').afterThreadReply(io, { root: target.threadRoot, message, channel: target.channel }).catch(() => {});
  }
  return message;
}

/**
 * Atualiza a mensagem do Pingu. persist=false: só avisa os apps (streaming,
 * sem gravar no banco a cada pedaço); persist=true: grava e avisa.
 */
async function updatePinguMessage(msg, content, { streaming = false, persist = false } = {}) {
  if (!msg) return null;
  const room = roomOf(msg);
  if (!persist) {
    io?.to(room).emit('message:update', { ...msg, content, pinguStreaming: streaming });
    return msg;
  }
  const messageInclude = msgInclude();
  const r = await db().message.updateMany({ where: { id: msg.id, deleted: false }, data: { content } });
  if (!r.count) return null; // apagada no meio do caminho
  const fresh = await db().message.findUnique({ where: { id: msg.id }, include: messageInclude });
  if (fresh) io?.to(room).emit('message:update', fresh);
  return fresh;
}

/** A mensagem "🎨 Criando…" vira a imagem com a descrição. */
async function attachImageToPinguMessage(msg, { url, mime, size, filename, caption }) {
  await db().attachment.create({ data: { messageId: msg.id, url, filename, mimeType: mime, size } });
  return updatePinguMessage(msg, caption, { persist: true });
}

async function removePinguMessage(msg) {
  if (!msg) return;
  await db().message.updateMany({ where: { id: msg.id }, data: { deleted: true, content: null } }).catch(() => {});
  io?.to(roomOf(msg)).emit('message:delete', { id: msg.id, conversationId: msg.conversationId || null, channelId: msg.channelId || null, threadId: msg.threadId || null });
}

const replyAsPingu = (target, text) => createPinguMessage(target, text);

/**
 * Posta uma mensagem como o Pingu num canal (boas-vindas, quiz…).
 * mentions: [{ targetType: 'USER', targetId }]. Devolve a mensagem criada.
 */
async function postAsPingu(channelId, content, { replyToId = null, mentions = [] } = {}) {
  const authorId = await botId();
  const { messageInclude, roomFor } = require('../controllers/messageController');
  const message = await db().message.create({
    data: {
      content, authorId, channelId, replyToId, quickReactions: '[]',
      mentions: mentions.length ? { create: mentions.map((m) => ({ targetType: m.targetType, targetId: m.targetId })) } : undefined,
    },
    include: messageInclude,
  });
  io?.to(roomFor({ channelId })).emit('message:new', message);
  return message;
}

/** Resposta só pra uma pessoa (não fica no canal): chega pelo socket pessoal. */
function sendEphemeral(userId, payload) {
  io?.notifyUser?.(userId, 'pingu:ephemeral', { at: new Date().toISOString(), ...payload });
}

/** O Pingu reage a uma mensagem (ex.: ⏰ quando o lembrete foi criado). */
async function reactAsPingu(message, emoji) {
  try {
    const authorId = await botId();
    await db().reaction.create({ data: { messageId: message.id, userId: authorId, emoji } });
    const messageInclude = msgInclude();
    const fresh = await db().message.findUnique({ where: { id: message.id }, include: messageInclude });
    if (fresh) io?.to(roomOf(fresh)).emit('message:update', fresh);
  } catch { /* reação repetida ou mensagem apagada: tudo bem */ }
}

function typing(target, on) {
  io?.to(roomOf(target)).emit(on ? 'typing:start' : 'typing:stop', { userId: pinguId, channelId: target.channelId || undefined, conversationId: target.conversationId || undefined });
}

// ---------------- respostas da IA (ao vivo) ----------------

/**
 * Gera a resposta pela fila (prioridade de pergunta direta), com streaming.
 * emit(textoAtéAgora) a cada pedaço. job.ctrl cancela.
 */
function generate(job, emit) {
  return new Promise((resolve, reject) => {
    const task = {
      priority: PRIORITY.QUESTION,
      run: async () => {
        if (job.ctrl.signal.aborted) { reject(Object.assign(new Error('cancelado'), { code: 'CANCELLED' })); return; }
        typing(job.target, true);
        let typingOn = true;
        const keepTyping = setInterval(() => { if (typingOn) typing(job.target, true); }, 4000);
        try {
          perf.modelCalls += 1;
          const res = await chatStreaming(job.messages, {
            numPredict: job.budget.numPredict, temperature: job.budget.temperature, signal: job.ctrl.signal,
            onDelta: (piece, text) => {
              if (typingOn) { typingOn = false; typing(job.target, false); }
              emit(text);
            },
          });
          resolve(res);
        } catch (err) {
          reject(err);
        } finally {
          clearInterval(keepTyping);
          if (typingOn) typing(job.target, false);
        }
      },
      drop: () => reject(pinguError('BUSY')),
    };
    job.cancelQueued = () => { if (dequeue(task)) reject(Object.assign(new Error('cancelado'), { code: 'CANCELLED' })); };
    if (!enqueue(task)) reject(pinguError('BUSY'));
  });
}

/**
 * Responde uma pergunta: posta "digitando…" na hora, preenche ao vivo e
 * grava a versão final. Pedido igual ao mesmo tempo pega carona na mesma
 * geração (job.dedupeKey). Devolve o texto final (ou null).
 */
async function runAnswer(job) {
  const depth = queue.length + (busy ? 1 : 0);
  const sharing = job.dedupeKey && inflight.has(job.dedupeKey);
  const waiting = !sharing && depth > 0 ? `🐧 Na fila (${depth}º)… já já eu respondo!` : TYPING_TEXT;
  let placeholder;
  try { placeholder = await createPinguMessage(job.target, waiting, { streaming: true }); } catch (err) {
    console.warn('[pingu] não deu pra postar:', err?.message || err);
    return null;
  }
  byPlaceholder.set(placeholder.id, job.sourceMessageId);
  let closed = false;
  const throttle = createThrottle({
    intervalMs: STREAM_EDIT_MS,
    publish: (text) => { if (!closed) updatePinguMessage(placeholder, text, { streaming: true }).catch(() => {}); },
  });
  const onPartial = (raw) => {
    const t = cleanAnswer(raw, { max: job.budget.maxAnswer, keepFormat: job.kind === 'rewrite' });
    if (t) throttle.push(t);
  };
  job.ctrl = new AbortController();
  const entry = { cancelled: false };
  active.set(job.sourceMessageId, entry);
  const { promise, shared } = inflight.run(job.dedupeKey || null, (emit) => generate(job, emit), onPartial);
  if (shared) perf.sharedHits += 1;
  entry.cancel = ({ placeholderGone = false } = {}) => {
    if (entry.cancelled) return;
    entry.cancelled = true;
    closed = true;
    perf.cancelled += 1;
    throttle.finish();
    if (job.dedupeKey) inflight.unlisten(job.dedupeKey, onPartial);
    // Só para a geração se ninguém mais estiver esperando por ela.
    if (!shared && (!job.dedupeKey || inflight.listenerCount(job.dedupeKey) === 0)) {
      job.cancelQueued?.();
      job.ctrl.abort(new Error('cancelado'));
    }
    if (!placeholderGone) removePinguMessage(placeholder).catch(() => {});
  };
  try {
    const res = await promise;
    if (entry.cancelled) return null;
    closed = true;
    throttle.finish();
    const text = cleanAnswer(res.text, { truncated: res.truncated, max: job.budget.maxAnswer, keepFormat: job.kind === 'rewrite' })
      || 'Hmm, não consegui pensar numa resposta. Pode perguntar de outro jeito? 🐧';
    await updatePinguMessage(placeholder, text, { persist: true });
    if (job.cacheKey && !shared) answerCache.set(job.cacheKey, text);
    if (job.roomId) memory.remember(job.userId, job.roomId, job.question, text);
    return text;
  } catch (err) {
    if (entry.cancelled || err?.code === 'CANCELLED') return null;
    closed = true;
    throttle.finish();
    let text;
    if (err?.code === 'BUSY') text = BUSY_REPLY;
    else {
      console.warn('[pingu] falha ao responder:', err?.message || err);
      await checkHealth().catch(() => {});
      text = online ? 'Ops, me enrolei aqui e não consegui responder agora. Tenta de novo daqui a pouco? 🐧' : OFFLINE_REPLY;
    }
    await updatePinguMessage(placeholder, text, { persist: true }).catch(() => {});
    return null;
  } finally {
    if (active.get(job.sourceMessageId) === entry) active.delete(job.sourceMessageId);
    byPlaceholder.delete(placeholder.id);
  }
}

/**
 * A mensagem foi apagada (messageController.deleteMessage): se ela pediu
 * algo ao Pingu, cancela; se era a resposta do Pingu sendo escrita, também.
 */
function onMessageDeleted(messageId) {
  try {
    const fromPlaceholder = byPlaceholder.get(messageId);
    const entry = active.get(fromPlaceholder || messageId);
    if (entry) entry.cancel({ placeholderGone: !!fromPlaceholder });
    if (imageServiceStarted) require('./pingu/imageRuntime').getService().cancelBySource(messageId).catch(() => {});
  } catch (err) {
    console.warn('[pingu] cancelar:', err?.message || err);
  }
}

// ---------------- pedidos ----------------

// Comandos depois do @pingu (só o começo da mensagem).
const RESUME_RE = /^(resum[eao]|resumir|resumo)\b/i;
const QUIZ_RE = /^quiz\b/i;

async function isStaff(userId) {
  const u = await db().user.findUnique({ where: { id: userId }, select: { platformRole: true } }).catch(() => null);
  return !!u && ['ADMIN', 'MODERATOR'].includes(u.platformRole);
}

/** Recursos da Fase 9 que olham TODA mensagem de canal (baratos; nunca lançam). */
function runMessageHooks(ctx) {
  const { message } = ctx;
  if (!message || (pinguId && message.authorId === pinguId)) return;
  try { require('./pingu/quiz').onMessage(io, message); } catch (err) { console.warn('[pingu] quiz:', err?.message || err); }
  try { require('./pingu/modAssist').onMessage(io, ctx); } catch (err) { console.warn('[pingu] moderação:', err?.message || err); }
}

/** @pingu resume / @pingu quiz. true = era um comando (já tratado). */
function handleCommand(message, question, channel) {
  if (RESUME_RE.test(question)) {
    require('./pingu/summary').requestSummary({ userId: message.authorId, channelId: message.channelId, channelName: channel?.name, until: message.createdAt || new Date() })
      .then((r) => sendEphemeral(message.authorId, { kind: 'summary', channelId: message.channelId, ...r }))
      .catch((err) => sendEphemeral(message.authorId, { kind: 'summary', channelId: message.channelId, error: err?.message || 'Não deu pra resumir agora.' }));
    return true;
  }
  if (QUIZ_RE.test(question)) {
    isStaff(message.authorId).then((ok) => {
      if (!ok) { sendEphemeral(message.authorId, { kind: 'info', channelId: message.channelId, text: 'Só a equipe pode começar um quiz. 🐧' }); return null; }
      return require('./pingu/quiz').startRound(io, { channelId: message.channelId, startedBy: message.authorId });
    }).catch((err) => sendEphemeral(message.authorId, { kind: 'info', channelId: message.channelId, error: err?.message || 'Não deu pra começar o quiz.' }));
    return true;
  }
  return false;
}

let imageServiceStarted = false;
function imageService() {
  imageServiceStarted = true;
  return require('./pingu/imageRuntime').getService();
}

/** Segura spam das respostas instantâneas (em silêncio). true = pode seguir. */
function takeLocal(userId) {
  const now = Date.now();
  if (now - (lastLocalAt.get(userId) || 0) < LOCAL_COOLDOWN_MS) return false;
  lastLocalAt.set(userId, now);
  if (lastLocalAt.size > 5000) lastLocalAt.delete(lastLocalAt.keys().next().value);
  return true;
}

/** Resposta "só você vê" no canal; na DM vira mensagem normal. */
function privateReply(ctx, text, title = 'Pingu') {
  if (ctx.isDm) return replyAsPingu(ctx.target, text).catch(() => {});
  sendEphemeral(ctx.message.authorId, { kind: 'info', channelId: ctx.message.channelId, title, text });
  return Promise.resolve();
}

async function handleImage(ctx, intent) {
  const { message, target } = ctx;
  if (ctx.isDm) {
    await replyAsPingu(target, '🎨 Imagens eu crio só nos canais (assim a equipe consegue acompanhar). Me chama com "@pingu desenhe …" num canal! 🐧');
    return true;
  }
  const svc = imageService();
  let rerollFrom = null;
  if (intent.type === 'reroll') {
    if (message.replyTo?.authorId === pinguId) {
      const log = await db().pinguImage.findFirst({ where: { messageId: message.replyTo.id }, select: { prompt: true, width: true, height: true } }).catch(() => null);
      if (!log) return false; // respondendo um texto do Pingu: "outra" é pergunta normal
      rerollFrom = { prompt: log.prompt, size: log.width > log.height ? 'paisagem' : log.width < log.height ? 'retrato' : 'quadrada' };
    } else if (!svc.hasRecent(message.authorId)) return false;
  }
  await svc.request({
    userId: message.authorId, target, prompt: intent.prompt, size: intent.size,
    sourceMessageId: message.id, reroll: intent.type === 'reroll', rerollFrom,
  });
  return true;
}

async function handleReminder(ctx, intent) {
  const { message } = ctx;
  let link = null;
  try {
    const lr = require('./linkResolver');
    link = ctx.isDm
      ? lr.conversationPath({ id: ctx.conversationId, isGroup: false }, { otherUsername: USERNAME })
      : `${lr.channelPath(ctx.channel)}?m=${encodeURIComponent(message.id)}`;
  } catch { link = null; }
  const r = await require('./pingu/actions').createReminder({ userId: message.authorId, question: intent.text, link, messageId: message.id });
  if (ctx.isDm) { await replyAsPingu(ctx.target, r.text); return; }
  sendEphemeral(message.authorId, { kind: 'info', channelId: message.channelId, title: 'Lembrete', text: r.text });
  if (r.ok) reactAsPingu(message, '⏰');
}

async function handlePoll(ctx, intent) {
  if (ctx.isDm) { await replyAsPingu(ctx.target, '📊 Enquetes eu crio só nos canais. 🐧'); return; }
  const r = await require('./pingu/actions').createPoll({
    io, userId: ctx.message.authorId, authorName: ctx.message.author?.displayName, channel: ctx.channel,
    sourceMessage: ctx.message, body: intent.body, pinguId: await botId(), threadRoot: ctx.threadRoot,
  });
  if (!r.ok) sendEphemeral(ctx.message.authorId, { kind: 'info', channelId: ctx.message.channelId, title: 'Enquete', text: r.text });
}

/** Pergunta que precisa da IA (pergunta normal, explicar, resumir isso, reescrever). */
function askAi(ctx, { kind, question }) {
  const { message, target } = ctx;
  if (!enabled()) return;
  if (!online) { replyAsPingu(target, OFFLINE_REPLY).catch(() => {}); return; }
  const now = Date.now();
  if (now - (lastAskAt.get(message.authorId) || 0) < USER_COOLDOWN_MS) return; // segura o spam em silêncio
  lastAskAt.set(message.authorId, now);
  const replyIsPingu = message.replyTo?.authorId === pinguId;
  const normalized = normalize(question);
  const previousAnswer = replyIsPingu
    ? String(message.replyTo.content || '').replace(/\s+/g, ' ').trim().slice(0, CONTEXT_CHARS) || null
    : null;
  const reply = kind !== 'question' && message.replyTo
    ? { author: message.replyTo.author?.displayName || 'alguém', content: String(message.replyTo.content || '') }
    : null;
  const mem = (replyIsPingu || isFollowUp(normalized)) && kind === 'question' ? memory.recall(message.authorId, ctx.roomId) : [];
  // Cache/carona só pra pergunta "solta" de canal (sem memória, sem resposta anterior, nunca DM).
  const cacheKey = !ctx.isDm && kind === 'question' && !mem.length && !previousAnswer ? cacheKeyFor(question) : null;
  if (cacheKey) {
    answerCache.setVersion(cacheVersion());
    const hit = answerCache.get(cacheKey);
    if (hit) {
      perf.cacheHits += 1;
      memory.remember(message.authorId, ctx.roomId, question, hit);
      replyAsPingu(target, hit).catch(() => {});
      return;
    }
  }
  const budget = promptLib.budgetFor(kind, kind === 'rewrite' ? reply?.content : question);
  const userTurn = promptLib.buildUserTurn({
    question, wiki: kind === 'question' ? wikiContextFor(question) : null, reply, task: kind === 'question' ? null : kind, normalized,
  });
  const messages = promptLib.buildMessages({ system: systemPrompt(), memory: mem, previousAnswer, userTurn });
  runAnswer({
    target, sourceMessageId: message.id, userId: message.authorId, roomId: ctx.roomId,
    question, kind, messages, budget, cacheKey, dedupeKey: cacheKey ? `${cacheVersion()}|${cacheKey}` : null,
  }).catch((err) => console.warn('[pingu] resposta:', err?.message || err));
}

/** Tudo que chega pro Pingu (canal ou DM) passa aqui. */
async function handleIncoming(ctx) {
  const { message } = ctx;
  const question = cleanQuestion(message.content);
  // Comandos antigos (resumo/quiz) só em canal e sem estar respondendo alguém.
  if (!ctx.isDm && !message.replyTo && handleCommand(message, question, ctx.channel)) return;
  const replyIsPingu = message.replyTo?.authorId === pinguId;
  const intent = parseIntent(question, { hasReply: !!message.replyTo && !replyIsPingu && !!message.replyTo.content });

  if (intent.type === 'image' || intent.type === 'reroll') {
    if (await handleImage(ctx, intent)) return;
  } else if (intent.type === 'help') {
    if (!takeLocal(message.authorId)) return;
    perf.localHits += 1;
    await privateReply(ctx, require('./pingu/tools').helpText(), 'Comandos do Pingu');
    return;
  } else if (intent.type === 'reminder') {
    if (!takeLocal(message.authorId)) return;
    await handleReminder(ctx, intent);
    return;
  } else if (intent.type === 'poll') {
    if (!takeLocal(message.authorId)) return;
    await handlePoll(ctx, intent);
    return;
  } else if (intent.type === 'explain' || intent.type === 'summarizeThis' || intent.type === 'rewrite') {
    askAi(ctx, { kind: intent.type, question });
    return;
  }

  // Respostas instantâneas (sem IA): contas, conversões, hora, dados, wiki…
  if (!replyIsPingu || question.length < 120) {
    let local = null;
    try {
      const wiki = require('./pingu/wiki');
      local = require('./pingu/tools').tryLocalTool(question, { pages: wiki.cachedPages(), wiki });
    } catch (err) { console.warn('[pingu] ferramenta:', err?.message || err); }
    if (local) {
      if (!takeLocal(message.authorId)) return;
      perf.localHits += 1;
      memory.remember(message.authorId, ctx.roomId, question, local.text);
      await replyAsPingu(ctx.target, local.text);
      return;
    }
  }
  askAi(ctx, { kind: 'question', question });
}

function targetFor({ message, channel, threadRoot, conversationId }) {
  return conversationId
    ? { conversationId, replyToId: message.id }
    : { channelId: message.channelId, channel, threadId: message.threadId || null, threadRoot: threadRoot || null, replyToId: message.id };
}

/**
 * Chamado depois que uma mensagem de CANAL foi criada e enviada
 * (messageController). Nunca lança: o envio da mensagem já terminou.
 */
function onChannelMessage(ioServer, { message, channel, mentionRows, threadRoot }) {
  try {
    io = io || ioServer;
    if (channel) runMessageHooks({ message, channel, mentionRows });
    if (!channel || !pinguId || !isForPingu(message, mentionRows)) return;
    const ctx = {
      message, channel, threadRoot, mentionRows, isDm: false,
      roomId: `c:${message.channelId}:${message.threadId || ''}`,
      target: targetFor({ message, channel, threadRoot }),
    };
    handleIncoming(ctx).catch((err) => console.error('[pingu] erro ao responder:', err?.message || err));
  } catch (err) {
    console.error('[pingu] erro ao receber mensagem:', err?.message || err);
  }
}

// DM 1:1 com o Pingu? (cache por conversa: membros de uma DM não mudam)
const dmCache = new Map();
async function isPinguDm(conversationId) {
  if (dmCache.has(conversationId)) return dmCache.get(conversationId);
  const conv = await db().conversation.findUnique({ where: { id: conversationId }, select: { isGroup: true, members: { select: { userId: true } } } }).catch(() => null);
  const yes = !!conv && !conv.isGroup && conv.members.length === 2 && conv.members.some((m) => m.userId === pinguId);
  dmCache.set(conversationId, yes);
  if (dmCache.size > 5000) dmCache.delete(dmCache.keys().next().value);
  return yes;
}

/**
 * Mensagem nova numa DM (messageController). Só faz algo se for a DM 1:1
 * com o Pingu. A conversa NUNCA vai pra moderação, cache compartilhado nem
 * registro de imagens. Nunca lança.
 */
function onDirectMessage(ioServer, { message, conversationId }) {
  try {
    io = io || ioServer;
    if (!pinguId || !message || !conversationId || message.authorId === pinguId) return;
    if (!String(message.content || '').trim()) return;
    isPinguDm(conversationId).then((yes) => {
      if (!yes) return null;
      const ctx = { message, isDm: true, conversationId, roomId: `d:${conversationId}`, target: targetFor({ message, conversationId }) };
      return handleIncoming(ctx);
    }).catch((err) => console.error('[pingu] DM:', err?.message || err));
  } catch (err) {
    console.error('[pingu] erro na DM:', err?.message || err);
  }
}

/** Wiki, configurações, quiz diário: funcionam mesmo sem a IA. */
async function startFeatures() {
  await require('./pingu/config').loadConfig().catch((err) => console.warn('[pingu] config:', err?.message || err));
  await require('./pingu/wiki').ensureSeed().catch((err) => console.warn('[wiki] seed:', err?.message || err));
  await require('./pingu/quiz').ensureSeed().catch((err) => console.warn('[pingu] quiz seed:', err?.message || err));
  require('./pingu/quiz').startScheduler(io);
  // Conta já existente: o quiz e as boas-vindas reconhecem o Pingu sem IA.
  if (!pinguId) {
    const existing = await db().user.findUnique({ where: { username: USERNAME }, select: { id: true } }).catch(() => null);
    if (existing) pinguId = existing.id;
  }
}

async function start(ioServer) {
  if (started) return;
  started = true;
  io = ioServer;
  await startFeatures().catch((err) => console.warn('[pingu] funções:', err?.message || err));
  if (!enabled()) { console.log('[pingu] IA desligada (sem PINGU_OLLAMA_URL) — respostas instantâneas e imagens seguem'); return; }
  try {
    pinguId = await ensureAccount();
  } catch (err) {
    started = false;
    console.error('[pingu] não deu pra preparar a conta:', err?.message || err);
    return;
  }
  await loadSettings().catch((err) => console.warn('[pingu] configurações:', err?.message || err));
  // Começa offline de verdade (restart do servidor) e confere a IA.
  online = true;
  await setOnline(false);
  await checkHealth();
  healthTimer = setInterval(checkHealth, HEALTH_EVERY_MS);
  healthTimer.unref?.();
}

module.exports = {
  start, onChannelMessage, onDirectMessage, onMessageDeleted, adminState, updateFromAdmin, setImageFromAdmin,
  // Fase 9: fila única da IA e ajudantes pros recursos novos (services/pingu/*).
  askModel, isOnline, botId, postAsPingu, sendEphemeral, cleanAnswer, PRIORITY, OFFLINE_TEXT, BUSY_TEXT,
  // Pingu Turbo: mensagens do Pingu (imagens, respostas ao vivo).
  createPinguMessage, updatePinguMessage, attachImageToPinguMessage, removePinguMessage, replyAsPingu,
  getPinguId: () => pinguId,
  _test: {
    isForPingu, cleanQuestion, cleanAnswer, systemPrompt, buildChat, enqueue, chatStreaming, chatBody, handleIncoming, runAnswer,
    setSettings: (v) => { settings = { ...settings, ...v }; },
    setPinguId: (id) => { pinguId = id; },
    setEnabled: (v) => { forceEnabled = !!v; },
    setOnline: (v) => { online = !!v; },
    setChat: (fn) => { chatImpl = fn; },
    setStream: (fn) => { streamImpl = fn; },
    setIo: (v) => { io = v; },
    setDeps: ({ db: d = null, include = null } = {}) => { injected.db = d; injected.include = include; },
    cache: answerCache,
    memory,
    perf,
    queueLength: () => queue.length + (busy ? 1 : 0),
    reset: () => {
      queue.length = 0; busy = false; lastAskAt.clear(); lastLocalAt.clear(); answerCache.clear(); memory.clear();
      active.clear(); byPlaceholder.clear(); streamOffUntil = 0;
    },
  },
};
