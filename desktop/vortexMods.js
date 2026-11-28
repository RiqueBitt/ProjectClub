// Mods instalados pelo Vortex (só leitura).
//
// O Vortex não guarda os mods na pasta do jogo: ele deixa tudo numa pasta
// dele ("staging") e "implanta" no jogo com links. A cada implantação ele
// escreve na pasta do jogo um vortex.deployment.json (ou
// vortex.deployment.<tipo>.json) com a lista de arquivos e o mod de onde
// cada um veio. Aqui a gente só LÊ esses manifestos e a pasta de staging:
// nada é movido, apagado ou ativado — quem cuida desses mods é o Vortex.
const fs = require('fs');
const path = require('path');

const MANIFEST_RE = /^vortex\.deployment(\.[\w-]+)?\.json$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', 'shadercache', 'cache', 'logs', 'screenshots', 'saves']);
const MAX_VISITS = 6000;

// Procura os manifestos na pasta do jogo (até 3 níveis, com limite de pastas visitadas).
function findManifests(root, maxDepth = 3) {
  const out = [];
  if (!root || !fs.existsSync(root)) return out;
  let visits = 0;
  const walk = (dir, depth) => {
    if (visits > MAX_VISITS) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      visits += 1;
      if (e.isFile() && MANIFEST_RE.test(e.name)) out.push(path.join(dir, e.name));
    }
    if (depth >= maxDepth) return;
    for (const e of entries) {
      if (visits > MAX_VISITS) return;
      if (e.isDirectory() && !e.isSymbolicLink?.() && !SKIP_DIRS.has(e.name.toLowerCase())) walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

// "SkyUI-12604-5-2SE-1573229210" → "SkyUI" (nome da pasta que o Vortex cria: nome-id-versão-data).
function prettyName(folder) {
  const s = String(folder || '').trim();
  const m = s.match(/^(.+?)-\d{2,}-.+$/);
  return (m ? m[1] : s).replace(/[_]+/g, ' ').trim() || s;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; }
}

// Lista os mods do Vortex pra um jogo: os implantados (com quantos arquivos)
// e os que estão só na pasta do Vortex (desativados lá).
function listVortexMods(gameInstallPath) {
  const manifests = findManifests(gameInstallPath);
  const byFolder = new Map();
  const stagingPaths = new Set();
  let gameId = null;
  for (const file of manifests) {
    const data = readJson(file);
    if (!data || !Array.isArray(data.files)) continue;
    if (data.stagingPath) stagingPaths.add(String(data.stagingPath));
    if (data.gameId && !gameId) gameId = String(data.gameId);
    for (const f of data.files) {
      const src = f && typeof f.source === 'string' ? f.source : null;
      if (!src) continue;
      const cur = byFolder.get(src) || { folder: src, name: prettyName(src), files: 0, deployed: true };
      cur.files += 1;
      byFolder.set(src, cur);
    }
  }
  for (const sp of stagingPaths) {
    let entries = [];
    try { entries = fs.readdirSync(sp, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('__') || e.name.startsWith('.')) continue;
      if (!byFolder.has(e.name)) byFolder.set(e.name, { folder: e.name, name: prettyName(e.name), files: 0, deployed: false });
    }
  }
  const mods = [...byFolder.values()].sort((a, b) => (a.deployed === b.deployed ? a.name.localeCompare(b.name, 'pt-BR') : a.deployed ? -1 : 1));
  return { found: manifests.length > 0, gameId, stagingPath: [...stagingPaths][0] || null, mods };
}

module.exports = { listVortexMods, findManifests, prettyName, MANIFEST_RE };
