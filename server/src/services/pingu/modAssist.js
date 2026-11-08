// Assistente de moderação do Pingu (só AVISA a equipe — NUNCA pune).
//
// 1) Filtro local barato em toda mensagem de canal: palavrões/ofensas (a
//    mesma lista do automod de DM + palavras extras do painel), convite de
//    outra plataforma, texto todo em maiúsculas, caracteres/palavras
//    repetidos, excesso de menções, flood e ameaças.
// 2) Só o que o filtro achou suspeito pode ir pra IA, com uma pergunta
//    curta de SIM/NÃO (fila de fundo; sem nome nem dado da pessoa, só o
//    texto). Mensagem limpa NUNCA chega na IA.
// 3) Confirmado (ou muito suspeito, ou suspeito com a IA fora do ar): cria
//    um alerta (PinguModAlert) que aparece no Painel → Moderação → Alertas
//    do Pingu e um aviso pra equipe com link pra mensagem.
const dmAutomod = require('../dmAutomod');
const { normalize, clip } = require('./text');

const SUSPICIOUS = 2; // vai pra IA (se ligada)
const STRONG = 3; // vira alerta mesmo sem IA
const VERY_STRONG = 4; // vira alerta direto, sem perguntar pra IA
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // um alerta por pessoa a cada 5 min
const AI_COOLDOWN_MS = 60 * 1000; // uma checagem de IA por pessoa por minuto
const FLOOD_WINDOW_MS = 10 * 1000;
const FLOOD_MAX = 6;
const REPEAT_WINDOW_MS = 60 * 1000;
const REPEAT_MAX = 3;
const THREAT_RE = /\b(vou te matar|te mato|vou matar voce|se mata|vai se matar|kys|kill yourself|vou te pegar|sei onde voce mora)\b/;

/**
 * Nota do filtro local pra um texto. ctx.recent: [{ at, text }] da mesma
 * pessoa no mesmo canal (já incluindo esta). Puro.
 * Devolve { score, reasons }.
 */
function heuristic(content, { recent = [], extraWords = [], now = Date.now() } = {}) {
  const text = String(content || '');
  const reasons = [];
  let score = 0;
  if (!text.trim()) return { score, reasons };
  const norm = normalize(text);

  const flag = dmAutomod.checkFlaggedWord(text);
  if (flag) { score += 2; reasons.push(`palavra ofensiva ("${flag.matchedWord}")`); }
  const extra = extraWords.find((w) => w && new RegExp(`(^|\\s)${normalize(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(norm));
  if (extra) { score += 2; reasons.push(`palavra da lista da equipe ("${extra}")`); }
  if (THREAT_RE.test(norm)) { score += 3; reasons.push('possível ameaça'); }
  if (dmAutomod.containsInviteLink(text)) { score += 1; reasons.push('convite de outra plataforma'); }

  const letters = text.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length >= 12 && letters.replace(/[^A-ZÀ-Þ]/g, '').length / letters.length >= 0.7) { score += 1; reasons.push('texto todo em maiúsculas'); }
  if (/(.)\1{9,}/u.test(text)) { score += 1; reasons.push('caracteres repetidos'); }
  const words = norm.split(' ').filter(Boolean);
  if (words.length >= 6) {
    const counts = new Map();
    words.forEach((w) => counts.set(w, (counts.get(w) || 0) + 1));
    const top = Math.max(...counts.values());
    if (top >= 6 && top / words.length >= 0.6) { score += 1; reasons.push('palavra repetida várias vezes'); }
  }
  if ((text.match(/@\w/g) || []).length >= 5) { score += 1; reasons.push('muitas menções'); }

  const inFlood = recent.filter((r) => now - r.at < FLOOD_WINDOW_MS).length;
  if (inFlood >= FLOOD_MAX) { score += 1; reasons.push('flood (muitas mensagens seguidas)'); }
  const same = recent.filter((r) => now - r.at < REPEAT_WINDOW_MS && r.text === norm).length;
  if (norm.length >= 3 && same >= REPEAT_MAX) { score += 1; reasons.push('mesma mensagem repetida'); }
  return { score, reasons };
}

/** "SIM"/"NAO" da IA → true/false (qualquer outra coisa = null). */
function parseVerdict(text) {
  const t = normalize(text).split(' ')[0];
  if (t === 'sim' || t === 'yes') return true;
  if (t === 'nao' || t === 'no') return false;
  return null;
}

const AI_SYSTEM = 'Você é um filtro de moderação de um chat brasileiro. Leia a mensagem e responda APENAS "SIM" se ela tiver ofensa grave, assédio, discurso de ódio, ameaça, conteúdo sexual explícito, golpe ou spam. Caso contrário responda APENAS "NAO". Palavrão leve entre amigos, brincadeira e reclamação normal são "NAO".';

/**
 * deps: { getConfig, extraWords(cfg), isOnline(), askModel(messages, opts),
 *         createAlert(data) → alerta, notifyStaff(io, alerta, ctx), now() }
 */
function createModAssist(deps) {
  const recentBy = new Map(); // `${channelId}:${userId}` -> [{ at, text }]
  const lastAlertAt = new Map();
  const lastAiAt = new Map();

  function remember(key, text, t) {
    const list = (recentBy.get(key) || []).filter((r) => t - r.at < REPEAT_WINDOW_MS);
    list.push({ at: t, text });
    recentBy.set(key, list.slice(-20));
    if (recentBy.size > 5000) {
      for (const [k, l] of recentBy) if (!l.length || t - l[l.length - 1].at > REPEAT_WINDOW_MS) recentBy.delete(k);
    }
    return list;
  }

  async function raise(io, ctx, h, aiVerdict) {
    const { message, channel } = ctx;
    const t = deps.now();
    if (t - (lastAlertAt.get(message.authorId) || 0) < ALERT_COOLDOWN_MS) return null;
    lastAlertAt.set(message.authorId, t);
    const alert = await deps.createAlert({
      messageId: message.id, channelId: message.channelId, authorId: message.authorId,
      reasons: JSON.stringify(h.reasons), snippet: clip(String(message.content || ''), 300),
      aiVerdict: aiVerdict === null || aiVerdict === undefined ? null : (aiVerdict ? 'SIM' : 'NAO'),
    });
    if (alert) await deps.notifyStaff(io, alert, { message, channel }).catch(() => {});
    return alert;
  }

  /**
   * Toda mensagem de canal passa aqui. Devolve Promise com
   * { score, aiChecked, alerted } (pros testes; quem chama não espera).
   */
  async function check(io, ctx) {
    const cfg = deps.getConfig();
    const { message } = ctx;
    const result = { score: 0, aiChecked: false, alerted: false };
    if (!cfg.modAssistEnabled || !message?.content || !message.channelId) return result;
    const t = deps.now();
    const recent = remember(`${message.channelId}:${message.authorId}`, normalize(message.content), t);
    const h = heuristic(message.content, { recent, extraWords: deps.extraWords(cfg), now: t });
    result.score = h.score;
    if (h.score < SUSPICIOUS) return result; // limpo: para aqui, sem IA

    let verdict = null;
    const canAsk = cfg.modAssistAi && h.score < VERY_STRONG && deps.isOnline()
      && t - (lastAiAt.get(message.authorId) || 0) >= AI_COOLDOWN_MS;
    if (canAsk) {
      lastAiAt.set(message.authorId, t);
      result.aiChecked = true;
      try {
        const res = await deps.askModel([
          { role: 'system', content: AI_SYSTEM },
          { role: 'user', content: `Mensagem: """${clip(String(message.content), 400)}"""` },
        ], { priority: 2, numPredict: 3, temperature: 0 });
        verdict = parseVerdict(res?.text);
      } catch { verdict = null; }
    }
    const shouldAlert = verdict === true || (verdict === null && h.score >= STRONG) || h.score >= VERY_STRONG;
    if (shouldAlert) result.alerted = !!(await raise(io, ctx, h, verdict));
    return result;
  }

  return {
    check,
    onMessage: (io, ctx) => { check(io, ctx).catch((err) => console.warn('[pingu] moderação:', err?.message || err)); },
  };
}

// ---------------- dependências reais ----------------

const db = () => require('../../config/prisma');
const bot = () => require('../pinguBot');

async function notifyStaff(io, alert, { message, channel }) {
  const { createNotice } = require('../notices');
  const { channelPath } = require('../linkResolver');
  const staff = await db().user.findMany({ where: { platformRole: { in: ['ADMIN', 'MODERATOR'] } }, select: { id: true }, take: 50 });
  const link = `${channelPath(channel)}?m=${encodeURIComponent(message.id)}`;
  const author = message.author?.displayName || message.author?.username || 'Alguém';
  await Promise.all(staff.map((s) => createNotice(io, s.id, {
    kind: 'pingu_mod',
    title: `Pingu: mensagem suspeita em #${clip(channel?.name || 'canal', 40)}`,
    body: `${author}: ${alert.snippet}`,
    link,
    data: { alertId: alert.id, messageId: message.id, channelId: message.channelId },
  })));
}

const engine = createModAssist({
  getConfig: () => require('./config').getConfig(),
  extraWords: (cfg) => require('./config').extraWords(cfg),
  isOnline: () => bot().isOnline(),
  askModel: (messages, opts) => bot().askModel(messages, opts),
  createAlert: (data) => db().pinguModAlert.create({ data }).catch((err) => { console.warn('[pingu] alerta:', err?.message || err); return null; }),
  notifyStaff,
  now: () => Date.now(),
});

// ---------------- painel ----------------

async function listAlerts({ status = 'PENDING', limit = 100 } = {}) {
  const where = status && status !== 'ALL' ? { status } : {};
  const rows = await db().pinguModAlert.findMany({ where, orderBy: { createdAt: 'desc' }, take: Math.min(200, limit) });
  const userIds = [...new Set(rows.flatMap((r) => [r.authorId, r.reviewedById].filter(Boolean)))];
  const channelIds = [...new Set(rows.map((r) => r.channelId))];
  const [users, channels] = await Promise.all([
    db().user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, displayName: true, avatarUrl: true } }),
    db().channel.findMany({ where: { id: { in: channelIds } }, select: { id: true, name: true, slug: true } }),
  ]);
  const u = new Map(users.map((x) => [x.id, x]));
  const c = new Map(channels.map((x) => [x.id, x]));
  const { channelPath } = require('../linkResolver');
  return rows.map((r) => {
    let reasons = [];
    try { reasons = JSON.parse(r.reasons || '[]'); } catch { reasons = []; }
    const ch = c.get(r.channelId) || null;
    return {
      ...r, reasons, author: u.get(r.authorId) || { id: r.authorId }, reviewedBy: r.reviewedById ? u.get(r.reviewedById) || null : null,
      channel: ch, link: ch ? `${channelPath(ch)}?m=${encodeURIComponent(r.messageId)}` : null,
    };
  });
}

async function updateAlert(id, status, reviewerId) {
  if (!['RESOLVED', 'DISMISSED', 'PENDING'].includes(status)) throw Object.assign(new Error('Situação inválida.'), { status: 400 });
  const exists = await db().pinguModAlert.findUnique({ where: { id } });
  if (!exists) throw Object.assign(new Error('Alerta não encontrado.'), { status: 404 });
  return db().pinguModAlert.update({
    where: { id },
    data: { status, reviewedById: status === 'PENDING' ? null : reviewerId, reviewedAt: status === 'PENDING' ? null : new Date() },
  });
}

const pendingCount = () => db().pinguModAlert.count({ where: { status: 'PENDING' } }).catch(() => 0);

module.exports = {
  onMessage: engine.onMessage, listAlerts, updateAlert, pendingCount,
  createModAssist, heuristic, parseVerdict, SUSPICIOUS, STRONG, VERY_STRONG,
};
