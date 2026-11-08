'use strict';
// Project Club Dev: GitHub falso em memória (branch, commit, publicar, aprovar).
const test = require('node:test');
const assert = require('node:assert');

process.env.PC_DEV_GITHUB_TOKEN = 'github_pat_teste_000000000000000000000000';
process.env.PC_DEV_REPO = 'dono/projeto';
const gh = require('../src/services/devStudio/github');
const logRing = require('../src/services/devStudio/logRing');

function fakeGitHub() {
  const refs = { main: 'c1' };
  const commits = { c1: { tree: 't1', parents: [] } };
  const blobs = {};
  const trees = { t1: { 'README.md': 'oi' } };
  const pulls = [];
  let n = 0;
  const calls = [];
  const json = (status, body) => ({ status, ok: status < 400, text: async () => JSON.stringify(body) });
  const fetchFn = async (url, opt = {}) => {
    const u = new URL(url);
    const p = decodeURIComponent(u.pathname.replace('/repos/dono/projeto', ''));
    const body = opt.body ? JSON.parse(opt.body) : null;
    const m = opt.method || 'GET';
    calls.push(`${m} ${p}`);
    let r;
    if (m === 'GET' && (r = p.match(/^\/git\/ref\/heads\/(.+)$/))) return refs[r[1]] ? json(200, { object: { sha: refs[r[1]] } }) : json(404, { message: 'Not Found' });
    if (m === 'POST' && p === '/git/refs') { refs[body.ref.replace('refs/heads/', '')] = body.sha; return json(201, {}); }
    if (m === 'GET' && (r = p.match(/^\/git\/commits\/(.+)$/))) return json(200, { tree: { sha: commits[r[1]].tree } });
    if (m === 'POST' && p === '/git/blobs') { const sha = `b${++n}`; blobs[sha] = body.content; return json(201, { sha }); }
    if (m === 'POST' && p === '/git/trees') {
      const t = { ...trees[body.base_tree] };
      for (const e of body.tree) { if (e.sha === null) delete t[e.path]; else t[e.path] = blobs[e.sha]; }
      const sha = `t${++n}`; trees[sha] = t; return json(201, { sha });
    }
    if (m === 'POST' && p === '/git/commits') { const sha = `c${++n}`; commits[sha] = { tree: body.tree, parents: body.parents, message: body.message }; return json(201, { sha, html_url: `https://x/${sha}` }); }
    if (m === 'PATCH' && (r = p.match(/^\/git\/refs\/heads\/(.+)$/))) { refs[r[1]] = body.sha; return json(200, {}); }
    if (m === 'DELETE' && (r = p.match(/^\/git\/refs\/heads\/(.+)$/))) { delete refs[r[1]]; return { status: 204, ok: true, text: async () => '' }; }
    if (m === 'GET' && (r = p.match(/^\/compare\/main\.\.\.(.+)$/))) {
      const a = trees[commits[refs.main].tree]; const b = trees[commits[refs[r[1]]].tree];
      const files = [];
      for (const k of Object.keys(b)) if (!(k in a)) files.push({ filename: k, status: 'added' }); else if (a[k] !== b[k]) files.push({ filename: k, status: 'modified' });
      for (const k of Object.keys(a)) if (!(k in b)) files.push({ filename: k, status: 'removed' });
      return json(200, { ahead_by: refs[r[1]] === refs.main ? 0 : 1, behind_by: 0, files });
    }
    if (m === 'GET' && p === '/pulls' && u.searchParams.get('head')) return json(200, pulls.filter((x) => x.state === 'open' && `dono:${x.head.ref}` === u.searchParams.get('head')));
    if (m === 'GET' && p === '/pulls') return json(200, pulls.filter((x) => x.state === 'open'));
    if (m === 'POST' && p === '/pulls') { const pr = { number: pulls.length + 1, title: body.title, body: body.body, head: { ref: body.head, sha: refs[body.head] }, state: 'open', labels: [], html_url: 'https://x/pr' }; pulls.push(pr); return json(201, pr); }
    if (m === 'POST' && /^\/issues\/\d+\/labels$/.test(p)) return json(200, []);
    if (m === 'GET' && (r = p.match(/^\/pulls\/(\d+)\/files$/))) return json(200, [{ filename: 'novo.js', status: 'added' }, { filename: 'README.md', status: 'modified' }]);
    if (m === 'GET' && (r = p.match(/^\/commits\/.+\/check-runs$/))) return json(200, { check_runs: [{ name: 'Testes', status: 'completed', conclusion: 'success' }] });
    if (m === 'GET' && (r = p.match(/^\/pulls\/(\d+)$/))) return json(200, pulls[Number(r[1]) - 1]);
    if (m === 'PUT' && (r = p.match(/^\/pulls\/(\d+)\/merge$/))) { const pr = pulls[Number(r[1]) - 1]; pr.state = 'closed'; pr.merged_at = 'agora'; refs.main = refs[pr.head.ref]; return json(200, { merged: true, sha: refs.main }); }
    if (m === 'POST' && /^\/issues\/\d+\/comments$/.test(p)) return json(201, {});
    if (m === 'PATCH' && (r = p.match(/^\/pulls\/(\d+)$/))) { const pr = pulls[Number(r[1]) - 1]; Object.assign(pr, body); return json(200, pr); }
    return json(500, { message: `sem rota: ${m} ${p}` });
  };
  return { fetchFn, refs, trees, commits, pulls, calls };
}

const admin = { id: 'u-admin', username: 'Zé_Dev', displayName: 'Zé' };
const owner = { id: 'u-dono', username: 'dono', displayName: 'Dono' };

test('dev: salvar cria a branch do admin e grava o commit', async () => {
  const f = fakeGitHub();
  gh._setFetch(f.fetchFn);
  assert.strictEqual(gh.branchFor(admin), 'dev/ze_dev');
  const out = await gh.commitFiles(admin, [{ path: 'novo.js', content: 'console.log(1)' }, { path: 'README.md', content: 'oi!' }], 'Teste');
  assert.strictEqual(out.branch, 'dev/ze_dev');
  const t = f.trees[f.commits[f.refs['dev/ze_dev']].tree];
  assert.deepStrictEqual(t, { 'README.md': 'oi!', 'novo.js': 'console.log(1)' });
  assert.strictEqual(f.refs.main, 'c1'); // a main não muda
  assert.match(f.commits[out.sha].message, /Feito no Project Club Dev por Zé/);
});

test('dev: caminhos perigosos são recusados', async () => {
  for (const p of ['../x', 'a/../../b', '.git/config', 'a//b', '']) {
    assert.throws(() => gh.cleanPath(p), /inválido/);
  }
});

test('dev: publicar → atualização com resumo pros donos → aprovar junta na main', async () => {
  const f = fakeGitHub();
  gh._setFetch(f.fetchFn);
  await assert.rejects(gh.publish(admin, { description: 'x' }), /nada salvo/);
  await gh.commitFiles(admin, [{ path: 'novo.js', content: 'a' }, { path: 'README.md', content: 'b' }], 'Teste');
  const pub = await gh.publish(admin, { title: '', description: 'Arrumei o README e criei um arquivo.' });
  assert.strictEqual(pub.summary, 'Admin Zé criou 1 arquivo novo, editou 1 arquivo');
  assert.match(f.pulls[0].body, /Arrumei o README/);
  const list = await gh.listUpdates();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].author.userId, 'u-admin');
  assert.strictEqual(list[0].description, 'Arrumei o README e criei um arquivo.');
  assert.strictEqual(list[0].checks.state, 'success');
  const ok = await gh.approve(1, owner);
  assert.strictEqual(ok.merged, true);
  assert.strictEqual(ok.meta.userId, 'u-admin');
  assert.ok(!f.refs['dev/ze_dev'], 'branch de testes apagada depois de implementar');
  assert.deepStrictEqual(f.trees[f.commits[f.refs.main].tree], { 'README.md': 'b', 'novo.js': 'a' });
});

test('dev: recusar fecha com o motivo', async () => {
  const f = fakeGitHub();
  gh._setFetch(f.fetchFn);
  await gh.commitFiles(admin, [{ path: 'x.txt', content: '1' }], 'x');
  await gh.publish(admin, { description: '' });
  const r = await gh.reject(1, owner, 'Ainda não.');
  assert.strictEqual(r.closed, true);
  assert.strictEqual(f.pulls[0].state, 'closed');
  assert.ok(f.calls.includes('POST /issues/1/comments'));
});

test('dev: logs escondem segredos', () => {
  process.env.TESTE_SECRET_KEY = 'super-segredo-123456';
  assert.strictEqual(logRing._scrub('conectando com super-segredo-123456 ok'), 'conectando com *** ok');
  logRing._push('log', ['linha 1']);
  const { lines } = logRing.since(0);
  assert.ok(lines.some((l) => l.text === 'linha 1'));
});
