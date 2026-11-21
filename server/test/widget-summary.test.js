// Widget do Android ("quem está online"): contagem de amigos online, quem
// está em call e as regras de privacidade (invisível, DM, clã, canal sem
// permissão) — com banco/Redis falsos.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWidgetSummary, cleanName } = require('../src/services/widgetSummary');

const U = (id, status, displayName = id.toUpperCase()) => ({ id, status, displayName, username: id });

function deps({ friends = [], me = { id: 'eu', clanId: 'c1' }, rooms = {}, visibleChannels = [] } = {}) {
  const permCalls = [];
  return {
    permCalls,
    db: {
      user: { findUnique: async () => me },
      friendship: {
        findMany: async ({ where }) => {
          assert.equal(where.status, 'ACCEPTED', 'só amizades aceitas');
          return friends.map((f, i) => (i % 2 === 0
            ? { requesterId: 'eu', addresseeId: f.id, requester: U('eu', 'ONLINE'), addressee: f }
            : { requesterId: f.id, addresseeId: 'eu', requester: f, addressee: U('eu', 'ONLINE') }));
        },
      },
    },
    voiceStore: {
      getActiveRoomIds: async () => Object.keys(rooms),
      getRoom: async (id) => rooms[id] || {},
    },
    canViewChannel: async (userId, channelId) => { permCalls.push(channelId); return visibleChannels.includes(channelId); },
  };
}

test('conta amigos online (ONLINE/IDLE/DND); invisível e offline não contam', async () => {
  const d = deps({ friends: [U('a', 'ONLINE'), U('b', 'IDLE'), U('c', 'DND'), U('d', 'INVISIBLE'), U('e', 'OFFLINE')] });
  const s = await buildWidgetSummary('eu', d);
  assert.equal(s.onlineCount, 3);
  assert.equal(s.friendCount, 5);
  assert.deepEqual(s.inVoice, []);
  assert.equal(s.inVoiceCount, 0);
  assert.ok(!Number.isNaN(Date.parse(s.generatedAt)));
});

test('em call: só salas que eu veria — DM nunca, clã só o meu, canal só com permissão', async () => {
  const d = deps({
    friends: [U('a', 'ONLINE', 'Ana'), U('b', 'ONLINE', 'Beto'), U('c', 'ONLINE', 'Caio'), U('d', 'ONLINE', 'Duda'), U('e', 'ONLINE', 'Edu')],
    rooms: {
      'dm:x': { a: { joinedAt: 1 } },
      'clan:c2': { b: { joinedAt: 2 } },
      'clan:c1': { c: { joinedAt: 3 } },
      canalPrivado: { d: { joinedAt: 4 } },
      canalAberto: { e: { joinedAt: 5 }, estranho: { joinedAt: 9 } },
    },
    visibleChannels: ['canalAberto'],
  });
  const s = await buildWidgetSummary('eu', d);
  assert.deepEqual(s.inVoice, ['Edu', 'Caio']);
  assert.equal(s.inVoiceCount, 2);
  // Permissão só é consultada pra canal comum com amigo dentro.
  assert.deepEqual(d.permCalls.sort(), ['canalAberto', 'canalPrivado']);
});

test('invisível em call não aparece; máximo 3 nomes (mais recentes primeiro), contagem completa', async () => {
  const d = deps({
    friends: [U('a', 'ONLINE', 'Ana'), U('b', 'ONLINE', 'Beto'), U('c', 'ONLINE', 'Caio'), U('d', 'ONLINE', 'Duda'), U('f', 'INVISIBLE', 'Fantasma')],
    rooms: { v: { a: { joinedAt: 10 }, b: { joinedAt: 40 }, c: { joinedAt: 30 }, d: { joinedAt: 20 }, f: { joinedAt: 50 } } },
    visibleChannels: ['v'],
  });
  const s = await buildWidgetSummary('eu', d);
  assert.deepEqual(s.inVoice, ['Beto', 'Caio', 'Duda']);
  assert.equal(s.inVoiceCount, 4);
  assert.equal(s.onlineCount, 4);
});

test('sem amigos: nem olha as salas de voz; resposta só com números e nomes', async () => {
  const d = deps({ friends: [], rooms: { v: { a: {} } } });
  let scanned = false;
  d.voiceStore.getActiveRoomIds = async () => { scanned = true; return ['v']; };
  const s = await buildWidgetSummary('eu', d);
  assert.equal(scanned, false);
  assert.deepEqual(Object.keys(s).sort(), ['friendCount', 'generatedAt', 'inVoice', 'inVoiceCount', 'onlineCount']);
});

test('Redis fora do ar: widget continua com a contagem de online', async () => {
  const d = deps({ friends: [U('a', 'ONLINE')] });
  d.voiceStore.getActiveRoomIds = async () => { throw new Error('redis caiu'); };
  const s = await buildWidgetSummary('eu', d);
  assert.equal(s.onlineCount, 1);
  assert.deepEqual(s.inVoice, []);
});

test('nome: usa displayName, cai pro username e corta nomes enormes', () => {
  assert.equal(cleanName({ displayName: '  Ana   Paula ' }), 'Ana Paula');
  assert.equal(cleanName({ username: 'beto' }), 'beto');
  assert.equal([...cleanName({ displayName: 'x'.repeat(80) })].length, 32);
});
