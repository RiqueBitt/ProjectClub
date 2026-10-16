const prisma = require('../config/prisma');

// Solicitações de mensagem e filtro de spam nas DMs (igual ao Discord).
// Quando alguém que NÃO é seu amigo te manda a primeira mensagem numa DM,
// a conversa vai pra "Solicitações" (se você deixou ligado) — ou pra
// "Spam", se a mensagem parece spam e seu filtro pega. Responder ou
// aceitar move a conversa pra caixa normal. Preferências em
// UserSettings.extraPrefs (messageRequests, spamFilter).

const recentBySender = new Map(); // senderId -> [{ text, conversationId, at }]
const WINDOW_MS = 10 * 60 * 1000;
const linkCount = (t) => (String(t || '').match(/https?:\/\/\S+/gi) || []).length;
const norm = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 300);

function remember(senderId, conversationId, content) {
  const now = Date.now();
  const list = (recentBySender.get(senderId) || []).filter((x) => now - x.at < WINDOW_MS);
  list.push({ text: norm(content), conversationId, at: now });
  recentBySender.set(senderId, list.slice(-30));
  if (recentBySender.size > 5000) recentBySender.clear();
  return list;
}

// Heurística simples e explicável: mesma mensagem pra várias pessoas em
// pouco tempo, muitos links, ou conta muito nova mandando link.
function looksLikeSpam({ sender, content, recent }) {
  const text = norm(content);
  if (!text) return false;
  const sameElsewhere = new Set(recent.filter((x) => x.text === text && text.length >= 12).map((x) => x.conversationId));
  if (sameElsewhere.size >= 3) return true;
  const links = linkCount(content);
  if (links >= 3) return true;
  const ageDays = (Date.now() - new Date(sender.createdAt).getTime()) / 86400000;
  if (links >= 1 && ageDays < 3) return true;
  return false;
}

async function areFriends(a, b) {
  const f = await prisma.friendship.findFirst({
    where: { status: 'ACCEPTED', OR: [{ requesterId: a, addresseeId: b }, { requesterId: b, addresseeId: a }] }, select: { id: true },
  });
  return !!f;
}

function emitInbox(io, userId, conversationId, inbox) {
  io?.notifyUser?.(userId, 'conversation:inbox', { conversationId, inbox });
}

// Chamado ANTES de avisar quem recebe. Devolve { [userId]: inbox } de quem
// recebe (pra pular push/aviso de quem não está na caixa normal).
async function classifyIncoming(io, { conversationId, senderId, content }) {
  const out = {};
  try {
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { isGroup: true, members: { select: { id: true, userId: true, inbox: true, inboxAcceptedAt: true } } },
    });
    if (!conv) return out;
    const recent = remember(senderId, conversationId, content);
    // Quem manda está aceitando a conversa (responder = aceitar).
    const mine = conv.members.find((m) => m.userId === senderId);
    if (mine && mine.inbox !== 'main') {
      await prisma.conversationMember.update({ where: { id: mine.id }, data: { inbox: 'main', inboxAcceptedAt: new Date() } });
      emitInbox(io, senderId, conversationId, 'main');
    }
    if (conv.isGroup) return out;
    const other = conv.members.find((m) => m.userId !== senderId);
    if (!other) return out;
    if (other.inbox !== 'main') { out[other.userId] = other.inbox; return out; }
    if (other.inboxAcceptedAt) return out;
    // Já conversaram de verdade (a outra pessoa já respondeu, ou a conversa
    // é antiga e longa): nada muda.
    const [replied, sentBefore] = await Promise.all([
      prisma.message.count({ where: { conversationId, authorId: other.userId } }),
      prisma.message.count({ where: { conversationId, authorId: senderId } }),
    ]);
    if (replied > 0 || sentBefore > 3) return out;
    const [prefs, sender, friends] = await Promise.all([
      require('../controllers/settingsController').getExtraPrefs(other.userId),
      prisma.user.findUnique({ where: { id: senderId }, select: { createdAt: true } }),
      areFriends(senderId, other.userId),
    ]);
    const filter = prefs.spamFilter || 'strangers';
    let inbox = 'main';
    if ((filter === 'all' || (filter === 'strangers' && !friends)) && sender && looksLikeSpam({ sender, content, recent })) inbox = 'spam';
    else if (!friends && prefs.messageRequests !== false) inbox = 'request';
    if (inbox !== 'main') {
      await prisma.conversationMember.update({ where: { id: other.id }, data: { inbox } });
      emitInbox(io, other.userId, conversationId, inbox);
      out[other.userId] = inbox;
    }
  } catch (err) {
    console.error('[dm-inbox] falha ao classificar:', err?.message || err);
  }
  return out;
}

// PATCH /conversations/:id/inbox { action: accept | ignore | spam }
async function setInbox(req, res, next) {
  try {
    const action = req.body?.action;
    const map = { accept: 'main', ignore: 'ignored', spam: 'spam' };
    if (!map[action]) return res.status(400).json({ error: 'Ação inválida.' });
    const m = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: req.params.id, userId: req.user.id } } });
    if (!m) return res.status(404).json({ error: 'Conversa não encontrada.' });
    const inbox = map[action];
    await prisma.conversationMember.update({ where: { id: m.id }, data: { inbox, inboxAcceptedAt: inbox === 'main' ? new Date() : m.inboxAcceptedAt } });
    emitInbox(req.app.get('io'), req.user.id, req.params.id, inbox);
    res.json({ conversationId: req.params.id, inbox });
  } catch (err) { next(err); }
}

module.exports = { classifyIncoming, setInbox, looksLikeSpam };
