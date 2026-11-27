'use strict';
// latest.yml é o arquivo que o app instalado lê pra saber se saiu versão nova e de onde baixar.
// Com o instalador pequeno ("nsis-web") ele lista duas coisas: o instalador (.exe) e o pacote do
// app (.7z). O electron-builder grava só o NOME do pacote, e o app iria procurar esse nome em
// .../releases/latest/download/, que só responde enquanto esta versão for a mais nova. Aqui o
// nome vira o endereço completo dentro da release da PRÓPRIA versão, que nunca muda de lugar.
//
// Uso (no CI), com o endereço da release da versão (https://github.com/<dono>/<repo>/releases/download/vN.N.N):
//   node scripts/installer-manifest.js set-package-url <endereço>      antes do build: o instalador baixa o pacote daí
//   node scripts/installer-manifest.js pin <latest.yml> <endereço>     depois do build: o app instalado baixa daí

const INSTALLER_NAME = 'ProjectClub-Setup-Windows.exe';

function assertBaseUrl(baseUrl) {
  if (!/^https?:\/\/[^\s]+[^/\s]$/.test(String(baseUrl || ''))) {
    throw new Error(`Endereço da release inválido (precisa começar com http e não terminar com barra): ${baseUrl}`);
  }
}

// Devolve uma cópia do latest.yml (já lido como objeto) com o pacote apontando pra release da versão.
function pinPackageUrl(manifest, baseUrl) {
  assertBaseUrl(baseUrl);
  const packages = manifest && manifest.packages;
  if (!packages || typeof packages !== 'object' || !Object.keys(packages).length) {
    throw new Error('latest.yml sem a lista de pacotes: o instalador não é do tipo que baixa o app.');
  }
  const pinned = {};
  for (const [arch, info] of Object.entries(packages)) {
    const name = String((info && (info.file || info.path)) || '').split(/[\\/]/).pop();
    if (!/\.7z$/i.test(name)) throw new Error(`Pacote de ${arch} sem nome de arquivo .7z no latest.yml.`);
    pinned[arch] = { ...info, path: `${baseUrl}/${encodeURIComponent(name)}`, file: name };
  }
  return { ...manifest, packages: pinned };
}

// Lista o que estiver errado num latest.yml pronto pra publicar (lista vazia = tudo certo).
function manifestProblems(manifest, { installerName = INSTALLER_NAME } = {}) {
  const problems = [];
  const m = manifest || {};
  if (!/^\d+\.\d+\.\d+/.test(String(m.version || ''))) problems.push('sem versão');
  const first = Array.isArray(m.files) ? m.files[0] : null;
  if (!first || first.url !== installerName) problems.push(`o primeiro arquivo devia ser ${installerName}`);
  if (m.path !== installerName) problems.push(`"path" devia ser ${installerName}`);
  // (O electron-builder não grava o tamanho do instalador neste tipo de latest.yml, só o hash.)
  if (!first || !first.sha512) problems.push('instalador sem hash');
  const pkg = m.packages && m.packages.x64;
  if (!pkg) problems.push('sem o pacote x64');
  else {
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/[^/]+\.7z$/.test(String(pkg.path || ''))) {
      problems.push('o pacote devia ter o endereço completo dentro de uma release com versão');
    }
    if (!pkg.sha512 || !(pkg.size > 0)) problems.push('pacote sem hash ou tamanho');
  }
  return problems;
}

module.exports = { INSTALLER_NAME, pinPackageUrl, manifestProblems };

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const [command, ...args] = process.argv.slice(2);

  if (command === 'set-package-url' && args[0]) {
    assertBaseUrl(args[0]);
    const file = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    pkg.build.nsisWeb = { ...pkg.build.nsisWeb, appPackageUrl: args[0] };
    fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log(`O instalador vai baixar o pacote do app de ${args[0]}`);
  } else if (command === 'pin' && args[0] && args[1]) {
    const yaml = require('js-yaml');
    const pinned = pinPackageUrl(yaml.load(fs.readFileSync(args[0], 'utf8')), args[1]);
    const problems = manifestProblems(pinned);
    if (problems.length) {
      console.error(`latest.yml com problema: ${problems.join('; ')}`);
      process.exit(1);
    }
    fs.writeFileSync(args[0], yaml.dump(pinned, { lineWidth: 8000 }));
    console.log(`latest.yml: versão ${pinned.version}, pacote em ${pinned.packages.x64.path}`);
  } else {
    console.error('Uso: node scripts/installer-manifest.js set-package-url <endereço> | pin <latest.yml> <endereço>');
    process.exit(2);
  }
}
