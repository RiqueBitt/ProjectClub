// Pingu — assistente de IA do Project Club.
//
// Uma conta normal da comunidade ("Pingu", @pingu) que responde quando é
// mencionada (@pingu …) ou quando alguém responde uma mensagem dela. A IA
// roda num Ollama PRÓPRIO, na VPS do Project Club; este servidor só pergunta
// e posta a resposta como o Pingu.
//
// - Online/offline: o Pingu fica online enquanto a IA responde (conferida a
//   cada 30 s) e some sozinho quando a VPS desliga. A presença usa o mesmo
//   Redis das pessoas (presenceStore) com um "socket" próprio, então a
//   varredura de presença concorda com isso.
// - Só texto: nada de imagem, áudio, arquivo ou ação no site. As respostas
//   saem sem imagens/links de imagem e sem @todos.
// - Uma pergunta por vez (a VPS tem 2 vCPU): fila curta e espera por pessoa.
//
// Configuração (variáveis de ambiente; sem PINGU_OLLAMA_URL fica desligado):
//   PINGU_OLLAMA_URL  ex.: https://38-92-41-54.sslip.io  (proxy na VPS)
//   PINGU_OLLAMA_KEY  senha do proxy (Authorization: Bearer …)
//   PINGU_MODEL       padrão qwen3.5:2b
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
// Banco e Redis só quando o Pingu está ligado (os testes dos filtros não
// precisam conectar em nada).
const db = () => require('../config/prisma');
const presence = () => require('./presenceStore');

const USERNAME = 'pingu';
const DISPLAY_NAME = 'Pingu';
const EMAIL = 'pingu@bot.projectclub.local';
const PRESENCE_SOCKET = 'pingu-ia';
const HEALTH_EVERY_MS = 30_000;
const HEALTH_TIMEOUT_MS = 8_000;
const ANSWER_TIMEOUT_MS = 120_000;
const QUEUE_MAX = 6;
const USER_COOLDOWN_MS = 8_000;
const MAX_QUESTION = 800;
const MAX_ANSWER = 600;
// Velocidade (2 vCPU, sem placa de vídeo): o qwen3.5 relê o prompt INTEIRO a
// cada pergunta (~37 tokens/s) e escreve ~10 tokens/s — medido na VPS. Então:
// instruções curtas, sem o histórico do canal (só a mensagem do Pingu quando
// alguém responde ele) e resposta curta. Ficou em ~4–8 s (antes 13–26 s).
const CONTEXT_CHARS = 240;
const NUM_CTX = 1024;
const NUM_PREDICT = 120;
const MAX_INSTRUCTIONS = 2000;

const BASE_PROMPT = (name) => `Você é o ${name}, assistente do Project Club (comunidade brasileira com chat, voz, Fórum, Economia, Loja e Guerra das Cartas). Responda em português do Brasil, simples e amigável, em 1 a 3 frases curtas, sem listas nem negrito. Só responda em texto: não crie imagens nem faça ações no site. Quando não souber algo do Project Club, admita e indique a equipe. Não invente regras, preços ou datas e nunca peça senhas.`;

let settings = { name: DISPLAY_NAME, instructions: '' };
const systemPrompt = () => (settings.instructions
  ? `${BASE_PROMPT(settings.name)}\nO que você sabe sobre o Project Club:\n${settings.instructions}`
  : BASE_PROMPT(settings.name));

let io = null;
let pinguId = null;
let online = false;
let started = false;
let healthTimer = null;
const queue = [];
let busy = false;
const lastAskAt = new Map();

const config = () => ({
  url: String(process.env.PINGU_OLLAMA_URL || '').trim().replace(/\/+$/, ''),
  key: String(process.env.PINGU_OLLAMA_KEY || '').trim(),
  model: String(process.env.PINGU_MODEL || 'qwen3.5:2b').trim(),
});
const enabled = () => !!config().url;

async function ollama(path, { body, timeoutMs }) {
  const { url, key } = config();
  const res = await fetch(`${url}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`IA respondeu HTTP ${res.status}`);
  return res.json();
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
      tagEmoji: '🤖', tagText: 'IA',
      bio: 'Assistente de IA do Project Club. Me chame com @pingu e eu respondo! Só respondo em texto. 🐧',
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
  profileColor: true, profileNameColor: true, tagEmoji: true, tagText: true,
};
const HEX = /^#[0-9a-fA-F]{6}$/;

async function loadSettings() {
  const [user, row] = await Promise.all([
    pinguId ? db().user.findUnique({ where: { id: pinguId }, select: { displayName: true } }) : null,
    db().platformSettings.findUnique({ where: { id: 'singleton' }, select: { pinguInstructions: true } }).catch(() => null),
  ]);
  settings = {
    name: user?.displayName || DISPLAY_NAME,
    instructions: String(row?.pinguInstructions || '').trim().slice(0, MAX_INSTRUCTIONS),
  };
}

async function adminState() {
  if (!pinguId && enabled()) pinguId = await ensureAccount();
  const user = pinguId ? await db().user.findUnique({ where: { id: pinguId }, select: PROFILE_FIELDS }) : null;
  return {
    enabled: enabled(), online, model: config().model, queue: queue.length + (busy ? 1 : 0),
    user, instructions: settings.instructions, maxInstructions: MAX_INSTRUCTIONS,
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
  if (body.tagEmoji !== undefined) data.tagEmoji = String(body.tagEmoji || '').trim().slice(0, 16) || null;
  if (body.tagText !== undefined) data.tagText = String(body.tagText || '').trim().slice(0, 12) || null;
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

// ---------------- perguntas ----------------

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

/** Resposta segura e simples pra postar: sem "pensamento", sem imagens, sem @todos, sem enfeite de markdown. */
function cleanAnswer(text, { truncated = false } = {}) {
  let t = String(text || '');
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '');
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ''); // imagem em markdown
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1'); // negrito
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, ''); // títulos
  t = t.replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, ''); // listas viram frases
  t = t.replace(/@(everyone|here|todos|aqui)\b/gi, '@​$1');
  t = t.replace(/\n{3,}/g, '\n\n').trim();
  if (t.length > MAX_ANSWER) { t = t.slice(0, MAX_ANSWER); truncated = true; }
  return truncated && t ? finishSentence(t) : t;
}

function buildChat(job) {
  const messages = [{ role: 'system', content: systemPrompt() }];
  // Respondendo o Pingu: a mensagem dele entra pra ele saber do que se trata.
  if (job.previousAnswer) messages.push({ role: 'assistant', content: job.previousAnswer });
  messages.push({ role: 'user', content: job.question || 'Oi!' });
  return messages;
}

async function postAnswer(job, content) {
  const { messageInclude, roomFor } = require('../controllers/messageController');
  const message = await db().message.create({
    data: {
      content, authorId: pinguId, channelId: job.channelId,
      replyToId: job.messageId, threadId: job.threadId || null, quickReactions: '[]',
    },
    include: messageInclude,
  });
  io?.to(roomFor({ channelId: job.channelId })).emit('message:new', message);
  if (job.threadRoot) {
    require('./threads').afterThreadReply(io, { root: job.threadRoot, message, channel: job.channel }).catch(() => {});
  }
}

function typing(job, on) {
  const room = `channel:${job.channelId}`;
  io?.to(room).emit(on ? 'typing:start' : 'typing:stop', { userId: pinguId, channelId: job.channelId });
}

async function answer(job) {
  typing(job, true);
  const keepTyping = setInterval(() => typing(job, true), 4000);
  try {
    let text;
    try {
      const res = await ollama('/api/chat', {
        timeoutMs: ANSWER_TIMEOUT_MS,
        body: {
          model: config().model,
          messages: buildChat(job),
          stream: false,
          think: false,
          keep_alive: '24h',
          options: { num_ctx: NUM_CTX, num_predict: NUM_PREDICT, temperature: 0.5, top_p: 0.9 },
        },
      });
      text = cleanAnswer(res?.message?.content, { truncated: res?.done_reason === 'length' });
    } catch (err) {
      console.warn('[pingu] falha ao responder:', err.message);
      await checkHealth();
      text = online
        ? 'Ops, me enrolei aqui e não consegui responder agora. Tenta de novo daqui a pouco? 🐧'
        : 'Estou desligado agora (a minha IA está fora do ar). Tenta de novo mais tarde! 🐧';
    }
    await postAnswer(job, text || 'Hmm, não consegui pensar numa resposta. Pode perguntar de outro jeito? 🐧');
  } finally {
    clearInterval(keepTyping);
    typing(job, false);
  }
}

async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const job = queue.shift();
      // eslint-disable-next-line no-await-in-loop
      await answer(job).catch((err) => console.error('[pingu] erro:', err?.message || err));
    }
  } finally { busy = false; }
}

/**
 * Chamado depois que uma mensagem de CANAL foi criada e enviada
 * (messageController). Nunca lança: o envio da mensagem já terminou.
 */
function onChannelMessage(ioServer, { message, channel, mentionRows, threadRoot }) {
  try {
    if (!enabled() || !channel || !isForPingu(message, mentionRows)) return;
    io = io || ioServer;
    const now = Date.now();
    const job = {
      channelId: message.channelId, channel, threadId: message.threadId || null, threadRoot: threadRoot || null,
      messageId: message.id, authorName: message.author?.displayName || 'Alguém',
      previousAnswer: message.replyTo?.authorId === pinguId
        ? String(message.replyTo.content || '').replace(/\s+/g, ' ').trim().slice(0, CONTEXT_CHARS) || null
        : null,
      question: cleanQuestion(message.content),
    };
    if (!online) {
      postAnswer(job, 'Estou desligado agora (a minha IA está fora do ar). Tenta de novo mais tarde! 🐧').catch(() => {});
      return;
    }
    if (now - (lastAskAt.get(message.authorId) || 0) < USER_COOLDOWN_MS) return; // segura o spam em silêncio
    lastAskAt.set(message.authorId, now);
    if (queue.length >= QUEUE_MAX) {
      postAnswer(job, 'Tem muita gente falando comigo agora! Me chama de novo em um minutinho. 🐧').catch(() => {});
      return;
    }
    queue.push(job);
    pump();
  } catch (err) {
    console.error('[pingu] erro ao receber mensagem:', err?.message || err);
  }
}

async function start(ioServer) {
  if (started) return;
  started = true;
  io = ioServer;
  if (!enabled()) { console.log('[pingu] desligado (sem PINGU_OLLAMA_URL)'); return; }
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

module.exports = { start, onChannelMessage, adminState, updateFromAdmin, setImageFromAdmin, _test: { isForPingu, cleanQuestion, cleanAnswer, systemPrompt, setSettings: (v) => { settings = { ...settings, ...v }; }, setPinguId: (id) => { pinguId = id; } } };
