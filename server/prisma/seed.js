// Popula o catálogo de insígnias e cria a estrutura inicial da comunidade
// única: o cargo "@todos" (equivalente ao antigo @everyone por servidor,
// agora global — toda conta nova recebe automaticamente, ver
// authController.register) e uma categoria/canais padrão pra não começar
// vazio. Seguro rodar de novo: tudo é upsert por chave estável.
const { PrismaClient } = require('@prisma/client');
const { DEFAULT_EVERYONE_PERMISSIONS, toStringBits } = require('../src/services/permissions');
const prisma = new PrismaClient();

const BADGES = [
  { key: 'PLATFORM_OWNER', name: 'Dono da Plataforma', description: 'Fundador e responsável pela comunidade.', icon: '👑', rarity: 'LEGENDARY' },
  { key: 'FOUNDER', name: 'Fundador', description: 'Uma das primeiras contas criadas na plataforma.', icon: '🌟', rarity: 'LEGENDARY' },
  { key: 'NEWCOMER', name: 'Novo por aqui', description: 'Concedida automaticamente ao criar sua conta.', icon: '🌱', rarity: 'COMMON' },
  { key: 'VERIFIED', name: 'Verificado', description: 'Conta com e-mail verificado.', icon: '✅', rarity: 'COMMON' },
  { key: 'STAFF', name: 'Equipe', description: 'Membro da equipe da plataforma.', icon: '🛠️', rarity: 'EPIC' },
  { key: 'BUG_HUNTER', name: 'Caçador de bugs', description: 'Ajudou a encontrar e reportar um bug.', icon: '🐛', rarity: 'RARE' },
  { key: 'SUPPORTER', name: 'Apoiador', description: 'Concedida pela administração por apoiar a comunidade.', icon: '💜', rarity: 'RARE' },
  { key: 'EVENT_WINNER', name: 'Vencedor de evento', description: 'Venceu um evento da comunidade.', icon: '🏆', rarity: 'EPIC' },
  { key: 'BETA_TESTER', name: 'Beta Tester', description: 'Ajudou a testar a plataforma antes do lançamento.', icon: '🧪', rarity: 'RARE' },
  { key: 'ARTIST', name: 'Artista', description: 'Contribuiu com arte para a comunidade.', icon: '🎨', rarity: 'RARE' },
  { key: 'VETERAN', name: 'Veterano', description: 'Conta ativa há mais de um ano.', icon: '🎖️', rarity: 'RARE' },
  { key: 'HELPER', name: 'Ajudante', description: 'Sempre disposto a ajudar outros usuários.', icon: '🤗', rarity: 'COMMON' },
];

async function main() {
  for (const badge of BADGES) {
    await prisma.badge.upsert({ where: { key: badge.key }, update: badge, create: badge });
  }
  console.log(`Seeded ${BADGES.length} badges.`);

  // Configurações da plataforma/comunidade (singleton).
  await prisma.platformSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton', communityName: 'Project Club' },
  });

  // Cargo @todos — o cargo padrão que toda conta nova recebe.
  const everyone = await prisma.role.findFirst({ where: { isDefault: true } });
  if (!everyone) {
    await prisma.role.create({
      data: {
        name: '@todos',
        color: '#99AAB5',
        permissions: toStringBits(DEFAULT_EVERYONE_PERMISSIONS),
        position: 0,
        isDefault: true,
      },
    });
    console.log('Cargo @todos criado.');
  }

  // Estrutura inicial de canais, pra comunidade não abrir vazia.
  const existingCategory = await prisma.category.findFirst();
  if (!existingCategory) {
    const geral = await prisma.category.create({ data: { name: 'Geral', position: 0 } });
    await prisma.channel.create({ data: { name: 'início', type: 'TEXT', categoryId: geral.id, position: 0, topic: 'Bem-vindo(a) à comunidade!' } });
    await prisma.channel.create({ data: { name: 'avisos', type: 'ANNOUNCEMENT', categoryId: geral.id, position: 1 } });
    await prisma.channel.create({ data: { name: 'geral', type: 'TEXT', categoryId: geral.id, position: 2 } });
    console.log('Categoria e canais padrão criados.');
  }

  // Casas/decoração (adaptado do bot Robbie — fase 3): catálogo real de
  // casas (iglus temáticos), categorias e móveis extraídos do banco de
  // dados original do usuário.
  const { FURNITURE_CATEGORIES, FURNITURE_ITEMS, HOUSE_CATALOG } = require('../src/data/housesCatalog');
  for (const cat of FURNITURE_CATEGORIES) {
    await prisma.furnitureCategory.upsert({ where: { id: cat.id }, update: cat, create: cat });
  }
  for (const item of FURNITURE_ITEMS) {
    await prisma.furniture.upsert({ where: { id: item.id }, update: item, create: item });
  }
  for (const house of HOUSE_CATALOG) {
    await prisma.houseCatalog.upsert({ where: { id: house.id }, update: house, create: house });
  }
  console.log(`Seeded ${FURNITURE_CATEGORIES.length} categorias, ${FURNITURE_ITEMS.length} móveis e ${HOUSE_CATALOG.length} casas.`);

  // Baús diários (agora editáveis pela staff — ver adminController de
  // economia) — valores iniciais extraídos 1:1 do catálogo original.
  const chestsCatalog = require('../src/data/chestsCatalog');
  for (const [i, chest] of chestsCatalog.DAILY_CHESTS.entries()) {
    const existing = await prisma.dailyChest.findFirst({ where: { name: chest.name } });
    if (!existing) {
      await prisma.dailyChest.create({ data: { ...chest, position: i } });
    } else if (chest.imageClosed && !existing.imageClosed) {
      // Backfill pra bancos de dados que já tinham os baús criados ANTES
      // das imagens (imgur, extraídas do bot Robbie) entrarem no catálogo
      // — sem isso, quem já jogava não ganhava as imagens novas.
      await prisma.dailyChest.update({ where: { id: existing.id }, data: { imageClosed: chest.imageClosed, imageOpened: chest.imageOpened } });
    }
  }
  console.log(`Seeded ${chestsCatalog.DAILY_CHESTS.length} baús diários.`);

  // Figurinhas/álbum (adaptado do bot Robbie — fase 4): raridades e
  // catálogo real extraídos do config original.
  const { STICKER_RARITIES, STICKERS } = require('../src/data/stickersCatalog');
  for (const r of STICKER_RARITIES) {
    await prisma.stickerRarity.upsert({ where: { id: r.id }, update: r, create: r });
  }
  for (const s of STICKERS) {
    const { slotIndex, ...stickerData } = s; // slotIndex é só auxiliar (ordem no catálogo), não existe no schema
    await prisma.collectibleSticker.upsert({ where: { id: stickerData.id }, update: stickerData, create: stickerData });
  }
  console.log(`Seeded ${STICKER_RARITIES.length} raridades e ${STICKERS.length} figurinhas.`);

  // Fundos de casa (mapas) — adaptado do sistema de mapas do bot Robbie:
  // fundos de imagem reais que o dono da casa pode escolher pra substituir
  // a cor sólida padrão.
  const { MAP_BACKGROUNDS } = require('../src/data/mapsCatalog');
  for (const map of MAP_BACKGROUNDS) {
    await prisma.mapBackground.upsert({ where: { id: map.id }, update: map, create: map });
  }
  console.log(`Seeded ${MAP_BACKGROUNDS.length} fundos de casa (mapas).`);

  // Layout do álbum (fundo + espaços) — pré-preenchido com 10 espaços (2
  // páginas de 5, já que o catálogo real tem 10 figurinhas), staff pode
  // reconfigurar tudo depois no painel administrativo.
  await prisma.albumSettings.upsert({
    where: { id: 'singleton' }, update: {},
    create: { id: 'singleton', backgroundColor: '#14161c', totalPages: 2 },
  });
  const SLOT_LAYOUT = Array.from({ length: 12 }, (_, i) => ({
    slotKey: `slot${i}`, x: 50 + (i % 4) * 426, y: 150 + Math.floor(i / 4) * 346, width: 396, height: 316, enabled: i < 5,
  }));
  for (const slot of SLOT_LAYOUT) {
    await prisma.albumSlot.upsert({ where: { slotKey: slot.slotKey }, update: {}, create: slot });
  }
  // Distribui as figurinhas nas duas páginas (5 por página) só pra não
  // abrir vazio — staff pode reposicionar cada uma livremente depois.
  const enabledSlotKeys = SLOT_LAYOUT.filter((s) => s.enabled).map((s) => s.slotKey);
  for (let i = 0; i < STICKERS.length; i++) {
    const page = Math.floor(i / enabledSlotKeys.length) + 1;
    const slotKey = enabledSlotKeys[i % enabledSlotKeys.length];
    await prisma.collectibleSticker.update({
      where: { id: STICKERS[i].id }, data: { assignedPage: page, assignedSlotKey: slotKey },
    }).catch(() => {});
  }
  console.log('Layout do álbum inicial criado (2 páginas, 5 espaços cada).');

  // Item pedido: "apague completamente a tag PROJ que já existe no
  // sistema... remova também qualquer registro dela no banco de
  // dados" — deleteMany já é seguro de rodar de novo em todo deploy
  // (se não existir mais, simplesmente não encontra nada e não faz
  // nada, sem erro). onDelete: SetNull no schema (User.clanTag) já
  // limpa sozinho qualquer clanTagId que estivesse apontando pra ela.
  // BUG CORRIGIDO ("a tag PROJ continua ativa mesmo depois de
  // removida"): investigação anterior mirou errado — não existe (e
  // nunca existiu) nenhuma ClanTag chamada "PROJ", então aquele
  // deleteMany nunca encontrava nada pra apagar de verdade. A causa
  // real é outra completamente: "PROJ" é a tag DE COMUNIDADE (sistema
  // separado, bem mais antigo — ver TagBadge.jsx/UserSettingsModal.jsx
  // "Tag da comunidade" em Configurações > Exibição), gerada
  // automaticamente a partir do nome da comunidade
  // (settings.communityName.slice(0, 4).toUpperCase() — "Project
  // Club" vira "PROJ" sozinho, ver setActiveTag em
  // userController.js) — nunca foi uma tag de clã, então limpar
  // User.tagText/tagEmoji é o que precisa acontecer aqui, em
  // qualquer conta que já tenha ativado essa tag antes (idempotente,
  // igual antes — não afeta quem já não tem PROJ ativo).
  const removedCommunityTag = await prisma.user.updateMany({
    where: { tagText: 'PROJ' }, data: { tagEmoji: null, tagText: null },
  });
  if (removedCommunityTag.count > 0) console.log(`Removida a tag de comunidade "PROJ" de ${removedCommunityTag.count} conta(s).`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
