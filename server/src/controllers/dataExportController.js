// Exportar meus dados (LGPD, art. 18 — portabilidade): um JSON com tudo que
// a conta tem de dados pessoais e conteúdo próprio. Sem segredos (hash de
// senha, 2FA, tokens) e sem dados de OUTRAS pessoas além do mínimo (quem
// enviou uma mensagem na mesma conversa aparece só por nome).
const prisma = require('../config/prisma');

const LIMIT = 20000;
const strip = (obj, keys) => { const o = { ...obj }; for (const k of keys) delete o[k]; return o; };
const SECRET_USER_FIELDS = ['passwordHash', 'twoFactorSecret', 'twoFactorLastUsedStep', 'emailVerifyToken', 'passwordResetToken', 'passwordResetExpires', 'emailVerifyExpires'];

async function safe(fn) { try { return await fn(); } catch { return null; } }

// GET /api/auth/export-data
async function exportData(req, res, next) {
  try {
    const userId = req.user.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'Conta não encontrada.' });
    const [settings, messages, posts, comments, transactions, friendships, playtime, minigames, achievements, testimonials, reminders, scheduled] = await Promise.all([
      safe(() => prisma.userSettings.findUnique({ where: { userId } })),
      safe(() => prisma.message.findMany({ where: { authorId: userId, deleted: false }, orderBy: { createdAt: 'desc' }, take: LIMIT, select: { id: true, content: true, channelId: true, conversationId: true, createdAt: true, edited: true, pinned: true, attachments: { select: { url: true, filename: true, mimeType: true, size: true } } } })),
      safe(() => prisma.post.findMany({ where: { authorId: userId }, orderBy: { createdAt: 'desc' }, take: LIMIT, select: { id: true, title: true, content: true, type: true, createdAt: true, communityId: true } })),
      safe(() => prisma.postComment.findMany({ where: { authorId: userId }, orderBy: { createdAt: 'desc' }, take: LIMIT, select: { id: true, content: true, postId: true, createdAt: true } })),
      safe(() => prisma.economyTransaction.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: LIMIT })),
      safe(() => prisma.friendship.findMany({ where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] }, select: { requesterId: true, addresseeId: true, createdAt: true } })),
      safe(() => prisma.gamePlaytime.findMany({ where: { userId } })),
      safe(() => prisma.minigameStat.findMany({ where: { userId } })),
      safe(() => prisma.userAchievement.findMany({ where: { userId } })),
      safe(() => prisma.testimonial.findMany({ where: { OR: [{ authorId: userId }, { targetId: userId }] }, take: LIMIT })),
      safe(() => prisma.reminder.findMany({ where: { userId } })),
      safe(() => prisma.scheduledMessage.findMany({ where: { authorId: userId } })),
    ]);
    // Amigos: só id + nome de exibição (dado mínimo).
    let friends = [];
    if (friendships?.length) {
      const ids = friendships.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId));
      const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, username: true } });
      friends = users.map((u) => ({ ...u, since: friendships.find((f) => f.requesterId === u.id || f.addresseeId === u.id)?.createdAt }));
    }
    const payload = {
      exportedAt: new Date().toISOString(),
      about: 'Exportação dos seus dados no Project Club (LGPD). Guarde com cuidado: contém suas mensagens e informações pessoais.',
      account: strip(user, SECRET_USER_FIELDS),
      settings,
      friends,
      messages: messages || [],
      posts: posts || [],
      comments: comments || [],
      economy: transactions || [],
      games: { playtime: playtime || [], minigames: minigames || [] },
      achievements: achievements || [],
      testimonials: testimonials || [],
      reminders: reminders || [],
      scheduledMessages: scheduled || [],
      counts: { messages: messages?.length || 0, posts: posts?.length || 0, comments: comments?.length || 0, friends: friends.length },
    };
    const name = `projectclub-dados-${String(user.username).replace(/[^a-z0-9_-]/gi, '')}-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(JSON.stringify(payload, null, 2));
  } catch (err) { next(err); }
}

module.exports = { exportData, SECRET_USER_FIELDS };
