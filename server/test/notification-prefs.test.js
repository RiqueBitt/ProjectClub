// Notificações por canal/categoria: nível efetivo (canal → categoria →
// global), silenciar com tempo, "Não perturbe" agendado com fuso horário e
// a filtragem de destinatários (banco substituído por um fake).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// ---- fake do prisma (só o que notificationPrefs usa) ----
const db = { settings: [], overrides: [] };
const fakePrisma = {
  userSettings: {
    findMany: async ({ where }) => {
      if (where.userId) return db.settings.filter((s) => where.userId.in.includes(s.userId));
      if (where.extraPrefs?.contains) return db.settings.filter((s) => (s.extraPrefs || '').includes(where.extraPrefs.contains));
      return [];
    },
  },
  notificationOverride: {
    findMany: async ({ where }) => db.overrides.filter((o) => (
      (!where.userId || where.userId.in.includes(o.userId))
      && (!where.targetKey || where.targetKey.in.includes(o.targetKey))
      && (!where.level || o.level === where.level)
    )),
  },
};
require.cache[path.resolve(__dirname, '../src/config/prisma.js')] = { exports: fakePrisma, loaded: true, id: 'prisma' };

const np = require('../src/services/notificationPrefs');

const NOW = Date.parse('2026-10-16T12:00:00Z'); // sexta-feira, 12:00 UTC (09:00 em São Paulo)
const minutes = (n) => new Date(NOW + n * 60000);

test('nível: canal sobrescreve categoria, que sobrescreve o global', () => {
  assert.equal(np.resolveChannelPrefs({ now: NOW }).level, 'MENTIONS', 'padrão sem nada configurado');
  assert.equal(np.resolveChannelPrefs({ globalLevel: 'all', now: NOW }).level, 'ALL');
  const cat = { level: 'NONE' };
  assert.deepEqual(
    [np.resolveChannelPrefs({ globalLevel: 'all', categoryOverride: cat, now: NOW }).level, np.resolveChannelPrefs({ globalLevel: 'all', categoryOverride: cat, now: NOW }).source],
    ['NONE', 'category'],
  );
  const r = np.resolveChannelPrefs({ globalLevel: 'none', categoryOverride: cat, channelOverride: { level: 'ALL' }, now: NOW });
  assert.equal(r.level, 'ALL');
  assert.equal(r.source, 'channel');
  // Canal com nível null herda da categoria.
  assert.equal(np.resolveChannelPrefs({ categoryOverride: { level: 'ALL' }, channelOverride: { level: null }, now: NOW }).level, 'ALL');
  // Valor inválido é ignorado.
  assert.equal(np.resolveChannelPrefs({ globalLevel: 'tudo', channelOverride: { level: 'XPTO' }, now: NOW }).level, 'MENTIONS');
});

test('silenciar: com tempo expira sozinho; "até reativar" não', () => {
  assert.equal(np.isOverrideMuted({ mutedUntil: minutes(15) }, NOW), true);
  assert.equal(np.isOverrideMuted({ mutedUntil: minutes(-1) }, NOW), false, 'já expirou');
  assert.equal(np.isOverrideMuted({ muteForever: true }, NOW), true);
  assert.equal(np.isOverrideMuted(null, NOW), false);

  const chMuted = np.resolveChannelPrefs({ channelOverride: { mutedUntil: minutes(60) }, now: NOW });
  assert.equal(chMuted.muted, true);
  assert.equal(chMuted.mutedBy, 'channel');
  assert.equal(chMuted.mutedUntil.getTime(), minutes(60).getTime());

  // Categoria silenciada silencia os canais dela.
  const viaCat = np.resolveChannelPrefs({ categoryOverride: { muteForever: true }, channelOverride: { level: 'ALL' }, now: NOW });
  assert.equal(viaCat.muted, true);
  assert.equal(viaCat.mutedForever, true);
  assert.equal(viaCat.mutedBy, 'category');

  // Os dois silenciados: vale o que dura mais.
  const both = np.resolveChannelPrefs({ categoryOverride: { mutedUntil: minutes(480) }, channelOverride: { mutedUntil: minutes(15) }, now: NOW });
  assert.equal(both.mutedUntil.getTime(), minutes(480).getTime());
});

test('shouldNotify combina nível, silêncio e "Não perturbe"', () => {
  assert.equal(np.shouldNotify({ kind: 'message', level: 'ALL' }), true);
  assert.equal(np.shouldNotify({ kind: 'message', level: 'MENTIONS' }), false);
  assert.equal(np.shouldNotify({ kind: 'mention', level: 'MENTIONS' }), true);
  assert.equal(np.shouldNotify({ kind: 'mention', level: 'NONE' }), false);
  assert.equal(np.shouldNotify({ kind: 'mention', level: 'ALL', muted: true }), false);
  assert.equal(np.shouldNotify({ kind: 'mention', level: 'ALL', quiet: true }), false);
  assert.equal(np.shouldNotify({ kind: 'dm', muted: true }), true, 'silenciar canal não afeta DM');
  assert.equal(np.shouldNotify({ kind: 'dm', quiet: true }), false, '"Não perturbe" vale pra DM também');
});

test('"Não perturbe": janela que atravessa a meia-noite, no fuso da pessoa', () => {
  const qh = { enabled: true, start: '23:00', end: '07:00', days: [5], timezone: 'America/Sao_Paulo' }; // só sexta
  // Sexta 23:30 em SP = sábado 02:30 UTC.
  assert.equal(np.isQuietHoursActive(qh, Date.parse('2026-10-17T02:30:00Z')), true);
  // Sábado 06:59 em SP (janela começou na sexta) = sábado 09:59 UTC.
  assert.equal(np.isQuietHoursActive(qh, Date.parse('2026-10-17T09:59:00Z')), true);
  // Sábado 07:00 em SP: acabou.
  assert.equal(np.isQuietHoursActive(qh, Date.parse('2026-10-17T10:00:00Z')), false);
  // Sexta 09:00 em SP (madrugada de sexta pertence à janela de quinta, que não está marcada).
  assert.equal(np.isQuietHoursActive({ ...qh }, Date.parse('2026-10-16T08:00:00Z')), false);
  // Mesmo horário UTC, outro fuso: em Tóquio já é sábado 08:30 → fora.
  assert.equal(np.isQuietHoursActive({ ...qh, timezone: 'Asia/Tokyo' }, Date.parse('2026-10-16T23:30:00Z')), false);
  // Tóquio sexta 23:30 = sexta 14:30 UTC → dentro.
  assert.equal(np.isQuietHoursActive({ ...qh, timezone: 'Asia/Tokyo' }, Date.parse('2026-10-16T14:30:00Z')), true);
});

test('"Não perturbe": janela no mesmo dia, desligado, dias vazios, dia inteiro e fuso inválido', () => {
  const day = { enabled: true, start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5], timezone: 'UTC' };
  assert.equal(np.isQuietHoursActive(day, NOW), true, 'sexta 12:00 UTC');
  assert.equal(np.isQuietHoursActive(day, Date.parse('2026-10-16T18:00:00Z')), false, 'fim é exclusivo');
  assert.equal(np.isQuietHoursActive(day, Date.parse('2026-10-17T12:00:00Z')), false, 'sábado não marcado');
  assert.equal(np.isQuietHoursActive({ ...day, enabled: false }, NOW), false);
  assert.equal(np.isQuietHoursActive({ ...day, days: [] }, NOW), false);
  assert.equal(np.isQuietHoursActive({ ...day, start: '00:00', end: '00:00' }, NOW), true, 'start = end = dia todo');
  assert.equal(np.isQuietHoursActive({ ...day, start: '25:00' }, NOW), false, 'horário inválido');
  assert.equal(np.isQuietHoursActive({ ...day, timezone: 'Lua/Base_Alfa' }, NOW), true, 'fuso inválido cai pra UTC');
  assert.equal(np.isQuietHoursActive(null, NOW), false);
});

test('localTimeParts e isValidTimeZone', () => {
  assert.deepEqual(np.localTimeParts(NOW, 'America/Sao_Paulo'), { weekday: 5, minutes: 9 * 60 });
  assert.deepEqual(np.localTimeParts(Date.parse('2026-10-16T00:15:00Z'), 'UTC'), { weekday: 5, minutes: 15 });
  assert.equal(np.isValidTimeZone('Europe/Lisbon'), true);
  assert.equal(np.isValidTimeZone('Nada/Aqui'), false);
  assert.equal(np.isValidTimeZone(''), false);
});

test('parseOverrideBody valida nível e duração do silêncio', () => {
  assert.deepEqual(np.parseOverrideBody({ level: 'all' }, NOW).data, { level: 'ALL' });
  assert.deepEqual(np.parseOverrideBody({ level: null }, NOW).data, { level: null });
  assert.ok(np.parseOverrideBody({ level: 'TUDO' }, NOW).error);
  assert.deepEqual(np.parseOverrideBody({ mute: { minutes: 60 } }, NOW).data, { mutedUntil: minutes(60), muteForever: false });
  assert.deepEqual(np.parseOverrideBody({ mute: { forever: true } }, NOW).data, { mutedUntil: null, muteForever: true });
  assert.deepEqual(np.parseOverrideBody({ mute: null }, NOW).data, { mutedUntil: null, muteForever: false });
  assert.ok(np.parseOverrideBody({ mute: { minutes: 7 } }, NOW).error, 'só 15/60/480/1440');
  assert.ok(np.parseOverrideBody({}, NOW).error);
  assert.equal(np.isEmptyOverride({ level: null, mutedUntil: minutes(-5) }, NOW), true);
  assert.equal(np.isEmptyOverride({ level: 'NONE' }, NOW), false);
});

test('filterNotifiable e allMessageRecipients respeitam banco, silêncio e "Não perturbe"', async () => {
  const channel = { id: 'c1', categoryId: 'k1' };
  const quiet = { enabled: true, start: '00:00', end: '00:00', days: [0, 1, 2, 3, 4, 5, 6], timezone: 'UTC' };
  db.settings = [
    { userId: 'global-all', extraPrefs: JSON.stringify({ notifyLevel: 'all' }) },
    { userId: 'global-all-but-cat-none', extraPrefs: JSON.stringify({ notifyLevel: 'all' }) },
    { userId: 'sleeping', extraPrefs: JSON.stringify({ notifyLevel: 'all', quietHours: quiet }) },
    { userId: 'plain', extraPrefs: '{}' },
  ];
  db.overrides = [
    { userId: 'global-all-but-cat-none', targetKey: 'cat:k1', level: 'NONE' },
    { userId: 'chan-all', targetKey: 'ch:c1', level: 'ALL' },
    { userId: 'muted-all', targetKey: 'ch:c1', level: 'ALL', mutedUntil: minutes(30) },
    { userId: 'cat-muted', targetKey: 'cat:k1', muteForever: true },
  ];

  const mention = await np.filterNotifiable(['plain', 'cat-muted', 'sleeping', 'global-all-but-cat-none', 'chan-all'], { channel, kind: 'mention', now: NOW });
  assert.deepEqual(mention.sort(), ['chan-all', 'plain']);

  const every = await np.allMessageRecipients(channel, { excludeIds: ['author'], now: NOW });
  assert.deepEqual(every.sort(), ['chan-all', 'global-all']);

  const dm = await np.filterNotifiable(['plain', 'sleeping', 'cat-muted'], { now: NOW });
  assert.deepEqual(dm.sort(), ['cat-muted', 'plain'], 'DM só olha "Não perturbe"');
});

test('configurações: notifyLevel e quietHours são validados antes de salvar', () => {
  const { sanitizeExtraPrefs } = require('../src/controllers/settingsController');
  const ok = sanitizeExtraPrefs({
    notifyLevel: 'all',
    quietHours: { enabled: true, start: '23:00', end: '07:00', days: [5, 1, 5], timezone: 'America/Sao_Paulo', extra: 'lixo' },
  });
  assert.equal(ok.notifyLevel, 'all');
  assert.deepEqual(ok.quietHours, { enabled: true, start: '23:00', end: '07:00', days: [1, 5], timezone: 'America/Sao_Paulo' });
  const bad = sanitizeExtraPrefs({
    notifyLevel: 'tudo',
    quietHours: { enabled: true, start: '23:00', end: '07:00', days: [9], timezone: 'America/Sao_Paulo' },
  });
  assert.equal('notifyLevel' in bad, false);
  assert.equal('quietHours' in bad, false);
  const badTz = sanitizeExtraPrefs({ quietHours: { enabled: true, start: '23:00', end: '07:00', days: [1], timezone: 'Nada/Aqui' } });
  assert.equal('quietHours' in badTz, false);
});
