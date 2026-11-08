// Parte 1 (velocidade e chat): helpers puros do servidor — idempotência do
// envio pelo nonce e o filtro in:/em:#canal da busca.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createIdempotencyStore, validNonce } = require('../src/services/messageIdempotency');
const { parseSearchQuery, resolveChannelFilter, normChannelName } = require('../src/services/searchQuery');

test('idempotência: nonce válido só com formato esperado', () => {
  assert.equal(validNonce('temp-1712345678901-abc123'), true);
  assert.equal(validNonce('curto'), false);
  assert.equal(validNonce('com espaço no meio aqui'), false);
  assert.equal(validNonce('x'.repeat(81)), false);
  assert.equal(validNonce(null), false);
});

test('idempotência: o mesmo (usuário, nonce) devolve a mensagem já criada', async () => {
  const store = createIdempotencyStore();
  const first = await store.acquire('u1', 'temp-1-aaaaaaaa');
  assert.ok(first.claim);
  first.claim.commit('msg-1');
  const again = await store.acquire('u1', 'temp-1-aaaaaaaa');
  assert.equal(again.existingId, 'msg-1');
  assert.equal(await store.lookup('u1', 'temp-1-aaaaaaaa'), 'msg-1');
  // Outra pessoa com o mesmo nonce não colide.
  const other = await store.acquire('u2', 'temp-1-aaaaaaaa');
  assert.ok(other.claim);
  assert.equal(other.existingId, undefined);
});

test('idempotência: requisição igual em andamento espera a primeira', async () => {
  const store = createIdempotencyStore();
  const a = await store.acquire('u1', 'temp-2-bbbbbbbb');
  const pending = store.acquire('u1', 'temp-2-bbbbbbbb');
  a.claim.commit('msg-2');
  assert.equal((await pending).existingId, 'msg-2');
});

test('idempotência: falha libera o nonce pra nova tentativa', async () => {
  const store = createIdempotencyStore();
  const a = await store.acquire('u1', 'temp-3-cccccccc');
  const waiting = store.acquire('u1', 'temp-3-cccccccc');
  a.claim.release();
  const b = await waiting;
  assert.ok(b.claim, 'a segunda vira a dona da tentativa');
  assert.equal(b.existingId, undefined);
});

test('idempotência: expira depois da janela e respeita o teto de memória', async () => {
  let now = 1000;
  const store = createIdempotencyStore({ windowMs: 100, maxEntries: 3, now: () => now });
  (await store.acquire('u1', 'temp-4-dddddddd')).claim.commit('m4');
  now += 200;
  const later = await store.acquire('u1', 'temp-4-dddddddd');
  assert.ok(later.claim, 'depois da janela pode criar de novo');
  later.claim.release();
  for (let i = 0; i < 10; i += 1) (await store.acquire('u1', `temp-5-eeeeeee${i}`)).claim.commit(`m${i}`);
  assert.ok(store.size() <= 3);
});

test('idempotência: usa o reforço remoto (Redis) quando a memória não tem', async () => {
  const kv = new Map([['idem:msg:u1:temp-6-ffffffff', 'msg-remota']]);
  const remote = { get: async (k) => kv.get(k) || null, set: async (k, v) => { kv.set(k, v); } };
  const store = createIdempotencyStore({ remote });
  assert.equal((await store.acquire('u1', 'temp-6-ffffffff')).existingId, 'msg-remota');
  const fresh = await store.acquire('u1', 'temp-7-gggggggg');
  fresh.claim.commit('nova');
  await new Promise((r) => setImmediate(r));
  assert.equal(kv.get('idem:msg:u1:temp-7-gggggggg'), 'nova');
});

test('idempotência: sem nonce o envio segue normal (sem dedupe)', async () => {
  const store = createIdempotencyStore();
  assert.deepEqual(await store.acquire('u1', undefined), { claim: null });
  assert.equal(await store.lookup('u1', ''), null);
});

test('busca: in:/em: aceita #nome, nome entre aspas e token <#id>', () => {
  assert.equal(parseSearchQuery('oi in:#geral').in, 'geral');
  assert.equal(parseSearchQuery('em:#bate-papo oi').in, 'bate-papo');
  assert.equal(parseSearchQuery('em:"bate papo"').in, 'bate papo');
  assert.equal(parseSearchQuery('in:<#abc123>').in, '<#abc123>');
  assert.equal(parseSearchQuery('em:#geral oi').text, 'oi');
});

test('busca: resolveChannelFilter só escolhe entre os canais visíveis', () => {
  const visible = [
    { id: 'c1', name: 'geral' },
    { id: 'c2', name: 'Bate Papo' },
    { id: 'c3', name: 'memes-e-humor' },
    { id: 'c4', name: 'Anúncios' },
  ];
  assert.equal(resolveChannelFilter('geral', visible), 'c1');
  assert.equal(resolveChannelFilter('bate-papo', visible), 'c2');
  assert.equal(resolveChannelFilter('anuncios', visible), 'c4');
  assert.equal(resolveChannelFilter('meme', visible), 'c3');
  assert.equal(resolveChannelFilter('humor', visible), 'c3');
  assert.equal(resolveChannelFilter('<#c2>', visible), 'c2');
  // Canal privado (fora da lista visível) nunca é escolhido, nem pelo id.
  assert.equal(resolveChannelFilter('staff-secreto', visible), null);
  assert.equal(resolveChannelFilter('<#c9>', visible), null);
  assert.equal(resolveChannelFilter('', visible), null);
  assert.equal(resolveChannelFilter('geral', []), null);
  // Exato vence "começa com".
  assert.equal(resolveChannelFilter('geral', [{ id: 'x', name: 'geral-2' }, { id: 'y', name: 'Geral' }]), 'y');
  assert.equal(normChannelName('#Bate_Papo Á'), 'bate-papo-a');
});
