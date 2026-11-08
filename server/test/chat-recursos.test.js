// Recursos de chat: busca (permissões + FULLTEXT), fixar (permissões +
// aviso no chat), status personalizado (expiração) e tópicos (criação,
// resposta, arquivamento). Sem banco: prisma, authz e serviços com efeito
// colateral são trocados por versões falsas em memória.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.resolve(__dirname, '../src', p);
const stub = (rel, exports) => { require.cache[src(rel)] = { id: src(rel), filename: src(rel), loaded: true, exports }; };

const { PERMISSIONS } = require(src('services/permissions.js'));
const VIEW = PERMISSIONS.VIEW_CHANNEL;
const SEND = PERMISSIONS.SEND_MESSAGES;
const MANAGE = PERMISSIONS.MANAGE_MESSAGES;
const TOPICS = PERMISSIONS.CREATE_TOPICS;

// ---------------- estado falso ----------------
let state;
function reset() {
  state = {
    channels: {
      geral: { id: 'geral', name: 'geral', categoryId: null, isPrivate: false, type: 'TEXT', slowModeSeconds: null },
      // "público" mas com sobrescrita negando VIEW_CHANNEL pra "eu"
      escondido: { id: 'escondido', name: 'escondido', categoryId: null, isPrivate: false, type: 'TEXT', slowModeSeconds: null },
      staff: { id: 'staff', name: 'staff', categoryId: null, isPrivate: true, type: 'TEXT', slowModeSeconds: null },
      voz: { id: 'voz', name: 'voz', categoryId: null, isPrivate: false, type: 'VOICE', slowModeSeconds: null },
    },
    // permissões efetivas por usuário/canal
    perms: {
      eu: { geral: VIEW | SEND | TOPICS, escondido: 0n, staff: 0n, voz: VIEW },
      mod: { geral: VIEW | SEND | MANAGE | TOPICS, escondido: VIEW | SEND | MANAGE, staff: VIEW | SEND | MANAGE, voz: VIEW },
      outro: { geral: VIEW | SEND | TOPICS, escondido: VIEW | SEND, staff: 0n, voz: VIEW },
    },
    convMembers: { 'dm-1': new Set(['eu', 'outro']) },
    messages: {},
    users: {},
    created: [],
    updated: [],
    rawQueries: [],
    findManyCalls: [],
    rawRows: null,
    rawThrows: false,
    emits: [],
  };
}
reset();

let idSeq = 0;
function addMessage(m) {
  const row = {
    id: m.id || `m${++idSeq}`, content: null, title: null, authorId: 'eu', channelId: null, conversationId: null,
    replyToId: null, threadId: null, deleted: false, archived: false, pinned: false, embed: null,
    isThread: false, threadReplyCount: 0, threadLastReplyAt: null, threadLastReplyId: null, threadArchivedAt: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, idSeq)), attachments: [], ...m,
  };
  state.messages[row.id] = row;
  return row;
}

function matchWhere(row, where = {}) {
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if (k === 'AND') { if (!v.every((w) => matchWhere(row, w))) return false; continue; }
    if (k === 'OR') { if (!v.some((w) => matchWhere(row, w))) return false; continue; }
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v && !v.in.includes(row[k])) return false;
      if ('lt' in v && !(row[k] < v.lt)) return false;
      if ('lte' in v && !(row[k] <= v.lte)) return false;
      if ('gt' in v && !(row[k] > v.gt)) return false;
      if ('not' in v && v.not === null && row[k] == null) return false;
      if ('contains' in v && !(row[k] || '').includes(v.contains)) return false;
      if ('startsWith' in v && !String(row[k] || '').startsWith(v.startsWith)) return false;
      if ('some' in v) continue; // anexos: não usado nos testes
      continue;
    }
    if (v instanceof Date) { if (!row[k] || row[k].getTime() !== v.getTime()) return false; continue; }
    if (row[k] !== v) return false;
  }
  return true;
}

stub('config/prisma.js', {
  channel: {
    findUnique: async ({ where }) => state.channels[where.id] || null,
    findMany: async ({ where } = {}) => Object.values(state.channels).filter((c) => !where?.type?.notIn?.includes(c.type)),
  },
  conversationMember: {
    findUnique: async ({ where }) => {
      const { conversationId, userId } = where.conversationId_userId;
      return state.convMembers[conversationId]?.has(userId) ? { conversationId, userId } : null;
    },
    findMany: async ({ where }) => Object.entries(state.convMembers).filter(([, s]) => s.has(where.userId)).map(([conversationId]) => ({ conversationId })),
  },
  userSettings: { findUnique: async () => null },
  user: {
    findUnique: async ({ where }) => state.users[where.id] || { id: where.id, timeoutUntil: null },
    findMany: async ({ where }) => {
      if (where?.customStatusExpiresAt) {
        return Object.values(state.users).filter((u) => u.customStatusExpiresAt && u.customStatusExpiresAt <= where.customStatusExpiresAt.lte).map((u) => ({ id: u.id, status: u.status }));
      }
      return [];
    },
    updateMany: async ({ where, data }) => {
      let count = 0;
      for (const u of Object.values(state.users)) {
        if (where.id.in.includes(u.id) && u.customStatusExpiresAt && u.customStatusExpiresAt <= where.customStatusExpiresAt.lte) { Object.assign(u, data); count += 1; }
      }
      return { count };
    },
  },
  message: {
    findUnique: async ({ where }) => {
      const m = state.messages[where.id];
      return m ? { ...m } : null;
    },
    findFirst: async () => null,
    count: async () => 0,
    findMany: async (args) => {
      state.findManyCalls.push(args);
      const rows = Object.values(state.messages).filter((m) => matchWhere(m, args.where));
      rows.sort((a, b) => b.createdAt - a.createdAt);
      return rows.slice(0, args.take || 50).map((m) => (args.select?._count ? { ...m, _count: { attachments: 0 } } : { ...m }));
    },
    create: async ({ data }) => {
      const row = addMessage({ ...data, createdAt: new Date() });
      state.created.push(row);
      return { ...row, author: { id: data.authorId, displayName: data.authorId } };
    },
    update: async ({ where, data }) => {
      const m = state.messages[where.id];
      state.updated.push({ id: where.id, data });
      for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === 'object' && 'increment' in v) m[k] = (m[k] || 0) + v.increment;
        else if (v && typeof v === 'object' && 'decrement' in v) m[k] = (m[k] || 0) - v.decrement;
        else m[k] = v;
      }
      return { ...m };
    },
    updateMany: async ({ where, data }) => {
      const ids = where.id?.in || [where.id];
      ids.forEach((id) => { if (state.messages[id]) Object.assign(state.messages[id], data); });
      return { count: ids.length };
    },
  },
  $queryRawUnsafe: async (sql, ...params) => {
    state.rawQueries.push({ sql, params });
    if (state.rawThrows) throw new Error("Can't find FULLTEXT index matching the column list");
    return state.rawRows || [];
  },
});
stub('config/redis.js', {
  redis: { set: async () => 'OK', get: async () => null, del: async () => 0, on: () => {} },
  cacheGetOrSet: async (key, ttl, compute) => compute(),
  cacheInvalidate: async () => {},
});
stub('services/authz.js', {
  getEffectivePermissions: async (userId, channelId) => state.perms[userId]?.[channelId] ?? 0n,
  getEffectivePermissionsForChannels: async (userId, channels) => new Map(channels.map((c) => [c.id, state.perms[userId]?.[c.id] ?? 0n])),
  channelHasRestrictions: async (ch) => ch.id !== 'geral',
});
stub('services/automod.js', { checkMessage: async () => null, applyAction: async () => {}, phishingReason: () => null });
stub('services/xp.js', { awardMessageXp: async () => null });
stub('services/missions.js', { track: () => {} });
stub('services/notificationPrefs.js', { filterNotifiable: async (ids) => ids, allMessageRecipients: async () => [] });
stub('services/pushNotifications.js', { sendPushToUser: async () => {} });

const ctrl = require(src('controllers/messageController.js'));
const threads = require(src('services/threads.js'));
const messageSearch = require(src('services/messageSearch.js'));
const customStatus = require(src('services/customStatus.js'));
const { parseSystemEmbed } = require(src('utils/systemMessage.js'));

function fakeIo() {
  const io = {
    to(room) { return { emit: (event, payload) => state.emits.push({ room, event, payload }), to: (r2) => ({ emit: (event, payload) => state.emits.push({ room: `${room}+${r2}`, event, payload }) }) }; },
    emitPresenceUpdate: (u) => state.emits.push({ room: '*', event: 'presence:update', payload: u }),
  };
  return io;
}

const call = (fn, { user = 'eu', params = {}, query = {}, body = {} } = {}) => new Promise((resolve) => {
  const res = {
    statusCode: 200,
    status(c) { this.statusCode = c; return this; },
    json(b) { resolve({ status: this.statusCode, body: b }); },
  };
  const req = { user: { id: user, displayName: user === 'mod' ? 'Moderadora' : user }, params, query, body, headers: {}, app: { get: () => fakeIo() } };
  const p = fn(req, res, (err) => resolve({ status: err.status || 500, body: { error: err.message } }));
  // createMessageInner devolve true/false sem passar por res em sucesso parcial
  if (p && typeof p.then === 'function') p.then((r) => { if (r === false && res.statusCode === 200) resolve({ status: 0, body: null }); });
});

beforeEach(() => { reset(); messageSearch.resetFulltextState(); });

// ---------------- busca ----------------
test('busca global: só canais com VIEW_CHANNEL (inclusive público com sobrescrita negando) + conversas da pessoa', async () => {
  addMessage({ channelId: 'geral', content: 'bolo de chocolate' });
  addMessage({ channelId: 'escondido', content: 'bolo secreto' });
  addMessage({ channelId: 'staff', content: 'bolo da staff' });
  addMessage({ conversationId: 'dm-1', content: 'bolo na dm' });
  const r = await call(ctrl.searchMessages, { query: { q: 'bolo' } });
  assert.equal(r.status, 200);
  const where = state.findManyCalls.at(-1).where;
  const scopeIds = where.OR.flatMap((c) => c.channelId?.in || c.conversationId?.in || []);
  assert.deepEqual(scopeIds.sort(), ['dm-1', 'geral'].sort());
  assert.ok(!scopeIds.includes('escondido'), 'canal com VIEW negado por sobrescrita não pode entrar');
  assert.ok(!scopeIds.includes('voz'), 'canal de voz fica de fora');
  const contents = r.body.messages.map((m) => m.content).sort();
  assert.deepEqual(contents, ['bolo de chocolate', 'bolo na dm']);
});

test('busca: in:#canal invisível não vaza (lista vazia, sem 403 que confirme a existência)', async () => {
  addMessage({ channelId: 'staff', content: 'segredo' });
  const r = await call(ctrl.searchMessages, { query: { q: 'segredo in:#staff' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.messages, []);
  // e o mod (que vê) acha
  const r2 = await call(ctrl.searchMessages, { user: 'mod', query: { q: 'segredo in:#staff' } });
  assert.equal(r2.body.messages.length, 1);
});

test('busca: canal específico sem acesso = 403; DM de outros = 403', async () => {
  assert.equal((await call(ctrl.searchMessages, { query: { q: 'oi tudo', channelId: 'staff' } })).status, 403);
  assert.equal((await call(ctrl.searchMessages, { user: 'mod', query: { q: 'oi tudo', conversationId: 'dm-1' } })).status, 403);
});

test('busca FULLTEXT: consulta presa ao escopo visível e cai pro LIKE se o índice faltar', async () => {
  const keep = addMessage({ channelId: 'geral', content: 'receita de bolo de chocolate' });
  addMessage({ channelId: 'geral', content: 'outra coisa' });
  state.rawRows = [{ id: keep.id }];
  const r = await call(ctrl.searchMessages, { query: { q: 'bolo chocolate' } });
  assert.equal(r.status, 200);
  assert.equal(state.rawQueries.length, 1);
  const { sql, params } = state.rawQueries[0];
  assert.match(sql, /MATCH\(content\) AGAINST \(\? IN BOOLEAN MODE\)/);
  assert.equal(params[0], '+bolo* +chocolate*');
  assert.ok(params.includes('geral') && params.includes('dm-1'));
  assert.ok(!params.includes('escondido') && !params.includes('staff'), 'FULLTEXT nunca olha canal invisível');
  // índice ausente: não quebra, segue no LIKE
  reset(); messageSearch.resetFulltextState();
  addMessage({ channelId: 'geral', content: 'bolo de chocolate' });
  state.rawThrows = true;
  const r2 = await call(ctrl.searchMessages, { query: { q: 'bolo chocolate' } });
  assert.equal(r2.status, 200);
});

test('busca: expressão booleana segura (sem operadores do usuário, palavras curtas = LIKE)', () => {
  assert.equal(messageSearch.buildBooleanQuery('Olá MUNDO'), '+olá* +mundo*');
  assert.equal(messageSearch.buildBooleanQuery('+bolo -"chocolate" (x*)'), null); // "x" tem 1 letra
  assert.equal(messageSearch.buildBooleanQuery('+bolo -"chocolate"'), '+bolo* +chocolate*');
  assert.equal(messageSearch.buildBooleanQuery('oi'), null);
  assert.equal(messageSearch.buildBooleanQuery(''), null);
  assert.equal(messageSearch.buildCandidateSql({ booleanQuery: '+a*', channelIds: [], conversationIds: [] }), null);
});

// ---------------- fixar ----------------
test('fixar: sem MANAGE_MESSAGES = 403; sem ver o canal = 404', async () => {
  const m = addMessage({ channelId: 'geral', content: 'oi' });
  assert.equal((await call(ctrl.togglePin, { params: { id: m.id } })).status, 403);
  const s = addMessage({ channelId: 'staff', content: 'oi' });
  assert.equal((await call(ctrl.togglePin, { params: { id: s.id } })).status, 404);
  assert.equal(state.messages[m.id].pinned, false);
});

test('fixar: mod fixa, cria o aviso "fixou uma mensagem" e desafixar não cria aviso', async () => {
  const m = addMessage({ channelId: 'geral', content: 'regras' });
  const r = await call(ctrl.togglePin, { user: 'mod', params: { id: m.id } });
  assert.equal(r.status, 200);
  assert.equal(state.messages[m.id].pinned, true);
  assert.equal(state.created.length, 1);
  const sys = parseSystemEmbed(state.created[0].embed);
  assert.equal(sys.system, 'pin');
  assert.equal(sys.targetId, m.id);
  assert.match(sys.description, /Moderadora fixou uma mensagem/);
  assert.ok(state.emits.some((e) => e.room === 'channel:geral' && e.event === 'message:new'));
  // aviso do sistema não pode ser fixado nem editado
  assert.equal((await call(ctrl.togglePin, { user: 'mod', params: { id: state.created[0].id } })).status, 400);
  assert.equal((await call(ctrl.editMessage, { user: 'mod', params: { id: state.created[0].id }, body: { content: 'hack' } })).status, 400);
  const r2 = await call(ctrl.togglePin, { user: 'mod', params: { id: m.id } });
  assert.equal(r2.status, 200);
  assert.equal(state.messages[m.id].pinned, false);
  assert.equal(state.created.length, 1);
});

test('fixar em DM: qualquer participante; quem não participa = 403', async () => {
  const m = addMessage({ conversationId: 'dm-1', content: 'oi' });
  assert.equal((await call(ctrl.togglePin, { user: 'mod', params: { id: m.id } })).status, 403);
  assert.equal((await call(ctrl.togglePin, { user: 'outro', params: { id: m.id } })).status, 200);
});

// ---------------- status personalizado ----------------
test('status: cálculo da expiração (30 min, 1h, 4h, hoje, nunca) e validação', () => {
  const now = Date.UTC(2026, 9, 17, 12, 0, 0);
  assert.equal(customStatus.computeStatusExpiry({ durationMinutes: 30, now }).expiresAt.getTime(), now + 30 * 60000);
  assert.equal(customStatus.computeStatusExpiry({ durationMinutes: '240', now }).expiresAt.getTime(), now + 240 * 60000);
  assert.equal(customStatus.computeStatusExpiry({ durationMinutes: null, now }).expiresAt, null);
  assert.equal(customStatus.computeStatusExpiry({ now }).expiresAt, null);
  const endOfDay = new Date(now + 11 * 3600000).toISOString();
  assert.equal(customStatus.computeStatusExpiry({ expiresAt: endOfDay, now }).expiresAt.toISOString(), endOfDay);
  assert.ok(customStatus.computeStatusExpiry({ expiresAt: new Date(now - 1000).toISOString(), now }).error);
  assert.ok(customStatus.computeStatusExpiry({ expiresAt: 'lixo', now }).error);
  assert.ok(customStatus.computeStatusExpiry({ durationMinutes: -5, now }).error);
  assert.ok(customStatus.computeStatusExpiry({ durationMinutes: 99999, now }).error);
});

test('status: varredura limpa só os vencidos e avisa todo mundo em tempo real', async () => {
  const now = new Date(Date.UTC(2026, 9, 17, 12, 0, 0));
  state.users = {
    a: { id: 'a', status: 'ONLINE', customStatus: 'almoçando', customStatusEmoji: '🍕', customStatusExpiresAt: new Date(now.getTime() - 1000) },
    b: { id: 'b', status: 'IDLE', customStatus: 'estudando', customStatusEmoji: '📚', customStatusExpiresAt: new Date(now.getTime() + 60000) },
    c: { id: 'c', status: 'ONLINE', customStatus: 'pra sempre', customStatusEmoji: null, customStatusExpiresAt: null },
  };
  const n = await customStatus.sweepExpiredStatuses(fakeIo(), now);
  assert.equal(n, 1);
  assert.equal(state.users.a.customStatus, null);
  assert.equal(state.users.a.customStatusEmoji, null);
  assert.equal(state.users.b.customStatus, 'estudando');
  assert.equal(state.users.c.customStatus, 'pra sempre');
  assert.ok(state.emits.some((e) => e.event === 'presence:update' && e.payload.id === 'a' && e.payload.customStatus === null));
  assert.ok(state.emits.some((e) => e.event === 'user:update' && e.payload.id === 'a' && e.payload.customStatusEmoji === null));
  assert.ok(!state.emits.some((e) => e.payload?.id === 'b'));
});

// ---------------- tópicos ----------------
function createMsg(user, body) {
  return call((req, res, next) => ctrl.createMessageInner(req, res).catch(next), { user, body });
}

test('tópico: criar a partir de uma mensagem marca a raiz (isThread) e exige CREATE_TOPICS', async () => {
  const parent = addMessage({ channelId: 'geral', content: 'ideia: torneio', authorId: 'outro' });
  const r = await createMsg('eu', { channelId: 'geral', replyToId: parent.id, title: 'Torneio de sábado' });
  assert.equal(r.status, 201);
  const root = state.created[0];
  assert.equal(root.title, 'Torneio de sábado');
  assert.equal(root.replyToId, parent.id);
  assert.equal(root.isThread, true);
  assert.ok(root.threadLastReplyAt instanceof Date);
  // sem CREATE_TOPICS
  state.perms.eu.geral = VIEW | SEND;
  const r2 = await createMsg('eu', { channelId: 'geral', replyToId: parent.id, title: 'Outro' });
  assert.equal(r2.status, 403);
});

test('tópico: resposta entra com threadId, atualiza o resumo e avisa os participantes (menos quem escreveu)', async () => {
  const parent = addMessage({ channelId: 'geral', content: 'ideia', authorId: 'outro' });
  const root = addMessage({ channelId: 'geral', replyToId: parent.id, title: 'Tópico', authorId: 'mod', isThread: true, threadLastReplyAt: new Date() });
  const r = await createMsg('eu', { channelId: 'geral', threadId: root.id, content: 'bora!' });
  assert.equal(r.status, 201);
  const reply = state.created.at(-1);
  assert.equal(reply.threadId, root.id);
  // efeitos assíncronos (resumo + aviso)
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(state.messages[root.id].threadReplyCount, 1);
  assert.equal(state.messages[root.id].threadLastReplyId, reply.id);
  const notified = state.emits.filter((e) => e.event === 'thread:reply').map((e) => e.room).sort();
  assert.deepEqual(notified, ['user:mod', 'user:outro']);
  assert.ok(state.emits.some((e) => e.event === 'message:update' && e.room === 'channel:geral' && e.payload.id === root.id && e.payload.threadLastReply?.id === reply.id));
  // a lista principal do canal não traz respostas de tópico
  state.findManyCalls = [];
  const list = await call(ctrl.listMessages, { query: { channelId: 'geral' } });
  assert.equal(list.status, 200);
  assert.equal(state.findManyCalls.find((c) => c.where.channelId === 'geral').where.threadId, null);
  assert.ok(!list.body.messages.some((m) => m.threadId), 'resposta do tópico não aparece no canal');
  assert.equal(list.body.messages.find((m) => m.id === root.id).threadLastReply.id, reply.id);
  // painel do tópico: raiz + respostas
  const panel = await call(ctrl.listMessages, { query: { channelId: 'geral', threadId: root.id } });
  assert.deepEqual(panel.body.messages.map((m) => m.id), [root.id, reply.id]);
});

test('tópico: trancado pela moderação recusa resposta; de outro canal = 400; arquivado por inatividade reabre ao responder', async () => {
  const parent = addMessage({ channelId: 'geral', content: 'x' });
  const locked = addMessage({ channelId: 'geral', replyToId: parent.id, title: 'T', isThread: true, archived: true });
  assert.equal((await createMsg('eu', { channelId: 'geral', threadId: locked.id, content: 'oi' })).status, 403);
  const other = addMessage({ channelId: 'escondido', replyToId: 'zz', title: 'T2', isThread: true });
  assert.equal((await createMsg('eu', { channelId: 'geral', threadId: other.id, content: 'oi' })).status, 400);
  assert.equal((await createMsg('eu', { channelId: 'geral', threadId: parent.id, content: 'oi' })).status, 404); // não é raiz
  const sleepy = addMessage({ channelId: 'geral', replyToId: parent.id, title: 'T3', isThread: true, threadArchivedAt: new Date() });
  assert.equal((await createMsg('eu', { channelId: 'geral', threadId: sleepy.id, content: 'acordando' })).status, 201);
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(state.messages[sleepy.id].threadArchivedAt, null);
  // tópico dentro de tópico não
  assert.equal((await createMsg('eu', { channelId: 'geral', threadId: sleepy.id, title: 'sub', content: 'x' })).status, 400);
});

test('tópico: varredura arquiva só os parados', async () => {
  const now = Date.UTC(2026, 9, 17, 12, 0, 0);
  const old = addMessage({ channelId: 'geral', replyToId: 'p', title: 'velho', isThread: true, threadLastReplyAt: new Date(now - 4 * 24 * 3600000) });
  const fresh = addMessage({ channelId: 'geral', replyToId: 'p', title: 'novo', isThread: true, threadLastReplyAt: new Date(now - 3600000) });
  assert.equal(threads.isInactive(state.messages[old.id], now), true);
  assert.equal(threads.isInactive(state.messages[fresh.id], now), false);
  const n = await threads.sweepInactiveThreads(fakeIo(), now);
  assert.equal(n, 1);
  assert.ok(state.messages[old.id].threadArchivedAt instanceof Date);
  assert.equal(state.messages[fresh.id].threadArchivedAt, null);
  assert.ok(state.emits.some((e) => e.event === 'thread:archived' && e.payload.id === old.id));
});

test('tópico: participante que perdeu acesso ao canal não é avisado', async () => {
  const parent = addMessage({ channelId: 'escondido', content: 'x', authorId: 'outro' });
  const root = addMessage({ channelId: 'escondido', replyToId: parent.id, title: 'T', authorId: 'eu', isThread: true });
  const reply = addMessage({ channelId: 'escondido', threadId: root.id, authorId: 'mod', content: 'oi', author: { displayName: 'Moderadora' } });
  const ids = await threads.notifyThreadParticipants(fakeIo(), { root: state.messages[root.id], message: reply, channel: state.channels.escondido });
  assert.deepEqual(ids.sort(), ['outro']); // "eu" não vê #escondido
});
