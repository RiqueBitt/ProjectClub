// Fase 5 — Mensagens temporárias nas DMs.
//
// Cada conversa tem Conversation.ephemeralSeconds (null = desligado, 24 horas
// ou 7 dias). Qualquer participante pode mudar; uma linha de sistema na
// conversa mostra quem mudou. Mensagens criadas com isso ligado ganham
// Message.expiresAt; a faxina abaixo apaga de verdade (a linha, os anexos,
// reações etc. em cascata) o que já venceu e avisa os clientes abertos com
// o mesmo evento de "mensagem apagada" ('message:delete').
//
// Tudo recebe `db` injetado (testes sem banco).
const getPrisma = () => require('../config/prisma');

const OPTIONS = Object.freeze({ off: null, '24h': 24 * 60 * 60, '7d': 7 * 24 * 60 * 60 });
const ALLOWED_SECONDS = new Set(Object.values(OPTIONS).filter(Boolean));
const SWEEP_INTERVAL_MS = 2 * 60 * 1000;
const SWEEP_BATCH = 500;
const SWEEP_MAX_BATCHES = 20;

// 'off' | '24h' | '7d' (ou os segundos) → segundos válidos, null (desligado)
// ou undefined (valor inválido).
function normalizeMode(input) {
  if (input === null || input === 'off' || input === 0 || input === '0') return null;
  if (typeof input === 'string' && Object.prototype.hasOwnProperty.call(OPTIONS, input)) return OPTIONS[input];
  const n = typeof input === 'number' ? input : (typeof input === 'string' && /^\d+$/.test(input) ? Number(input) : NaN);
  return ALLOWED_SECONDS.has(n) ? n : undefined;
}

function modeLabel(seconds) {
  if (seconds === OPTIONS['24h']) return '24 horas';
  if (seconds === OPTIONS['7d']) return '7 dias';
  return 'desligado';
}

// Quando uma mensagem criada AGORA numa conversa com `seconds` vence.
function computeExpiresAt(seconds, now = new Date()) {
  if (!ALLOWED_SECONDS.has(seconds)) return null;
  return new Date(now.getTime() + seconds * 1000);
}

// Prazo pra uma mensagem nova numa conversa (null em canal ou desligado).
// Nunca derruba o envio: erro na leitura = mensagem normal.
async function expiryForConversation(conversationId, { db = getPrisma(), now = new Date() } = {}) {
  if (!conversationId) return null;
  try {
    const conv = await db.conversation.findUnique({ where: { id: conversationId }, select: { ephemeralSeconds: true } });
    return computeExpiresAt(conv?.ephemeralSeconds ?? null, now);
  } catch {
    return null;
  }
}

// Linha de sistema "Fulano ativou/desativou as mensagens temporárias" (mesmo
// formato da de "fixou uma mensagem": a marca fica no JSON do embed e o
// `description` serve de texto pra clientes que não conhecem o tipo).
function buildEphemeralSystemEmbed({ actorName, seconds }) {
  const name = String(actorName || 'Alguém').slice(0, 80);
  const on = ALLOWED_SECONDS.has(seconds);
  const description = on
    ? `⏱️ ${name} ativou as mensagens temporárias: mensagens novas somem depois de ${modeLabel(seconds)}.`
    : `⏱️ ${name} desativou as mensagens temporárias.`;
  return JSON.stringify({ system: 'ephemeral', seconds: on ? seconds : null, description });
}

// Faxina: apaga as mensagens vencidas em lotes e devolve quantas apagou.
// O `where` é exportado pros testes conferirem que só pega mensagem com
// prazo (expiresAt não nulo) e já vencida.
function expiredWhere(now = new Date()) {
  return { expiresAt: { not: null, lte: now } };
}

async function sweepExpiredMessages({ db = getPrisma(), io = null, now = new Date(), batch = SWEEP_BATCH, maxBatches = SWEEP_MAX_BATCHES } = {}) {
  let total = 0;
  for (let i = 0; i < maxBatches; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await db.message.findMany({
      where: expiredWhere(now),
      select: { id: true, conversationId: true, channelId: true, threadId: true },
      orderBy: { expiresAt: 'asc' },
      take: batch,
    });
    if (!rows.length) break;
    const ids = rows.map((r) => r.id);
    // Favoritos que apontavam pra elas (sem FK no schema) saem junto.
    // eslint-disable-next-line no-await-in-loop
    await db.savedMessage?.deleteMany?.({ where: { messageId: { in: ids } } })?.catch?.(() => {});
    // Anexos, reações, menções, enquete etc. saem em cascata (onDelete: Cascade).
    // eslint-disable-next-line no-await-in-loop
    const { count } = await db.message.deleteMany({ where: { id: { in: ids }, ...expiredWhere(now) } });
    total += count;
    rows.forEach((r) => {
      const room = r.conversationId ? `conversation:${r.conversationId}` : `channel:${r.channelId}`;
      io?.to?.(room)?.emit?.('message:delete', { id: r.id, conversationId: r.conversationId, channelId: r.channelId, threadId: r.threadId || null });
    });
    if (rows.length < batch) break;
  }
  return total;
}

let timer = null;
function startEphemeralSweeper(io) {
  if (timer) return;
  const run = () => sweepExpiredMessages({ io })
    .then((n) => { if (n) console.log(`[temporárias] ${n} mensagem(ns) vencida(s) apagada(s).`); })
    .catch((err) => console.error('[temporárias] faxina falhou:', err?.message || err));
  timer = setInterval(run, SWEEP_INTERVAL_MS);
  timer.unref?.();
  setTimeout(run, 30 * 1000).unref?.();
}

module.exports = {
  OPTIONS, ALLOWED_SECONDS, normalizeMode, modeLabel, computeExpiresAt, expiryForConversation,
  buildEphemeralSystemEmbed, expiredWhere, sweepExpiredMessages, startEphemeralSweeper,
};
