'use strict';
// Project Club Dev → GitHub. Tudo pela API REST do GitHub (sem git no
// servidor): ler a árvore e os arquivos, gravar um commit na branch de
// testes de cada admin (dev/<usuário>), abrir a "atualização" (Pull Request)
// pros donos e, quando um dono aprova, juntar na main (o deploy da main já
// publica o site). Nada vai pro banco: a atualização É o Pull Request.
const { getConfig } = require('../integrationConfig');

const API = 'https://api.github.com';
const LABEL = 'pc-dev';
const MAX_FILE = 1_500_000; // editor: até ~1,5 MB por arquivo

let fetchImpl = (...a) => fetch(...a);
function _setFetch(fn) { fetchImpl = fn; }

async function settings() {
  let cfg = {};
  try { cfg = await getConfig('pcDev', {}); } catch { /* sem banco: só variáveis de ambiente */ }
  return {
    token: cfg.githubToken || process.env.PC_DEV_GITHUB_TOKEN || '',
    repo: cfg.repo || process.env.PC_DEV_REPO || 'RiqueBitt/ProjectClub',
    base: cfg.baseBranch || 'main',
  };
}

class GitHubError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function gh(path, { method = 'GET', body, raw = false } = {}) {
  const s = await settings();
  if (!s.token) throw new GitHubError(412, 'O Project Club Dev ainda não tem a chave do GitHub (Configurações do Dev).');
  const url = path.startsWith('http') ? path : `${API}/repos/${s.repo}${path}`;
  const res = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${s.token}`,
      Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ProjectClub-Dev',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && data.message) || `GitHub respondeu ${res.status}`;
    throw new GitHubError(res.status === 401 ? 412 : res.status, res.status === 401 ? 'A chave do GitHub não vale mais (troque nas Configurações do Dev).' : msg);
  }
  return data;
}

const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'admin';
const branchFor = (user) => `dev/${slug(user.username || user.id)}`;
const enc = (p) => String(p).split('/').map(encodeURIComponent).join('/');

/** Caminho seguro dentro do repositório (sem "..", sem barra no começo). */
function cleanPath(p) {
  const s = String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!s || s.length > 400 || s.split('/').some((x) => x === '..' || x === '.' || x === '' || x === '.git')) {
    throw new GitHubError(400, 'Caminho de arquivo inválido.');
  }
  return s;
}

async function refSha(branch) {
  try {
    const r = await gh(`/git/ref/heads/${enc(branch)}`);
    return r.object.sha;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/** Branch do admin: cria a partir da main se ainda não existe. */
async function ensureBranch(branch) {
  const have = await refSha(branch);
  if (have) return have;
  const { base } = await settings();
  const sha = await refSha(base);
  if (!sha) throw new GitHubError(404, `Branch ${base} não encontrada.`);
  await gh('/git/refs', { method: 'POST', body: { ref: `refs/heads/${branch}`, sha } });
  return sha;
}

const SKIP = /(^|\/)(node_modules|\.git|dist|build|\.gradle|\.idea|coverage)(\/|$)/;

/** Árvore de arquivos (de uma branch; a do admin se existir, senão a main). */
async function tree(branch) {
  const { base } = await settings();
  const ref = (await refSha(branch)) ? branch : base;
  const t = await gh(`/git/trees/${enc(ref)}?recursive=1`);
  const files = (t.tree || [])
    .filter((e) => e.type === 'blob' && !SKIP.test(e.path))
    .map((e) => ({ path: e.path, size: e.size || 0, sha: e.sha }));
  return { ref, truncated: !!t.truncated, files };
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

async function readFile(path, branch) {
  const p = cleanPath(path);
  const { base } = await settings();
  const ref = (await refSha(branch)) ? branch : base;
  const meta = await gh(`/contents/${enc(p)}?ref=${encodeURIComponent(ref)}`);
  if (Array.isArray(meta) || meta.type !== 'file') throw new GitHubError(400, 'Isso é uma pasta, não um arquivo.');
  if (meta.size > MAX_FILE) return { path: p, ref, sha: meta.sha, size: meta.size, tooBig: true, binary: false, content: '' };
  let buf;
  if (meta.content) buf = Buffer.from(meta.content, 'base64');
  else {
    const blob = await gh(`/git/blobs/${meta.sha}`);
    buf = Buffer.from(blob.content || '', 'base64');
  }
  const binary = looksBinary(buf);
  return { path: p, ref, sha: meta.sha, size: meta.size, binary, tooBig: false, content: binary ? '' : buf.toString('utf8') };
}

/**
 * Um commit com vários arquivos na branch do admin.
 * files: [{ path, content }] (content null = apagar o arquivo).
 */
async function commitFiles(user, files, message) {
  if (!Array.isArray(files) || files.length === 0) throw new GitHubError(400, 'Nada pra salvar.');
  if (files.length > 100) throw new GitHubError(400, 'No máximo 100 arquivos por vez.');
  const branch = branchFor(user);
  const head = await ensureBranch(branch);
  const headCommit = await gh(`/git/commits/${head}`);
  const entries = [];
  for (const f of files) {
    const path = cleanPath(f.path);
    if (f.content === null || f.content === undefined) {
      entries.push({ path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const content = String(f.content);
    if (Buffer.byteLength(content) > MAX_FILE) throw new GitHubError(413, `${path} passou de 1,5 MB.`);
    const blob = await gh('/git/blobs', { method: 'POST', body: { content, encoding: 'utf-8' } });
    entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const newTree = await gh('/git/trees', { method: 'POST', body: { base_tree: headCommit.tree.sha, tree: entries } });
  const name = user.displayName || user.username || 'Admin';
  const commit = await gh('/git/commits', {
    method: 'POST',
    body: {
      message: `${String(message || 'Ajustes no Project Club Dev').slice(0, 200)}\n\nFeito no Project Club Dev por ${name} (@${user.username || user.id}).`,
      tree: newTree.sha,
      parents: [head],
      // conta do GitHub ligada ao Project Club: o commit aparece no perfil dela
      author: user.github?.login
        ? { name: user.github.name || user.github.login, email: `${user.github.id}+${user.github.login}@users.noreply.github.com` }
        : { name: `${name} (Project Club Dev)`, email: 'dev@projectclub.shardweb.app' },
    },
  });
  await gh(`/git/refs/heads/${enc(branch)}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
  return { branch, sha: commit.sha, url: commit.html_url };
}

/** Login do GitHub a partir do id numérico (conta ligada no Project Club). */
const ghUsers = new Map();
async function githubUser(id) {
  if (!id) return null;
  if (ghUsers.has(id)) return ghUsers.get(id);
  try {
    const u = await gh(`${API}/user/${encodeURIComponent(id)}`);
    const out = { id: String(u.id), login: u.login, name: u.name || null, avatar: u.avatar_url || null };
    ghUsers.set(id, out);
    return out;
  } catch { return null; }
}

/** O que a branch do admin tem de diferente da main. */
async function changes(user) {
  const branch = branchFor(user);
  if (!(await refSha(branch))) return { branch, exists: false, ahead: 0, behind: 0, files: [] };
  const { base } = await settings();
  const c = await gh(`/compare/${enc(base)}...${enc(branch)}`);
  return {
    branch,
    exists: true,
    ahead: c.ahead_by || 0,
    behind: c.behind_by || 0,
    files: (c.files || []).map((f) => ({ path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions })),
  };
}

const COUNT = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Texto do aviso pros donos: "Admin X criou 2 arquivos, editou …". */
function summary(name, files) {
  const created = files.filter((f) => f.status === 'added');
  const edited = files.filter((f) => f.status === 'modified' || f.status === 'renamed' || f.status === 'changed');
  const removed = files.filter((f) => f.status === 'removed');
  const parts = [];
  if (created.length) parts.push(`criou ${COUNT(created.length, 'arquivo novo', 'arquivos novos')}`);
  if (edited.length) parts.push(`editou ${COUNT(edited.length, 'arquivo', 'arquivos')}`);
  if (removed.length) parts.push(`apagou ${COUNT(removed.length, 'arquivo', 'arquivos')}`);
  return `Admin ${name} ${parts.join(', ') || 'mandou uma atualização'}`;
}

const META = /<!-- pc-dev (\{.*?\}) -->/;

/** Publicar: abre (ou atualiza) a atualização da branch do admin pros donos. */
async function publish(user, { title, description }) {
  const ch = await changes(user);
  if (!ch.exists || ch.ahead === 0) throw new GitHubError(400, 'Não há nada salvo pra publicar — salve primeiro.');
  const { base, repo } = await settings();
  const name = user.displayName || user.username || 'Admin';
  const sum = summary(name, ch.files);
  const list = ch.files.map((f) => `- ${f.status === 'added' ? '🆕' : f.status === 'removed' ? '🗑️' : '✏️'} \`${f.path}\``).join('\n');
  const meta = JSON.stringify({ userId: user.id, name, username: user.username || null, at: new Date().toISOString() });
  const body = `**${sum}.**\n\n${String(description || '').slice(0, 4000) || '_(sem descrição)_'}\n\n### Arquivos\n${list}\n\n<!-- pc-dev ${meta} -->`;
  const t = String(title || '').trim().slice(0, 120) || sum;
  const owner = repo.split('/')[0];
  const open = await gh(`/pulls?state=open&head=${encodeURIComponent(`${owner}:${ch.branch}`)}&base=${encodeURIComponent(base)}`);
  let pr;
  if (Array.isArray(open) && open.length) {
    pr = await gh(`/pulls/${open[0].number}`, { method: 'PATCH', body: { title: t, body } });
  } else {
    pr = await gh('/pulls', { method: 'POST', body: { title: t, head: ch.branch, base, body } });
  }
  try { await gh(`/issues/${pr.number}/labels`, { method: 'POST', body: { labels: [LABEL] } }); } catch { /* sem permissão de label: segue */ }
  return { number: pr.number, title: t, summary: sum, files: ch.files, url: pr.html_url };
}

async function checksOf(sha) {
  try {
    const r = await gh(`/commits/${sha}/check-runs?per_page=50`);
    const runs = r.check_runs || [];
    if (!runs.length) return { state: 'none', runs: [] };
    const failed = runs.some((x) => x.conclusion === 'failure' || x.conclusion === 'timed_out' || x.conclusion === 'cancelled');
    const pending = runs.some((x) => x.status !== 'completed');
    return {
      state: failed ? 'failure' : pending ? 'pending' : 'success',
      runs: runs.map((x) => ({ name: x.name, status: x.status, conclusion: x.conclusion })),
    };
  } catch { return { state: 'unknown', runs: [] }; }
}

function parseMeta(body) {
  const m = META.exec(String(body || ''));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/** Atualizações esperando os donos (Pull Requests do Project Club Dev). */
async function listUpdates({ state = 'open' } = {}) {
  const prs = await gh(`/pulls?state=${state === 'closed' ? 'closed' : 'open'}&per_page=30&sort=updated&direction=desc`);
  const mine = (prs || []).filter((p) => String(p.head?.ref || '').startsWith('dev/') && (parseMeta(p.body) || (p.labels || []).some((l) => l.name === LABEL)));
  return Promise.all(mine.map(async (p) => {
    const files = await gh(`/pulls/${p.number}/files?per_page=100`).catch(() => []);
    const meta = parseMeta(p.body) || {};
    const desc = String(p.body || '').replace(META, '').split('### Arquivos')[0].replace(/^\*\*.*?\*\*\s*/s, '').trim();
    return {
      number: p.number,
      title: p.title,
      summary: summary(meta.name || p.user?.login || 'Admin', (files || []).map((f) => ({ status: f.status }))),
      description: desc,
      author: meta,
      branch: p.head.ref,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      state: p.merged_at ? 'merged' : p.state,
      url: p.html_url,
      files: (files || []).map((f) => ({ path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: String(f.patch || '').slice(0, 20_000) })),
      checks: p.state === 'open' ? await checksOf(p.head.sha) : null,
    };
  }));
}

/** Dono aprovou: junta na main (squash) e apaga a branch de testes. */
async function approve(number, owner) {
  const pr = await gh(`/pulls/${Number(number)}`);
  if (pr.state !== 'open') throw new GitHubError(409, 'Essa atualização já foi fechada.');
  const name = owner.displayName || owner.username || 'Dono';
  const r = await gh(`/pulls/${pr.number}/merge`, {
    method: 'PUT',
    body: { merge_method: 'squash', commit_title: `${pr.title} (#${pr.number})`, commit_message: `Aprovado no Project Club Dev por ${name}.` },
  });
  try { await gh(`/git/refs/heads/${enc(pr.head.ref)}`, { method: 'DELETE' }); } catch { /* ok */ }
  return { merged: !!r?.merged, sha: r?.sha, meta: parseMeta(pr.body) };
}

/** Dono recusou: comenta o motivo e fecha (a branch fica pro admin continuar). */
async function reject(number, owner, reason) {
  const pr = await gh(`/pulls/${Number(number)}`);
  if (pr.state !== 'open') throw new GitHubError(409, 'Essa atualização já foi fechada.');
  const name = owner.displayName || owner.username || 'Dono';
  await gh(`/issues/${pr.number}/comments`, { method: 'POST', body: { body: `❌ Recusado por ${name} no Project Club Dev.${reason ? `\n\n${String(reason).slice(0, 2000)}` : ''}` } });
  await gh(`/pulls/${pr.number}`, { method: 'PATCH', body: { state: 'closed' } });
  return { closed: true, meta: parseMeta(pr.body) };
}

/** Traz o que já entrou na main pra branch do admin (evita conflito). */
async function syncBranch(user) {
  const branch = branchFor(user);
  if (!(await refSha(branch))) return { branch, merged: false };
  const { base } = await settings();
  try {
    const r = await gh('/merges', { method: 'POST', body: { base: branch, head: base, commit_message: `Atualiza ${branch} com a ${base}` } });
    return { branch, merged: !!r };
  } catch (err) {
    if (err.status === 409) throw new GitHubError(409, 'Conflito: alguém mudou os mesmos arquivos na main. Copie suas mudanças, desfaça a branch e salve de novo.');
    throw err;
  }
}

/** Desfaz o que não foi publicado: a branch do admin volta a ser igual à main. */
async function resetBranch(user) {
  const branch = branchFor(user);
  try { await gh(`/git/refs/heads/${enc(branch)}`, { method: 'DELETE' }); } catch (err) { if (err.status !== 404 && err.status !== 422) throw err; }
  return { branch };
}

module.exports = {
  settings, gh, branchFor, cleanPath, tree, readFile, commitFiles, changes, publish, listUpdates, approve, reject,
  resetBranch, syncBranch, githubUser, summary, parseMeta, GitHubError, _setFetch,
};
