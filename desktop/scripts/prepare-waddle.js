#!/usr/bin/env node
// Monta desktop/vendor/waddle/ — o Club Penguin (Waddle Forever) que vai
// embutido no app de computador pro modo offline (ver ../pracaOffline.js).
// Roda sozinho antes de `npm run build:win` / `build:linux` (prebuild).
//
//   vendor/waddle/dist/                  server/waddle/dist (compilado, commitado)
//   vendor/waddle/dist/server/i18n/pt-BR traduções (ficam em src/ no repo)
//   vendor/waddle/media-manifest.json    lista dos arquivos de mídia
//   vendor/waddle/node_modules/          express, ws, dotenv (o que o dist pede)
//
// A pasta inteira entra no instalador como extraResources → resources/waddle.
// A mídia (1,7 GB) NÃO vai no instalador: o app baixa da release waddle-media
// do GitHub na primeira vez que a Praça offline abre.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const src = path.join(root, 'server', 'waddle');
const out = path.join(__dirname, '..', 'vendor', 'waddle');

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, force: true });
}

if (!fs.existsSync(path.join(src, 'dist', 'server', 'boot.js'))) {
  console.error('server/waddle/dist não existe — rode `npm run waddle:build` em server/ e commite o dist.');
  process.exit(1);
}
fs.rmSync(out, { recursive: true, force: true });
copy(path.join(src, 'dist'), path.join(out, 'dist'));
copy(path.join(src, 'media-manifest.json'), path.join(out, 'media-manifest.json'));
copy(path.join(src, 'src', 'server', 'i18n', 'pt-BR'), path.join(out, 'dist', 'server', 'i18n', 'pt-BR'));
copy(path.join(src, 'LICENSE'), path.join(out, 'LICENSE'));

// Versões iguais às do servidor (server/package.json), pra rodar o mesmo código.
const serverPkg = JSON.parse(fs.readFileSync(path.join(root, 'server', 'package.json'), 'utf8'));
const want = ['express', 'ws', 'dotenv'].map((n) => `${n}@${serverPkg.dependencies[n] || 'latest'}`);
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ name: 'projectclub-waddle-embedded', private: true, version: '1.0.0' }, null, 2));
execSync(`npm install --omit=dev --no-audit --no-fund --no-package-lock ${want.join(' ')}`, { cwd: out, stdio: 'inherit' });
console.log(`[prepare-waddle] pronto em ${out}`);
