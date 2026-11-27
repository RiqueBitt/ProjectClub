'use strict';
// Calcula a versão da próxima release dos apps (vMAIOR.MÉDIA.CORREÇÃO).
//
// O tipo do salto vem dos commits desde a última versão: "feat!" ou "BREAKING CHANGE" sobe a
// maior, "feat:" sobe a média, qualquer outra coisa sobe a correção.
//
// A conta parte da MAIOR versão que já existe, não da última tag do histórico. Antes partia da
// última tag: quando já existia uma release com o número calculado (v1.45.0 saiu antes da
// v1.44.40), todo build novo era publicado DENTRO dessa release antiga, que não é a "mais
// recente" do GitHub. Os links de download do site e a atualização automática dos apps leem a
// "mais recente", então ficaram parados numa versão velha enquanto o CI dizia que deu certo.
//
// Uso (no CI):  LAST_TAG=v1.2.3 EXISTING="$(git tag -l)" node next-version.js < assuntos-dos-commits

function parseVersion(tag) {
  const m = String(tag || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// lastTag: última versão no histórico deste commit ("" se nenhuma).
// existing: todas as tags e releases que já existem (o que não for vN.N.N é ignorado).
// commits: assunto de cada commit desde lastTag.
function nextVersion({ lastTag = '', existing = [], commits = [] } = {}) {
  const versions = [lastTag, ...existing].map(parseVersion).filter(Boolean).sort(compareVersions);
  const [major, minor, patch] = versions.length ? versions[versions.length - 1] : [0, 0, 0];
  const subjects = commits.map((c) => String(c || '').trim()).filter(Boolean);
  if (subjects.some((s) => /^feat!|BREAKING CHANGE/i.test(s))) return `v${major + 1}.0.0`;
  if (subjects.some((s) => /^feat(\(|:)/i.test(s))) return `v${major}.${minor + 1}.0`;
  return `v${major}.${minor}.${patch + 1}`;
}

module.exports = { nextVersion, parseVersion };

if (require.main === module) {
  const lines = (text) => String(text || '').split(/\r?\n/);
  const commits = lines(require('fs').readFileSync(0, 'utf8'));
  process.stdout.write(`${nextVersion({ lastTag: process.env.LAST_TAG, existing: lines(process.env.EXISTING), commits })}\n`);
}
