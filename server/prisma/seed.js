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

// BUG CORRIGIDO ("seed falhou no deploy com PrismaClientInitializationError
// / Can't reach database server", logo depois de um `prisma db push` que
// funcionou normal): instabilidade passageira de rede entre o container
// do deploy e o banco, bem no instante em que o processo do `db push`
// fecha a conexão dele e este processo (`seed.js`) abre uma nova — o
// banco em si está de pé (o push, segundos antes, prova isso). Tenta de
// novo algumas vezes com uma pequena espera crescente antes de desistir,
// em vez de derrubar o deploy inteiro por causa de uma falha de conexão
// de meio segundo.
async function main() {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await prisma.$connect();
      break;
    } catch (err) {
      if (attempt === 5) throw err;
      const waitMs = attempt * 1000;
      console.warn(`Seed: não conectou ao banco na tentativa ${attempt}/5 (${err.message.split('\n')[0]}) — tentando de novo em ${waitMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  await seed();
}

async function seed() {
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

  // Item pedido: "não quero a tag Clube, se não tiver tag de clã não
  // apareça nada" — a funcionalidade genérica de "tag da comunidade"
  // (o botão que ficava em Configurações > Exibição, que já mostrou
  // "PROJ" e depois "Clube" como valor de reserva em tentativas
  // anteriores) foi removida de vez da tela — não há mais como
  // desativar isso por lá, então limpa aqui qualquer conta que ainda
  // tenha um valor preso nesses dois campos, de quando a
  // funcionalidade ainda existia. Idempotente: contas que já não têm
  // nada aí simplesmente não são afetadas.
  const removedCommunityTag = await prisma.user.updateMany({
    where: { tagText: { not: null } }, data: { tagEmoji: null, tagText: null },
  });
  if (removedCommunityTag.count > 0) console.log(`Removida a tag de comunidade de ${removedCommunityTag.count} conta(s).`);

  // Item pedido: "deixe o layout do discord como o principal pra todo
  // mundo, atualiza pra deixar ele como principal pra qualquer user
  // que for usar no futuro" — o default de conta nova já mudou
  // (schema.prisma), esta é a parte que falta: contas já existentes
  // que ainda estavam no valor antigo. Mesmo padrão do bloco acima —
  // idempotente (não sobrescreve quem já escolheu 'discord' ou
  // qualquer outro valor de propósito), então fica seguro aqui pra
  // sempre, sem precisar remover depois.
  const migratedToDiscordLayout = await prisma.user.updateMany({
    where: { layoutStyle: 'normal' }, data: { layoutStyle: 'discord' },
  });
  if (migratedToDiscordLayout.count > 0) console.log(`Layout padrão trocado pra 'discord' em ${migratedToDiscordLayout.count} conta(s).`);

  // Item pedido: "cadastrar sozinho" os jogos do sistema de Mods, sem
  // precisar clicar no painel da staff — mesmo padrão idempotente do
  // resto do seed (upsert por chave estável, seguro rodar de novo a
  // cada deploy). Cobre os jogos que a pessoa mencionou terem mods via
  // Steam Workshop (Payday 2/3, Terraria via tModLoader) ou GameBanana
  // (GTA V, Terraria). GTA V não tem entrada no mod.io/Workshop de
  // propósito — não existe API pública seguindo pra ele lá (ver
  // conversa: gta5-mods.com não tem API oficial, só teria como via
  // scraping, que não fazemos).
  // Item pedido: corrigir o Steam Workshop pra Payday 2/3 — pesquisei
  // e confirmei que NÃO deveriam estar aqui: o Payday 3 não tem
  // suporte a Steam Workshop nenhum (mods de verdade ficam no
  // ModWorkshop.net, um site totalmente diferente que a gente não
  // integra), e o Payday 2 só usa o Workshop pra skins cosméticos
  // votáveis — os mods de jogabilidade de verdade (a maioria do que a
  // comunidade usa) também ficam só no ModWorkshop.net. Mantê-los aqui
  // dava a entender errado que tinha mod ali quando na prática não
  // tinha nada relevante — removidos.
  const workshopGames = [
    { steamAppId: 4000, workshopAppId: 4000, displayName: "Garry's Mod" },
    { steamAppId: 550, workshopAppId: 550, displayName: 'Left 4 Dead 2' },
    { steamAppId: 232090, workshopAppId: 232090, displayName: 'Killing Floor 2' },
    { steamAppId: 244850, workshopAppId: 244850, displayName: 'Space Engineers' },
    { steamAppId: 255710, workshopAppId: 255710, displayName: 'Cities: Skylines' },
    { steamAppId: 346110, workshopAppId: 346110, displayName: 'ARK: Survival Evolved' },
    { steamAppId: 294100, workshopAppId: 294100, displayName: 'RimWorld' },
    { steamAppId: 281990, workshopAppId: 281990, displayName: 'Stellaris' },
    { steamAppId: 233860, workshopAppId: 233860, displayName: 'Kenshi' },
    { steamAppId: 1142710, workshopAppId: 1142710, displayName: 'Total War: WARHAMMER III' },
    { steamAppId: 322330, workshopAppId: 322330, displayName: "Don't Starve Together" },
    { steamAppId: 251570, workshopAppId: 251570, displayName: '7 Days to Die' },
    { steamAppId: 602960, workshopAppId: 602960, displayName: 'Barotrauma' },
    { steamAppId: 581320, workshopAppId: 581320, displayName: 'Insurgency: Sandstorm' },
    { steamAppId: 108600, workshopAppId: 108600, displayName: 'Project Zomboid' },
    {
      // Item pedido: "adicione o Workshop do Terraria" — o steamAppId
      // aqui é o do Terraria CLÁSSICO (105600, o jogo que a pessoa
      // realmente tem instalado e que o steamDetector encontra
      // sozinho), não o do tModLoader — é assim que esse jogo consegue
      // se FUNDIR com a entrada dele no GameBanana logo abaixo (mesmo
      // steamAppId nos dois) em vez de aparecer como um cartão
      // separado repetido. workshopAppId continua sendo o do
      // tModLoader (1281930), que é quem lê os mods de verdade — pra
      // isso funcionar, precisa instalá-lo também pela Steam.
      steamAppId: 105600, workshopAppId: 1281930, displayName: 'Terraria',
      note: 'Isso lê os mods através do tModLoader, um app separado da Steam — instale-o também pela sua biblioteca Steam.',
    },
  ];
  for (const g of workshopGames) {
    await prisma.workshopGameMapping.upsert({ where: { steamAppId: g.steamAppId }, update: g, create: g });
  }
  console.log(`Seeded ${workshopGames.length} jogos do Steam Workshop.`);

  // IDs conferidos direto nas páginas do GameBanana (gamebanana.com/games/<id>).
  // Item pedido: "corrija pois eu tenho o Garry's Mod baixado e ele
  // não está aparecendo" — faltava mesmo, id conferido direto na
  // página do jogo no GameBanana (a atual, "GMod Hub" — existem
  // páginas antigas tipo "Garry's Mod 9"/"13" com IDs diferentes, essa
  // aqui é a principal/ativa).
  const gamebananaGames = [
    { steamAppId: 4000, gameBananaGameId: 73, displayName: "Garry's Mod" },
    { steamAppId: 271590, gameBananaGameId: 4745, displayName: 'Grand Theft Auto V' },
    { steamAppId: 105600, gameBananaGameId: 4779, displayName: 'Terraria' },
  ];
  for (const g of gamebananaGames) {
    await prisma.gameBananaGameMapping.upsert({ where: { steamAppId: g.steamAppId }, update: g, create: g });
  }
  console.log(`Seeded ${gamebananaGames.length} jogos do GameBanana.`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
