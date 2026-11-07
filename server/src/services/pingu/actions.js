// Ações do Pingu que usam sistemas que já existem no site:
// - "@pingu me lembra …" → lembrete de verdade (services/reminders.js →
//   aviso nas Notificações na hora marcada);
// - "@pingu enquete …" → enquete de verdade (mesmo formato do
//   pollController: mensagem + Poll), postada pelo Pingu.
// Banco e serviços só são carregados quando usados (testes injetam deps).
const { parseReminderRequest, formatWhen, formatIn } = require('./timeparse');
const { parsePoll } = require('./intents');

const db = () => require('../../config/prisma');

/**
 * Lembrete pelo Pingu. Devolve { ok, text } (texto pra responder).
 * deps (opcional, testes): { now, validate, countActive, create }
 */
async function createReminder({ userId, question, link = null, messageId = null }, deps = {}) {
  const now = deps.now ? deps.now() : Date.now();
  const parsed = parseReminderRequest(question, now);
  if (!parsed) return { ok: false, text: 'Não entendi o lembrete. Ex.: "@pingu me lembra em 20 min de tirar o bolo". 🐧' };
  if (parsed.error) return { ok: false, text: parsed.error };
  const reminders = deps.validate ? null : require('../reminders');
  const validate = deps.validate || reminders.validateReminder;
  const v = validate({ text: parsed.text, dueAt: parsed.dueAt, link, messageId }, now);
  if (v.error) return { ok: false, text: `${v.error} 🐧` };
  const max = reminders?.MAX_ACTIVE_PER_USER ?? 50;
  const countActive = deps.countActive || ((uid) => db().reminder.count({ where: { userId: uid, firedAt: null } }));
  if (await countActive(userId) >= max) return { ok: false, text: `Você já tem ${max} lembretes ativos. Apague algum em Notificações → Lembretes. 🐧` };
  const create = deps.create || ((data) => db().reminder.create({ data }));
  await create({ userId, text: v.text, dueAt: v.dueAt, link: v.link, messageId: v.messageId });
  return { ok: true, dueAt: v.dueAt, text: `⏰ Combinado! Vou te lembrar de “${v.text}” em ${formatWhen(v.dueAt)} (${formatIn(v.dueAt.getTime() - now)}). O aviso chega nas suas notificações.` };
}

/**
 * Enquete pedida ao Pingu num canal. Confere CREATE_POLLS de quem pediu.
 * ctx: { io, userId, authorName, channel, sourceMessage, body, pinguId, threadRoot }
 * Devolve { ok, text?, message? }.
 */
async function createPoll(ctx) {
  const parsed = parsePoll(ctx.body);
  if (parsed.error) return { ok: false, text: parsed.error };
  const { getEffectivePermissions } = require('../authz');
  const { has } = require('../permissions');
  const perms = await getEffectivePermissions(ctx.userId, ctx.channel.id, ctx.channel);
  if (!has(perms, 'CREATE_POLLS')) return { ok: false, text: 'Você não tem permissão pra criar enquetes neste canal. 🐧' };
  const { DURATION_HOURS } = require('../../controllers/pollController');
  const hours = DURATION_HOURS[parsed.duration] || 24;
  const { messageInclude, roomFor } = require('../../controllers/messageController');
  const message = await db().message.create({
    data: {
      title: parsed.question,
      content: `📊 Enquete criada a pedido de ${String(ctx.authorName || 'alguém').slice(0, 40)}.`,
      authorId: ctx.pinguId,
      channelId: ctx.channel.id,
      replyToId: ctx.sourceMessage?.id || null,
      threadId: ctx.sourceMessage?.threadId || null,
      quickReactions: '[]',
      poll: { create: { question: parsed.question, options: JSON.stringify(parsed.options), expiresAt: new Date(Date.now() + hours * 3600000) } },
    },
    include: messageInclude,
  });
  ctx.io?.to(roomFor({ channelId: ctx.channel.id })).emit('message:new', message);
  if (ctx.threadRoot) require('../threads').afterThreadReply(ctx.io, { root: ctx.threadRoot, message, channel: ctx.channel }).catch(() => {});
  return { ok: true, message };
}

module.exports = { createReminder, createPoll };
