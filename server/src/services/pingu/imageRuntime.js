// Liga o motor de imagens (image.js) ao site de verdade: banco, armazenamento
// (B2/disco via fileStorage), mensagens do Pingu e a IA (só pra traduzir o
// pedido quando o dicionário local não deu conta). Também tem o que o
// Painel da Equipe usa: lista dos pedidos e "Apagar" (some com a mensagem).
const image = require('./image');
const { clip } = require('./text');

const db = () => require('../../config/prisma');
const bot = () => require('../pinguBot');

const ENHANCE_SYSTEM = 'Translate the user\'s image description into short, clear English (at most 30 words) for an image generator. Keep every detail, add nothing unsafe. Reply only with the English description.';

/** Começo do dia de hoje em Brasília (UTC−3). */
function startOfBrDay(now = Date.now()) {
  const l = new Date(now - 3 * 3600000);
  return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()) + 3 * 3600000);
}

async function enhance(prompt) {
  const local = image.localEnhance(prompt);
  // Quase tudo traduzido (ou já em inglês): nem chama a IA.
  if (local.unknownRatio <= 0.34 || !bot().isOnline()) return local.prompt;
  try {
    const res = await bot().askModel([
      { role: 'system', content: ENHANCE_SYSTEM },
      { role: 'user', content: clip(prompt, 400) },
    ], { priority: bot().PRIORITY.USER, numPredict: 60, temperature: 0.2, timeoutMs: 25_000 });
    const en = String(res.text || '').replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').trim();
    return en ? clip(`${en}, ${image.QUALITY_TAGS}`, 400) : local.prompt;
  } catch { return local.prompt; }
}

let service = null;
function getService() {
  if (service) return service;
  service = image.createImageService({
    getConfig: () => require('./config').getConfig(),
    provider: () => image.providerName(),
    fetchImage: (req, opts) => image.fetchImage(req, opts),
    enhance: (prompt) => enhance(prompt),
    tierOf: async (userId) => (await db().user.findUnique({ where: { id: userId }, select: { supporterTier: true } }).catch(() => null))?.supporterTier || 'NONE',
    countToday: (userId) => db().pinguImage.count({ where: { userId, status: { in: ['PENDING', 'DONE'] }, createdAt: { gte: startOfBrDay() } } }),
    store: async ({ buffer, mime, name }) => {
      const { storeFile } = require('../fileStorage');
      const asset = await storeFile({ buffer, originalName: name, mimeType: mime, ownerId: await bot().botId() });
      return { url: asset.url, storageKey: asset.storageKey };
    },
    createLog: (data) => db().pinguImage.create({ data }),
    updateLog: (id, data) => db().pinguImage.update({ where: { id }, data }),
    ui: {
      placeholder: (target, text) => bot().createPinguMessage(target, text, { streaming: true }),
      update: (msg, text) => bot().updatePinguMessage(msg, text, { streaming: true }),
      finish: (msg, att) => bot().attachImageToPinguMessage(msg, att),
      fail: (msg, text) => bot().updatePinguMessage(msg, text, { persist: true }),
      reply: (target, text) => bot().replyAsPingu(target, text),
      remove: (msg) => bot().removePinguMessage(msg),
    },
    now: () => Date.now(),
    rng: Math.random,
  });
  return service;
}

// ---------------- painel ----------------

async function listImages({ status, limit = 100 } = {}) {
  const where = status && status !== 'ALL' ? { status } : {};
  const rows = await db().pinguImage.findMany({ where, orderBy: { createdAt: 'desc' }, take: Math.min(200, Number(limit) || 100) });
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const channelIds = [...new Set(rows.map((r) => r.channelId).filter(Boolean))];
  const [users, channels] = await Promise.all([
    db().user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, displayName: true, avatarUrl: true } }),
    channelIds.length ? db().channel.findMany({ where: { id: { in: channelIds } }, select: { id: true, name: true, slug: true } }) : [],
  ]);
  const u = new Map(users.map((x) => [x.id, x]));
  const c = new Map(channels.map((x) => [x.id, x]));
  const { channelPath } = require('../linkResolver');
  return rows.map((r) => {
    const ch = r.channelId ? c.get(r.channelId) || null : null;
    return {
      ...r, user: u.get(r.userId) || { id: r.userId }, channel: ch,
      link: ch && r.messageId ? `${channelPath(ch)}?m=${encodeURIComponent(r.messageId)}` : null,
    };
  });
}

/** Apaga a imagem: a mensagem do Pingu some do canal e o arquivo sai do armazenamento. */
async function deleteImage(io, id) {
  const row = await db().pinguImage.findUnique({ where: { id } });
  if (!row) throw Object.assign(new Error('Imagem não encontrada.'), { status: 404 });
  if (row.messageId) {
    const msg = await db().message.findUnique({ where: { id: row.messageId }, select: { id: true, channelId: true, conversationId: true, threadId: true, deleted: true } });
    if (msg && !msg.deleted) {
      await db().message.update({ where: { id: msg.id }, data: { deleted: true, content: null } });
      const { roomFor } = require('../../controllers/messageController');
      io?.to(roomFor(msg)).emit('message:delete', { id: msg.id, conversationId: msg.conversationId, channelId: msg.channelId, threadId: msg.threadId || null });
    }
  }
  if (row.storageKey) await require('../fileStorage').deleteFile(row.storageKey).catch(() => {});
  return db().pinguImage.update({ where: { id }, data: { status: 'DELETED', url: null } });
}

/** Estado pro painel: provedor, ligado, fila e o que já aconteceu. */
function imageStatus() {
  const s = getService().status();
  return {
    ...s,
    providerConfigured: s.provider !== 'off',
    localUrl: s.provider === 'local' ? String(process.env.PINGU_IMAGE_URL || '').replace(/\/\/[^@/]*@/, '//') : null,
  };
}

module.exports = { getService, listImages, deleteImage, imageStatus, startOfBrDay, enhance };
