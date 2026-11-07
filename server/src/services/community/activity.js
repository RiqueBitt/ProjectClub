// Contadores de atividade da Fase 4 — alimentam a competição semanal dos
// Clubes, as metas coletivas da semana e a retrospectiva do mês.
//
// Leve de propósito: cada mensagem/minuto em call/post só soma num mapa em
// memória (record) e, uma vez por minuto, o lote vira poucas gravações no
// banco (flush). Nada disso atrasa ou derruba o envio de uma mensagem.
//
// Pontos do Clube por membro: mensagem = 1, minuto em call = 1, post no
// Fórum = 10, com teto semanal por pessoa (anti-farm).
const { safeUpsert } = require('../../utils/prismaSafe');
const { weekBounds, monthBounds } = require('../../utils/spTime');
const { deps } = require('./common');

const POINTS = { messages: 1, voiceMinutes: 1, forumPosts: 10 };
const CLAN_POINTS_WEEKLY_CAP_PER_MEMBER = 600;
const FLUSH_MS = 60 * 1000;
const MAX_BUFFERED_USERS = 20000; // proteção de memória: além disso, descarrega antes

// Tipo vindo de missions.track → campo do contador.
const FIELD_BY_TYPE = {
  MESSAGES: 'messages',
  VOICE_MINUTES: 'voiceMinutes',
  FORUM_POSTS: 'forumPosts',
  REACTIONS: 'reactions',
  XP: 'xp',
};
const FIELDS = ['messages', 'voiceMinutes', 'forumPosts', 'reactions', 'xp'];

const buffer = new Map(); // `${userId}|${week}|${month}` -> { userId, week, month, ...contagens }
const listeners = { communityWeek: [] };

function pointsOf(c) {
  return (c.messages || 0) * POINTS.messages + (c.voiceMinutes || 0) * POINTS.voiceMinutes + (c.forumPosts || 0) * POINTS.forumPosts;
}

/** Soma atividade no lote em memória. Nunca lança erro. */
function record(userId, type, amount = 1, now = Date.now()) {
  const field = FIELD_BY_TYPE[type];
  const n = Math.trunc(Number(amount) || 0);
  if (!userId || !field || n <= 0) return false;
  const week = weekBounds(now).key;
  const month = monthBounds(now).key;
  const key = `${userId}|${week}|${month}`;
  let row = buffer.get(key);
  if (!row) {
    if (buffer.size >= MAX_BUFFERED_USERS) setImmediate(() => flush().catch(() => {}));
    row = { userId, week, month, messages: 0, voiceMinutes: 0, forumPosts: 0, reactions: 0, xp: 0 };
    buffer.set(key, row);
  }
  row[field] += n;
  return true;
}

function incData(c, extra = {}) {
  const data = {};
  for (const f of FIELDS) if (c[f]) data[f] = { increment: c[f] };
  for (const [k, v] of Object.entries(extra)) if (v) data[k] = { increment: v };
  return data;
}

async function bump(db, scope, scopeId, periodKey, counts, points = 0) {
  const update = incData(counts, { points });
  if (Object.keys(update).length === 0) return null;
  const create = { scope, scopeId: String(scopeId), periodKey };
  for (const f of FIELDS) create[f] = counts[f] || 0;
  create.points = points;
  return safeUpsert(db.activityCounter, {
    where: { scope_scopeId_periodKey: { scope, scopeId: String(scopeId), periodKey } },
    create, update,
  });
}

/**
 * Grava o lote no banco. Devolve um resumo (usado nos testes).
 * Pontos de Clube respeitam o teto semanal por membro: o contador semanal da
 * pessoa (USER_WEEK) diz quanto ela já somou antes deste lote.
 */
async function flush(over = {}) {
  if (buffer.size === 0) return { users: 0 };
  const d = deps(over);
  const entries = [...buffer.values()];
  buffer.clear();
  const userIds = [...new Set(entries.map((e) => e.userId))];
  let clanOf = new Map();
  try {
    const users = await d.db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, clanId: true } });
    clanOf = new Map(users.map((u) => [u.id, u.clanId]));
  } catch { /* sem Clube conhecido: só os contadores pessoais */ }

  const communityByWeek = new Map();
  const clanTotals = new Map(); // `${clanId}|${week}` -> { clanId, week, counts, points }
  for (const e of entries) {
    const pts = pointsOf(e);
    try {
      const weekRow = await bump(d.db, 'USER_WEEK', e.userId, e.week, e, pts);
      await bump(d.db, 'USER_MONTH', e.userId, e.month, e, pts);
      const before = Math.max(0, (weekRow?.points ?? pts) - pts);
      const allowed = Math.max(0, Math.min(pts, CLAN_POINTS_WEEKLY_CAP_PER_MEMBER - before));
      const clanId = clanOf.get(e.userId);
      if (clanId) {
        const k = `${clanId}|${e.week}`;
        const t = clanTotals.get(k) || { clanId, week: e.week, counts: { messages: 0, voiceMinutes: 0, forumPosts: 0, reactions: 0, xp: 0 }, points: 0 };
        for (const f of ['messages', 'voiceMinutes', 'forumPosts']) t.counts[f] += e[f] || 0;
        t.points += allowed;
        clanTotals.set(k, t);
      }
      const c = communityByWeek.get(e.week) || { messages: 0, voiceMinutes: 0, forumPosts: 0, reactions: 0, xp: 0, points: 0 };
      for (const f of FIELDS) c[f] += e[f] || 0;
      c.points += pts;
      communityByWeek.set(e.week, c);
    } catch (err) {
      console.error('[atividade] falha ao gravar contadores:', err?.message || err);
    }
  }
  for (const t of clanTotals.values()) {
    try { await bump(d.db, 'CLAN_WEEK', t.clanId, t.week, t.counts, t.points); } catch (err) { console.error('[atividade] clube:', err?.message || err); }
  }
  for (const [week, c] of communityByWeek) {
    try {
      const row = await bump(d.db, 'COMMUNITY_WEEK', 'all', week, c, c.points);
      for (const fn of listeners.communityWeek) {
        try { await fn(row, { ...over, db: d.db }); } catch (err) { console.error('[atividade] ouvinte:', err?.message || err); }
      }
    } catch (err) { console.error('[atividade] comunidade:', err?.message || err); }
  }
  return { users: userIds.length, clans: clanTotals.size };
}

/** Avisado depois de cada gravação do total semanal da comunidade (metas coletivas). */
function onCommunityWeek(fn) { listeners.communityWeek.push(fn); }

let timer = null;
function startActivityFlush(io) {
  if (timer) return;
  timer = setInterval(() => { flush({ io }).catch((err) => console.error('[atividade]', err?.message || err)); }, FLUSH_MS);
  timer.unref?.();
}

function _peek() { return [...buffer.values()]; }
function _reset() { buffer.clear(); listeners.communityWeek.length = 0; }

module.exports = {
  record, flush, onCommunityWeek, startActivityFlush, pointsOf,
  POINTS, CLAN_POINTS_WEEKLY_CAP_PER_MEMBER, FIELD_BY_TYPE,
  _peek, _reset,
};
