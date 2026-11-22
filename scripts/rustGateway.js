/* Rust na frente do Node (só módulos nativos do Node).
 *
 * O servidor em Rust (rust/pc-server, binário em rust/bin/pc-server — o CI
 * compila e manda junto no branch `deploy`) fica na porta pública do app e
 * responde as rotas que já foram portadas; o resto ele repassa pro Node, que
 * passa a escutar numa porta interna (127.0.0.1). O site e os apps não
 * percebem diferença. Ver rust/PLANO.md.
 *
 * Quem liga tudo é o scripts/deploy.js; aqui ficam as decisões e o "vigia":
 *
 *  - usar ou não o Rust (`plan`): precisa do binário, de Linux x64 e de
 *    ninguém ter desligado. Pra desligar na hora: variável `PC_RUST=0` ou um
 *    arquivo vazio `.pc-rust-off` na raiz do app, e reiniciar o app.
 *  - se o Rust cair, sobe de novo sozinho; se cair 3 vezes em 2 minutos (ou
 *    travar), o deploy.js desiste dele e volta o Node pra porta pública —
 *    o site nunca fica fora do ar por causa do Rust. Na próxima publicação
 *    ele tenta de novo.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const BIN_REL = path.join('rust', 'bin', 'pc-server');
const OFF_FILE = '.pc-rust-off';
const SHA_FILE = '.deployed-sha';
const DEFAULT_NODE_PORT = 3001;
const MAX_CRASHES = 3;
const CRASH_WINDOW_MS = 2 * 60 * 1000;
const WATCH_EVERY_MS = 15 * 1000;
const WATCH_TIMEOUT_MS = 5 * 1000;
const WATCH_MAX_FAILS = 4;
const STOP_GRACE_MS = 5 * 1000;

const isNo = (v) => ['0', 'off', 'false', 'no', 'nao', 'não'].includes(String(v ?? '').trim().toLowerCase());

function deployedSha(root, { readFile = fs.readFileSync } = {}) {
  try { return String(readFile(path.join(root, SHA_FILE), 'utf8')).trim() || null; } catch { return null; }
}

// Porta interna do Node: PC_NODE_PORT ou 3001 (nunca a mesma da pública).
function internalPort(env, publicPort) {
  const n = parseInt(env.PC_NODE_PORT || '', 10);
  let port = Number.isFinite(n) && n > 0 && n < 65536 ? n : DEFAULT_NODE_PORT;
  if (port === publicPort) port = publicPort === 65535 ? publicPort - 1 : publicPort + 1;
  return port;
}

/**
 * Decide se o Rust vai na frente. Devolve
 * { useRust, reason, bin, publicPort, nodePort }.
 * gaveUpSha: versão (SHA) em que o Rust foi desligado por cair demais —
 * enquanto a versão no ar for a mesma, não tenta de novo.
 */
function plan({
  env = process.env, root, publicPort, gaveUpSha, platform = process.platform, arch = process.arch,
  exists = fs.existsSync, readFile = fs.readFileSync,
} = {}) {
  const bin = path.join(root, BIN_REL);
  const out = { useRust: false, reason: '', bin, publicPort: publicPort || null, nodePort: null };
  const no = (reason) => ({ ...out, reason });
  if (isNo(env.PC_RUST)) return no('desligado pela variável PC_RUST');
  if (exists(path.join(root, OFF_FILE))) return no(`desligado pelo arquivo ${OFF_FILE}`);
  if (platform !== 'linux' || arch !== 'x64') return no(`o binário é só pra Linux x64 (aqui: ${platform} ${arch})`);
  if (!publicPort) return no('não achei a porta do app');
  if (!exists(bin)) return no('sem o binário em rust/bin/pc-server');
  if (gaveUpSha !== undefined && gaveUpSha === deployedSha(root, { readFile })) return no('caiu demais nesta versão — volta na próxima publicação');
  return { ...out, useRust: true, reason: 'ok', nodePort: internalPort(env, publicPort) };
}

// Confere o binário com o .sha256 que veio junto (download cortado, disco
// cheio...). Sem o .sha256, só confere que não está vazio.
function verifyBinary(bin, { readFile = fs.readFileSync, stat = fs.statSync, chmod = fs.chmodSync } = {}) {
  let size = 0;
  try { size = stat(bin).size; } catch { return { ok: false, reason: 'não consegui ler o binário' }; }
  if (size < 1024 * 1024) return { ok: false, reason: `binário pequeno demais (${size} bytes)` };
  let want = null;
  try { want = String(readFile(`${bin}.sha256`, 'utf8')).trim().split(/\s+/)[0].toLowerCase(); } catch { /* sem .sha256 */ }
  if (want) {
    const got = crypto.createHash('sha256').update(readFile(bin)).digest('hex');
    if (got !== want) return { ok: false, reason: 'o binário não confere com o .sha256' };
  }
  try { chmod(bin, 0o755); } catch { /* já é executável ou sem permissão pra mudar */ }
  return { ok: true, reason: 'ok' };
}

// KEY=valor do server/.env (o Node lê esse arquivo sozinho; o Rust só vê
// variáveis de ambiente, então o que estiver só no arquivo vai junto).
function parseDotenv(text = '') {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    const q = v[0];
    if ((q === '"' || q === "'") && v.lastIndexOf(q) > 0) v = v.slice(1, v.lastIndexOf(q));
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

// Ambiente do Node quando o Rust está na frente: porta interna, só local.
function nodeEnv(env, p) {
  return { ...env, PORT: String(p.nodePort), PC_LISTEN_HOST: '127.0.0.1', PC_BEHIND_RUST: '1' };
}

// Ambiente do Rust: o mesmo do app (+ o que só existe no server/.env), na
// porta pública, sabendo onde o Node ficou.
function rustEnv(env, p, dotenvText = '') {
  return { ...parseDotenv(dotenvText), ...env, PORT: String(p.publicPort), PC_NODE_UPSTREAM: `http://127.0.0.1:${p.nodePort}` };
}

// GET simples em 127.0.0.1 — resolve com o status (ou null se não respondeu).
function probe(port, urlPath, { timeoutMs = WATCH_TIMEOUT_MS, request = http.request } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const end = (v) => { if (!done) { done = true; resolve(v); } };
    let req;
    try {
      req = request({ host: '127.0.0.1', port, path: urlPath, method: 'GET', timeout: timeoutMs, headers: { connection: 'close' } }, (res) => {
        res.resume();
        end(res.statusCode || null);
      });
    } catch { end(null); return; }
    req.on('timeout', () => { req.destroy(); end(null); });
    req.on('error', () => end(null));
    req.end();
  });
}

// Espera o Node responder /api/health na porta interna. `alive()` falso
// (o Node saiu) para de esperar. Devolve true se respondeu 200.
async function waitForHealth(port, {
  timeoutMs = 180 * 1000, intervalMs = 500, urlPath = '/api/health', alive = () => true, probeImpl = probe,
  sleep = (ms) => new Promise((r) => { setTimeout(r, ms); }), now = Date.now,
} = {}) {
  const until = now() + timeoutMs;
  while (alive() && now() < until) {
    // eslint-disable-next-line no-await-in-loop
    if ((await probeImpl(port, urlPath, { timeoutMs: 3000 })) === 200) return true;
    // eslint-disable-next-line no-await-in-loop
    await sleep(intervalMs);
  }
  return false;
}

/**
 * Sobe o Rust e cuida dele: caiu → sobe de novo; caiu demais (ou travou
 * demais) → chama onGiveUp() uma vez e para. `stop()` encerra com calma
 * (SIGTERM, e SIGKILL se demorar).
 */
function superviseRust({
  plan: p, env, cwd, log = console.log, spawnImpl = spawn, onGiveUp = () => {},
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, setRepeat = setInterval, clearRepeat = clearInterval,
  probeImpl = probe, watch = true,
} = {}) {
  let child = null;
  let stopped = false;
  let gaveUp = false;
  let restartTimer = null;
  let watchTimer = null;
  let fails = 0;
  const crashes = [];
  const stopWaiters = [];

  const start = () => {
    if (stopped || gaveUp) return;
    log(`[rust] subindo na porta ${p.publicPort} (Node na ${p.nodePort})`);
    const c = spawnImpl(p.bin, [], { stdio: 'inherit', cwd, env });
    child = c;
    fails = 0;
    c.on('error', (err) => { log(`[rust] não iniciou: ${err.message}`); onExit(c, 127, null); });
    c.on('exit', (code, signal) => onExit(c, code, signal));
  };

  function onExit(c, code, signal) {
    if (child !== c) return; // já tratado (error + exit)
    child = null;
    if (stopped) { stopWaiters.splice(0).forEach((f) => f()); return; }
    const t = now();
    crashes.push(t);
    while (crashes.length && t - crashes[0] > CRASH_WINDOW_MS) crashes.shift();
    log(`[rust] saiu (código ${code ?? signal}) — ${crashes.length}ª queda em ${Math.round(CRASH_WINDOW_MS / 60000)} min`);
    if (crashes.length >= MAX_CRASHES) {
      gaveUp = true;
      if (watchTimer) clearRepeat(watchTimer);
      log('[rust] caiu demais: desistindo dele nesta versão');
      onGiveUp();
      return;
    }
    restartTimer = setTimer(start, 300 * 2 ** (crashes.length - 1));
  }

  // Vigia: se o Rust parar de responder (travou), mata — conta como queda.
  async function check() {
    const c = child;
    if (!c || stopped || gaveUp) return;
    const status = await probeImpl(p.publicPort, '/api/system/rust', { timeoutMs: WATCH_TIMEOUT_MS });
    if (child !== c || stopped) return;
    if (status === 200) { fails = 0; return; }
    fails += 1;
    log(`[rust] não respondeu ao vigia (${fails}/${WATCH_MAX_FAILS})`);
    if (fails >= WATCH_MAX_FAILS) { fails = 0; try { c.kill('SIGKILL'); } catch { /* já saiu */ } }
  }

  start();
  if (watch) { watchTimer = setRepeat(check, WATCH_EVERY_MS); watchTimer.unref?.(); }

  function stop(signal = 'SIGTERM') {
    stopped = true;
    if (restartTimer) clearTimer(restartTimer);
    if (watchTimer) clearRepeat(watchTimer);
    const c = child;
    if (!c) return Promise.resolve();
    return new Promise((resolve) => {
      const kill = setTimer(() => { try { c.kill('SIGKILL'); } catch { /* já saiu */ } }, STOP_GRACE_MS);
      stopWaiters.push(() => { clearTimer(kill); resolve(); });
      try { c.kill(signal); } catch { /* já saiu */ }
    });
  }

  return { stop, check, get running() { return !!child; }, get gaveUp() { return gaveUp; } };
}

module.exports = {
  plan, verifyBinary, parseDotenv, nodeEnv, rustEnv, probe, waitForHealth, superviseRust, internalPort, deployedSha,
  BIN_REL, OFF_FILE, MAX_CRASHES, CRASH_WINDOW_MS, WATCH_MAX_FAILS,
};
