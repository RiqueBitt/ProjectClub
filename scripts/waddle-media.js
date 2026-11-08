#!/usr/bin/env node
/* Mídia da Praça (Club Penguin / Waddle Forever) — manifesto.
 *
 * Os ~26 mil SWFs do jogo (1,7 GB) NÃO ficam no Git: são publicados como
 * assets da release "waddle-media" do repositório pelo workflow
 * .github/workflows/waddle-media.yml, e o servidor baixa/extrai na primeira
 * inicialização. Este script só gera o manifesto (a lista de arquivos) a
 * partir de uma cópia da pasta "media" do Waddle Forever:
 *
 *   node scripts/waddle-media.js manifest /caminho/Waddle-Forever/media
 *
 * Depois commite server/waddle/media-manifest.json e rode o workflow.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'server', 'waddle', 'media-manifest.json');

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function readManifest() {
  const parsed = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'));
  return Array.isArray(parsed) ? parsed : parsed.files;
}

async function cmdManifest(mediaDir) {
  if (!mediaDir || !fs.existsSync(path.join(mediaDir, 'default'))) throw new Error('Passe a pasta "media" do Waddle Forever (precisa ter default/ e clothing/).');
  const files = walk(mediaDir).sort();
  let bytes = 0;
  for (const f of files) bytes += fs.statSync(path.join(mediaDir, f)).size;
  fs.writeFileSync(MANIFEST, JSON.stringify({ generatedAt: new Date().toISOString(), count: files.length, bytes, files }));
  console.log(`manifesto: ${files.length} arquivos, ${(bytes / 1e9).toFixed(2)} GB → ${path.relative(ROOT, MANIFEST)}`);
}

(async () => {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'manifest') await cmdManifest(arg);
  else { console.log('uso: node scripts/waddle-media.js manifest <pasta media do Waddle Forever>'); process.exitCode = 1; }
})().catch((err) => { console.error(err.message || err); process.exit(1); });
