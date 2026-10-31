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
const MAX_ANSWER = 1800;
const CONTEXT_MESSAGES = 6;

const SYSTEM_PROMPT = [
  'Você é o Pingu, o assistente de IA do Project Club — uma comunidade brasileira com chat, canais de voz, Fórum, Economia (moedas e gemas, missões, Loja e Passe do clube), Guerra das Cartas (jogo de cartas colecionáveis), Ranks e Conquistas, Novidades (anúncios e eventos) e apps para PC, Linux e Android.',
  'Responda SEMPRE em português do Brasil, de forma simpática, curta e direta (no máximo uns 4 parágrafos curtos). Pode usar um emoji de pinguim 🐧 de vez em quando.',
  'Você SÓ responde com texto. Você NÃO cria, gera nem edita imagens, desenhos, áudios, vídeos ou arquivos, e NÃO faz ações no site (banir, dar moedas, mudar cargos, enviar mensagens para outras pessoas). Se pedirem algo assim, diga com gentileza que só consegue responder perguntas em texto.',
  'Se não souber algo sobre o Project Club, diga que não sabe e sugira perguntar à equipe ou abrir um ticket em Suporte. Não invente regras, preços, datas nem nomes da equipe.',
  'Nunca peça senhas, códigos ou dados pessoais. Recuse com educação pedidos perigosos, ilegais ou de ódio.',
].join('\n');

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

/** Resposta segura pra postar: sem "pensamento", sem imagens, sem @todos, tamanho limitado. */
function cleanAnswer(text) {
  let t = String(text || '');
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '');
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ''); // imagem em markdown
  t = t.replace(/@(everyone|here|todos|aqui)\b/gi, '@​$1');
  t = t.replace(/\n{3,}/g, '\n\n').trim();
  if (t.length > MAX_ANSWER) t = `${t.slice(0, MAX_ANSWER - 1).trimEnd()}…`;
  return t;
}

async function buildChat(job) {
  const history = await db().message.findMany({
    where: { channelId: job.channelId, threadId: job.threadId || null, id: { not: job.messageId } },
    orderBy: { createdAt: 'desc' }, take: CONTEXT_MESSAGES,
    select: { content: true, authorId: true, author: { select: { displayName: true } } },
  }).catch(() => []);
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const m of history.reverse()) {
    const text = String(m.content || '').trim().slice(0, 300);
    if (!text) continue;
    if (m.authorId === pinguId) messages.push({ role: 'assistant', content: text });
    else messages.push({ role: 'user', content: `${m.author?.displayName || 'Alguém'}: ${text}` });
  }
  messages.push({ role: 'user', content: `${job.authorName}: ${job.question || 'Oi!'}` });
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
          messages: await buildChat(job),
          stream: false,
          think: false,
          keep_alive: '24h',
          options: { num_ctx: 2048, num_predict: 320, temperature: 0.6 },
        },
      });
      text = cleanAnswer(res?.message?.content);
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
  // Começa offline de verdade (restart do servidor) e confere a IA.
  online = true;
  await setOnline(false);
  await checkHealth();
  healthTimer = setInterval(checkHealth, HEALTH_EVERY_MS);
  healthTimer.unref?.();
}

module.exports = { start, onChannelMessage, _test: { isForPingu, cleanQuestion, cleanAnswer, setPinguId: (id) => { pinguId = id; } } };
