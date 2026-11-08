// Cria (ou atualiza) as coleções temáticas da Loja descritas em
// scripts/colecoes-data.js. Pode rodar quantas vezes quiser: acha cada coisa
// pelo nome e só atualiza. Nunca apaga nada — os estilos de perfil que já
// existem só ganham a coleção (e ficam ativos pra venda); preço, estoque e
// o que a staff já ajustou nos estilos continuam como estão.
//   node scripts/seed-colecoes.js
const prisma = require('../src/config/prisma');
const { ensureBuiltinStyles } = require('../src/services/profileStyles');
const { resolveGoogleFontFile } = require('../src/controllers/shopExtrasController');
const { COLLECTIONS, PRICES } = require('./colecoes-data');

async function upsertBy(model, where, data) {
  const have = await prisma[model].findFirst({ where });
  return have ? prisma[model].update({ where: { id: have.id }, data }) : prisma[model].create({ data });
}

async function main() {
  await ensureBuiltinStyles();
  for (const [ci, c] of COLLECTIONS.entries()) {
    const base = `/loja/${c.slug}`;
    const tags = c.slug.replace(/-/g, ' ');
    const double = c.styles.length > 1;
    const col = await upsertBy('shopCollection', { name: c.name }, {
      name: c.name, description: c.description, bannerUrl: `${base}/banner.webp`, logoUrl: `${base}/logo.webp`, accentColor: c.accent,
      active: true, showInShop: true, featured: double, sortOrder: ci + 1,
      bundlePriceCoins: double ? PRICES.bundleDouble : PRICES.bundleSingle,
    });

    for (const [i, f] of c.frames.entries()) {
      await upsertBy('avatarDecoration', { name: f.name, collectionId: col.id }, {
        name: f.name, description: f.description, imageUrl: `${base}/moldura-${i + 1}.webp`, priceCoins: PRICES.frame,
        color: c.accent, tags, active: true, sortOrder: i, scale: 1.2, offsetX: 0, offsetY: 0, collectionId: col.id,
      });
    }
    for (const [i, e] of c.effects.entries()) {
      await upsertBy('profileEffect', { name: e.name, collectionId: col.id }, {
        name: e.name, description: e.description, imageUrl: `${base}/efeito-${i + 1}.webp`, priceCoins: PRICES.effect,
        color: c.accent, tags, active: true, sortOrder: i, scale: 1, offsetX: 0, offsetY: 0, opacity: 0.9, duration: 4,
        mScale: 1, mOffsetX: 0, mOffsetY: 0, mOpacity: 0.9, mDuration: 4, collectionId: col.id,
      });
    }
    for (const key of c.styles) {
      await prisma.shopItem.update({ where: { key: `style:${key}` }, data: { active: true, collectionId: col.id } });
    }
    const url = await resolveGoogleFontFile(c.font.family);
    if (!url) throw new Error(`Fonte ${c.font.family} não encontrada no Google Fonts`);
    await upsertBy('shopItem', { kind: 'FONT', name: c.font.name }, {
      kind: 'FONT', name: c.font.name, description: c.font.description, priceCoins: PRICES.font, active: true, tags,
      data: JSON.stringify({ family: c.font.family, url, source: 'google' }), collectionId: col.id,
    });
    console.log(`ok ${c.name}: ${c.frames.length} molduras, ${c.effects.length} efeitos, ${c.styles.length} estilo(s), fonte ${c.font.family}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
