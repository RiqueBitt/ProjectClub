// Indicação de amigos.
//
// Cada pessoa tem um código fixo (ex.: "K7M2QX9A") e um link de inscrição
// (/register?convite=CODIGO). Quando a inscrição feita com o código vira
// conta (aprovada pela staff) e essa conta nova mostra atividade mínima
// (nível MIN_LEVEL e MIN_DAYS dias de conta), as duas pessoas ganham moedas.
//
// Anti-abuso:
//  - uma indicação por conta nova (Referral.inviteeId/applicationId únicos);
//  - ninguém indica a si mesmo;
//  - teto de MONTHLY_CAP indicações pagas por mês para quem convida (a conta
//    nova recebe a parte dela mesmo assim);
//  - inscrição feita do MESMO IP usado recentemente por quem convidou fica
//    "em análise" (SUSPECT) e não paga sozinha;
//  - conta banida/desativada antes de qualificar não paga.
const { randomInt } = require('node:crypto');
const { monthBounds, DAY_MS } = require('../../utils/spTime');
const { deps, grantOnce, economyDisabled, claimJob, finishJob } = require('./common');

const INVITER_COINS = 300;
const INVITEE_COINS = 150;
const MIN_LEVEL = 3;
const MIN_DAYS = 7;
const MONTHLY_CAP = 5;
const EXPIRE_DAYS = 60;
const SAME_IP_LOOKBACK_DAYS = 30;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I
const CODE_LENGTH = 8;

function newCode() {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

function normalizeCode(raw) {
  const c = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length >= 4 && c.length <= 16 ? c : null;
}

async function getOrCreateCode(userId, over = {}) {
  const d = deps(over);
  const have = await d.db.referralCode.findUnique({ where: { userId } });
  if (have) return have.code;
  for (let i = 0; i < 5; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const row = await d.db.referralCode.create({ data: { userId, code: newCode() } });
      return row.code;
    } catch (err) {
      if (err?.code !== 'P2002') throw err;
      // eslint-disable-next-line no-await-in-loop
      const again = await d.db.referralCode.findUnique({ where: { userId } });
      if (again) return again.code; // duas abas criando ao mesmo tempo
    }
  }
  throw new Error('Não foi possível gerar o código de convite.');
}

const sameIp = (a, b) => !!a && !!b && String(a).replace(/^::ffff:/, '') === String(b).replace(/^::ffff:/, '');

async function inviterUsedIp(db, inviterId, ip, now) {
  if (!ip) return false;
  const tokens = await db.refreshToken.findMany({
    where: { userId: inviterId, createdAt: { gte: new Date(now.getTime() - SAME_IP_LOOKBACK_DAYS * DAY_MS) } },
    select: { ipAddress: true }, take: 200,
  }).catch(() => []);
  return tokens.some((t) => sameIp(t.ipAddress, ip));
}

/**
 * Guarda a indicação junto da inscrição (ainda não é conta). Código
 * inválido é ignorado em silêncio — nunca atrapalha a inscrição.
 */
async function attachToApplication({ code, applicationId, ip }, over = {}) {
  const d = deps(over);
  const c = normalizeCode(code);
  if (!c || !applicationId) return null;
  const owner = await d.db.referralCode.findUnique({ where: { code: c } });
  if (!owner) return null;
  const suspect = await inviterUsedIp(d.db, owner.userId, ip, d.now);
  try {
    return await d.db.referral.create({
      data: {
        inviterId: owner.userId, applicationId, inviteeIp: ip ? String(ip).slice(0, 64) : null,
        status: suspect ? 'SUSPECT' : 'PENDING', note: suspect ? 'Mesmo IP de quem convidou' : null,
      },
    });
  } catch (err) {
    if (err?.code === 'P2002') return null;
    throw err;
  }
}

/** Inscrição aprovada → liga a indicação à conta nova. */
async function linkInvitee({ applicationId, userId }, over = {}) {
  const d = deps(over);
  if (!applicationId || !userId) return null;
  const ref = await d.db.referral.findUnique({ where: { applicationId } });
  if (!ref || ref.inviteeId) return null;
  if (ref.inviterId === userId) {
    await d.db.referral.update({ where: { id: ref.id }, data: { status: 'REJECTED', note: 'Autoindicação' } });
    return null;
  }
  try {
    return await d.db.referral.update({ where: { id: ref.id }, data: { inviteeId: userId } });
  } catch (err) {
    if (err?.code === 'P2002') return null; // essa conta já tinha uma indicação
    throw err;
  }
}

/** Conta criada sem passar pela fila (auto-aprovação do dono): liga direto. */
async function attachToUser({ code, userId, ip }, over = {}) {
  const d = deps(over);
  const c = normalizeCode(code);
  if (!c || !userId) return null;
  const owner = await d.db.referralCode.findUnique({ where: { code: c } });
  if (!owner || owner.userId === userId) return null;
  const suspect = await inviterUsedIp(d.db, owner.userId, ip, d.now);
  try {
    return await d.db.referral.create({
      data: {
        inviterId: owner.userId, inviteeId: userId, inviteeIp: ip ? String(ip).slice(0, 64) : null,
        status: suspect ? 'SUSPECT' : 'PENDING', note: suspect ? 'Mesmo IP de quem convidou' : null,
      },
    });
  } catch (err) {
    if (err?.code === 'P2002') return null;
    throw err;
  }
}

/** A conta nova já cumpriu a atividade mínima? */
function qualifies(invitee, now) {
  if (!invitee) return false;
  if (invitee.isPlatformBanned || invitee.accountDisabledAt) return false;
  const ageDays = (now.getTime() - new Date(invitee.createdAt).getTime()) / DAY_MS;
  return (invitee.accountLevel || 1) >= MIN_LEVEL && ageDays >= MIN_DAYS;
}

/**
 * Confere as indicações pendentes (de hora em hora): paga as que
 * qualificaram, respeitando o teto mensal, e expira as velhas.
 */
async function processPending(over = {}) {
  const d = deps(over);
  const month = monthBounds(d.now).key;
  const results = { rewarded: 0, capped: 0, expired: 0, rejected: 0 };
  const expireBefore = new Date(d.now.getTime() - EXPIRE_DAYS * DAY_MS);
  const ex = await d.db.referral.updateMany({ where: { status: 'PENDING', createdAt: { lt: expireBefore } }, data: { status: 'EXPIRED' } });
  results.expired = ex.count || 0;

  const pending = await d.db.referral.findMany({ where: { status: 'PENDING', inviteeId: { not: null } }, orderBy: { createdAt: 'asc' }, take: 300 });
  if (!pending.length) return results;
  const off = await economyDisabled(d.db);
  const invitees = await d.db.user.findMany({
    where: { id: { in: pending.map((r) => r.inviteeId) } },
    select: { id: true, displayName: true, accountLevel: true, createdAt: true, isPlatformBanned: true, accountDisabledAt: true },
  });
  const byId = new Map(invitees.map((u) => [u.id, u]));

  for (const ref of pending) {
    const invitee = byId.get(ref.inviteeId);
    if (!invitee || invitee.isPlatformBanned || invitee.accountDisabledAt) {
      // eslint-disable-next-line no-await-in-loop
      await d.db.referral.updateMany({ where: { id: ref.id, status: 'PENDING' }, data: { status: 'REJECTED', note: 'Conta indicada indisponível' } });
      results.rejected += 1;
      continue;
    }
    if (!qualifies(invitee, d.now) || off) continue;
    // eslint-disable-next-line no-await-in-loop
    const paidThisMonth = await d.db.referral.count({ where: { inviterId: ref.inviterId, status: 'REWARDED', monthKey: month } });
    const capped = paidThisMonth >= MONTHLY_CAP;
    // Reivindica a linha (só um processo paga).
    // eslint-disable-next-line no-await-in-loop
    const claim = await d.db.referral.updateMany({
      where: { id: ref.id, status: 'PENDING' },
      data: { status: capped ? 'CAPPED' : 'REWARDED', monthKey: month, rewardedAt: d.now, inviterCoins: capped ? 0 : INVITER_COINS, inviteeCoins: INVITEE_COINS },
    });
    if (claim.count !== 1) continue;
    // eslint-disable-next-line no-await-in-loop
    await grantOnce(d, `indicacao:${ref.id}`, ref.inviteeId, INVITEE_COINS, { kind: 'REFERRAL', label: 'Bônus de boas-vindas (indicação)' });
    // eslint-disable-next-line no-await-in-loop
    await d.notify(d.io, ref.inviteeId, {
      kind: 'REFERRAL', title: 'Bônus de indicação liberado!',
      body: `Você ganhou ${INVITEE_COINS} moedas por ter entrado com um convite. Bem-vindo(a) de verdade!`, link: '/economia?aba=historico',
    });
    if (!capped) {
      // eslint-disable-next-line no-await-in-loop
      await grantOnce(d, `indicacao:${ref.id}`, ref.inviterId, INVITER_COINS, { kind: 'REFERRAL', label: `Indicação: ${invitee.displayName}` });
      results.rewarded += 1;
    } else results.capped += 1;
    // eslint-disable-next-line no-await-in-loop
    await d.notify(d.io, ref.inviterId, {
      kind: 'REFERRAL', title: `${invitee.displayName} entrou pelo seu convite`,
      body: capped
        ? `Você já chegou ao limite de ${MONTHLY_CAP} indicações pagas este mês — a conta nova recebeu o bônus dela.`
        : `Você ganhou ${INVITER_COINS} moedas pela indicação. Obrigado por trazer gente boa!`,
      link: '/participar?aba=convites',
    });
  }
  return results;
}

/** Dados da aba "Convites". */
async function myReferrals(userId, over = {}) {
  const d = deps(over);
  const code = await getOrCreateCode(userId, d);
  const month = monthBounds(d.now).key;
  const rows = await d.db.referral.findMany({ where: { inviterId: userId }, orderBy: { createdAt: 'desc' }, take: 50 });
  const ids = rows.map((r) => r.inviteeId).filter(Boolean);
  const users = ids.length ? await d.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, username: true, avatarUrl: true, accountLevel: true } }) : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  const paidThisMonth = rows.filter((r) => r.status === 'REWARDED' && r.monthKey === month).length;
  return {
    code,
    link: `/register?convite=${code}`,
    paidThisMonth,
    rules: { inviterCoins: INVITER_COINS, inviteeCoins: INVITEE_COINS, minLevel: MIN_LEVEL, minDays: MIN_DAYS, monthlyCap: MONTHLY_CAP },
    referrals: rows.map((r) => ({
      id: r.id, status: r.status, createdAt: r.createdAt, rewardedAt: r.rewardedAt, coins: r.inviterCoins,
      // Antes de virar conta: só "inscrição em análise" (nada de e-mail/nome da inscrição).
      invitee: r.inviteeId && byId.get(r.inviteeId) ? byId.get(r.inviteeId) : null,
    })),
  };
}

async function hourlyTick(over = {}) {
  const d = deps(over);
  const key = `indicacoes:${d.now.toISOString().slice(0, 13)}`;
  if (!await claimJob(d.db, key, { now: d.now })) return null;
  try {
    const r = await processPending(d);
    await finishJob(d.db, key, JSON.stringify(r));
    return r;
  } catch (err) {
    console.error('[indicações] falhou:', err?.message || err);
    return null;
  }
}

module.exports = {
  getOrCreateCode, normalizeCode, attachToApplication, linkInvitee, attachToUser, qualifies, processPending, myReferrals, hourlyTick,
  INVITER_COINS, INVITEE_COINS, MIN_LEVEL, MIN_DAYS, MONTHLY_CAP, EXPIRE_DAYS,
};
