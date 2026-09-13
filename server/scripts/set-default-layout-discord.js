// Item pedido: "deixe o layout do discord como o principal pra todo
// mundo, atualiza pra deixar ele como principal pra qualquer user que
// for usar no futuro" — o default de conta nova já foi trocado
// (schema.prisma, User.layoutStyle), este script é só a metade que
// falta: atualizar as contas que JÁ EXISTEM.
//
// Só atualiza quem ainda está no valor antigo ('normal') — se alguém
// já tiver escolhido 'discord' de propósito (ou qualquer outro valor
// futuro), essa escolha é respeitada, não sobrescrita. Rodar de novo
// não faz nada da segunda vez em diante (todo mundo que era 'normal'
// já virou 'discord' na primeira).
//
// Uso (uma vez, manualmente): node server/scripts/set-default-layout-discord.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.user.updateMany({
    where: { layoutStyle: 'normal' },
    data: { layoutStyle: 'discord' },
  });
  console.log(`${result.count} conta(s) atualizada(s) de 'normal' para 'discord'.`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
