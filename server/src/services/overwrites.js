const prisma = require('../config/prisma');

// Cria ou atualiza a sobrescrita de permissão de um canal OU categoria.
// Não dá para usar prisma.upsert aqui: a chave única composta tem um campo
// nulo (channelId ou categoryId) e o Prisma recusa null no `where` de
// upsert ("Argument must not be null") — o que dava erro 500 ao salvar.
async function upsertOverwrite({ channelId = null, categoryId = null, targetType, targetId }, data) {
  const existing = await prisma.permissionOverwrite.findFirst({ where: { channelId, categoryId, targetType, targetId } });
  if (existing) return prisma.permissionOverwrite.update({ where: { id: existing.id }, data });
  return prisma.permissionOverwrite.create({ data: { channelId, categoryId, targetType, targetId, ...data } });
}

module.exports = { upsertOverwrite };
