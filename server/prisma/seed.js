// Popula o catálogo de insígnias e cria a estrutura inicial da comunidade
// única: o cargo "@todos" (equivalente ao antigo @everyone por servidor,
// agora global — toda conta nova recebe automaticamente, ver
// authController.register) e uma categoria/canais padrão pra não começar
// vazio. Seguro rodar de novo: cada parte só escreve o que falta/mudou
// (ver syncCatalog/runOnce abaixo) e com os sistemas de casas/figurinhas
// desligados (src/config/features.js) esses catálogos nem são lidos.
const { PrismaClient } = require('@prisma/client');
const { DEFAULT_EVERYONE_PERMISSIONS, toStringBits } = require('../src/services/permissions');
const { isFeatureEnabled } = require('../src/config/features');
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

// ---------- Ajudantes: seed barato e silencioso ----------
// O seed roda em TODO deploy (ver scripts/prisma-push-with-retry.js).
// Antes ele fazia um upsert por item de cada catálogo (centenas de
// consultas) e imprimia "Seeded ..." sempre, mesmo sem mudar nada. Agora
// cada catálogo faz UMA leitura e só escreve o que falta ou mudou; o log
// só aparece quando algo realmente foi criado/alterado.
const changes = [];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

async function syncCatalog(label, delegate, rows, idField = 'id') {
  const existing = await delegate.findMany({ where: { [idField]: { in: rows.map((r) => r[idField]) } } });
  const byId = new Map(existing.map((e) => [e[idField], e]));
  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const cur = byId.get(row[idField]);
    if (!cur) {
      await delegate.create({ data: row });
      created += 1;
    } else if (Object.keys(row).some((k) => !same(cur[k], row[k]))) {
      await delegate.update({ where: { [idField]: row[idField] }, data: row });
      updated += 1;
    }
  }
  if (created || updated) changes.push(`${label}: ${created} novo(s), ${updated} atualizado(s)`);
  return { created, updated };
}

// Migrações de dados que só podem rodar UMA vez (model SeedMarker). Se a
// tabela ainda não existir no client gerado, cai no modo "sempre roda" —
// por isso cada migração também é escrita pra ser inofensiva ao repetir.
async function runOnce(key, fn) {
  const markers = prisma.seedMarker;
  if (markers) {
    const done = await markers.findUnique({ where: { key } }).catch(() => null);
    if (done) return;
  }
  await fn();
  if (markers) await markers.upsert({ where: { key }, update: {}, create: { key } }).catch(() => {});
}

async function seed() {
  await syncCatalog('Insígnias', prisma.badge, BADGES, 'key');

  // Configurações da plataforma/comunidade (singleton).
  if (!(await prisma.platformSettings.findUnique({ where: { id: 'singleton' } }))) {
    await prisma.platformSettings.create({ data: { id: 'singleton', communityName: 'Project Club' } });
  }

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
    changes.push('Cargo @todos criado');
  }

  // Estrutura inicial de canais, pra comunidade não abrir vazia.
  const existingCategory = await prisma.category.findFirst();
  if (!existingCategory) {
    const geral = await prisma.category.create({ data: { name: 'Geral', position: 0 } });
    await prisma.channel.create({ data: { name: 'início', type: 'TEXT', categoryId: geral.id, position: 0, topic: 'Bem-vindo(a) à comunidade!' } });
    await prisma.channel.create({ data: { name: 'avisos', type: 'ANNOUNCEMENT', categoryId: geral.id, position: 1 } });
    await prisma.channel.create({ data: { name: 'geral', type: 'TEXT', categoryId: geral.id, position: 2 } });
    changes.push('Categoria e canais padrão criados');
  }

  // Casas/decoração e figurinhas colecionáveis (adaptados do bot Robbie)
  // estão DESLIGADOS no código (src/config/features.js). Com o sistema
  // desligado não há por que mexer nessas tabelas a cada deploy; os
  // dados antigos continuam no banco intactos. Ao religar, o próximo
  // deploy sincroniza tudo de novo.
  if (isFeatureEnabled('houses')) {
    const { FURNITURE_CATEGORIES, FURNITURE_ITEMS, HOUSE_CATALOG } = require('../src/data/housesCatalog');
    await syncCatalog('Categorias de móveis', prisma.furnitureCategory, FURNITURE_CATEGORIES);
    await syncCatalog('Móveis', prisma.furniture, FURNITURE_ITEMS);
    await syncCatalog('Casas', prisma.houseCatalog, HOUSE_CATALOG);
    // Fundos de casa (mapas) — fundos de imagem que o dono da casa pode
    // escolher no lugar da cor sólida padrão.
    const { MAP_BACKGROUNDS } = require('../src/data/mapsCatalog');
    await syncCatalog('Fundos de casa', prisma.mapBackground, MAP_BACKGROUNDS);
  }

  // Baús diários (editáveis pela staff — ver adminController de
  // economia): só cria os que faltam, uma leitura só.
  const chestsCatalog = require('../src/data/chestsCatalog');
  const chestRows = await prisma.dailyChest.findMany({ where: { name: { in: chestsCatalog.DAILY_CHESTS.map((c) => c.name) } } });
  const chestByName = new Map(chestRows.map((c) => [c.name, c]));
  for (const [i, chest] of chestsCatalog.DAILY_CHESTS.entries()) {
    const existing = chestByName.get(chest.name);
    if (!existing) {
      await prisma.dailyChest.create({ data: { ...chest, position: i } });
      changes.push(`Baú "${chest.name}" criado`);
    } else if (chest.imageClosed && !existing.imageClosed) {
      // Backfill pra bancos que já tinham os baús criados ANTES das
      // imagens entrarem no catálogo.
      await prisma.dailyChest.update({ where: { id: existing.id }, data: { imageClosed: chest.imageClosed, imageOpened: chest.imageOpened } });
      changes.push(`Baú "${chest.name}": imagens adicionadas`);
    }
  }

  if (isFeatureEnabled('stickers')) {
    // Figurinhas/álbum: raridades e catálogo real extraídos do config original.
    const { STICKER_RARITIES, STICKERS } = require('../src/data/stickersCatalog');
    await syncCatalog('Raridades de figurinha', prisma.stickerRarity, STICKER_RARITIES);
    // slotIndex é só auxiliar (ordem no catálogo), não existe no schema.
    await syncCatalog('Figurinhas', prisma.collectibleSticker, STICKERS.map(({ slotIndex, ...data }) => data));

    // Layout do álbum (fundo + espaços): só na PRIMEIRA vez. Antes, toda
    // execução redistribuía as figurinhas nos espaços — desfazendo o que
    // a staff tivesse reposicionado no painel.
    const album = await prisma.albumSettings.findUnique({ where: { id: 'singleton' } });
    if (!album) {
      await prisma.albumSettings.create({ data: { id: 'singleton', backgroundColor: '#14161c', totalPages: 2 } });
      const SLOT_LAYOUT = Array.from({ length: 12 }, (_, i) => ({
        slotKey: `slot${i}`, x: 50 + (i % 4) * 426, y: 150 + Math.floor(i / 4) * 346, width: 396, height: 316, enabled: i < 5,
      }));
      for (const slot of SLOT_LAYOUT) {
        await prisma.albumSlot.upsert({ where: { slotKey: slot.slotKey }, update: {}, create: slot });
      }
      const enabledSlotKeys = SLOT_LAYOUT.filter((s) => s.enabled).map((s) => s.slotKey);
      for (let i = 0; i < STICKERS.length; i++) {
        const page = Math.floor(i / enabledSlotKeys.length) + 1;
        const slotKey = enabledSlotKeys[i % enabledSlotKeys.length];
        await prisma.collectibleSticker.update({
          where: { id: STICKERS[i].id }, data: { assignedPage: page, assignedSlotKey: slotKey },
        }).catch(() => {});
      }
      changes.push('Layout do álbum inicial criado (2 páginas, 5 espaços cada)');
    }
  }

  // A "tag da comunidade" foi removida da tela — limpa qualquer conta que
  // ainda tenha um valor preso nesses campos. Uma consulta só; não faz
  // nada quando já está tudo limpo.
  const removedCommunityTag = await prisma.user.updateMany({
    where: { tagText: { not: null } }, data: { tagEmoji: null, tagText: null },
  });
  if (removedCommunityTag.count > 0) changes.push(`Tag de comunidade removida de ${removedCommunityTag.count} conta(s)`);

  // Layout "Normal 2.0" como padrão: migração de UMA vez só (marcador
  // 'layout-normal2'). Causa do log "aplicado em N conta(s)" a cada
  // deploy: conta nova nasce com layoutVersion 0 (e já em "normal2"), e
  // a versão anterior pegava toda conta em 0 de novo. Agora: só roda uma
  // vez e só mexe em quem nunca escolheu (layoutVersion < 2) e ainda
  // está num layout antigo — quem escolheu em Configurações já está em 2
  // e nunca é tocado.
  await runOnce('layout-normal2', async () => {
    const migrated = await prisma.user.updateMany({
      where: { layoutVersion: { lt: 2 }, layoutStyle: { not: 'normal2' } },
      data: { layoutStyle: 'normal2', layoutVersion: 2 },
    });
    if (migrated.count > 0) changes.push(`Layout 'Normal 2.0' aplicado em ${migrated.count} conta(s) (migração única)`);
  });

  // Jogos do sistema de Mods cadastrados sozinhos (Steam Workshop e
  // GameBanana). Payday 2/3 ficaram de fora de propósito: os mods de
  // verdade deles ficam no ModWorkshop.net, que não integramos. GTA V não
  // tem Workshop (só GameBanana).
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
      // Terraria: steamAppId do jogo CLÁSSICO (105600, o que o
      // steamDetector encontra) pra fundir com a entrada do GameBanana
      // logo abaixo; workshopAppId é o do tModLoader (1281930), que é
      // quem lê os mods de verdade.
      steamAppId: 105600, workshopAppId: 1281930, displayName: 'Terraria',
      note: 'Isso lê os mods através do tModLoader, um app separado da Steam — instale-o também pela sua biblioteca Steam.',
    },
  ];
  await syncCatalog('Jogos do Steam Workshop', prisma.workshopGameMapping, workshopGames, 'steamAppId');

  // IDs conferidos direto nas páginas do GameBanana (gamebanana.com/games/<id>).
  const gamebananaGames = [
    { steamAppId: 4000, gameBananaGameId: 73, displayName: "Garry's Mod" },
    { steamAppId: 271590, gameBananaGameId: 4745, displayName: 'Grand Theft Auto V' },
    { steamAppId: 105600, gameBananaGameId: 4779, displayName: 'Terraria' },
  ];
  await syncCatalog('Jogos do GameBanana', prisma.gameBananaGameMapping, gamebananaGames, 'steamAppId');

  // Pingentes do catálogo da staff foram descontinuados: agora só vale a
  // imagem própria que cada pessoa envia. Limpa as escolhas antigas (não
  // apaga nada do banco, só desmarca). Uma consulta; nada quando já limpo.
  const clearedPendants = await prisma.user.updateMany({ where: { selectedPendantId: { not: null } }, data: { selectedPendantId: null } });
  if (clearedPendants.count) changes.push(`Pingentes do catálogo removidos de ${clearedPendants.count} conta(s)`);

  if (changes.length) {
    console.log('Seed: alterações aplicadas —');
    changes.forEach((c) => console.log(`  - ${c}`));
  } else {
    console.log('Seed: nada a mudar (tudo já estava em dia).');
  }
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
