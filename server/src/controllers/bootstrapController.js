// GET /api/bootstrap — "pacote de abertura" do app numa requisição só.
//
// Antes, abrir o app disparava ~20 requisições separadas (comunidade,
// amigos, conversas, clã, emojis, figurinhas, coleções, GIFs favoritos,
// configurações, layout, status, anúncio, eventos...) — cada uma com sua
// própria checagem de login no banco (requireAuth) e seu próprio custo de
// rede. Aqui tudo vem junto, reaproveitando EXATAMENTE os mesmos handlers
// das rotas antigas (que continuam existindo, por compatibilidade).
//
// Cada seção volta com um hash curto do conteúdo. O cliente manda de volta
// os hashes que já tem (`?have=secao:hash,...`) e a seção que não mudou
// não é reenviada (só o hash) — o refresh ao vivo quase não gasta banda
// quando nada mudou. `?only=a,b` pede só algumas seções.
const crypto = require('crypto');
const { runHandler } = require('../utils/internalCall');
const { maskDeep } = require('../utils/presenceVisibility');
const authCtrl = require('./authController');
const communityCtrl = require('./communityController');
const conversationCtrl = require('./conversationController');
const friendCtrl = require('./friendController');
const clanCtrl = require('./clanController');
const emojiCtrl = require('./emojiController');
const stickerCtrl = require('./serverStickerController');
const collectionCtrl = require('./assetCollectionController');
const gifCtrl = require('./gifController');
const communitiesCtrl = require('./communitiesController');
const settingsCtrl = require('./settingsController');
const uiEditorCtrl = require('./uiEditorController');
const platformCtrl = require('./platformController');
const announcementCtrl = require('./announcementController');
const eventsCtrl = require('./eventsController');
const channelCtrl = require('./channelController');

// seção -> [handler, opções] — o corpo de cada seção é igual ao da rota antiga.
const SECTIONS = {
  me: [authCtrl.me], // GET /auth/me
  community: [communityCtrl.getCommunity], // GET /community
  conversations: [conversationCtrl.listConversations], // GET /conversations
  friends: [friendCtrl.listFriends], // GET /friends
  clan: [clanCtrl.getMyClan], // GET /clans/mine
  usableEmojis: [emojiCtrl.listUsableEmojis], // GET /users/me/usable-emojis
  stickers: [stickerCtrl.listStickers], // GET /community/stickers
  emojiCollections: [collectionCtrl.listCollections, { params: { kind: 'EMOJI' } }],
  stickerCollections: [collectionCtrl.listCollections, { params: { kind: 'STICKER' } }],
  favoriteGifs: [gifCtrl.listFavoriteGifs], // GET /users/me/favorite-gifs
  clubs: [communitiesCtrl.listCommunities], // GET /communities
  settings: [settingsCtrl.getSettings], // GET /users/me/settings
  uiLayout: [uiEditorCtrl.getUiLayout], // GET /ui-layout
  status: [platformCtrl.getStatus], // GET /platform/status
  announcement: [announcementCtrl.getActiveAnnouncement], // GET /platform/announcements/active
  events: [eventsCtrl.listEvents], // GET /events
  channelStates: [channelCtrl.getChannelStates], // GET /community/channels/read-states
};
const SECTION_NAMES = Object.keys(SECTIONS);

function hashOf(body) {
  return crypto.createHash('sha1').update(JSON.stringify(body ?? null)).digest('base64url').slice(0, 12);
}

function parseList(raw) {
  if (typeof raw !== 'string' || !raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 64);
}

// Roda as seções com no máximo `limit` ao mesmo tempo (não abre 16
// consultas paralelas no pool do Prisma de uma vez só).
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function getBootstrap(req, res, next) {
  try {
    const only = parseList(req.query.only).filter((s) => SECTIONS[s]);
    const wanted = only.length ? only : SECTION_NAMES;
    const have = {};
    parseList(req.query.have).forEach((pair) => {
      const [k, h] = pair.split(':');
      if (k && h && SECTIONS[k]) have[k] = h;
    });

    const results = await mapLimit(wanted, 6, async (name) => {
      const [handler, opts] = SECTIONS[name];
      const r = await runHandler(handler, req, opts);
      return [name, r];
    });

    const hashes = {};
    const data = {};
    const failed = {};
    results.forEach(([name, r]) => {
      if (r.status >= 200 && r.status < 300) {
        // Mascara o "invisível" ANTES do hash: o hash não pode mudar quando
        // alguém só alterna entre invisível e offline.
        const body = maskDeep(r.body, req.user?.id || null);
        const h = hashOf(body);
        hashes[name] = h;
        if (have[name] !== h) data[name] = body ?? null;
      } else {
        // O cliente busca essa seção pela rota antiga (mesmo erro que antes).
        failed[name] = r.status;
      }
    });

    // Dado pessoal: nada de cache compartilhado (proxy/CDN).
    res.set('Cache-Control', 'private, no-cache');
    res.json({ v: 1, at: Date.now(), hashes, data, failed });
  } catch (err) { next(err); }
}

module.exports = { getBootstrap, SECTION_NAMES, hashOf };
