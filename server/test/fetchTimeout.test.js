const test = require('node:test');
const assert = require('node:assert');
const { withDefaultTimeout } = require('../src/config/fetchTimeout');

test('fetch sem prazo próprio: desiste quando o outro lado não responde', async () => {
  const hung = (_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
  const f = withDefaultTimeout(hung, 30);
  await assert.rejects(f('https://exemplo.invalid/'), (err) => err.name === 'TimeoutError');
});

test('fetch com signal próprio: usa o de quem chamou, sem trocar', async () => {
  const mine = new AbortController();
  let got;
  const f = withDefaultTimeout(async (_i, init) => { got = init.signal; return 'ok'; }, 30);
  assert.equal(await f('https://exemplo.invalid/', { signal: mine.signal }), 'ok');
  assert.equal(got, mine.signal);
});

test('fetch que responde a tempo: devolve a resposta e não aborta depois', async () => {
  let signal;
  const f = withDefaultTimeout(async (_i, init) => { signal = init.signal; return { ok: true }; }, 30);
  const res = await f('https://exemplo.invalid/', { headers: { a: '1' } });
  assert.deepEqual(res, { ok: true });
  await new Promise((r) => { setTimeout(r, 60); });
  assert.equal(signal.aborted, false);
});

test('fetch: embrulhar duas vezes não empilha prazos', () => {
  const base = async () => 'ok';
  const once = withDefaultTimeout(base, 30);
  assert.equal(withDefaultTimeout(once, 30), once);
});
