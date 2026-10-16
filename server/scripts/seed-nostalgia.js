// Cria (ou atualiza) a coleção "Nostalgia" da Loja: banner, 3 molduras,
// 2 efeitos de perfil, os estilos Windows 2000 + Mensageiro 2005 e 1 fonte.
// As imagens ficam no próprio site (client/public/loja/nostalgia/).
// Pode rodar mais de uma vez: acha pelo nome e só atualiza.
//   node scripts/seed-nostalgia.js
const prisma = require('../src/config/prisma');
const { ensureBuiltinStyles } = require('../src/services/profileStyles');
const { resolveGoogleFontFile } = require('../src/controllers/shopExtrasController');

const BASE = '/loja/nostalgia';
const TAGS = 'nostalgia,anos 2000,retro';

const COLLECTION = {
  name: 'Nostalgia',
  description: 'Uma viagem de volta aos anos 2000: CD-ROM brilhando, janelas de erro, purpurina, protetor de tela e bate-papo com status "Disponível".',
  bannerUrl: `${BASE}/banner.webp`,
  accentColor: '#2e9bea',
  active: true,
  featured: true,
  sortOrder: 0,
  bundlePriceCoins: 12000,
};

const FRAMES = [
  { name: 'CD-ROM', imageUrl: `${BASE}/moldura-cd-rom.webp`, priceCoins: 1500, color: '#a98bff', description: 'Disco de 700 MB com reflexo de arco-íris girando em volta da sua foto.' },
  { name: 'Janela Clássica', imageUrl: `${BASE}/moldura-janela-classica.webp`, priceCoins: 1500, color: '#0a246a', description: 'Sua foto dentro de uma janela "perfil.exe", com barra de título azul e barrinha carregando.' },
  { name: 'Glitter 2000', imageUrl: `${BASE}/moldura-glitter-2000.webp`, priceCoins: 1500, color: '#ff3fb4', description: 'Purpurina rosa, lilás e azul piscando, com estrelinhas e coraçõezinhos — direto do perfil de 2006.' },
];

const EFFECTS = [
  { name: 'Janela Travada', imageUrl: `${BASE}/efeito-janela-travada.webp`, priceCoins: 3000, color: '#0a246a', opacity: 1, mOpacity: 1, description: 'Uma janela de erro trava e vai deixando um rastro de cópias pelo seu perfil.' },
  { name: 'Protetor de Tela', imageUrl: `${BASE}/efeito-protetor-de-tela.webp`, priceCoins: 3000, color: '#39ff9a', opacity: 0.9, mOpacity: 0.9, description: 'Linhas de neon quicando e trocando de cor, igual ao protetor de tela do computador da família.' },
];

const STYLE_KEYS = ['style:win2000', 'style:mensageiro'];
const FONT = { name: 'Pixel 2000', family: 'Silkscreen', priceCoins: 1200, description: 'Letra pixelada dos sites em Flash dos anos 2000.' };

async function main() {
  await ensureBuiltinStyles();

  let col = await prisma.shopCollection.findFirst({ where: { name: COLLECTION.name } });
  col = col
    ? await prisma.shopCollection.update({ where: { id: col.id }, data: COLLECTION })
    : await prisma.shopCollection.create({ data: COLLECTION });
  console.log('coleção', col.id);

  for (const [i, f] of FRAMES.entries()) {
    const data = { ...f, tags: TAGS, active: true, sortOrder: i, scale: 1.2, offsetX: 0, offsetY: 0, collectionId: col.id };
    const have = await prisma.avatarDecoration.findFirst({ where: { name: f.name, collectionId: col.id } });
    const row = have ? await prisma.avatarDecoration.update({ where: { id: have.id }, data }) : await prisma.avatarDecoration.create({ data });
    console.log('moldura', row.name, row.id);
  }

  for (const [i, e] of EFFECTS.entries()) {
    const data = { ...e, tags: TAGS, active: true, sortOrder: i, scale: 1, offsetX: 0, offsetY: 0, duration: 4, mScale: 1, mOffsetX: 0, mOffsetY: 0, mDuration: 4, collectionId: col.id };
    const have = await prisma.profileEffect.findFirst({ where: { name: e.name, collectionId: col.id } });
    const row = have ? await prisma.profileEffect.update({ where: { id: have.id }, data }) : await prisma.profileEffect.create({ data });
    console.log('efeito', row.name, row.id);
  }

  for (const key of STYLE_KEYS) {
    const row = await prisma.shopItem.update({ where: { key }, data: { active: true, collectionId: col.id, tags: TAGS } });
    console.log('estilo', row.name, row.id);
  }

  const url = await resolveGoogleFontFile(FONT.family);
  if (!url) throw new Error(`fonte ${FONT.family} não encontrada no Google Fonts`);
  const fontData = JSON.stringify({ family: FONT.family, url, source: 'google' });
  const haveFont = await prisma.shopItem.findFirst({ where: { kind: 'FONT', name: FONT.name } });
  const fontRow = {
    name: FONT.name, description: FONT.description, priceCoins: FONT.priceCoins, active: true,
    data: fontData, tags: TAGS, collectionId: col.id,
  };
  const font = haveFont
    ? await prisma.shopItem.update({ where: { id: haveFont.id }, data: fontRow })
    : await prisma.shopItem.create({ data: { ...fontRow, kind: 'FONT' } });
  console.log('fonte', font.name, font.id);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
