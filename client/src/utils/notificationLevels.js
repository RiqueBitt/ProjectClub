// Regras puras de notificação por canal/categoria (sem store, sem rede).
// Cópia da parte pura de server/src/services/notificationPrefs.js — o
// servidor decide o push, o cliente decide som/notificação de desktop e
// como o canal aparece na lista. Mantenha os dois iguais.
//
// Prioridade: canal → categoria → padrão global (extraPrefs.notifyLevel).

export const LEVELS = ['ALL', 'MENTIONS', 'NONE'];
export const DEFAULT_LEVEL = 'MENTIONS';
export const LEVEL_LABELS = { ALL: 'Todas as mensagens', MENTIONS: 'Só @menções', NONE: 'Nada' };
export const MUTE_OPTIONS = [
  { minutes: 15, label: 'Por 15 minutos' },
  { minutes: 60, label: 'Por 1 hora' },
  { minutes: 480, label: 'Por 8 horas' },
  { minutes: 1440, label: 'Por 24 horas' },
  { forever: true, label: 'Até eu reativar' },
];

export const channelKey = (id) => `ch:${id}`;
export const categoryKey = (id) => `cat:${id}`;

export function normalizeLevel(v) {
  if (typeof v !== 'string') return null;
  const up = v.toUpperCase();
  return LEVELS.includes(up) ? up : null;
}

export function isOverrideMuted(o, now = Date.now()) {
  if (!o) return false;
  if (o.muteForever) return true;
  if (!o.mutedUntil) return false;
  const until = new Date(o.mutedUntil).getTime();
  return Number.isFinite(until) && until > now;
}

export function resolveChannelPrefs({ globalLevel, categoryOverride, channelOverride, now = Date.now() } = {}) {
  const chLevel = normalizeLevel(channelOverride?.level);
  const catLevel = normalizeLevel(categoryOverride?.level);
  let level = normalizeLevel(globalLevel) || DEFAULT_LEVEL;
  let source = 'global';
  if (catLevel) { level = catLevel; source = 'category'; }
  if (chLevel) { level = chLevel; source = 'channel'; }
  const chMuted = isOverrideMuted(channelOverride, now);
  const catMuted = isOverrideMuted(categoryOverride, now);
  const muted = chMuted || catMuted;
  let mutedForever = false;
  let mutedUntil = null;
  if (muted) {
    const parts = [chMuted && channelOverride, catMuted && categoryOverride].filter(Boolean);
    mutedForever = parts.some((o) => o.muteForever);
    if (!mutedForever) mutedUntil = new Date(Math.max(...parts.map((o) => new Date(o.mutedUntil).getTime())));
  }
  return { level, source, muted, mutedForever, mutedUntil, mutedBy: chMuted ? 'channel' : (catMuted ? 'category' : null) };
}

// ---------- "Não perturbe" agendado ----------
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export function parseHHMM(s) {
  const m = typeof s === 'string' ? HHMM.exec(s) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

export function browserTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export function localTimeParts(now, timeZone) {
  const tz = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(now));
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { weekday: WEEKDAYS[get('weekday')] ?? 0, minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
}

// `days` = dias em que a janela começa; start === end = dia inteiro.
export function isQuietHoursActive(qh, now = Date.now()) {
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
  if (minutes >= start) return days.includes(weekday);
  if (minutes < end) return days.includes(yesterday);
  return false;
}

// kind: 'message' | 'mention' | 'dm'
export function shouldNotify({ kind, level = DEFAULT_LEVEL, muted = false, quiet = false } = {}) {
  if (quiet) return false;
  if (kind === 'dm') return true;
  if (muted) return false;
  const lv = normalizeLevel(level) || DEFAULT_LEVEL;
  if (lv === 'NONE') return false;
  if (kind === 'mention') return true;
  return kind === 'message' && lv === 'ALL';
}

// "faltam 42 min" / "até 14:30" / "até sex., 09:00".
export function muteRemainingLabel(mutedUntil, { forever = false, now = Date.now() } = {}) {
  if (forever) return 'Até você reativar';
  if (!mutedUntil) return '';
  const until = new Date(mutedUntil);
  const mins = Math.max(1, Math.ceil((until.getTime() - now) / 60000));
  if (mins < 60) return `Faltam ${mins} min`;
  const sameDay = new Date(now).toDateString() === until.toDateString();
  const time = until.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `Até ${time}` : `Até ${until.toLocaleDateString('pt-BR', { weekday: 'short' })} ${time}`;
}
