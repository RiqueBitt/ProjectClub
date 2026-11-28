// Fase 5 — Revisão de banimento/suspensão ("Pedir revisão").
//
// Quem está banido/suspenso não consegue entrar, então o login (senha certa
// ou chave de acesso) devolve, junto do 403, um "token de revisão": curto
// (30 min), assinado com uma chave DERIVADA (nunca vale como token de acesso
// em requireAuth) e que só serve pra ver/pedir a revisão da própria punição.
//
// Regras:
//   - UM pedido por punição: cada punição tem uma chave (punishmentKey) e o
//     banco tem @@unique([userId, punishmentKey]);
//   - texto opcional, até 2000 caracteres;
//   - a equipe (ADMIN/MODERATOR) aceita (a punição sai pelo mesmo caminho do
//     "desbanir"/"tirar suspensão" — services/punishments.js) ou recusa com
//     uma resposta; ninguém revisa o próprio pedido; cada decisão vai pro
//     registro de auditoria da plataforma.
//
// Tudo recebe o `db` injetado (testes sem banco).
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { auditReason, auditMetadata } = require('../utils/auditFields');

const getPrisma = () => require('../config/prisma');
const getEnv = () => require('../config/env');

const MAX_MESSAGE = 2000;
const MAX_REPLY = 2000;
const TOKEN_TTL = '30m';
const KINDS = Object.freeze({ BAN: 'BAN', SUSPENSION: 'SUSPENSION' });
const STATUSES = Object.freeze({ PENDING: 'PENDING', ACCEPTED: 'ACCEPTED', DENIED: 'DENIED' });

class AppealError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// Chave própria pros tokens de revisão — derivada do segredo do JWT de
// acesso, mas diferente dele: um token de revisão NUNCA passa em
// verifyAccessToken (requireAuth), nem depois que a punição acaba.
function appealSecret(env = getEnv()) {
  return crypto.createHmac('sha256', String(env.JWT_ACCESS_SECRET)).update('pc-appeal-token-v1').digest('hex');
}

function signAppealToken(userId, { env } = {}) {
  return jwt.sign({ sub: userId, typ: 'appeal' }, appealSecret(env), { expiresIn: TOKEN_TTL, algorithm: 'HS256' });
}

function verifyAppealToken(token, { env } = {}) {
  if (typeof token !== 'string' || token.length > 2000) return null;
  try {
    const payload = jwt.verify(token, appealSecret(env), { algorithms: ['HS256'] });
    return payload?.typ === 'appeal' && typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

// Texto livre: tira caracteres de controle (menos quebra de linha/tab),
// apara e limita.
function cleanText(raw, max) {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  return text.length > max ? null : text;
}

// Qual punição está valendo AGORA pra esta conta (banimento vem antes de
// suspensão) e a chave que identifica essa punição. Um banimento novo
// (depois de desbanir) gera um registro novo de Ban ou de auditoria, então
// ganha uma chave nova — e um pedido de revisão novo.
async function currentPunishment(user, { db = getPrisma(), now = new Date() } = {}) {
  if (!user) return null;
  if (user.isPlatformBanned) {
    const [banRow, logRow] = await Promise.all([
      db.ban.findUnique({ where: { userId: user.id } }).catch(() => null),
      db.platformAuditLog.findFirst({
        where: { targetId: user.id, action: 'USER_BAN' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true },
      }).catch(() => null),
    ]);
    const times = [banRow?.createdAt, logRow?.createdAt].filter(Boolean).map((d) => new Date(d).getTime());
    const key = times.length ? `BAN:${new Date(Math.max(...times)).toISOString()}` : 'BAN:legacy';
    return { kind: KINDS.BAN, key, reason: user.platformBanReason || banRow?.reason || null, until: null };
  }
  if (user.suspendedUntil && new Date(user.suspendedUntil).getTime() > now.getTime()) {
    const until = new Date(user.suspendedUntil);
    return { kind: KINDS.SUSPENSION, key: `SUSPENSION:${until.toISOString()}`, reason: null, until };
  }
  return null;
}

function shapeAppeal(a) {
  if (!a) return null;
  return {
    id: a.id, kind: a.kind, status: a.status, message: a.message || '', staffReply: a.staffReply || null,
    reason: a.reason || null, until: a.until || null, createdAt: a.createdAt, reviewedAt: a.reviewedAt || null,
  };
}

// O que a pessoa punida vê: a punição atual e o pedido dela (se já pediu).
async function getMyAppealState(user, { db = getPrisma(), now = new Date() } = {}) {
  const punishment = await currentPunishment(user, { db, now });
  if (!punishment) {
    const last = await db.punishmentAppeal.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
    return { punishment: null, appeal: shapeAppeal(last), canAppeal: false };
  }
  const appeal = await db.punishmentAppeal.findUnique({
    where: { userId_punishmentKey: { userId: user.id, punishmentKey: punishment.key } },
  });
  return {
    punishment: { kind: punishment.kind, reason: punishment.reason, until: punishment.until },
    appeal: shapeAppeal(appeal),
    canAppeal: !appeal,
  };
}

async function submitAppeal(user, rawMessage, { db = getPrisma(), now = new Date() } = {}) {
  const message = cleanText(rawMessage, MAX_MESSAGE);
  if (message === null) throw new AppealError('invalid', `O texto pode ter no máximo ${MAX_MESSAGE} caracteres.`);
  const punishment = await currentPunishment(user, { db, now });
  if (!punishment) throw new AppealError('no_punishment', 'Sua conta não tem nenhuma punição ativa.', 409);
  const existing = await db.punishmentAppeal.findUnique({
    where: { userId_punishmentKey: { userId: user.id, punishmentKey: punishment.key } },
  });
  if (existing) throw new AppealError('already', 'Você já pediu revisão desta punição. Aguarde a resposta da equipe.', 409);
  try {
    const created = await db.punishmentAppeal.create({
      data: {
        userId: user.id, kind: punishment.kind, punishmentKey: punishment.key,
        reason: auditReason(punishment.reason), until: punishment.until, message: message || null,
        status: STATUSES.PENDING, createdAt: now,
      },
    });
    return shapeAppeal(created);
  } catch (err) {
    // Dois envios ao mesmo tempo: o @@unique segura o segundo.
    if (err?.code === 'P2002') throw new AppealError('already', 'Você já pediu revisão desta punição. Aguarde a resposta da equipe.', 409);
    throw err;
  }
}

const isStaff = (u) => !!u && ['ADMIN', 'MODERATOR'].includes(u.platformRole);

// Decisão da equipe. Aceitar tira a punição (se ainda for a MESMA do
// pedido); recusar exige uma resposta. Só um revisor "ganha" o pedido.
async function reviewAppeal({ appealId, reviewer, accept, reply }, {
  db = getPrisma(), now = new Date(), punishments = require('./punishments'),
} = {}) {
  if (!isStaff(reviewer)) throw new AppealError('forbidden', 'Acesso restrito à equipe da plataforma.', 403);
  if (typeof appealId !== 'string' || !appealId || appealId.length > 64) throw new AppealError('not_found', 'Pedido não encontrado.', 404);
  const cleanReply = cleanText(reply, MAX_REPLY);
  if (cleanReply === null) throw new AppealError('invalid', `A resposta pode ter no máximo ${MAX_REPLY} caracteres.`);
  if (!accept && !cleanReply) throw new AppealError('reply_required', 'Escreva uma resposta explicando a recusa.');

  const appeal = await db.punishmentAppeal.findUnique({ where: { id: appealId } });
  if (!appeal) throw new AppealError('not_found', 'Pedido não encontrado.', 404);
  if (appeal.userId === reviewer.id) throw new AppealError('own', 'Você não pode revisar o seu próprio pedido.', 403);
  if (appeal.status !== STATUSES.PENDING) throw new AppealError('already_reviewed', 'Este pedido já foi revisado.', 409);

  const target = await db.user.findUnique({ where: { id: appeal.userId } });
  if (!target) throw new AppealError('not_found', 'A conta deste pedido não existe mais.', 404);
  const punishment = await currentPunishment(target, { db, now });
  if (accept && punishment && punishment.key !== appeal.punishmentKey) {
    throw new AppealError('stale', 'A punição desta conta mudou depois do pedido. Recuse este pedido — a pessoa pode pedir revisão da punição atual.', 409);
  }

  const claimed = await db.punishmentAppeal.updateMany({
    where: { id: appeal.id, status: STATUSES.PENDING },
    data: {
      status: accept ? STATUSES.ACCEPTED : STATUSES.DENIED,
      staffReply: cleanReply || null, reviewedById: reviewer.id, reviewedAt: now,
    },
  });
  if (claimed.count !== 1) throw new AppealError('already_reviewed', 'Este pedido já foi revisado por outra pessoa da equipe.', 409);

  let lifted = false;
  if (accept && punishment) {
    if (appeal.kind === KINDS.BAN) await punishments.liftBan(target.id, { db });
    else await punishments.liftSuspension(target.id, { db });
    lifted = true;
  }

  const audit = (action, metadata) => db.platformAuditLog.create({
    data: {
      actorId: reviewer.id, action, targetType: 'USER', targetId: target.id,
      reason: auditReason(cleanReply), metadata: auditMetadata(metadata),
    },
  }).catch((err) => console.error('[revisão] falha ao registrar auditoria:', err?.message || err));
  await audit(accept ? 'APPEAL_ACCEPT' : 'APPEAL_DENY', { appealId: appeal.id, kind: appeal.kind });
  if (lifted) await audit(appeal.kind === KINDS.BAN ? 'USER_UNBAN' : 'USER_UNSUSPEND', { via: 'appeal', appealId: appeal.id });

  return {
    appeal: shapeAppeal({ ...appeal, status: accept ? STATUSES.ACCEPTED : STATUSES.DENIED, staffReply: cleanReply || null, reviewedAt: now }),
    target, lifted,
  };
}

module.exports = {
  MAX_MESSAGE, MAX_REPLY, KINDS, STATUSES, AppealError,
  signAppealToken, verifyAppealToken, appealSecret, cleanText,
  currentPunishment, getMyAppealState, submitAppeal, reviewAppeal, shapeAppeal, isStaff,
};
