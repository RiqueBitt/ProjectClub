// Webhooks de canais (item "Webhooks de canais"): um serviço externo
// (GitHub, formulário, bot, painel do Minecraft…) faz POST na URL secreta e a
// mensagem aparece no canal com o nome do webhook.
//
// Segurança:
//  - o token (32 bytes aleatórios) só é mostrado UMA vez; guardamos o SHA-256;
//  - comparação em tempo constante;
//  - limite de envios por webhook; @everyone/@here/menções não pingam ninguém;
//  - só quem tem MANAGE_CHANNELS cria, lista, troca o token ou apaga.
const crypto = require('crypto');

const getPrisma = () => require('../config/prisma');
const MAX_PER_CHANNEL = 10;
const MAX_CONTENT = 2000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const BOT_EMAIL_DOMAIN = '@webhook.projectclub.local';

const hits = new Map(); // webhookId -> [timestamps]

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
function safeEqualHex(a, b) {
  const x = Buffer.from(String(a || ''), 'hex');
  const y = Buffer.from(String(b || ''), 'hex');
  return x.length === 32 && x.length === y.length && crypto.timingSafeEqual(x, y);
}
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

function cleanName(v) {
  const s = String(v ?? '').replace(/[\u0000-\u001f<>@]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return s.length >= 2 ? s : null;
}

const httpsUrl = (v, max = 2000) => (typeof v === 'string' && /^https:\/\//i.test(v) ? v.slice(0, max) : undefined);

/** Desarma menções em massa (o texto continua igual, mas não pinga ninguém). */
function defuse(text) {
  return String(text || '').replace(/@(everyone|here|todos)/gi, '@​$1').replace(/<@[!&]?[\w-]+>/g, (m) => m.replace('<@', '<@​'));
}

function colorOf(c) {
  if (typeof c === 'number' && c >= 0 && c <= 0xffffff) return `#${c.toString(16).padStart(6, '0')}`;
  if (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) return c;
  return undefined;
}

/** Aceita o formato do Discord ({ content, embeds:[...] }) e devolve { content, embed } já limpos. */
function parsePayload(body) {
  const b = body && typeof body === 'object' ? body : {};
  const content = b.content != null ? defuse(String(b.content)).slice(0, MAX_CONTENT).trim() : '';
  const raw = Array.isArray(b.embeds) ? b.embeds[0] : (b.embed && typeof b.embed === 'object' ? b.embed : null);
  let embed = null;
  if (raw && typeof raw === 'object') {
    embed = {
      title: raw.title ? defuse(raw.title).slice(0, 256) : undefined,
      titleUrl: httpsUrl(raw.url || raw.titleUrl),
      description: raw.description ? defuse(raw.description).slice(0, 4096) : undefined,
      color: colorOf(raw.color),
      author: raw.author?.name ? { name: String(raw.author.name).slice(0, 256), iconUrl: httpsUrl(raw.author.icon_url || raw.author.iconUrl), url: httpsUrl(raw.author.url) } : undefined,
      thumbnailUrl: httpsUrl(raw.thumbnail?.url || raw.thumbnailUrl),
      imageUrl: httpsUrl(raw.image?.url || raw.imageUrl),
      footer: raw.footer ? String(raw.footer.text ?? raw.footer).slice(0, 2048) : undefined,
      fields: Array.isArray(raw.fields) ? raw.fields.slice(0, 25).filter((f) => f && (f.name || f.value))
        .map((f) => ({ name: defuse(f.name || '').slice(0, 256), value: defuse(f.value || '').slice(0, 1024), inline: !!f.inline })) : undefined,
    };
    if (!embed.title && !embed.description && !embed.fields?.length && !embed.imageUrl && !embed.thumbnailUrl && !embed.author) embed = null;
  }
  if (!content && !embed) throw httpError(400, 'Mande "content" (texto) ou um embed.');
  return { content: content || null, embed };
}

function allow(id, now = Date.now()) {
  const list = (hits.get(id) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_MAX) { hits.set(id, list); return false; }
  list.push(now); hits.set(id, list);
  if (hits.size > 5000) hits.clear();
  return true;
}

function publicWebhook(w, baseUrl, token) {
  return {
    id: w.id, channelId: w.channelId, name: w.name, createdAt: w.createdAt, lastUsedAt: w.lastUsedAt, uses: w.uses,
    ...(token ? { url: `${baseUrl}/api/webhooks/${w.id}/${token}` } : {}),
  };
}

async function createWebhook({ channelId, name, actorId }, { db = getPrisma(), bcrypt = require('bcryptjs') } = {}) {
  const nm = cleanName(name);
  if (!nm) throw httpError(400, 'Dê um nome ao webhook (2 a 80 letras).');
  const ch = await db.channel.findUnique({ where: { id: channelId }, select: { id: true, type: true } });
  if (!ch || !['TEXT', 'ANNOUNCEMENT'].includes(ch.type)) throw httpError(400, 'Webhooks só funcionam em canais de texto.');
  if (await db.channelWebhook.count({ where: { channelId } }) >= MAX_PER_CHANNEL) throw httpError(400, `Limite de ${MAX_PER_CHANNEL} webhooks por canal.`);
  const token = crypto.randomBytes(32).toString('hex');
  const slug = crypto.randomBytes(5).toString('hex');
  const bot = await db.user.create({
    data: {
      email: `wh-${slug}${BOT_EMAIL_DOMAIN}`, username: `webhook_${slug}`, displayName: nm,
      passwordHash: await bcrypt.hash(crypto.randomBytes(48).toString('hex'), 10), emailVerified: true, status: 'OFFLINE',
      bio: 'Webhook (app) — posta mensagens enviadas por um serviço externo.',
    },
    select: { id: true },
  });
  const w = await db.channelWebhook.create({ data: { channelId, userId: bot.id, name: nm, tokenHash: sha256(token), createdById: actorId } });
  return { webhook: w, token };
}

async function rotateToken(id, { db = getPrisma() } = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const w = await db.channelWebhook.update({ where: { id }, data: { tokenHash: sha256(token) } }).catch(() => null);
  if (!w) throw httpError(404, 'Webhook não encontrado.');
  return { webhook: w, token };
}

async function deleteWebhook(id, { db = getPrisma() } = {}) {
  const w = await db.channelWebhook.findUnique({ where: { id } });
  if (!w) return false;
  await db.channelWebhook.delete({ where: { id } });
  // A conta do app fica (as mensagens antigas continuam com nome/foto), mas
  // sem webhook ninguém mais posta por ela.
  return true;
}

/** Recebe o POST externo. Devolve a mensagem criada. */
async function execute(id, token, body, { db = getPrisma(), post, now = Date.now() } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id)) || !/^[0-9a-f]{64}$/i.test(String(token))) throw httpError(401, 'Webhook inválido.');
  const w = await db.channelWebhook.findUnique({ where: { id } });
  if (!w || !safeEqualHex(sha256(token), w.tokenHash)) throw httpError(401, 'Webhook inválido.');
  if (!allow(w.id, now)) throw httpError(429, 'Muitas mensagens por este webhook. Espere um minuto.');
  const { content, embed } = parsePayload(body);
  const message = await post({ channelId: w.channelId, authorId: w.userId, content, embed });
  db.channelWebhook.update({ where: { id: w.id }, data: { lastUsedAt: new Date(now), uses: { increment: 1 } } }).catch(() => null);
  return message;
}

function _reset() { hits.clear(); }

module.exports = { createWebhook, rotateToken, deleteWebhook, execute, parsePayload, defuse, publicWebhook, sha256, BOT_EMAIL_DOMAIN, RATE_MAX, _reset };
