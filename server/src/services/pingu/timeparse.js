// Expressões de tempo em português pro "@pingu me lembra …" (puro, sem banco).
//
// Entende, em qualquer lugar da frase:
//   relativo   "em 20 min", "daqui a 2 horas", "em meia hora", "em uma hora e meia",
//              "daqui 3 dias", "em 1 semana", "dentro de 10 minutos"
//   dia        "hoje às 18h", "amanhã às 9h", "amanhã de manhã", "depois de amanhã 14:30",
//              "amanhã à noite", "hoje à tarde"
//   semana     "sexta às 10h", "na segunda-feira", "próximo sábado 15h"
//   data       "dia 15 às 14h", "15/10 14:00", "15/10/2026"
//   hora       "às 15h", "às 18:30", "ao meio-dia", "à meia-noite"
// Hora local = Brasília (UTC−3, sem horário de verão desde 2019) por padrão.
// Devolve { dueAt: Date, start, end, rest } (rest = a frase sem a expressão)
// ou null.

const NUM_WORDS = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18,
  dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, noventa: 90,
};
const WEEKDAYS = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };
const PERIOD_HOUR = { manha: 9, tarde: 15, noite: 20, madrugada: 3 };

/** minúsculas e sem acento, MANTENDO o tamanho (índices batem com o original). */
function fold(text) {
  return Array.from(String(text || '')).map((ch) => {
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return (base.length === 1 ? base : ch).toLowerCase();
  }).join('');
}

const NUM = `(\\d+|${Object.keys(NUM_WORDS).sort((a, b) => b.length - a.length).join('|')}|meia)`;
const UNIT = '(segundos?|seg|s|minutos?|mins?|m|horas?|hrs?|h|dias?|d|semanas?|sem|meses|mes)';
const TIME = '(?:(meio[\\s-]dia|meia[\\s-]noite)|(\\d{1,2})(?:(?::|h)(\\d{2}))?\\s*(?:h(?:oras?|rs?)?\\b|(?=\\s|$|[,.!?])))';
const PERIOD = '(?:\\s+(?:de|da|a|à)\\s+(manha|tarde|noite|madrugada))?';

function num(word) {
  if (!word) return null;
  if (/^\d+$/.test(word)) return Number(word);
  if (word === 'meia') return 0.5;
  return NUM_WORDS[word] ?? null;
}

function unitMs(u) {
  if (/^s(eg|egundos?)?$/.test(u)) return 1000;
  if (/^m(in|ins|inutos?)?$/.test(u)) return 60_000;
  if (/^h(rs?|oras?)?$/.test(u)) return 3_600_000;
  if (/^d(ias?)?$/.test(u)) return 86_400_000;
  if (/^sem(anas?)?$/.test(u)) return 7 * 86_400_000;
  if (/^mes(es)?$/.test(u)) return 30 * 86_400_000;
  return 0;
}

/** Hora e minuto de um pedaço TIME casado (grupos: especial, h, min) + período. */
function clock(special, h, mi, period) {
  if (special) return /meio/.test(special) ? { h: 12, mi: 0 } : { h: 0, mi: 0 };
  let hour = Number(h);
  const minute = Number(mi || 0);
  if (period && (period === 'tarde' || period === 'noite') && hour < 12) hour += 12;
  if (hour > 23 || minute > 59) return null;
  return { h: hour, mi: minute };
}

function makeCalendar(now, tzOffsetMin) {
  const local = new Date(now + tzOffsetMin * 60000);
  const at = (addDays, h, mi, base = local) => new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + addDays, h, mi) - tzOffsetMin * 60000);
  return { local, at };
}

/**
 * Acha a PRIMEIRA expressão de tempo no texto. now em ms; tzOffsetMin =
 * minutos a somar ao UTC pra dar a hora local (Brasília = −180).
 */
function parseTimeExpression(text, now = Date.now(), tzOffsetMin = -180) {
  const src = String(text || '');
  const f = fold(src);
  const { local, at } = makeCalendar(now, tzOffsetMin);
  const candidates = [];
  const push = (m, dueAt) => { if (m && dueAt && dueAt.getTime() > now) candidates.push({ start: m.index, end: m.index + m[0].length, dueAt }); };

  // 1) relativo
  const relRe = new RegExp(`(?:^|\\b)(?:em|daqui(?:\\s+a)?|dentro\\s+de)\\s+${NUM}\\s*${UNIT}\\b(?:\\s+e\\s+(?:${NUM}\\s*${UNIT}\\b|(meia)))?`, 'g');
  for (const m of f.matchAll(relRe)) {
    const n1 = num(m[1]);
    let ms = n1 !== null ? n1 * unitMs(m[2]) : 0;
    if (m[3] && m[4]) ms += num(m[3]) * unitMs(m[4]);
    else if (m[5] === 'meia') ms += unitMs(m[2]) / 2; // "uma hora e meia"
    if (ms > 0) push(m, new Date(now + ms));
  }

  // 2) hoje / amanhã / depois de amanhã [às HH[:MM]] [de manhã/tarde/noite]
  const dayRe = new RegExp(`\\b(depois\\s+de\\s+amanha|amanha|hoje)(?:\\s+(?:a|as|ao|por\\s+volta\\s+das?)?\\s*${TIME})?${PERIOD}(?:\\s+(?:a|as)\\s+${TIME})?`, 'g');
  for (const m of f.matchAll(dayRe)) {
    const add = m[1] === 'hoje' ? 0 : m[1].startsWith('depois') ? 2 : 1;
    const period = m[5];
    let c = null;
    if (m[2] || m[3]) c = clock(m[2], m[3], m[4], period);
    else if (m[6] || m[7]) c = clock(m[6], m[7], m[8], period);
    else c = { h: period ? PERIOD_HOUR[period] : 9, mi: 0 };
    if (c) push(m, at(add, c.h, c.mi));
  }

  // 3) dia da semana
  const wdRe = new RegExp(`\\b(?:(?:na|no|nesta|neste|nessa|nesse|proxima|proximo|esta|este)\\s+)?(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:[\\s-]feira)?(?:\\s+(?:a|as|ao)?\\s*${TIME})?${PERIOD}`, 'g');
  for (const m of f.matchAll(wdRe)) {
    const target = WEEKDAYS[m[1]];
    let add = (target - local.getUTCDay() + 7) % 7;
    const c = (m[2] || m[3]) ? clock(m[2], m[3], m[4], m[5]) : { h: m[5] ? PERIOD_HOUR[m[5]] : 9, mi: 0 };
    if (!c) continue;
    if (add === 0 && at(0, c.h, c.mi).getTime() <= now) add = 7;
    push(m, at(add, c.h, c.mi));
  }

  // 4) data "15/10[/2026]" ou "dia 15"
  const dateRe = new RegExp(`\\b(?:dia\\s+(\\d{1,2})(?!\\s*[/:h\\d])|(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2,4}))?)(?:\\s+(?:a|as|ao)?\\s*${TIME})?${PERIOD}`, 'g');
  for (const m of f.matchAll(dateRe)) {
    const c = (m[5] || m[6]) ? clock(m[5], m[6], m[7], m[8]) : { h: m[8] ? PERIOD_HOUR[m[8]] : 9, mi: 0 };
    if (!c) continue;
    const y = local.getUTCFullYear();
    if (m[1]) {
      const d = Number(m[1]);
      if (d < 1 || d > 31) continue;
      let due = new Date(Date.UTC(y, local.getUTCMonth(), d, c.h, c.mi) - tzOffsetMin * 60000);
      if (due.getTime() <= now) due = new Date(Date.UTC(y, local.getUTCMonth() + 1, d, c.h, c.mi) - tzOffsetMin * 60000);
      push(m, due);
    } else {
      const d = Number(m[2]);
      const mo = Number(m[3]) - 1;
      let yy = m[4] ? Number(m[4]) : y;
      if (yy < 100) yy += 2000;
      if (d < 1 || d > 31 || mo < 0 || mo > 11) continue;
      let due = new Date(Date.UTC(yy, mo, d, c.h, c.mi) - tzOffsetMin * 60000);
      if (!m[4] && due.getTime() <= now) due = new Date(Date.UTC(yy + 1, mo, d, c.h, c.mi) - tzOffsetMin * 60000);
      push(m, due);
    }
  }

  // 5) só a hora: "às 15h", "às 18:30", "ao meio-dia" (hoje, ou amanhã se já passou)
  const hourRe = new RegExp(`\\b(?:a|as|ao)\\s+${TIME}${PERIOD}`, 'g');
  for (const m of f.matchAll(hourRe)) {
    const c = clock(m[1], m[2], m[3], m[4]);
    if (!c) continue;
    let due = at(0, c.h, c.mi);
    if (due.getTime() <= now) due = at(1, c.h, c.mi);
    push(m, due);
  }

  if (!candidates.length) return null;
  // A expressão mais longa ganha (ex.: "amanhã às 9h" em vez de só "às 9h");
  // empate: a que vem primeiro.
  candidates.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const best = candidates[0];
  const rest = `${src.slice(0, best.start)} ${src.slice(best.end)}`.replace(/\s+/g, ' ').trim();
  return { dueAt: best.dueAt, start: best.start, end: best.end, rest };
}

const LEMBRA_RE = /^(?:(?:por\s+favor|pfv|pf)[,\s]+)?(?:me\s+)?(?:lembrete|lembre-me|lembra-me|lembr[ae]r?)\b(?:\s+(?:de|que|pra|para))?[\s:,-]*/i;

/**
 * "me lembra em 20 min de tirar o bolo" → { dueAt, text: 'tirar o bolo' }.
 * null = não é pedido de lembrete; { error } = é, mas sem horário entendido.
 */
function parseReminderRequest(question, now = Date.now(), tzOffsetMin = -180) {
  const q = String(question || '').trim();
  const head = fold(q).match(LEMBRA_RE);
  if (!head) return null;
  const body = q.slice(head[0].length);
  const parsed = parseTimeExpression(body, now, tzOffsetMin);
  if (!parsed) return { error: 'Não entendi quando. Tenta assim: "@pingu me lembra em 20 min de tirar o bolo" ou "@pingu me lembra amanhã às 9h de pagar a conta". 🐧' };
  let text = parsed.rest
    .replace(/^(?:de|que|pra|para|sobre|do|da)\s+/i, '')
    .replace(/\s+(?:de|que|pra|para)$/i, '')
    .replace(/^[\s:,.-]+|[\s:,.-]+$/g, '')
    .trim();
  if (!text) text = 'Lembrete do Pingu';
  return { dueAt: parsed.dueAt, text: text.slice(0, 500) };
}

/** "02/11 às 09:00" no fuso da pessoa. */
function formatWhen(date, tzOffsetMin = -180) {
  const l = new Date(date.getTime() + tzOffsetMin * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(l.getUTCDate())}/${p(l.getUTCMonth() + 1)} às ${p(l.getUTCHours())}:${p(l.getUTCMinutes())}`;
}

/** "daqui a 20 min", "daqui a 3 h e 5 min", "daqui a 2 dias". */
function formatIn(ms) {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `daqui a ${min} min`;
  const h = Math.floor(min / 60);
  const rm = min % 60;
  if (h < 48) return `daqui a ${h} h${rm ? ` e ${rm} min` : ''}`;
  return `daqui a ${Math.round(h / 24)} dias`;
}

module.exports = { parseTimeExpression, parseReminderRequest, formatWhen, formatIn, fold };
