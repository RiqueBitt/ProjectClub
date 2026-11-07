// Fase 5 — Revisão de banimento/suspensão. Regras em services/appeals.js.
//
// Pessoa punida (sem sessão; usa o token de revisão que o login devolveu
// junto do 403, no cabeçalho X-Appeal-Token):
//   GET  /api/appeals/mine      → punição atual + pedido (se houver)
//   POST /api/appeals           { message } → pede a revisão (uma por punição)
// Equipe (ADMIN/MODERATOR):
//   GET  /api/appeals/staff?status=PENDING|ACCEPTED|DENIED|ALL&cursor=
//   POST /api/appeals/staff/:id/accept { reply? }
//   POST /api/appeals/staff/:id/deny   { reply }
const prisma = require('../config/prisma');
const env = require('../config/env');
const appeals = require('../services/appeals');
const { PUBLIC_USER_FIELDS } = require('./authController');

function sendError(res, next, err) {
  if (err instanceof appeals.AppealError) return res.status(err.status).json({ error: err.message, code: err.code });
  return next(err);
}

async function appellant(req, res) {
  const userId = appeals.verifyAppealToken(req.get('x-appeal-token'));
  const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
  if (!user) {
    // 403 (não 401) de propósito: 401 faz o cliente tentar renovar a sessão
    // normal (que essa pessoa nem tem) — ver client/src/api/client.js.
    res.status(403).json({ error: 'Sua sessão de revisão expirou. Entre de novo com sua senha para continuar.', code: 'token' });
    return null;
  }
  return user;
}

async function mine(req, res, next) {
  try {
    const user = await appellant(req, res);
    if (!user) return;
    res.set('Cache-Control', 'no-store');
    res.json(await appeals.getMyAppealState(user));
  } catch (err) { sendError(res, next, err); }
}

async function submit(req, res, next) {
  try {
    const user = await appellant(req, res);
    if (!user) return;
    const appeal = await appeals.submitAppeal(user, req.body?.message);
    // Avisa a equipe online (o contador do painel atualiza na próxima visita).
    try { req.app.get('io')?.to('staff')?.emit?.('appeal:new', { id: appeal.id }); } catch { /* opcional */ }
    res.status(201).json({ appeal });
  } catch (err) { sendError(res, next, err); }
}

const LIST_STATUSES = new Set(['PENDING', 'ACCEPTED', 'DENIED', 'ALL']);
const PAGE = 30;

async function listForStaff(req, res, next) {
  try {
    const status = LIST_STATUSES.has(String(req.query.status || '').toUpperCase()) ? String(req.query.status).toUpperCase() : 'PENDING';
    const cursor = typeof req.query.cursor === 'string' && req.query.cursor.length <= 64 ? req.query.cursor : null;
    const rows = await prisma.punishmentAppeal.findMany({
      where: status === 'ALL' ? {} : { status },
      orderBy: [{ createdAt: status === 'PENDING' ? 'asc' : 'desc' }, { id: 'asc' }],
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const ids = [...new Set(rows.flatMap((r) => [r.userId, r.reviewedById]).filter(Boolean))];
    const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: PUBLIC_USER_FIELDS }) : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    res.json({
      appeals: rows.map((r) => ({
        ...appeals.shapeAppeal(r),
        user: byId.get(r.userId) || null,
        reviewedBy: r.reviewedById ? byId.get(r.reviewedById) || null : null,
      })),
      nextCursor: rows.length === PAGE ? rows[rows.length - 1].id : null,
    });
  } catch (err) { next(err); }
}

// E-mail + aviso in-app pra pessoa (melhor esforço — nunca derruba a decisão).
function notifyDecision(req, target, appeal, accepted) {
  const kindLabel = appeal.kind === 'BAN' ? 'banimento' : 'suspensão';
  const title = accepted ? `Sua revisão de ${kindLabel} foi aceita` : `Sua revisão de ${kindLabel} foi recusada`;
  const body = accepted
    ? `A equipe aceitou o seu pedido e a punição foi retirada.${appeal.staffReply ? ` Resposta: ${appeal.staffReply}` : ''}`
    : `Resposta da equipe: ${appeal.staffReply || '—'}`;
  require('../services/notices').createNotice(req.app.get('io'), target.id, { kind: 'APPEAL', title, body, link: null, data: { appealId: appeal.id, accepted } })
    .catch(() => {});
  if (target.email) {
    require('../services/email').sendAppealDecision(target.email, {
      accepted, kindLabel, reply: appeal.staffReply, appUrl: env.CLIENT_ORIGIN,
    }).catch((err) => console.error('[revisão] falha ao enviar e-mail:', err?.message || err));
  }
}

function decide(accept) {
  return async (req, res, next) => {
    try {
      const result = await appeals.reviewAppeal({ appealId: req.params.id, reviewer: req.user, accept, reply: req.body?.reply });
      notifyDecision(req, result.target, result.appeal, accept);
      res.json({ appeal: result.appeal, lifted: result.lifted });
    } catch (err) { sendError(res, next, err); }
  };
}

module.exports = { mine, submit, listForStaff, accept: decide(true), deny: decide(false) };
