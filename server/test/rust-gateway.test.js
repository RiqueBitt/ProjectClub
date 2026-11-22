// Rust na frente do Node (scripts/rustGateway.js): quando usar, com que
// portas, e o vigia que sobe de novo / desiste.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const gw = require('../../scripts/rustGateway');

const ROOT = '/app';
const BIN = path.join(ROOT, gw.BIN_REL);
const base = (over = {}) => ({
  env: {}, root: ROOT, publicPort: 80, platform: 'linux', arch: 'x64',
  exists: (p) => p === BIN, readFile: () => { throw new Error('sem arquivo'); }, ...over,
});

test('plano: com o binário, em Linux x64, o Rust vai na porta do app e o Node na interna', () => {
  const p = gw.plan(base());
  assert.deepEqual({ useRust: p.useRust, publicPort: p.publicPort, nodePort: p.nodePort, bin: p.bin }, { useRust: true, publicPort: 80, nodePort: 3001, bin: BIN });
  assert.equal(gw.plan(base({ env: { PC_NODE_PORT: '4100' } })).nodePort, 4100);
  // nunca a mesma porta da pública
  assert.equal(gw.plan(base({ publicPort: 3001 })).nodePort, 3002);
  assert.equal(gw.internalPort({ PC_NODE_PORT: 'abc' }, 80), 3001);
  assert.equal(gw.internalPort({ PC_NODE_PORT: '80' }, 80), 81);
});

test('plano: desliga por variável, por arquivo, sem binário, noutra plataforma e sem porta', () => {
  for (const v of ['0', 'off', 'false', 'NO', ' Off ']) assert.equal(gw.plan(base({ env: { PC_RUST: v } })).useRust, false, v);
  assert.equal(gw.plan(base({ env: { PC_RUST: '1' } })).useRust, true);
  const byFile = gw.plan(base({ exists: (p) => p === BIN || p === path.join(ROOT, gw.OFF_FILE) }));
  assert.equal(byFile.useRust, false);
  assert.match(byFile.reason, /\.pc-rust-off/);
  assert.match(gw.plan(base({ exists: () => false })).reason, /sem o binário/);
  assert.equal(gw.plan(base({ platform: 'win32' })).useRust, false);
  assert.equal(gw.plan(base({ arch: 'arm64' })).useRust, false);
  assert.equal(gw.plan(base({ publicPort: null })).useRust, false);
});

test('plano: depois de cair demais, só volta quando a versão no ar mudar', () => {
  const sha = (v) => () => v;
  assert.equal(gw.plan(base({ gaveUpSha: 'aaa', readFile: sha('aaa\n') })).useRust, false);
  assert.equal(gw.plan(base({ gaveUpSha: 'aaa', readFile: sha('bbb\n') })).useRust, true);
  // sem arquivo de versão dos dois lados (null === null): continua desligado
  assert.equal(gw.plan(base({ gaveUpSha: null })).useRust, false);
  assert.equal(gw.plan(base({ gaveUpSha: undefined })).useRust, true);
});

test('ambiente: Node na porta interna só local; Rust na pública, com o que só existe no .env', () => {
  const p = gw.plan(base());
  const env = { PORT: '80', DATABASE_URL: 'mysql://x', A: 'do-ambiente' };
  assert.deepEqual(gw.nodeEnv(env, p), { ...env, PORT: '3001', PC_LISTEN_HOST: '127.0.0.1', PC_BEHIND_RUST: '1' });
  const r = gw.rustEnv(env, p, 'A=do-arquivo\nB="com espaço" # nota\nexport C=3 # nota\n# D=4\nE=\'x#y\'\n');
  assert.equal(r.PORT, '80');
  assert.equal(r.PC_NODE_UPSTREAM, 'http://127.0.0.1:3001');
  assert.equal(r.A, 'do-ambiente'); // o ambiente ganha do arquivo
  assert.equal(r.B, 'com espaço');
  assert.equal(r.C, '3');
  assert.equal(r.D, undefined);
  assert.equal(r.E, 'x#y');
  assert.equal(env.PORT, '80'); // não mexe no original
});

test('binário: recusa vazio/pequeno e o que não confere com o .sha256', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-rust-'));
  const bin = path.join(dir, 'pc-server');
  try {
    assert.equal(gw.verifyBinary(bin).ok, false);
    fs.writeFileSync(bin, 'x');
    assert.match(gw.verifyBinary(bin).reason, /pequeno/);
    const big = Buffer.alloc(1024 * 1024 + 10, 7);
    fs.writeFileSync(bin, big);
    assert.equal(gw.verifyBinary(bin).ok, true); // sem .sha256: só o tamanho
    fs.writeFileSync(`${bin}.sha256`, `${'0'.repeat(64)}  pc-server\n`);
    assert.match(gw.verifyBinary(bin).reason, /não confere/);
    fs.writeFileSync(`${bin}.sha256`, `${crypto.createHash('sha256').update(big).digest('hex')}  pc-server\n`);
    assert.equal(gw.verifyBinary(bin).ok, true);
    assert.ok(fs.statSync(bin).mode & 0o100, 'ficou executável');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('espera o Node: volta quando responde 200, para se o Node sair e tem prazo', async () => {
  let n = 0;
  const opts = { sleep: async () => {}, intervalMs: 0 };
  assert.equal(await gw.waitForHealth(3001, { ...opts, probeImpl: async () => { n += 1; return n >= 3 ? 200 : null; } }), true);
  assert.equal(n, 3);
  let alive = true; let tries = 0;
  assert.equal(await gw.waitForHealth(3001, { ...opts, alive: () => alive, probeImpl: async () => { tries += 1; if (tries === 2) alive = false; return 503; } }), false);
  assert.equal(tries, 2);
  let t = 0;
  assert.equal(await gw.waitForHealth(3001, { ...opts, timeoutMs: 100, now: () => { t += 40; return t; }, probeImpl: async () => null }), false);
});

test('espera o Node de verdade: um servidor HTTP local', async () => {
  const http = require('node:http');
  const server = http.createServer((req, res) => { res.writeHead(req.url === '/api/health' ? 200 : 404); res.end('{}'); });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const { port } = server.address();
  try {
    assert.equal(await gw.probe(port, '/api/health'), 200);
    assert.equal(await gw.probe(port, '/nada'), 404);
    assert.equal(await gw.waitForHealth(port, { timeoutMs: 2000 }), true);
  } finally { server.close(); }
  assert.equal(await gw.probe(port, '/api/health', { timeoutMs: 500 }), null); // fechado
});

// Processo de mentira + relógio na mão.
function fakeWorld() {
  const spawned = [];
  const timers = [];
  let clock = 1_000_000;
  const spawnImpl = (bin, args, opts) => {
    const c = new EventEmitter();
    c.bin = bin; c.opts = opts; c.killed = [];
    c.kill = (sig) => { c.killed.push(sig); };
    spawned.push(c);
    return c;
  };
  return {
    spawned, timers, spawnImpl,
    opts: (extra = {}) => ({
      plan: { bin: BIN, publicPort: 80, nodePort: 3001 }, env: { X: '1' }, cwd: ROOT, log: () => {}, spawnImpl,
      now: () => clock, setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; }, clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
      setRepeat: () => ({ unref() {} }), clearRepeat: () => {}, ...extra,
    }),
    runTimers() { timers.splice(0).forEach((t) => t.fn()); },
    advance(ms) { clock += ms; },
  };
}

test('vigia: o Rust caiu → sobe de novo; 3 quedas em 2 minutos → desiste uma vez', () => {
  const w = fakeWorld();
  let gaveUp = 0;
  const s = gw.superviseRust(w.opts({ onGiveUp: () => { gaveUp += 1; } }));
  assert.equal(w.spawned.length, 1);
  assert.equal(w.spawned[0].bin, BIN);
  assert.deepEqual(w.spawned[0].opts.env, { X: '1' });
  assert.equal(s.running, true);

  w.spawned[0].emit('exit', 1, null);
  assert.equal(s.running, false);
  assert.equal(w.timers.length, 1);
  assert.equal(w.timers[0].ms, 300);
  w.runTimers();
  assert.equal(w.spawned.length, 2);

  // queda antiga sai da conta: 3 min depois, mais duas quedas ainda não desistem
  w.advance(3 * 60 * 1000);
  w.spawned[1].emit('exit', null, 'SIGSEGV');
  w.runTimers();
  w.spawned[2].emit('exit', 1, null);
  assert.equal(gaveUp, 0);
  assert.equal(w.timers[0].ms, 600);
  w.runTimers();
  assert.equal(w.spawned.length, 4);
  w.spawned[3].emit('exit', 1, null);
  assert.equal(gaveUp, 1);
  assert.equal(s.gaveUp, true);
  assert.equal(w.timers.length, 0); // não agenda mais nada
  assert.equal(w.spawned.length, 4);
});

test('vigia: binário que nem inicia (error + exit) conta uma queda só', () => {
  const w = fakeWorld();
  let gaveUp = 0;
  gw.superviseRust(w.opts({ onGiveUp: () => { gaveUp += 1; } }));
  const c = w.spawned[0];
  c.emit('error', new Error('ENOENT'));
  c.emit('exit', 127, null);
  assert.equal(w.timers.length, 1);
  assert.equal(gaveUp, 0);
});

test('vigia: parar encerra com calma, não sobe de novo e mata se demorar', async () => {
  const w = fakeWorld();
  const s = gw.superviseRust(w.opts());
  const c = w.spawned[0];
  const stopped = s.stop('SIGTERM');
  assert.deepEqual(c.killed, ['SIGTERM']);
  assert.equal(w.timers.length, 1); // o prazo do SIGKILL
  w.timers[0].fn();
  assert.deepEqual(c.killed, ['SIGTERM', 'SIGKILL']);
  c.emit('exit', null, 'SIGKILL');
  await stopped;
  assert.equal(w.spawned.length, 1);
  // parar sem processo rodando resolve na hora
  await s.stop();
});

test('vigia: Rust travado (não responde 4 vezes seguidas) é morto; uma resposta zera a conta', async () => {
  const w = fakeWorld();
  const answers = [null, null, 200, null, 503, null, null];
  const s = gw.superviseRust(w.opts({ probeImpl: async (port, urlPath) => { assert.equal(port, 80); assert.equal(urlPath, '/api/system/rust'); return answers.shift(); } }));
  const c = w.spawned[0];
  for (let i = 0; i < 6; i += 1) await s.check(); // eslint-disable-line no-await-in-loop
  assert.deepEqual(c.killed, []);
  await s.check();
  assert.deepEqual(c.killed, ['SIGKILL']);
});
