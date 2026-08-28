const prisma = require('../config/prisma');

const TARGET_TYPES = ['ALL', 'USER'];

// POST /admin/announcements — creates the announcement itself; the banner
// image (optional) is attached in a second request right after, same
// "create, then decorate" two-step as a server template's icon or a
// group DM's photo (there's no id to upload against until the row exists).
async function createAnnouncement(req, res, next) {
  try {
    const {
      title, description, buttonLabel, buttonUrl, targetType, targetUserId,
    } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Título é obrigatório.' });
    if (!TARGET_TYPES.includes(targetType)) return res.status(400).json({ error: 'Público-alvo inválido.' });
    if (targetType === 'USER' && !targetUserId) return res.status(400).json({ error: 'Selecione um usuário.' });

    const announcement = await prisma.platformAnnouncement.create({
      data: {
        title: title.trim().slice(0, 100),
        description: description?.trim().slice(0, 1000) || null,
        buttonLabel: buttonLabel?.trim().slice(0, 40) || null,
        buttonUrl: buttonUrl?.trim().slice(0, 500) || null,
        targetType,
        targetUserId: targetType === 'USER' ? targetUserId : null,
        createdById: req.user.id,
      },
    });
    res.status(201).json({ announcement });
  } catch (err) { next(err); }
}

async function uploadAnnouncementBanner(req, res, next) {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    const bannerUrl = req.file.url;
    const announcement = await prisma.platformAnnouncement.update({ where: { id }, data: { bannerUrl } });
    res.json({ announcement });
  } catch (err) { next(err); }
}

// GET /admin/announcements — most recent first, just for the staff's own
// reference (no edit, only ever create new ones — same "each one's a fresh
// row" philosophy as a server template, no in-place editing of something
// people may have already seen and dismissed).
async function listAnnouncements(req, res, next) {
  try {
    const announcements = await prisma.platformAnnouncement.findMany({
      orderBy: { createdAt: 'desc' }, take: 50,
      include: { _count: { select: { dismissals: true } } },
    });
    res.json({ announcements });
  } catch (err) { next(err); }
}

// GET /announcements/active — the current user's own next undismissed
// announcement, if any (oldest-undismissed-first, so a backlog clears in
// the order it was sent rather than newest-first). Only one at a time is
// returned; the client re-checks after each dismissal for the next one.
async function getActiveAnnouncement(req, res, next) {
  try {
    // The "not dismissed by me" check now lives in the query's own `where`
    // (dismissals: { none: ... }) instead of being done in JS after an
    // `include: { dismissals: { where: { userId } } }` fetch. Both should
    // return the same rows, but a user created after the announcement was
    // sent has zero rows in the dismissals table for it — any edge case in
    // how the filtered `include` resolves that "empty relation" (empty
    // array vs. accidentally getting every dismissal back) silently hides
    // the announcement for exactly that kind of account. Filtering it at
    // the top-level `where` removes that whole class of failure.
    const next = await prisma.platformAnnouncement.findFirst({
      where: {
        OR: [
          { targetType: 'ALL' },
          { targetType: 'USER', targetUserId: req.user.id },
        ],
        dismissals: { none: { userId: req.user.id } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ announcement: next || null });
  } catch (err) { next(err); }
}

async function dismissAnnouncement(req, res, next) {
  try {
    const { id } = req.params;
    await prisma.announcementDismissal.upsert({
      where: { announcementId_userId: { announcementId: id, userId: req.user.id } },
      update: {},
      create: { announcementId: id, userId: req.user.id },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = {
  createAnnouncement, uploadAnnouncementBanner, listAnnouncements, getActiveAnnouncement, dismissAnnouncement,
};
