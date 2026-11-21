// Tópicos (threads) criados a partir de uma mensagem num canal de texto.
//
// Modelo (sem tabela nova — reaproveita Message, então anexos, reações,
// edição, fixar etc. funcionam igual em qualquer mensagem do tópico):
//   - RAIZ do tópico: mensagem com `title` + `replyToId` (a mensagem-mãe).
//     Foi sempre assim ("Criar tópico" no menu da mensagem). Agora a raiz
//     também guarda o resumo: isThread, threadReplyCount,
//     threadLastReplyAt, threadLastReplyId e threadArchivedAt.
//   - RESPOSTAS do tópico: mensagens com `threadId` = id da raiz. Ficam
//     fora da lista principal do canal (aparecem só no painel do tópico).
//   - Tópicos antigos (antes do threadId) respondiam com replyToId = raiz;
//     o painel continua mostrando essas respostas.
//
// Arquivamento:
//   - `archived` (já existia): trancado pela moderação — ninguém responde
//     até alguém com MANAGE_MESSAGES reabrir.
//   - `threadArchivedAt`: arquivado SOZINHO por inatividade (padrão 72h,
//     THREAD_AUTO_ARCHIVE_HOURS). Responder reabre na hora (igual Discord).
const DEFAULT_ARCHIVE_HOURS = 72;
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;
const SWEEP_BATCH = 200;
const PARTICIPANT_CAP = 50;

function db() { return require('../config/prisma'); }

function archiveAfterMs() {
  const h = Number(process.env.THREAD_AUTO_ARCHIVE_HOURS);
  return (Number.isFinite(h) && h > 0 ? h : DEFAULT_ARCHIVE_HOURS) * 3600 * 1000;
}

// Raiz de tópico de canal de texto (não confundir com post de fórum, que
// tem título mas NÃO tem replyToId).
function isThreadRoot(m) {
  return !!(m && m.channelId && m.title && m.replyToId);
}

// Valida a raiz pra quem quer responder no tópico. Devolve a raiz ou um
// { status, error } pra devolver ao cliente.
async function resolveThreadForReply(threadId, { channelId }) {
  if (!threadId) return { root: null };
  const root = await db().message.findUnique({
    where: { id: String(threadId) },
    select: {
      id: true, channelId: true, conversationId: true, title: true, replyToId: true, deleted: true,
      archived: true, threadArchivedAt: true, authorId: true, isThread: true,
    },
  });
  if (!root || root.deleted || !isThreadRoot(root)) return { status: 404, error: 'Tópico não encontrado.' };
  if (root.channelId !== (channelId || null)) return { status: 400, error: 'O tópico não é deste canal.' };
  if (root.archived) return { status: 403, error: 'Este tópico foi trancado pela moderação.' };
  return { root };
}

// Depois de gravar uma resposta: atualiza o resumo na raiz, avisa o canal
// (message:update da raiz → contador/prévia na lista principal) e manda o
// aviso de "nova resposta no tópico" pra quem participa.
async function afterThreadReply(io, { root, message, channel }) {
  const prisma = db();
  const updated = await prisma.message.update({
    where: { id: root.id },
    data: {
      isThread: true,
      threadReplyCount: { increment: 1 },
      threadLastReplyAt: message.createdAt || new Date(),
      threadLastReplyId: message.id,
      threadArchivedAt: null,
    },
    select: { id: true },
  });
  if (io && updated) {
    const full = await loadRootForBroadcast(root.id);
    if (full) io.to(`channel:${root.channelId}`).emit('message:update', full);
  }
  await notifyThreadParticipants(io, { root, message, channel }).catch((err) => {
    console.error('[tópico] falha ao avisar participantes:', err?.message || err);
  });
}

async function loadRootForBroadcast(rootId) {
  const { messageInclude } = require('../controllers/messageController');
  const prisma = db();
  const full = await prisma.message.findUnique({ where: { id: rootId }, include: messageInclude });
  if (!full) return null;
  const [withSummary] = await attachThreadSummaries([full]);
  return withSummary;
}

// Quem participa: autor da raiz, autor da mensagem-mãe e quem já
// respondeu no tópico (teto de PARTICIPANT_CAP). Sem quem escreveu agora.
async function threadParticipantIds(root, actorId) {
  const prisma = db();
  const ids = new Set();
  if (root.authorId) ids.add(root.authorId);
  if (root.replyToId) {
    const parent = await prisma.message.findUnique({ where: { id: root.replyToId }, select: { authorId: true } }).catch(() => null);
    if (parent?.authorId) ids.add(parent.authorId);
  }
  const repliers = await prisma.message.findMany({
    where: { threadId: root.id, deleted: false },
    select: { authorId: true },
    distinct: ['authorId'],
    orderBy: { createdAt: 'desc' },
    take: PARTICIPANT_CAP,
  }).catch(() => []);
  repliers.forEach((r) => ids.add(r.authorId));
  ids.delete(actorId);
  return [...ids].slice(0, PARTICIPANT_CAP);
}

async function notifyThreadParticipants(io, { root, message, channel }) {
  if (!io || !channel) return [];
  const { getEffectivePermissions, channelHasRestrictions } = require('./authz');
  const { has } = require('./permissions');
  const ids = await threadParticipantIds(root, message.authorId);
  if (!ids.length) return [];
  // Nunca avisa quem perdeu acesso ao canal (nome/prévia de canal privado).
  const restricted = await channelHasRestrictions(channel);
  const visible = [];
  for (const uid of ids) {
    if (restricted) {
      // eslint-disable-next-line no-await-in-loop
      const perms = await getEffectivePermissions(uid, channel.id, channel).catch(() => null);
      if (!perms || !has(perms, 'VIEW_CHANNEL')) continue;
    }
    visible.push(uid);
  }
  const payload = {
    channelId: channel.id,
    channelName: channel.name,
    threadId: root.id,
    threadName: root.title,
    messageId: message.id,
    authorId: message.authorId,
    authorName: message.author?.displayName || 'Alguém',
    preview: (message.content || '').slice(0, 140) || (message.attachments?.length ? '📎 Anexo' : 'Nova resposta'),
    createdAt: message.createdAt,
  };
  visible.forEach((uid) => io.to(`user:${uid}`).emit('thread:reply', payload));
  // Push (app fechado) respeitando silêncio/"Não perturbe" do canal.
  try {
    const notificationPrefs = require('./notificationPrefs');
    const { sendPushToUser } = require('./pushNotifications');
    const pushIds = await notificationPrefs.filterNotifiable(visible, { channel, kind: 'mention' });
    await Promise.all(pushIds.map((uid) => sendPushToUser(uid, {
      title: `${payload.authorName} em 🧵 ${root.title}`,
      body: payload.preview.slice(0, 120),
      data: { conversationId: '', channelId: channel.id, link: require('./linkResolver').channelPath(channel), tag: `thread:${root.id}` },
    }).catch(() => {})));
  } catch { /* push opcional */ }
  return visible;
}

// Prévia da última resposta + estado de arquivamento pra cada raiz de
// tópico da lista (uma consulta só pra página inteira).
async function attachThreadSummaries(messages) {
  if (!Array.isArray(messages) || !messages.length) return messages;
  const lastIds = [...new Set(messages.filter((m) => isThreadRoot(m) && m.threadLastReplyId).map((m) => m.threadLastReplyId))];
  if (!lastIds.length) return messages;
  const rows = await db().message.findMany({
    where: { id: { in: lastIds }, deleted: false },
    select: {
      id: true, content: true, createdAt: true, stickerUrl: true,
      author: { select: { id: true, displayName: true, avatarUrl: true } },
      _count: { select: { attachments: true } },
    },
  }).catch(() => []);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return messages.map((m) => {
    const last = m.threadLastReplyId && byId.get(m.threadLastReplyId);
    if (!last) return m;
    return {
      ...m,
      threadLastReply: {
        id: last.id,
        createdAt: last.createdAt,
        author: last.author,
        preview: (last.content || '').slice(0, 120) || (last._count?.attachments ? '📎 Anexo' : last.stickerUrl ? '🏷️ Figurinha' : ''),
      },
    };
  });
}

// Quais raízes já passaram do tempo de inatividade (puro, pra teste).
function isInactive(root, now = Date.now(), afterMs = archiveAfterMs()) {
  if (!root || root.archived || root.threadArchivedAt) return false;
  const last = new Date(root.threadLastReplyAt || root.createdAt).getTime();
  return Number.isFinite(last) && now - last >= afterMs;
}

// Arquiva sozinho os tópicos parados. Só olha raízes marcadas (isThread)
// pelo índice [isThread, threadLastReplyAt].
async function sweepInactiveThreads(io, now = Date.now()) {
  const prisma = db();
  const cutoff = new Date(now - archiveAfterMs());
  const stale = await prisma.message.findMany({
    where: { isThread: true, archived: false, threadArchivedAt: null, deleted: false, threadLastReplyAt: { lt: cutoff } },
    select: { id: true, channelId: true },
    take: SWEEP_BATCH,
  });
  if (!stale.length) return 0;
  const at = new Date(now);
  await prisma.message.updateMany({ where: { id: { in: stale.map((s) => s.id) } }, data: { threadArchivedAt: at } });
  if (io) {
    stale.forEach((s) => io.to(`channel:${s.channelId}`).emit('thread:archived', { id: s.id, channelId: s.channelId, threadArchivedAt: at }));
  }
  return stale.length;
}

let sweepTimer = null;
function startThreadArchiveJob(io) {
  if (sweepTimer) return;
  const run = () => sweepInactiveThreads(io).catch((err) => console.error('[tópico] varredura falhou:', err?.message || err));
  sweepTimer = setInterval(run, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
  setTimeout(run, 2 * 60 * 1000).unref?.();
}

module.exports = {
  isThreadRoot,
  resolveThreadForReply,
  afterThreadReply,
  attachThreadSummaries,
  threadParticipantIds,
  notifyThreadParticipants,
  isInactive,
  sweepInactiveThreads,
  startThreadArchiveJob,
  archiveAfterMs,
  loadRootForBroadcast,
};
