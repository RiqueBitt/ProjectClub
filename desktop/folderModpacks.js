// Modpacks em pasta própria do Project Club (pedido: "Project Club →
// ModManager → GTA 5 → Modpacks → Modpack 1").
//
// Cada modpack é uma pasta de verdade nos dados do Project Club:
//   <dados do app>/ModManager/<Jogo>/Modpacks/<Modpack>/
//     modpack.json   nome, jogo, mods que estão dentro
//     files/...      os arquivos dos mods, no MESMO caminho relativo que
//                    ocupam dentro da pasta do jogo
//     .originais/... arquivo original do jogo que um mod substitui
//                    (só enquanto o modpack está aplicado)
//
// Jogar com um modpack:
//   1. os arquivos de files/ vão pra pasta do jogo (o original que existia
//      no lugar fica guardado em .originais/);
//   2. o jogo abre (Steam, Epic, GOG ou a pessoa abre);
//   3. quando o jogo fecha, os arquivos voltam pro modpack e os originais
//      voltam pro jogo — a pasta do jogo fica limpa de novo.
// Um diário (deploy.json) guarda o que foi aplicado: se o PC desligar ou o
// app fechar com o jogo aberto, na próxima abertura tudo volta pro lugar.
//
// As funções que mexem em disco recebem `rootDir` (testável sem Electron).
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { moveFile, isInside } = require('./modRouter');

const META = 'modpack.json';
const FILES = 'files';
const ORIGINALS = '.originais';
const JOURNAL = 'deploy.json';

// Nome legível de pasta ("GTA 5", "Modpack 1"): só tira o que o Windows não aceita.
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
function safeSegment(name, fallback) {
  let s = String(name || '').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 80).trim();
  if (!s || RESERVED.test(s)) return fallback;
  return s;
}
function gameDir(rootDir, gameName) {
  return path.join(rootDir, safeSegment(gameName, 'Jogo'), 'Modpacks');
}
function packDir(rootDir, gameName, packName) {
  const dir = path.join(gameDir(rootDir, gameName), safeSegment(packName, 'Modpack'));
  if (!isInside(dir, gameDir(rootDir, gameName))) throw new Error('Nome de modpack inválido.');
  return dir;
}
function readJson(f, fb = null) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; }
}
function writeJson(f, data) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, f);
}

function listFiles(dir, base = dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(full, base, out);
    else if (e.isFile()) out.push(path.relative(base, full));
  }
  return out;
}
function dirSize(dir) {
  return listFiles(dir).reduce((a, rel) => { try { return a + fs.statSync(path.join(dir, rel)).size; } catch { return a; } }, 0);
}
function removeEmptyUp(startDir, stopDir) {
  let d = startDir;
  while (d && isInside(d, stopDir) && path.resolve(d) !== path.resolve(stopDir)) {
    try { if (fs.readdirSync(d).length) break; fs.rmdirSync(d); } catch { break; }
    d = path.dirname(d);
  }
}
/** Caminho relativo seguro (sem sair da pasta-base). */
function safeRel(rel, base) {
  const abs = path.resolve(base, rel);
  if (!isInside(abs, base) || path.resolve(abs) === path.resolve(base)) throw new Error(`Caminho inválido no modpack: ${rel}`);
  return abs;
}

// ---------- Listar / criar / apagar ----------

function listPacks(rootDir, gameName, { journal } = {}) {
  const dir = gameDir(rootDir, gameName);
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; }
  return names.map((n) => {
    const pdir = path.join(dir, n);
    const meta = readJson(path.join(pdir, META), {});
    const files = listFiles(path.join(pdir, FILES));
    return {
      id: n, name: meta.name || n, mods: Array.isArray(meta.mods) ? meta.mods : [],
      fileCount: files.length, size: dirSize(path.join(pdir, FILES)), path: pdir,
      createdAt: meta.createdAt || null, updatedAt: meta.updatedAt || null,
      active: !!(journal && journal.packDir && path.resolve(journal.packDir) === path.resolve(pdir)),
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function createPack(rootDir, gameName, packName, extra = {}) {
  const dir = packDir(rootDir, gameName, packName);
  if (fs.existsSync(path.join(dir, META))) throw new Error('Já existe um modpack com esse nome.');
  fs.mkdirSync(path.join(dir, FILES), { recursive: true });
  const now = new Date().toISOString();
  writeJson(path.join(dir, META), { name: String(packName).trim(), game: gameName, mods: [], createdAt: now, updatedAt: now, ...extra });
  return { id: path.basename(dir), path: dir };
}

function deletePack(rootDir, gameName, packId, journal) {
  const dir = packDir(rootDir, gameName, packId);
  if (journal && path.resolve(journal.packDir) === path.resolve(dir)) throw new Error('Esse modpack está aplicado no jogo agora. Feche o jogo primeiro.');
  fs.rmSync(dir, { recursive: true, force: true });
  return { deleted: true };
}

/**
 * Guarda arquivos de mods (que estão na pasta do jogo) dentro do modpack,
 * no mesmo caminho relativo. `files` = caminhos absolutos dentro do jogo.
 * Os arquivos SAEM do jogo (vão pro modpack).
 */
function addFilesToPack(rootDir, gameName, packId, { gameInstallPath, modName, files }) {
  const dir = packDir(rootDir, gameName, packId);
  const meta = readJson(path.join(dir, META));
  if (!meta) throw new Error('Modpack não encontrado.');
  const moved = [];
  for (const abs of files || []) {
    if (!isInside(abs, gameInstallPath)) continue;
    const rel = path.relative(gameInstallPath, abs);
    const dest = safeRel(rel, path.join(dir, FILES));
    if (!fs.existsSync(abs)) continue;
    moveFile(abs, dest);
    moved.push(rel);
  }
  const mods = new Set(meta.mods || []);
  if (modName) mods.add(modName);
  writeJson(path.join(dir, META), { ...meta, mods: [...mods], updatedAt: new Date().toISOString() });
  return { moved };
}

// ---------- Aplicar (jogar) e recolher ----------

function journalPath(rootDir) { return path.join(rootDir, JOURNAL); }
function readJournal(rootDir) { return readJson(journalPath(rootDir)); }

/** Põe os arquivos do modpack na pasta do jogo e grava o diário. */
function deploy(rootDir, { gameName, packId, gameInstallPath, gameKey, launch }) {
  if (readJournal(rootDir)) throw new Error('Já tem um modpack aplicado. Feche o jogo dele primeiro.');
  if (!gameInstallPath || !fs.existsSync(gameInstallPath)) throw new Error('A pasta do jogo não foi encontrada.');
  const dir = packDir(rootDir, gameName, packId);
  const filesDir = path.join(dir, FILES);
  const rels = listFiles(filesDir);
  if (!rels.length) throw new Error('Esse modpack está vazio. Adicione mods nele primeiro.');
  const journal = { gameName, gameKey: gameKey || null, packId, packDir: dir, gameInstallPath, launch: launch || null, startedAt: new Date().toISOString(), files: [], originals: [], dirs: [] };
  writeJson(journalPath(rootDir), journal); // antes de mexer: se cair no meio, a recuperação sabe onde estava
  try {
    for (const rel of rels) {
      const target = safeRel(rel, gameInstallPath);
      if (fs.existsSync(target)) {
        moveFile(target, safeRel(rel, path.join(dir, ORIGINALS)));
        journal.originals.push(rel);
      }
      let d = path.dirname(target);
      while (isInside(d, gameInstallPath) && path.resolve(d) !== path.resolve(gameInstallPath) && !fs.existsSync(d)) { journal.dirs.push(path.relative(gameInstallPath, d)); d = path.dirname(d); }
      moveFile(path.join(filesDir, rel), target);
      journal.files.push(rel);
      writeJson(journalPath(rootDir), journal);
    }
  } catch (err) {
    purge(rootDir); // deu errado no meio: desfaz o que já foi
    throw err;
  }
  removeEmptyUp(filesDir, dir);
  fs.mkdirSync(filesDir, { recursive: true });
  return { deployed: journal.files.length, replaced: journal.originals.length };
}

/** Devolve os arquivos pro modpack e os originais pro jogo. */
function purge(rootDir) {
  const j = readJournal(rootDir);
  if (!j) return { purged: 0 };
  const filesDir = path.join(j.packDir, FILES);
  const origDir = path.join(j.packDir, ORIGINALS);
  let purged = 0;
  for (const rel of j.files || []) {
    const target = path.resolve(j.gameInstallPath, rel);
    if (!isInside(target, j.gameInstallPath)) continue;
    if (fs.existsSync(target)) { moveFile(target, path.resolve(filesDir, rel)); purged += 1; }
    removeEmptyUp(path.dirname(target), j.gameInstallPath);
  }
  for (const rel of j.originals || []) {
    const src = path.resolve(origDir, rel);
    if (fs.existsSync(src)) moveFile(src, path.resolve(j.gameInstallPath, rel));
    removeEmptyUp(path.dirname(src), origDir);
  }
  for (const rel of (j.dirs || []).sort((a, b) => b.length - a.length)) {
    try { const d = path.resolve(j.gameInstallPath, rel); if (fs.readdirSync(d).length === 0) fs.rmdirSync(d); } catch { /* já saiu */ }
  }
  try { if (fs.readdirSync(origDir).length === 0) fs.rmdirSync(origDir); } catch { /* sem originais */ }
  fs.rmSync(journalPath(rootDir), { force: true });
  return { purged, gameName: j.gameName, packId: j.packId };
}

// ---------- Abrir e vigiar o jogo ----------

function execText(cmd, args, timeout = 10000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

/** Tem algum processo rodando de dentro da pasta do jogo? */
async function isGameRunning(gameInstallPath) {
  const dir = path.resolve(gameInstallPath);
  if (process.platform === 'win32') {
    const lit = dir.replace(/'/g, "''");
    const out = await execText('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$d='${lit}\\'; @(Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($d, [StringComparison]::OrdinalIgnoreCase) }).Count`]);
    return Number(out.trim()) > 0;
  }
  let pids = [];
  try { pids = fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p)); } catch { return false; }
  for (const pid of pids) {
    try { if (isInside(fs.readlinkSync(`/proc/${pid}/exe`), dir)) return true; } catch { /* processo de outro usuário */ }
    try { if (fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(dir)) return true; } catch { /* sumiu */ }
  }
  return false;
}

/** Executável principal de um jogo da GOG (goggame-<id>.info → playTasks). */
function gogExecutable(gameInstallPath) {
  let infos = [];
  try { infos = fs.readdirSync(gameInstallPath).filter((f) => /^goggame-\d+\.info$/i.test(f)); } catch { return null; }
  for (const f of infos) {
    const info = readJson(path.join(gameInstallPath, f));
    const task = (info?.playTasks || []).find((t) => t.isPrimary && t.type === 'FileTask') || (info?.playTasks || []).find((t) => t.type === 'FileTask');
    if (task?.path) {
      const exe = path.resolve(gameInstallPath, task.path);
      if (isInside(exe, gameInstallPath) && fs.existsSync(exe)) return { exe, args: task.arguments ? String(task.arguments).split(' ').filter(Boolean) : [], cwd: task.workingDir ? path.resolve(gameInstallPath, task.workingDir) : path.dirname(exe) };
    }
  }
  return null;
}

/**
 * Abre o jogo pela loja certa. `openExternal` = shell.openExternal.
 * Devolve false quando não sabe abrir (a pessoa abre o jogo ela mesma).
 */
async function launchGame({ platform, steamAppId, epicAppName, gameInstallPath }, openExternal) {
  if (platform === 'steam' && steamAppId) { await openExternal(`steam://rungameid/${Number(steamAppId)}`); return true; }
  if (platform === 'epic' && epicAppName) { await openExternal(`com.epicgames.launcher://apps/${encodeURIComponent(epicAppName)}?action=launch&silent=true`); return true; }
  if (platform === 'gog') {
    const g = gogExecutable(gameInstallPath);
    if (g) { spawn(g.exe, g.args, { cwd: g.cwd, detached: true, stdio: 'ignore' }).unref(); return true; }
  }
  return false;
}

/**
 * Vigia o jogo: espera ele abrir (até `waitStartMs`) e, depois que ele
 * fecha, recolhe os mods. `onState` recebe { state: 'waiting'|'running'|'purged' }.
 */
function watch(rootDir, { onState, pollMs = 5000, waitStartMs = 10 * 60 * 1000, isRunning = isGameRunning } = {}) {
  const j = readJournal(rootDir);
  if (!j) return () => {};
  let seen = false;
  let misses = 0;
  let stopped = false;
  const started = Date.now();
  const tick = async () => {
    if (stopped) return;
    const running = await isRunning(j.gameInstallPath).catch(() => false);
    if (running) { if (!seen) onState?.({ state: 'running', ...brief(j) }); seen = true; misses = 0; }
    else if (seen) misses += 1;
    const gaveUp = !seen && Date.now() - started > waitStartMs;
    if ((seen && misses >= 2) || gaveUp) {
      stopped = true;
      const r = purge(rootDir);
      onState?.({ state: 'purged', reason: gaveUp ? 'not-started' : 'closed', ...brief(j), purged: r.purged });
      return;
    }
    setTimeout(tick, pollMs);
  };
  onState?.({ state: 'waiting', ...brief(j) });
  setTimeout(tick, Math.min(pollMs, 3000));
  return () => { stopped = true; };
}
function brief(j) { return { gameName: j.gameName, gameKey: j.gameKey, packId: j.packId }; }

module.exports = {
  listPacks, createPack, deletePack, addFilesToPack, deploy, purge, readJournal, watch,
  isGameRunning, launchGame, gogExecutable, packDir, gameDir,
};
