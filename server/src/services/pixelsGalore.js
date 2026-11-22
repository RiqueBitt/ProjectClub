const fs = require('fs');
const path = require('path');

// Coleção "Fonte Mania" da Loja (nov/2026, pedido do dono; começou como
// "Pixels Galore" — a pasta e os "key" mantêm o nome antigo pra não quebrar
// quem já comprou): fontes do DaFont e do Fontesk pro nome no perfil, cada
// uma por 400 moedas ou 5 gemas. Os arquivos ficam em
// client/public/fonts/pixels-galore/ com um manifest.json (baixados pelo
// workflow .github/workflows/pixel-fonts.yml).
// A cada boot cria a coleção e os itens que faltam; não mexe no que a staff
// já editou depois (preço, ativo, coleção...), só acha pelo "key".

const COLLECTION_NAME = 'Fonte Mania';
const OLD_NAMES = ['Pixels Galore'];
const PRICE_COINS = 400;
const PRICE_GEMS = 5;
const URL_BASE = '/fonts/pixels-galore/';
const DEFAULT_ROOTS = [
  path.resolve(__dirname, '../../../client/dist'),
  path.resolve(__dirname, '../../../client/public'),
];

// Texto de cada fonte na Loja (créditos exigidos pela licença vão aqui).
const INFO = {
  minecraft: { name: 'Minecraft', description: 'Fonte pixelada no estilo do Minecraft. Por Craftron Gaming (DaFont, 100% grátis).' },
  'kiwi-soda': { name: 'Kiwi Soda', description: 'Fonte pixel arredondada e divertida. Por jeti (fontenddev.com), licença CC BY 4.0.' },
  'satyr-sp': { name: 'Satyr SP', description: 'Por Sasha Pavljenko (Fontesk, livre pra uso comercial).' },
  'matcha-cih': { name: 'Matcha Cih', description: 'Por Khurasan (Fontesk, livre pra uso comercial).' },
  balium: { name: 'Balium', description: 'Por Unio Creative Solutions (Fontesk, livre pra uso comercial).' },
  'cartas-de-abril': { name: 'Cartas De Abril', description: 'Por Arthur de Paula (licença OFL).' },
  'eastern-rhodopes': { name: 'Eastern Rhodopes', description: 'Por Dmitry Chekanov (licença OFL).' },
};

function readManifest(roots = DEFAULT_ROOTS) {
  for (const root of roots) {
    const dir = path.join(root, 'fonts', 'pixels-galore');
    try {
      const list = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      if (!Array.isArray(list)) continue;
      return list.filter((f) => f && /^[a-z0-9-]{1,40}$/.test(f.key || '')
        && /^[a-z0-9-]+\.(ttf|otf|woff2?)$/i.test(f.file || '')
        && fs.existsSync(path.join(dir, f.file)));
    } catch { /* tenta a próxima pasta */ }
  }
  return [];
}

async function ensurePixelsGalore({ db = require('../config/prisma'), roots = DEFAULT_ROOTS } = {}) {
  const fonts = readManifest(roots);
  if (fonts.length === 0) return { created: 0, skipped: 'sem fontes (rode o workflow pixel-fonts)' };

  let collection = await db.shopCollection.findFirst({ where: { name: COLLECTION_NAME } });
  if (!collection) {
    // Nome antigo ("Pixels Galore"): só renomeia, os itens continuam nela.
    const old = await db.shopCollection.findFirst({ where: { name: { in: OLD_NAMES } } });
    if (old) collection = await db.shopCollection.update({ where: { id: old.id }, data: { name: COLLECTION_NAME, description: 'Fontes pra deixar o seu nome no perfil com estilo.' } });
  }
  if (!collection) {
    collection = await db.shopCollection.create({
      data: {
        name: COLLECTION_NAME,
        description: 'Fontes pra deixar o seu nome no perfil com estilo.',
        accentColor: '#ff7ac6',
        active: true, featured: true, showInShop: true,
      },
    });
  }

  let created = 0;
  for (const [i, f] of fonts.entries()) {
    const key = `pixels-galore:${f.key}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await db.shopItem.findUnique({ where: { key } });
    if (exists) continue;
    const info = INFO[f.key] || { name: String(f.family || f.key).slice(0, 60), description: null };
    const family = String(f.family || info.name).replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 60) || info.name;
    try {
      // eslint-disable-next-line no-await-in-loop
      await db.shopItem.create({
        data: {
          kind: 'FONT', key, name: info.name, description: info.description,
          data: JSON.stringify({ family, url: `${URL_BASE}${f.file}`, source: 'file' }),
          priceCoins: PRICE_COINS, priceGems: PRICE_GEMS,
          active: true, sortOrder: i, collectionId: collection.id,
        },
      });
      created += 1;
    } catch (err) {
      if (err?.code !== 'P2002') throw err; // outra instância criou junto
    }
  }
  return { created, collectionId: collection.id };
}

module.exports = { ensurePixelsGalore, readManifest, COLLECTION_NAME, PRICE_COINS, PRICE_GEMS };
