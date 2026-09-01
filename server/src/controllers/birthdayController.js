const prisma = require('../config/prisma');

// Item pedido: "aniversariantes" — igual o Orkut mostrava, um aviso de
// quando é aniversário de um amigo. Só devolve DIA e MÊS (nunca o
// ano) — mostrar a idade de alguém sem ela ter escolhido isso é um
// dado sensível que essa funcionalidade não precisa expor pra
// funcionar.
function dayMonthOf(date) {
  return { day: date.getUTCDate(), month: date.getUTCMonth() + 1 };
}

function isWithinNextDays(birthDate, days) {
  const today = new Date();
  const { day: todayDay, month: todayMonth } = dayMonthOf(today);
  const { day, month } = dayMonthOf(birthDate);

  // Compara só dia/mês, ignorando o ano — monta uma data "deste ano"
  // pra cada aniversário e vê se cai nos próximos N dias (tratando a
  // virada de ano: dezembro -> janeiro).
  const thisYear = today.getUTCFullYear();
  let occursAt = new Date(Date.UTC(thisYear, month - 1, day));
  const todayAtMidnight = new Date(Date.UTC(thisYear, todayMonth - 1, todayDay));
  if (occursAt < todayAtMidnight) occursAt = new Date(Date.UTC(thisYear + 1, month - 1, day));

  const diffDays = Math.round((occursAt - todayAtMidnight) / 86400000);
  return diffDays >= 0 && diffDays <= days;
}

// Aniversariantes de hoje + dos próximos 7 dias, só entre os SEUS
// amigos (igual os Rankings — sempre relativo ao seu próprio círculo,
// não uma lista geral da plataforma inteira).
async function upcomingAmongFriends(req, res, next) {
  try {
    const friendships = await prisma.friendship.findMany({
      where: { status: 'ACCEPTED', OR: [{ requesterId: req.user.id }, { addresseeId: req.user.id }] },
    });
    const friendIds = friendships.map((f) => (f.requesterId === req.user.id ? f.addresseeId : f.requesterId));
    if (friendIds.length === 0) return res.json({ today: [], upcoming: [] });

    const friends = await prisma.user.findMany({
      where: { id: { in: friendIds }, birthDate: { not: null } },
      select: { id: true, displayName: true, username: true, avatarUrl: true, profileColor: true, birthDate: true },
    });

    const todayList = [];
    const upcomingList = [];
    for (const f of friends) {
      const { day, month } = dayMonthOf(f.birthDate);
      const todayDayMonth = dayMonthOf(new Date());
      const entry = { id: f.id, displayName: f.displayName, username: f.username, avatarUrl: f.avatarUrl, profileColor: f.profileColor, day, month };
      if (day === todayDayMonth.day && month === todayDayMonth.month) {
        todayList.push(entry);
      } else if (isWithinNextDays(f.birthDate, 7)) {
        upcomingList.push(entry);
      }
    }
    res.json({ today: todayList, upcoming: upcomingList });
  } catch (err) { next(err); }
}

module.exports = { upcomingAmongFriends, dayMonthOf };
