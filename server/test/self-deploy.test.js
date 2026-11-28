// Publicação automática pelo GitHub (services/selfDeploy.js).
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const sd = require('../src/services/selfDeploy');

const SHA = 'a'.repeat(40);
const head = (sha) => async () => ({ ok: true, json: async () => ({ object: { sha } }) });
function fakeSpawn(out, code = 0) {
  return () => {
    const c = new EventEmitter();
    c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => {};
    setImmediate(() => { c.stdout.emit('data', out); c.emit('exit', code); });
    return c;
  };
}

test('segredo: compara em tempo constante e recusa vazio', () => {
  assert.equal(sd.safeEqual('abc', 'abc'), true);
  assert.equal(sd.safeEqual('abc', 'abd'), false);
  assert.equal(sd.safeEqual('', ''), false);
  assert.equal(sd.safeEqual(undefined, 'x'), false);
});

test('recusa SHA inválido e SHA que não é a ponta do branch deploy', async () => {
  sd._resetForTests();
  assert.equal((await sd.requestDeploy('xyz')).status, 400);
  const r = await sd.requestDeploy(SHA, { fetchImpl: head('b'.repeat(40)), spawnImpl: fakeSpawn('') });
  assert.equal(r.status, 409);
});

test('SHA certo: aceita, roda o self-update e pede o reinício', async () => {
  sd._resetForTests();
  let reloaded = false;
  const done = new Promise((resolve) => {
    sd.requestDeploy(SHA, {
      fetchImpl: head(SHA), spawnImpl: fakeSpawn(`DEPLOY-OK ${SHA}\n`), log: () => {},
      reload: () => { reloaded = true; resolve(); },
    }).then((r) => assert.equal(r.status, 202));
  });
  await done;
  assert.equal(reloaded, true);
  assert.equal(sd.status().updating, true); // fica "atualizando" até o processo sair
  const again = await sd.requestDeploy(SHA, { fetchImpl: head(SHA) });
  assert.equal(again.status, 409);
});

test('self-update falhou: não reinicia e guarda o erro', async () => {
  sd._resetForTests();
  let reloaded = false;
  const r = await sd.requestDeploy(SHA, {
    fetchImpl: head(SHA), spawnImpl: fakeSpawn('DEPLOY-FALHOU: sem client/dist', 1), log: () => {},
    reload: () => { reloaded = true; },
  });
  assert.equal(r.status, 202);
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(reloaded, false);
  assert.equal(sd.status().updating, false);
  assert.match(sd.status().lastError, /sem client\/dist/);
});

test('GitHub fora do ar: 502, sem mexer em nada', async () => {
  sd._resetForTests();
  const r = await sd.requestDeploy(SHA, { fetchImpl: async () => { throw new Error('rede'); } });
  assert.equal(r.status, 502);
  assert.equal(sd.status().updating, false);
});
