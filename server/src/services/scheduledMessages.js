// Mensagens agendadas ("enviar às 18h", "enviar amanhã às 9h").
//
// A mensagem fica em ScheduledMessage até a hora. O job roda a cada 20s,
// RESERVA cada linha vencida (updateMany PENDING → claimedAt, atômico: duas
// instâncias nunca enviam a mesma) e envia pelo MESMO caminho do envio
// normal (createMessageInner do messageController: permissão, automod,
// menções, push, socket) — como se a pessoa tivesse apertado Enter naquela
// hora. Perdeu o acesso ao canal até lá? Vira FAILED com o motivo, e a
// pessoa recebe um aviso.
const prisma = require('../config/prisma');
const { createNotice } = require('./notices');

const TICK_MS = 20 * 1000;
const MAX_PER_TICK = 25;
const MAX_PENDING_PER_USER = 30;
const MAX_AHEAD_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const MIN_AHEAD_MS = 30 * 1000;
let timer = null;

// Validação do agendamento (pura — testável).
function validateSchedule({ content, sendAt, channelId, conversationId }, now = Date.now()) {
  const text = typeof content === 'string' ? content.trim() : '';
  if (!text) return { error: 'Escreva a mensagem.' };
  if (text.length > 4000) return { error: 'Mensagem longa demais (máx. 4000 caracteres).' };
  if (!channelId && !conversationId) return { error: 'Informe o canal ou a conversa.' };
  if (channelId && conversationId) return { error: 'Informe só o canal ou só a conversa.' };
  const at = new Date(sendAt);
  if (Number.isNaN(at.getTime())) return { error: 'Data/hora inválida.' };
  if (at.getTime() < now + MIN_AHEAD_MS) return { error: 'Escolha um horário pelo menos 30 segundos à frente.' };
  if (at.getTime() > now + MAX_AHEAD_MS) return { error: 'Dá pra agendar até 30 dias à frente.' };
  return { ok: true, content: text, sendAt: at };
}

// Monta um "req/res" mínimo pra reaproveitar createMessageInner sem HTTP.
function fakeHttp({ user, io, body }) {
  const req = { user, body, files: [], app: { get: (k) => (k === 'io' ? io : undefined) }, precheckedRoom: null, headers: {}, ip: '127.0.0.1' };
  const out = { status: 200, json: null };
  const res = {
    status(code) { out.status = code; return res; },
    json(payload) { out.json = payload; return res; },
  };
  return { req, res, out };
}

async function deliverOne(io, row, deps) {
  const { createMessageInner } = deps.messageController;
  const user = await prisma.user.findUnique({ where: { id: row.authorId } });
  if (!user) { await prisma.scheduledMessage.update({ where: { id: row.id }, data: { status: 'FAILED', error: 'Conta não existe mais.' } }); return; }
  const { req, res, out } = fakeHttp({
    user, io,
    body: { channelId: row.channelId || undefined, conversationId: row.conversationId || undefined, content: row.content, replyToId: row.replyToId || undefined },
  });
  let ok = false; let error = null;
  try {
    ok = await createMessageInner(req, res);
    if (!ok) error = (out.json && out.json.error) || `Envio recusado (${out.status}).`;
  } catch (err) {
    error = (err && err.message) || 'Falha ao enviar.';
  }
  if (ok) {
    await prisma.scheduledMessage.update({ where: { id: row.id }, data: { status: 'SENT', sentMessageId: out.json?.message?.id || null } });
    io?.notifyUser?.(row.authorId, 'scheduled:sent', { id: row.id, messageId: out.json?.message?.id || null });
  } else {
    await prisma.scheduledMessage.update({ where: { id: row.id }, data: { status: 'FAILED', error: String(error).slice(0, 300) } });
    io?.notifyUser?.(row.authorId, 'scheduled:failed', { id: row.id, error });
    await createNotice(io, row.authorId, {
      kind: 'SCHEDULED_FAILED', title: 'Mensagem agendada não enviada',
      body: `${String(error).slice(0, 200)} — "${row.content.slice(0, 80)}"`,
      // /canal/<id> e /dm/<id> abrem e o site troca pelo endereço bonito.
      link: row.channelId ? `/canal/${row.channelId}` : `/dm/${row.conversationId}`,
    });
  }
}

async function tick(io, deps, now = Date.now()) {
  try {
    const due = await prisma.scheduledMessage.findMany({
      where: { status: 'PENDING', sendAt: { lte: new Date(now) } },
      orderBy: { sendAt: 'asc' }, take: MAX_PER_TICK, select: { id: true },
    });
    for (const { id } of due) {
      // eslint-disable-next-line no-await-in-loop
      const claimed = await prisma.scheduledMessage.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'SENDING', claimedAt: new Date(now) } });
      if (claimed.count !== 1) continue;
      // eslint-disable-next-line no-await-in-loop
      const row = await prisma.scheduledMessage.findUnique({ where: { id } });
      // eslint-disable-next-line no-await-in-loop
      if (row) await deliverOne(io, row, deps);
    }
    // Reserva presa (processo caiu no meio): volta pra PENDING depois de 5 min.
    await prisma.scheduledMessage.updateMany({
      where: { status: 'SENDING', claimedAt: { lt: new Date(now - 5 * 60 * 1000) } }, data: { status: 'PENDING', claimedAt: null },
    });
  } catch (err) {
    console.error('[agendadas] tick falhou:', err?.message || err);
  }
}

function startScheduledMessages(io, deps = {}) {
  if (timer) return timer;
  const resolved = { messageController: deps.messageController || require('../controllers/messageController') };
  timer = setInterval(() => tick(io, resolved), TICK_MS);
  timer.unref?.();
  return timer;
}

function stopScheduledMessages() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { validateSchedule, tick, startScheduledMessages, stopScheduledMessages, MAX_PENDING_PER_USER, fakeHttp };
