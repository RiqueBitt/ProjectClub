const prisma = require('../config/prisma');

// Dá a casa (e o mapa, se ela tiver grupo) inicial pra uma conta recém
// criada — de graça, já ativa, sem precisar comprar nada. Igual o bot
// Robbie tinha ("todo usuário novo já ganha ela no primeiro login").
async function grantStarterHouse(userId) {
  try {
    const settings = await prisma.platformSettings.findUnique({ where: { id: 'singleton' } });
    if (!settings?.starterHouseId) return;

    const alreadyHasHouse = await prisma.userHouse.count({ where: { userId } });
    if (alreadyHasHouse > 0) return;

    const house = await prisma.houseCatalog.findUnique({ where: { id: settings.starterHouseId } });
    if (!house) return;

    let mapBackgroundId = null;
    if (house.groupId != null) {
      if (!settings.starterMapId) return;
      const map = await prisma.mapBackground.findUnique({ where: { id: settings.starterMapId } });
      if (!map) return;
      mapBackgroundId = map.id;
    }

    await prisma.userHouse.create({
      data: { userId, houseId: house.id, isActive: true, mapBackgroundId },
    });

    if (mapBackgroundId) {
      await prisma.userMapBackground.upsert({
        where: { userId_mapBackgroundId: { userId, mapBackgroundId } },
        update: {}, create: { userId, mapBackgroundId },
      });
    }
  } catch (err) {
    console.error('[starterHouse] falha ao conceder casa inicial:', err.message);
  }
}

module.exports = { grantStarterHouse };
