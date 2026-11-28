// Pacotes de emojis embutidos: Club Penguin e MSN (nov/2026, pedido do dono).
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
// Pacotes embutidos (imagens em client/public/emoji-sets/<pasta>/ com um
// manifest.json). Não contam no limite de 250 emojis da equipe.
const EMOJI_SETS = [
  { dir: 'clubpenguin', collection: COLLECTION_NAME, prefix: 'cp_' },
  // Emoticons originais do MSN / Windows Live Messenger (bernzrdo/msn-emoticons).
  { dir: 'msn', collection: 'MSN', prefix: 'msn_' },
];
const BUILTIN_URL_PREFIX = '/emoji-sets/';

function readManifest(roots, set = EMOJI_SETS[0]) {
  const nameRe = new RegExp(`^${set.prefix}[a-z0-9_]{1,29}$`);
  for (const root of roots) {
    try {
      const raw = fs.readFileSync(path.join(root, 'emoji-sets', set.dir, 'manifest.json'), 'utf8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list.filter((e) => e && nameRe.test(e.name) && /^[a-z0-9_.-]+$/i.test(e.file || ''));
    } catch { /* tenta o próximo */ }
  }
  return [];
}

const DEFAULT_ROOTS = [
  path.resolve(__dirname, '../../../client/dist'),
  path.resolve(__dirname, '../../../client/public'),
];

/** Garante a coleção e os emojis de um pacote embutido (só cria o que falta). */
async function ensureEmojiSet(set, { db = require('../config/prisma'), roots = DEFAULT_ROOTS } = {}) {
  const list = readManifest(roots, set);
  if (list.length === 0) return { created: 0, skipped: 'sem manifest' };
  const owner = await db.user.findFirst({ where: { platformRole: 'ADMIN' }, orderBy: { createdAt: 'asc' }, select: { id: true } })
    || await db.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!owner) return { created: 0, skipped: 'sem usuários' };

  const urlBase = `${BUILTIN_URL_PREFIX}${set.dir}/`;
  let collection = await db.assetCollection.findFirst({ where: { kind: 'EMOJI', name: set.collection } });
  if (!collection) {
    collection = await db.assetCollection.create({ data: { kind: 'EMOJI', name: set.collection, iconUrl: `${urlBase}${list[0].file}`, order: 0 } });
  }
  const existing = new Set((await db.emoji.findMany({ where: { name: { in: list.map((e) => e.name) } }, select: { name: true } })).map((e) => e.name));
  let created = 0;
  for (const e of list) {
    if (existing.has(e.name)) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await db.emoji.create({ data: { name: e.name, url: `${urlBase}${e.file}`, category: set.collection, collectionId: collection.id, createdById: owner.id } });
      created += 1;
    } catch (err) {
      if (err?.code !== 'P2002') throw err; // nome já usado (corrida entre instâncias): segue
    }
  }
  return { created, collectionId: collection.id };
}

/** Club Penguin (mantido pelo nome antigo). */
async function ensureCpEmotes(opts = {}) {
  return ensureEmojiSet(EMOJI_SETS[0], opts);
}

/** Todos os pacotes embutidos, um depois do outro. */
async function ensureBuiltinEmojiSets(opts = {}) {
  const out = {};
  for (const set of EMOJI_SETS) {
    // eslint-disable-next-line no-await-in-loop
    out[set.collection] = await ensureEmojiSet(set, opts).catch((err) => ({ created: 0, error: err.message }));
  }
  return out;
}

module.exports = { ensureCpEmotes, ensureEmojiSet, ensureBuiltinEmojiSets, readManifest, COLLECTION_NAME, EMOJI_SETS, BUILTIN_URL_PREFIX };
