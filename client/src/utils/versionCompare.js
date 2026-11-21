// Comparação de versões "vMAJOR.MINOR.PATCH" (formato das tags do workflow
// build-apps.yml). Sem dependências — testada em client/test/versionCompare.test.js.

export function parseVersion(v) {
  const m = String(v || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/i);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// -1 / 0 / 1, ou null quando alguma das duas não é uma versão válida.
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) {
    if (x[i] > y[i]) return 1;
    if (x[i] < y[i]) return -1;
  }
  return 0;
}

// true só quando `remote` é de fato MAIS NOVA que `local` (formato
// desconhecido nunca dispara atualização à toa).
export function isNewer(remote, local) {
  return compareVersions(remote, local) === 1;
}
