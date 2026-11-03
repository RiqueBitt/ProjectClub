// Parabéns automáticos de aniversário.
//
// Privacidade em primeiro lugar (os aniversários saíram da interface por
// segurança de dados): só é comemorado quem LIGOU a opção
// (CommunityPrefs.birthdayOptIn) e tem data cadastrada. Só dia e mês são
// usados — o ano de nascimento e a idade nunca aparecem em lugar nenhum.
//
// Uma vez por dia (a partir de RUN_FROM_HOUR, horário de Brasília): a pessoa
// ganha BIRTHDAY_COINS moedas de presente + aviso, os amigos recebem um
// aviso pra mandar os parabéns e o Início mostra "Aniversariantes de hoje".
const { dayKey, dayMonthSP, hourSP } = require('../../utils/spTime');
const { deps, claimJob, finishJob, grantOnce, economyDisabled, PUBLIC_MINI } = require('./common');

const BIRTHDAY_COINS = 100;
const RUN_FROM_HOUR = 8;
const MAX_FRIEND_NOTICES = 200;

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** A data de nascimento cai hoje (só dia/mês; 29/02 comemora em 28/02 fora de ano bissexto)? */
function isBirthdayToday(birthDate, now = Date.now()) {
  if (!birthDate) return false;
  const b = new Date(birthDate);
  if (Number.isNaN(b.getTime())) return false;
  const { day, month, year } = dayMonthSP(now);
  const bd = b.getUTCDate();
  const bm = b.getUTCMonth() + 1;
  if (bd === day && bm === month) return true;
  return bm === 2 && bd === 29 && !isLeap(year) && month === 2 && day === 28;
}

async function celebrants(d) {
  const prefs = await d.db.communityPrefs.findMany({ where: { birthdayOptIn: true }, select: { userId: true }, take: 50000 });
  if (!prefs.length) return [];
  const users = await d.db.user.findMany({
    where: { id: { in: prefs.map((p) => p.userId) }, birthDate: { not: null }, isPlatformBanned: false, accountDisabledAt: null },
    select: { id: true, displayName: true, birthDate: true },
  });
  return users.filter((u) => isBirthdayToday(u.birthDate, d.now));
}

async function friendIdsOf(db, userId) {
  const rows = await db.friendship.findMany({
    where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] },
    select: { requesterId: true, addresseeId: true }, take: MAX_FRIEND_NOTICES,
  });
  return rows.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId));
}

async function runIfDue(over = {}) {
  const d = deps(over);
  if (hourSP(d.now) < RUN_FROM_HOUR) return null;
  const today = dayKey(d.now);
  const jobKey = `aniversarios:${today}`;
  if (!await claimJob(d.db, jobKey, { now: d.now })) return null;
  try {
    const { year } = dayMonthSP(d.now);
    const list = await celebrants(d);
    const coins = (await economyDisabled(d.db)) ? 0 : BIRTHDAY_COINS;
    let celebrated = 0;
    for (const u of list) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await d.db.birthdayCelebration.create({ data: { userId: u.id, year } });
      } catch (err) {
        if (err?.code === 'P2002') continue;
        throw err;
      }
      celebrated += 1;
      // eslint-disable-next-line no-await-in-loop
      if (coins) await grantOnce(d, `aniversario:${year}`, u.id, coins, { kind: 'BIRTHDAY', label: 'Presente de aniversário do Project Club' });
      // eslint-disable-next-line no-await-in-loop
      await d.notify(d.io, u.id, {
        kind: 'BIRTHDAY', title: 'Feliz aniversário!',
        body: coins ? `O Project Club inteiro te deseja um dia incrível. Aqui vai um presente: ${coins} moedas.` : 'O Project Club inteiro te deseja um dia incrível.',
        link: '/inicio',
      });
      // eslint-disable-next-line no-await-in-loop
      const friends = await friendIdsOf(d.db, u.id);
      for (const fid of friends) {
        // eslint-disable-next-line no-await-in-loop
        await d.notify(d.io, fid, {
          kind: 'BIRTHDAY', title: `Hoje é aniversário de ${u.displayName}!`,
          body: 'Que tal mandar os parabéns?', link: `/perfil/${u.id}`, data: { userId: u.id },
        });
      }
      d.io?.to?.('community')?.emit?.('birthday:today', { userId: u.id, displayName: u.displayName });
    }
    await finishJob(d.db, jobKey, `${celebrated} aniversariante(s)`);
    return { celebrated, coins };
  } catch (err) {
    console.error('[aniversários] falhou:', err?.message || err);
    return null;
  }
}

/** "Aniversariantes de hoje" do Início — só quem ligou a opção, só o nome. */
async function todayList(over = {}) {
  const d = deps(over);
  const list = await celebrants(d);
  if (!list.length) return [];
  const users = await d.db.user.findMany({ where: { id: { in: list.map((u) => u.id) } }, select: PUBLIC_MINI });
  return users;
}

module.exports = { isBirthdayToday, runIfDue, todayList, BIRTHDAY_COINS, RUN_FROM_HOUR };
