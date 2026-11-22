// Emojis do Club Penguin (nov/2026, pedido do dono).
//
// As imagens são os emoticons originais do jogo, baixados da wiki
// (clubpenguinemoticons.fandom.com) pelo workflow "Emojis do Club
// Penguin" (.github/workflows/cp-emotes.yml) pra
// client/public/emoji-sets/clubpenguin/, com um manifest.json. A cada
// boot, isto garante uma coleção de emoji "Club Penguin" com um emoji
// :cp_nome: pra cada imagem — aparecem no seletor e no chat como qualquer
// emoji personalizado. Idempotente: não duplica nem mexe no que a staff
// já editou/apagou depois (só cria os que faltam pelo nome).
const fs = require('fs');
const path = require('path');

const COLLECTION_NAME = 'Club Penguin';
const EMOJI_SLOT_LIMIT = 250; // mesmo limite do emojiController
const URL_BASE = '/emoji-sets/clubpenguin/';
const NAME_RE = /^cp_[a-z0-9_]{1,29}$/;

function readManifest(roots) {
  for (const root of roots) {
    try {
      const raw = fs.readFileSync(path.join(root, 'emoji-sets', 'clubpenguin', 'manifest.json'), 'utf8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list.filter((e) => e && NAME_RE.test(e.name) && /^[a-z0-9_.-]+$/i.test(e.file || ''));
    } catch { /* tenta o próximo */ }
  }
  return [];
}

const DEFAULT_ROOTS = [
  path.resolve(__dirname, '../../../client/dist'),
  path.resolve(__dirname, '../../../client/public'),
];

async function ensureCpEmotes({ db = require('../config/prisma'), roots = DEFAULT_ROOTS } = {}) {
  const list = readManifest(roots);
  if (list.length === 0) return { created: 0, skipped: 'sem manifest' };
  const owner = await db.user.findFirst({ where: { platformRole: 'ADMIN' }, orderBy: { createdAt: 'asc' }, select: { id: true } })
    || await db.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!owner) return { created: 0, skipped: 'sem usuários' };

  let collection = await db.assetCollection.findFirst({ where: { kind: 'EMOJI', name: COLLECTION_NAME } });
  if (!collection) {
    collection = await db.assetCollection.create({ data: { kind: 'EMOJI', name: COLLECTION_NAME, iconUrl: `${URL_BASE}${list[0].file}`, order: 0 } });
  }
  const existing = new Set((await db.emoji.findMany({ where: { name: { in: list.map((e) => e.name) } }, select: { name: true } })).map((e) => e.name));
  let total = await db.emoji.count();
  let created = 0;
  for (const e of list) {
    if (existing.has(e.name)) continue;
    if (total >= EMOJI_SLOT_LIMIT) break;
    try {
      // eslint-disable-next-line no-await-in-loop
      await db.emoji.create({ data: { name: e.name, url: `${URL_BASE}${e.file}`, category: COLLECTION_NAME, collectionId: collection.id, createdById: owner.id } });
      created += 1; total += 1;
    } catch (err) {
      if (err?.code !== 'P2002') throw err; // nome já usado (corrida entre instâncias): segue
    }
  }
  return { created, collectionId: collection.id };
}

module.exports = { ensureCpEmotes, readManifest, COLLECTION_NAME };
