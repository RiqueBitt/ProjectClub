// "Resumir o que perdi": resumo em 3–5 tópicos das mensagens de um canal
// desde a última leitura da pessoa. A resposta é SÓ pra quem pediu (volta
// pelo socket pessoal / resposta HTTP), nunca é postada no canal.
//
// Pra caber na IA lenta: no máximo 60 mensagens, em linhas compactas
// "nome: texto", e ~1500 caracteres no total (ficam as mais recentes).
const { clip, createLimiter } = require('./text');

const db = () => require('../../config/prisma');
const bot = () => require('../pinguBot');

const MAX_MESSAGES = 60;
const MAX_CHARS = 1500;
const MAX_LINE = 160;
const LIMIT_WINDOW_MS = 2 * 60 * 1000;
const limiter = createLimiter({ windowMs: LIMIT_WINDOW_MS, max: 1 });

const SYSTEM = 'Você resume conversas de um chat brasileiro. Responda em português do Brasil com 3 a 5 tópicos curtos, um por linha, cada um começando com "• ". Sem introdução nem conclusão. Use só o que está na conversa e não invente nada.';

/** Texto de uma mensagem numa linha curta (sem links longos, sem quebras). */
function compactText(m) {
  let t = String(m.content || '')
    .replace(/```[\s\S]*?```/g, '[código]')
    .replace(/https?:\/\/\S+/g, '[link]')
    .replace(/<#[A-Za-z0-9_-]+>/g, '#canal')
    .replace(/<a?:(\w+):\d+>/g, ':$1:')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) {
    if (m.stickerUrl) t = '[figurinha]';
    else if (m.attachments?.length || m.attachmentCount) t = '[anexo]';
    else if (m.poll) t = '[enquete]';
  }
  return t ? clip(t, MAX_LINE) : '';
}

/**
 * Monta a conversa pra IA. `messages` em qualquer ordem (ordena por data);
 * ignora as do Pingu e as vazias. Mantém as mais recentes até caber.
 * Devolve { text, count, lines }.
 */
function buildTranscript(messages, { maxMessages = MAX_MESSAGES, maxChars = MAX_CHARS, skipAuthorId = null } = {}) {
  const sorted = [...(messages || [])]
    .filter((m) => m && !m.deleted && (!skipAuthorId || m.authorId !== skipAuthorId))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-maxMessages);
  const lines = [];
  for (const m of sorted) {
    const text = compactText(m);
    if (!text) continue;
    const name = clip(String(m.author?.displayName || m.author?.username || 'Alguém').replace(/[\n:]/g, ' ').trim(), 24);
    lines.push(`${name}: ${text}`);
  }
  // Corta do começo (mais antigas) até caber no total.
  let total = lines.reduce((n, l) => n + l.length + 1, 0);
  while (lines.length > 1 && total > maxChars) total -= lines.shift().length + 1;
  if (lines.length === 1 && lines[0].length > maxChars) lines[0] = clip(lines[0], maxChars);
  return { text: lines.join('\n'), count: lines.length, lines };
}

/** Deixa a resposta da IA em 3–5 tópicos "• …", sem markdown. */
function cleanBullets(text) {
  const lines = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/@(everyone|here|todos|aqui)\b/gi, '@​$1')
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((l) => l && !/^(resumo|aqui est)/i.test(l));
  return lines.slice(0, 5).map((l) => `• ${clip(l, 220)}`).join('\n');
}

// Leitura marcada agora há pouco (a pessoa acabou de abrir o canal pra
// pedir o resumo) não diz o que ela perdeu — nesse caso usa outra pista.
const RECENT_READ_MS = 2 * 60 * 1000;

/**
 * Desde quando resumir: 1) a última leitura que o app conhecia ao abrir o
 * canal (`since`); 2) a leitura salva no servidor, se não for de agora;
 * 3) pelo comando "@pingu resume" (`until` = hora do comando), desde a
 * mensagem anterior da própria pessoa; 4) nada (= últimas 60 mensagens).
 */
async function resolveSince({ userId, channelId, since, until }) {
  const given = since ? new Date(since) : null;
  if (given && !Number.isNaN(given.getTime())) return given;
  const st = await db().channelReadState.findUnique({ where: { channelId_userId: { channelId, userId } }, select: { lastReadAt: true } }).catch(() => null);
  const read = st?.lastReadAt ? new Date(st.lastReadAt) : null;
  const ref = until ? new Date(until).getTime() : Date.now();
  if (read && ref - read.getTime() > RECENT_READ_MS) return read;
  if (until) {
    const prev = await db().message.findFirst({
      where: { channelId, authorId: userId, threadId: null, createdAt: { lt: new Date(until) } },
      orderBy: { createdAt: 'desc' }, select: { createdAt: true },
    }).catch(() => null);
    if (prev?.createdAt) return prev.createdAt;
  }
  return null;
}

/**
 * Pede o resumo de um canal pra uma pessoa. A checagem de acesso ao canal
 * é de quem chama (rota usa assertAccess; o comando @pingu já veio de
 * alguém que escreveu no canal). Devolve { text } ou { error }.
 */
async function requestSummary({ userId, channelId, channelName, since = null, until = null }) {
  const cfg = require('./config').getConfig();
  if (!cfg.summaryEnabled) return { error: 'O resumo do Pingu está desligado pela equipe.' };
  if (!bot().isOnline()) return { error: bot().OFFLINE_TEXT };
  const lim = limiter.take(userId);
  if (!lim.ok) return { error: `Você pediu um resumo agora há pouco. Tenta de novo em ${Math.ceil(lim.retryInMs / 1000)} s.` };
  try {
    const after = await resolveSince({ userId, channelId, since, until });
    const end = until ? new Date(until) : null;
    const createdAt = { ...(after ? { gt: after } : {}), ...(end && !Number.isNaN(end.getTime()) ? { lt: end } : {}) };
    const rows = await db().message.findMany({
      where: { channelId, threadId: null, deleted: false, ...(Object.keys(createdAt).length ? { createdAt } : {}) },
      orderBy: { createdAt: 'desc' },
      take: MAX_MESSAGES,
      select: {
        id: true, content: true, createdAt: true, authorId: true, deleted: true, stickerUrl: true,
        author: { select: { username: true, displayName: true } },
        _count: { select: { attachments: true } },
      },
    });
    const transcript = buildTranscript(
      rows.map((r) => ({ ...r, attachmentCount: r._count?.attachments || 0 })),
      { skipAuthorId: bot().getPinguId() },
    );
    if (transcript.count === 0) {
      limiter.refund(userId);
      return { text: 'Você está em dia: não tem mensagem nova aqui desde a sua última visita. 🐧' };
    }
    const res = await bot().askModel([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Conversa no canal #${clip(channelName || 'canal', 40)}:\n${transcript.text}` },
    ], { priority: bot().PRIORITY.USER, numPredict: 170, temperature: 0.2 });
    const text = cleanBullets(res.text);
    return { text: text || 'Não consegui resumir essa conversa. Tenta de novo daqui a pouco? 🐧', count: transcript.count };
  } catch (err) {
    if (err?.code) limiter.refund(userId);
    return { error: err?.code ? err.message : 'Não deu pra resumir agora. Tenta de novo daqui a pouco.' };
  }
}

module.exports = { requestSummary, buildTranscript, cleanBullets, compactText, MAX_MESSAGES, MAX_CHARS };
