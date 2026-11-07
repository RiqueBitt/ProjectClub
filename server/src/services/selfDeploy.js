// Publicação automática sem depender da VPS (item "Publicação automática
// pelo GitHub").
//
// O GitHub Actions (deploy.yml) compila o site, publica o branch `deploy` e
// chama POST /api/system/deploy com o segredo CI_UPDATE_SECRET. O próprio app:
//   1. confere no GitHub que o SHA pedido é MESMO a ponta atual do branch
//      `deploy` (um segredo vazado não consegue fazer voltar versão antiga
//      nem publicar commit de outro lugar);
//   2. roda scripts/self-update.sh (troca as pastas de código atomicamente);
//   3. fecha as conexões com calma e sai com o código 75 — o
//      scripts/deploy.js, que é quem sobe o servidor, vê o 75, instala o que
//      mudou e sobe a versão nova no mesmo container (sem precisar da API da
//      Shard Cloud nem da VPS).
// O vigia da VPS (scripts/deploy-watch.sh) continua como reserva: ele olha
// GET /api/system/deployed antes e não repete o que o app já fez.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..');
const SHA_FILE = path.join(ROOT, '.deployed-sha');
const SCRIPT = path.join(ROOT, 'scripts', 'self-update.sh');
const REPO = 'RiqueBitt/ProjectClub';
const RELOAD_EXIT_CODE = 75;
const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;

const state = { running: false, sha: null, startedAt: null, lastError: null, lastOkAt: null };

function deployedSha() {
  try { return fs.readFileSync(SHA_FILE, 'utf8').trim() || null; } catch { return null; }
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function deployHead({ fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`https://api.github.com/repos/${REPO}/git/ref/heads/deploy`, {
    headers: { 'User-Agent': 'ProjectClub', Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`GitHub respondeu HTTP ${r.status}`);
  const j = await r.json();
  return j?.object?.sha || null;
}

function runScript(sha, { spawnImpl = spawn, timeoutMs = UPDATE_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl('sh', [SCRIPT, sha], { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const keep = (d) => { out = (out + d).slice(-4000); };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* já saiu */ } }, timeoutMs);
    child.on('error', (err) => { clearTimeout(t); reject(err); });
    child.on('exit', (code) => {
      clearTimeout(t);
      if (code === 0 && out.includes(`DEPLOY-OK ${sha}`)) resolve(out);
      else reject(new Error(`self-update saiu com ${code}: ${out.slice(-600)}`));
    });
  });
}

/**
 * Começa a atualização (não espera terminar). Devolve { status, body }.
 * `reload` é chamado no fim com sucesso (padrão: pede ao index.js para
 * fechar com calma e sair com 75).
 */
async function requestDeploy(sha, {
  fetchImpl = fetch, spawnImpl = spawn, reload = () => process.emit('pc:self-reload', RELOAD_EXIT_CODE),
  log = (m) => console.log(m),
} = {}) {
  const want = String(sha || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(want)) return { status: 400, body: { error: 'SHA inválido.' } };
  if (deployedSha() === want) return { status: 200, body: { ok: true, already: true, sha: want } };
  if (state.running) return { status: 409, body: { error: 'Já tem uma atualização rodando.', sha: state.sha } };

  let head;
  try { head = await deployHead({ fetchImpl }); } catch (err) {
    return { status: 502, body: { error: `Não consegui conferir o GitHub: ${err.message}` } };
  }
  if (head !== want) return { status: 409, body: { error: 'Esse SHA não é a versão atual do branch deploy.', head } };
  if (state.running) return { status: 409, body: { error: 'Já tem uma atualização rodando.', sha: state.sha } };

  Object.assign(state, { running: true, sha: want, startedAt: new Date().toISOString(), lastError: null });
  log(`[auto-deploy] atualizando para ${want.slice(0, 7)}`);
  runScript(want, { spawnImpl })
    .then(() => {
      state.lastOkAt = new Date().toISOString();
      log(`[auto-deploy] arquivos de ${want.slice(0, 7)} prontos — reiniciando o servidor`);
      setTimeout(() => reload(), 500);
    })
    .catch((err) => {
      state.lastError = String(err?.message || err).slice(0, 1000);
      state.running = false;
      log(`[auto-deploy] falhou: ${state.lastError}`);
      try { require('./errorLog').persistError({ source: 'server', message: `Publicação automática falhou: ${state.lastError}` }); } catch { /* ok */ }
    });
  return { status: 202, body: { ok: true, accepted: true, sha: want } };
}

function status() {
  return { sha: deployedSha(), updating: state.running, target: state.sha, startedAt: state.startedAt, lastError: state.lastError };
}

function _resetForTests() { Object.assign(state, { running: false, sha: null, startedAt: null, lastError: null, lastOkAt: null }); }

module.exports = { requestDeploy, status, safeEqual, deployHead, RELOAD_EXIT_CODE, SHA_FILE, _resetForTests };
