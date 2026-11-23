// Compêndio BLACKOUT: o site NÃO fica no repositório do Project Club (que é
// público). O servidor baixa do repositório do BLACKOUT no GitHub — privado —
// com uma chave guardada só nas variáveis do app na Shard Cloud:
//
//   BLACKOUT_GITHUB_TOKEN  chave do GitHub com leitura do repositório
//                          (fine-grained: só esse repo, "Contents: Read-only")
//   BLACKOUT_REPO          dono/repo (padrão MrPinguimBr/blackout)
//   BLACKOUT_REF           branch (padrão: o principal do repo)
//
// Baixa no boot e confere a cada 15 min se teve commit novo (push no BLACKOUT
// = atualiza sozinho aqui). Falhou? Continua servindo a última cópia baixada.
// Quem pode abrir: routes/blackoutSite.js.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const SITE_DIR = process.env.BLACKOUT_SITE_DIR || path.resolve(__dirname, '../../data/blackout-site');
const CHECK_MS = 15 * 60 * 1000;
const repo = () => (process.env.BLACKOUT_REPO || 'MrPinguimBr/blackout').trim();
const ref = () => (process.env.BLACKOUT_REF || '').trim();

let status = { sha: null, at: null, error: null, syncing: false };
let timer = null;

function headers() {
  const h = { 'User-Agent': 'ProjectClub-blackout-sync', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const token = (process.env.BLACKOUT_GITHUB_TOKEN || '').trim();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function readLocalSha() {
  try { return fs.readFileSync(path.join(SITE_DIR, '.pc-sha'), 'utf8').trim() || null; } catch { return null; }
}

function hasSite() {
  try { return fs.statSync(path.join(SITE_DIR, 'index.html')).isFile(); } catch { return false; }
}

const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: 120_000 }, (err, _o, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve()));
});

async function latestSha() {
  const r = await fetch(`https://api.github.com/repos/${repo()}/commits/${encodeURIComponent(ref() || 'HEAD')}`, { headers: headers() });
  if (r.status === 404 || r.status === 401 || r.status === 403) {
    throw new Error(`GitHub respondeu ${r.status}: confira BLACKOUT_GITHUB_TOKEN (chave válida, com leitura do repo) e BLACKOUT_REPO${r.status === 403 ? ' — ou limite da API do GitHub' : ''}`);
  }
  if (!r.ok) throw new Error(`GitHub respondeu ${r.status}`);
  return (await r.json()).sha;
}

async function download(sha) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blackout-'));
  try {
    const r = await fetch(`https://api.github.com/repos/${repo()}/tarball/${sha}`, { headers: headers(), redirect: 'follow' });
    if (!r.ok) throw new Error(`download falhou (${r.status})`);
    const file = path.join(tmp, 'site.tar.gz');
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    const out = path.join(tmp, 'site');
    fs.mkdirSync(out);
    await run('tar', ['xzf', file, '-C', out, '--strip-components=1', '--no-same-owner', '--no-same-permissions']);
    if (!fs.existsSync(path.join(out, 'index.html'))) throw new Error('o repositório não tem index.html na raiz');
    fs.rmSync(path.join(out, '.git'), { recursive: true, force: true });
    fs.writeFileSync(path.join(out, '.pc-sha'), sha);
    // Troca de uma vez (quem estiver com o site aberto não pega meio-copiado).
    fs.mkdirSync(path.dirname(SITE_DIR), { recursive: true });
    const old = `${SITE_DIR}.old-${Date.now()}`;
    if (fs.existsSync(SITE_DIR)) fs.renameSync(SITE_DIR, old);
    try { fs.renameSync(out, SITE_DIR); } catch {
      fs.cpSync(out, SITE_DIR, { recursive: true });
    }
    fs.rmSync(old, { recursive: true, force: true });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function sync() {
  if (status.syncing) return status;
  status.syncing = true;
  try {
    const sha = await latestSha();
    if (sha !== readLocalSha() || !hasSite()) {
      await download(sha);
      console.log(`[blackout] compêndio atualizado (${repo()}@${sha.slice(0, 7)})`);
    }
    status = { sha, at: new Date().toISOString(), error: null, syncing: false };
  } catch (err) {
    status = { sha: readLocalSha(), at: new Date().toISOString(), error: err.message, syncing: false };
    console.warn(`[blackout] não deu pra baixar o compêndio: ${err.message}${hasSite() ? ' (servindo a cópia anterior)' : ''}`);
  }
  return status;
}

function start() {
  if (process.env.BLACKOUT_SYNC === '0' || timer) return;
  sync();
  timer = setInterval(sync, CHECK_MS);
  timer.unref?.();
}

module.exports = { SITE_DIR, start, sync, hasSite, getStatus: () => ({ ...status, repo: repo(), hasSite: hasSite(), hasToken: !!(process.env.BLACKOUT_GITHUB_TOKEN || '').trim() }) };
