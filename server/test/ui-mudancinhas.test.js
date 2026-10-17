// Mudancinhas: assinatura só paga (gemas recusadas no servidor), contador
// de não lidas por canal, bolinhas "novo" das seções e aviso automático de
// anúncio/evento novo (push em lote respeitando as preferências).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// prisma falso (só pra os módulos carregarem sem o cliente gerado)
const fakePrisma = {};
require.cache[path.resolve(__dirname, '../src/config/prisma.js')] = { exports: fakePrisma, loaded: true, id: 'prisma' };

const supporterCredit = require('../src/services/supporterCredit');
const unread = require('../src/services/unreadCounts');
const sectionBadges = require('../src/services/sectionBadges');
const broadcast = require('../src/services/broadcastNotify');

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    set() { return this; },
  };
}

// ---------- 1) Assinatura só paga ----------
test('comprar assinatura com gemas é recusado (410) e nada é debitado', async () => {
  let touched = false;
  fakePrisma.user = new Proxy({}, { get() { touched = true; return async () => ({}); } });
  fakePrisma.$transaction = async () => { touched = true; };
  const res = fakeRes();
  await supporterCredit.rejectGemSubscription({ params: { id: 'sub-30' }, user: { id: 'u1' } }, res);
  assert.equal(res.statusCode, 410);
  assert.equal(res.body.code, 'SUBSCRIPTION_PAID_ONLY');
  assert.match(res.body.error, /só paga/);
  assert.equal(touched, false, 'não pode mexer no saldo nem no plano');
  assert.equal(supporterCredit.buyCredit, undefined, 'a compra com gemas não existe mais');
  assert.equal(supporterCredit.CREDITS, undefined, 'a Loja não oferece mais crédito de Assinante');
  delete fakePrisma.user; delete fakePrisma.$transaction;
});

test('a rota antiga de crédito aponta pra recusa, e a Loja não manda mais "credits"', () => {
  const routes = fs.readFileSync(path.resolve(__dirname, '../src/routes/decorations.js'), 'utf8');
  assert.match(routes, /credits\/:id\/buy', require\('\.\.\/services\/supporterCredit'\)\.rejectGemSubscription/);
  const shop = fs.readFileSync(path.resolve(__dirname, '../src/controllers/shopController.js'), 'utf8');
  assert.doesNotMatch(shop, /supporterCredit'\)\.CREDITS/);
});

// ---------- 2) Contador de não lidas ----------
test('mergeChannelStates: soma não lidas por canal e nunca fica abaixo das menções', () => {
  const t1 = new Date('2026-10-17T10:00:00Z');
  const states = unread.mergeChannelStates({
    visible: ['a', 'b', 'c'],
    reads: [{ channelId: 'a', lastReadAt: t1 }],
    lasts: [{ channelId: 'a', _max: { createdAt: t1 } }, { channelId: 'zz', _max: { createdAt: t1 } }],
    mentionRows: [{ channelId: 'b', cnt: 3n, lastAt: t1 }],
    unreadRows: [{ channelId: 'a', cnt: 12n }, { channelId: 'b', cnt: 1n }, { channelId: 'secreto', cnt: 9n }],
  });
  assert.deepEqual(Object.keys(states).sort(), ['a', 'b', 'c'], 'canal que a pessoa não vê nunca aparece');
  assert.equal(states.a.unreadCount, 12);
  assert.equal(states.a.myReadAt, t1);
  assert.equal(states.b.unreadMentions, 3);
  assert.equal(states.b.unreadCount, 3, 'menção também é mensagem não lida');
  assert.equal(states.c.unreadCount, 0);
});

test('countUnreadByChannel: uma consulta agrupada só, com o piso de dias', async () => {
  const calls = [];
  const prisma = { $queryRaw: async (strings, ...values) => { calls.push({ sql: strings.join('?'), values }); return [{ channelId: 'a', cnt: 2n }]; } };
  const FakePrisma = { join: (ids) => ({ joined: ids }) };
  const floor = unread.unreadFloor('2020-01-01T00:00:00Z', Date.parse('2026-10-17T00:00:00Z'));
  assert.equal(floor.toISOString(), '2026-10-03T00:00:00.000Z', '14 dias pra trás no máximo');
  const rows = await unread.countUnreadByChannel(prisma, { userId: 'me', channelIds: ['a', 'b'], floor }, FakePrisma);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /GROUP BY m\.channelId/);
  assert.match(calls[0].sql, /m\.authorId <> \?/);
  assert.deepEqual(calls[0].values[1], { joined: ['a', 'b'] });
  assert.deepEqual(rows, [{ channelId: 'a', cnt: 2n }]);
  assert.deepEqual(await unread.countUnreadByChannel(prisma, { userId: 'me', channelIds: [], floor }, FakePrisma), []);
  assert.equal(calls.length, 1, 'sem canal, sem consulta');
  // Conta nova: começa a contar da criação da conta.
  const fresh = unread.unreadFloor('2026-10-16T00:00:00Z', Date.parse('2026-10-17T00:00:00Z'));
  assert.equal(fresh.toISOString(), '2026-10-16T00:00:00.000Z');
});

test('activityPayload não leva conteúdo da mensagem', () => {
  const p = unread.activityPayload({ id: 'm1', authorId: 'u2', createdAt: 'x', content: 'segredo' }, 'c1');
  assert.deepEqual(p, { channelId: 'c1', messageId: 'm1', authorId: 'u2', createdAt: 'x' });
});

// ---------- 3) Bolinhas "novo" das seções ----------
function sectionDb({ latest, items, seen = [] }) {
  const counts = [];
  const model = (key) => ({
    findFirst: async () => (latest[key] ? { createdAt: latest[key] } : null),
    count: async ({ where }) => { counts.push(key); return (items[key] || []).filter((d) => d > where.createdAt.gt).length; },
  });
  const upserts = [];
  return {
    counts, upserts,
    staffAnnouncement: model('anuncios'),
    event: model('eventos'),
    shopCollection: model('colecoes'),
    sectionSeen: {
      findMany: async () => seen,
      upsert: async (args) => { upserts.push(args); return {}; },
    },
  };
}

test('badgesFor: conta o que saiu depois da última visita (ou da criação da conta)', async () => {
  sectionBadges.resetCache();
  const d = (s) => new Date(`2026-10-${String(s).padStart(2, "0")}T12:00:00Z`);
  const db = sectionDb({
    latest: { anuncios: d(15), eventos: d(10), colecoes: d(16) },
    items: { anuncios: [d(12), d(14), d(15)], eventos: [d(10)], colecoes: [d(1), d(16)] },
    seen: [{ section: 'anuncios', seenAt: d(13) }, { section: 'eventos', seenAt: d(11) }],
  });
  const out = await sectionBadges.badgesFor(db, { id: 'u1', createdAt: d(5) }, Date.parse('2026-10-17T00:00:00Z'));
  assert.equal(out.anuncios.count, 2, 'dois anúncios depois da visita');
  assert.equal(out.eventos.count, 0, 'já viu o último evento');
  assert.equal(out.colecoes.count, 1, 'nunca abriu: conta só o que saiu depois da conta');
  assert.deepEqual(db.counts.sort(), ['anuncios', 'colecoes'], 'só conta quando tem novidade');
});

test('badgesFor usa cache do "mais recente" e touchSection invalida', async () => {
  sectionBadges.resetCache();
  let finds = 0;
  const db = sectionDb({ latest: {}, items: {} });
  const wrap = (m) => ({ ...m, findFirst: async (...a) => { finds += 1; return m.findFirst(...a); } });
  db.staffAnnouncement = wrap(db.staffAnnouncement);
  const now = Date.now();
  await sectionBadges.badgesFor(db, { id: 'u1', createdAt: new Date(0) }, now);
  await sectionBadges.badgesFor(db, { id: 'u2', createdAt: new Date(0) }, now + 1000);
  assert.equal(finds, 1, 'segunda pessoa usa o cache');
  sectionBadges.touchSection('anuncios');
  await sectionBadges.badgesFor(db, { id: 'u3', createdAt: new Date(0) }, now + 2000);
  assert.equal(finds, 2);
});

test('markSeen grava a visita; seção desconhecida é ignorada', async () => {
  const db = sectionDb({ latest: {}, items: {} });
  const at = new Date('2026-10-17T00:00:00Z');
  assert.equal(await sectionBadges.markSeen(db, 'u1', 'anuncios', at), at);
  assert.deepEqual(db.upserts[0].where, { userId_section: { userId: 'u1', section: 'anuncios' } });
  assert.equal(db.upserts[0].update.seenAt, at);
  assert.equal(await sectionBadges.markSeen(db, 'u1', 'hackeado', at), null);
  assert.equal(db.upserts.length, 1);
});

// ---------- 4) Aviso automático de anúncio/evento ----------
function broadcastDeps({ fcm = [], web = [], prefs = {}, quiet = new Set() } = {}) {
  const sent = [];
  const prefBatches = [];
  return {
    sent, prefBatches,
    prisma: {
      pushToken: { findMany: async () => fcm.map((userId) => ({ userId })) },
      webPushSubscription: { findMany: async () => web.map((userId) => ({ userId })) },
    },
    loadExtraPrefs: async (ids) => { prefBatches.push(ids.length); return Object.fromEntries(ids.map((id) => [id, prefs[id] || {}])); },
    isQuietHoursActive: (qh) => !!qh && quiet.has(qh.who),
    sendPush: async (uid, payload) => { sent.push({ uid, payload }); },
  };
}

test('anúncio novo: push pra quem tem aparelho, menos o autor, quem desligou e quem está em "Não perturbe"', async () => {
  const emitted = [];
  const io = { to: (room) => ({ emit: (ev, p) => emitted.push({ room, ev, p }) }) };
  const deps = broadcastDeps({
    fcm: ['autor', 'ana', 'bia', 'caio'], web: ['ana', 'dani'],
    prefs: { bia: { notifyAnnouncements: false }, caio: { quietHours: { who: 'caio' } }, dani: { notifyEvents: false } },
    quiet: new Set(['caio']),
  });
  const r = await broadcast.notifyBroadcast(io, { kind: 'announcement', id: 'a1', title: 'Manutenção', body: 'Hoje às 22h', authorId: 'autor' }, deps);
  assert.deepEqual(deps.sent.map((s) => s.uid).sort(), ['ana', 'dani'], 'ana só uma vez (Android + navegador)');
  assert.equal(r.pushed, 2);
  assert.equal(r.skipped, 2);
  assert.equal(deps.sent[0].payload.title, 'Novo anúncio: Manutenção');
  assert.equal(deps.sent[0].payload.data.link, '/anuncios');
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].room, 'community');
  assert.equal(emitted[0].ev, 'broadcast:notify');
  assert.equal(emitted[0].p.kind, 'announcement');
});

test('evento novo: link do evento, chave própria, e envio em lotes', async () => {
  const many = Array.from({ length: broadcast.BATCH * 2 + 5 }, (_, i) => `u${i}`);
  const deps = broadcastDeps({ fcm: many, prefs: { u1: { notifyEvents: false }, u2: { notifyAnnouncements: false } } });
  const r = await broadcast.notifyBroadcast(null, { kind: 'event', id: 'e 9', title: 'Torneio', body: '', authorId: null }, deps);
  assert.deepEqual(deps.prefBatches, [broadcast.BATCH, broadcast.BATCH, 5], 'preferências carregadas em lotes');
  assert.equal(r.pushed, many.length - 1, 'só quem desligou eventos fica de fora');
  const one = deps.sent.find((s) => s.uid === 'u2');
  assert.equal(one.payload.title, 'Novo evento: Torneio');
  assert.equal(one.payload.data.link, '/eventos/e%209');
});

test('wantsBroadcast: ligado por padrão; tipo desconhecido nunca avisa', () => {
  assert.equal(broadcast.wantsBroadcast(undefined, 'announcement'), true);
  assert.equal(broadcast.wantsBroadcast({ notifyEvents: false }, 'announcement'), true);
  assert.equal(broadcast.wantsBroadcast({ notifyEvents: false }, 'event'), false);
  assert.equal(broadcast.wantsBroadcast({}, 'spam'), false);
});

test('as chaves novas de notificação são aceitas nas configurações', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../src/controllers/settingsController.js'), 'utf8');
  assert.match(src, /notifyAnnouncements: isBool/);
  assert.match(src, /notifyEvents: isBool/);
});
