'use strict';
// Versão da próxima release dos apps (.github/scripts/next-version.js, usado pelo build-apps.yml).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');
const SCRIPT = path.join(__dirname, '..', '..', '.github', 'scripts', 'next-version.js');
const { nextVersion } = require(SCRIPT);

test('correção, recurso novo e mudança que quebra', () => {
  const base = { lastTag: 'v1.2.3', existing: ['v1.2.3', 'v1.2.2'] };
  assert.strictEqual(nextVersion({ ...base, commits: ['fix: botão', 'Ajuste no menu'] }), 'v1.2.4');
  assert.strictEqual(nextVersion({ ...base, commits: ['fix: botão', 'feat(site): página nova'] }), 'v1.3.0');
  assert.strictEqual(nextVersion({ ...base, commits: ['feat: x', 'feat!: troca o login'] }), 'v2.0.0');
  assert.strictEqual(nextVersion({ ...base, commits: ['refactor: x', 'BREAKING CHANGE: formato novo'] }), 'v2.0.0');
  assert.strictEqual(nextVersion({ ...base, commits: [] }), 'v1.2.4', 'sem commit novo ainda sobe a correção');
});

test('nunca devolve uma versão que já existe', () => {
  // O caso real: a última tag do histórico é a v1.44.40, tem "feat" depois dela, e a v1.45.0 já existe.
  const existing = ['v1.44.39', 'v1.44.40', 'v1.45.0', 'android-nativo', 'waddle-media'];
  const feat = nextVersion({ lastTag: 'v1.44.40', existing, commits: ['feat(site): ficha do Blackout'] });
  assert.strictEqual(feat, 'v1.46.0');
  assert.ok(!existing.includes(feat));
  const fix = nextVersion({ lastTag: 'v1.44.40', existing, commits: ['fix: download'] });
  assert.strictEqual(fix, 'v1.45.1');
  assert.ok(!existing.includes(fix));
});

test('compara número com número (v1.9.0 < v1.10.0) e ignora o que não é versão', () => {
  assert.strictEqual(nextVersion({ lastTag: 'v1.9.0', existing: ['v1.10.0', 'v1.9.12', 'vandroid-nativo', '', 'v2', 'v1.11.0-beta'], commits: ['fix: x'] }), 'v1.10.1');
});

test('primeira versão do repositório', () => {
  assert.strictEqual(nextVersion({ lastTag: '', existing: [], commits: ['primeiro commit'] }), 'v0.0.1');
  assert.strictEqual(nextVersion(), 'v0.0.1');
});

test('pela linha de comando, como o CI chama', () => {
  const out = execFileSync(process.execPath, [SCRIPT], {
    input: 'Merge pull request #1\nfeat(site): novidade\n',
    env: { ...process.env, LAST_TAG: 'v1.44.40', EXISTING: 'v1.44.40\nv1.45.0\nandroid-nativo\n' },
    encoding: 'utf8',
  });
  assert.strictEqual(out, 'v1.46.0\n');
});
