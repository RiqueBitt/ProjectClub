// Notificações por canal/categoria + silenciar + "Não perturbe" agendado.
//
// Ordem de prioridade (igual ao Discord):
//   canal  →  categoria  →  padrão global da pessoa (extraPrefs.notifyLevel)
// Silenciar vale tanto no canal quanto na categoria (qualquer um dos dois
// silenciado = canal silenciado). "Não perturbe" (extraPrefs.quietHours)
// corta push/desktop/som de TUDO dentro da janela de horário, no fuso da
// pessoa.
//
// A parte de cima do arquivo é pura (sem banco) e é testada em
// test/notification-prefs.test.js; a de baixo consulta o banco e é o que
// o messageController usa antes de mandar push/avisos. O cliente tem uma
// cópia da parte pura em client/src/utils/notificationPrefs.js.

const LEVELS = ['ALL', 'MENTIONS', 'NONE'];
const DEFAULT_LEVEL = 'MENTIONS';
// Durações aceitas pra "Silenciar" (minutos) — o resto é "até eu reativar".
const MUTE_DURATIONS_MIN = [15, 60, 480, 1440];

const channelKey = (id) => `ch:${id}`;
const categoryKey = (id) => `cat:${id}`;

// 'all' | 'mentions' | 'none' (como fica salvo no extraPrefs) → ALL | MENTIONS | NONE.
function normalizeLevel(v) {
  if (typeof v !== 'string') return null;
  const up = v.toUpperCase();
  return LEVELS.includes(up) ? up : null;
}

function toMs(now) {
  if (now instanceof Date) return now.getTime();
  return typeof now === 'number' ? now : Date.now();
}

// Silenciado agora? (mutedUntil no passado = já expirou, conta como não silenciado.)
function isOverrideMuted(o, now = Date.now()) {
  if (!o) return false;
  if (o.muteForever) return true;
  if (!o.mutedUntil) return false;
  const until = new Date(o.mutedUntil).getTime();
  return Number.isFinite(until) && until > toMs(now);
}

// Resolve o que vale pra um canal: nível efetivo + se está silenciado.
// mutedUntil = quando o silêncio acaba (null = pra sempre ou não silenciado).
function resolveChannelPrefs({ globalLevel, categoryOverride, channelOverride, now = Date.now() } = {}) {
  const chLevel = normalizeLevel(channelOverride?.level);
  const catLevel = normalizeLevel(categoryOverride?.level);
  const global = normalizeLevel(globalLevel) || DEFAULT_LEVEL;
  let level = global;
  let source = 'global';
  if (catLevel) { level = catLevel; source = 'category'; }
  if (chLevel) { level = chLevel; source = 'channel'; }

  const chMuted = isOverrideMuted(channelOverride, now);
  const catMuted = isOverrideMuted(categoryOverride, now);
  const muted = chMuted || catMuted;
  let mutedForever = false;
  let mutedUntil = null;
  if (muted) {
    // O silêncio só acaba quando os DOIS acabarem — vale o mais longo.
    const parts = [chMuted && channelOverride, catMuted && categoryOverride].filter(Boolean);
    mutedForever = parts.some((o) => o.muteForever);
    if (!mutedForever) {
      mutedUntil = new Date(Math.max(...parts.map((o) => new Date(o.mutedUntil).getTime())));
    }
  }
  return { level, source, muted, mutedForever, mutedUntil, mutedBy: chMuted ? 'channel' : (catMuted ? 'category' : null) };
}

// ---------- "Não perturbe" agendado ----------
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
function parseHHMM(s) {
  const m = typeof s === 'string' ? HHMM.exec(s) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
// Dia da semana (0 = domingo) e minuto do dia no fuso informado (UTC se inválido).
function localTimeParts(now, timeZone) {
  const date = new Date(toMs(now));
  const tz = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const hour = Number(get('hour')) % 24;
  return { weekday: WEEKDAYS[get('weekday')] ?? 0, minutes: hour * 60 + Number(get('minute')) };
}

// quietHours: { enabled, start: 'HH:MM', end: 'HH:MM', days: [0..6], timezone }
// `days` são os dias em que a janela COMEÇA — 23:00–07:00 marcado só na
// sexta vai de sexta 23h até sábado 7h. start === end = o dia inteiro.
function isQuietHoursActive(qh, now = Date.now()) {
  if (!qh || qh.enabled !== true) return false;
  const start = parseHHMM(qh.start);
  const end = parseHHMM(qh.end);
  if (start === null || end === null) return false;
  const days = Array.isArray(qh.days) ? qh.days : [];
  if (!days.length) return false;
  const { weekday, minutes } = localTimeParts(now, qh.timezone);
  const yesterday = (weekday + 6) % 7;
  if (start === end) return days.includes(weekday);
  if (start < end) return days.includes(weekday) && minutes >= start && minutes < end;
  // Atravessa a meia-noite: parte da noite (hoje) ou da madrugada (começou ontem).
  if (minutes >= start) return days.includes(weekday);
  if (minutes < end) return days.includes(yesterday);
  return false;
}

// Pode avisar (push/desktop/som)? kind:
//   'message' — mensagem comum num canal
//   'mention' — @menção direta, de cargo ou resposta a uma mensagem sua
//   'dm'      — mensagem direta (canal/categoria não se aplicam)
function shouldNotify({ kind, level = DEFAULT_LEVEL, muted = false, quiet = false } = {}) {
  if (quiet) return false;
  if (kind === 'dm') return true;
  if (muted) return false;
  const lv = normalizeLevel(level) || DEFAULT_LEVEL;
  if (lv === 'NONE') return false;
  if (kind === 'mention') return true;
  return kind === 'message' && lv === 'ALL';
}

// Valida o corpo do PUT de uma configuração. Devolve { data } com só os
// campos mandados, ou { error }.
function parseOverrideBody(body, now = Date.now()) {
  const data = {};
  if (!body || typeof body !== 'object') return { error: 'Corpo inválido.' };
  if ('level' in body) {
    if (body.level === null || body.level === 'DEFAULT') data.level = null;
    else {
      const lv = normalizeLevel(body.level);
      if (!lv) return { error: 'Nível de notificação inválido.' };
      data.level = lv;
    }
  }
  if ('mute' in body) {
    const m = body.mute;
    if (m === null || m === false) { data.mutedUntil = null; data.muteForever = false; }
    else if (m && m.forever === true) { data.mutedUntil = null; data.muteForever = true; }
    else if (m && MUTE_DURATIONS_MIN.includes(m.minutes)) {
      data.mutedUntil = new Date(toMs(now) + m.minutes * 60000);
      data.muteForever = false;
    } else return { error: 'Duração de silêncio inválida.' };
  }
  if (!Object.keys(data).length) return { error: 'Nada para alterar.' };
  return { data };
}

// Uma linha sem nível próprio e sem silêncio ativo não serve pra nada.
function isEmptyOverride(o, now = Date.now()) {
  return !normalizeLevel(o?.level) && !isOverrideMuted(o, now);
}

// ---------- Banco ----------
function db() {
  // eslint-disable-next-line global-require
  return require('../config/prisma');
}
function parseExtra(raw) {
  try { return raw ? JSON.parse(raw) || {} : {}; } catch { return {}; }
}

async function loadExtraPrefs(userIds) {
  if (!userIds.length) return {};
  const rows = await db().userSettings.findMany({
    where: { userId: { in: userIds } }, select: { userId: true, extraPrefs: true },
  }).catch(() => []);
  const out = {};
  for (const r of rows) out[r.userId] = parseExtra(r.extraPrefs);
  return out;
}

async function loadOverrides(userIds, keys) {
  if (!userIds.length || !keys.length) return [];
  return db().notificationOverride.findMany({
    where: { userId: { in: userIds }, targetKey: { in: keys } },
  }).catch(() => []);
}

// Estado de notificação de cada pessoa num canal: { [userId]: { level, muted, quiet } }.
async function channelStatesFor(userIds, channel, now = Date.now()) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return {};
  const chKey = channelKey(channel.id);
  const catKey = channel.categoryId ? categoryKey(channel.categoryId) : null;
  const [prefs, overrides] = await Promise.all([
    loadExtraPrefs(ids),
    loadOverrides(ids, [chKey, catKey].filter(Boolean)),
  ]);
  const out = {};
  for (const uid of ids) {
    const mine = overrides.filter((o) => o.userId === uid);
    const r = resolveChannelPrefs({
      globalLevel: prefs[uid]?.notifyLevel,
      channelOverride: mine.find((o) => o.targetKey === chKey),
      categoryOverride: catKey ? mine.find((o) => o.targetKey === catKey) : null,
      now,
    });
    out[uid] = { level: r.level, muted: r.muted, quiet: isQuietHoursActive(prefs[uid]?.quietHours, now) };
  }
  return out;
}

// Quem dessa lista pode receber push/aviso agora.
async function filterNotifiable(userIds, { channel = null, kind, now = Date.now() } = {}) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return [];
  if (!channel) {
    const prefs = await loadExtraPrefs(ids);
    return ids.filter((uid) => shouldNotify({ kind: 'dm', quiet: isQuietHoursActive(prefs[uid]?.quietHours, now) }));
  }
  const states = await channelStatesFor(ids, channel, now);
  return ids.filter((uid) => shouldNotify({ kind, ...states[uid] }));
}

// Quem quer ser avisado de TODA mensagem deste canal (nível "Todas as
// mensagens" no canal, na categoria ou como padrão global). Já filtra
// silêncio e "Não perturbe". Limitado a `cap` pessoas por mensagem.
async function allMessageRecipients(channel, { excludeIds = [], cap = 200, now = Date.now() } = {}) {
  const prisma = db();
  const chKey = channelKey(channel.id);
  const catKey = channel.categoryId ? categoryKey(channel.categoryId) : null;
  const keys = [chKey, catKey].filter(Boolean);
  const [explicit, globalRows] = await Promise.all([
    prisma.notificationOverride.findMany({
      where: { targetKey: { in: keys }, level: 'ALL' }, select: { userId: true }, take: cap * 2,
    }).catch(() => []),
    // Padrão global "Todas as mensagens" fica dentro do JSON de extraPrefs.
    prisma.userSettings.findMany({
      where: { extraPrefs: { contains: '"notifyLevel":"all"' } }, select: { userId: true }, take: cap * 2,
    }).catch(() => []),
  ]);
  const exclude = new Set(excludeIds);
  const candidates = [...new Set([...explicit, ...globalRows].map((r) => r.userId))].filter((id) => !exclude.has(id));
  if (!candidates.length) return [];
  const allowed = await filterNotifiable(candidates, { channel, kind: 'message', now });
  return allowed.slice(0, cap);
}

module.exports = {
  LEVELS,
  DEFAULT_LEVEL,
  MUTE_DURATIONS_MIN,
  channelKey,
  categoryKey,
  normalizeLevel,
  isOverrideMuted,
  resolveChannelPrefs,
  parseHHMM,
  isValidTimeZone,
  localTimeParts,
  isQuietHoursActive,
  shouldNotify,
  parseOverrideBody,
  isEmptyOverride,
  channelStatesFor,
  filterNotifiable,
  allMessageRecipients,
  loadExtraPrefs,
};
