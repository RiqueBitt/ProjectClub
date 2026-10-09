// Motor de instalação "por jogo" — recebe a pasta já extraída de um mod
// (staging), decide pra onde vai CADA arquivo usando o perfil do jogo
// (ver modInstallProfiles.js), move os arquivos e guarda um manifesto
// local (JSON na pasta de dados do Project Club, um por jogo) com a
// lista exata do que cada mod colocou onde. Com isso:
// - Desinstalar apaga só os arquivos DAQUELE mod (nunca a pasta inteira
//   de outro mod ou do jogo) e devolve arquivos originais que ele tinha
//   substituído (backup);
// - Desativar move só esses arquivos pra ".projectclub-disabled" (fora
//   do alcance do jogo/loader) e Ativar devolve cada um pro lugar exato;
// - A varredura (scan) separa "instalado pelo Project Club" de
//   "detectado nos arquivos" (mods que a pessoa já tinha).
// Mods instalados pela lógica antiga (pasta <alvo>/<nome> e
// <alvo>.disabled/<nome>) continuam funcionando — ver bloco "legado".
//
// Sem Electron aqui de propósito (só fs/path), pra dar pra testar com
// `node -e` usando pastas temporárias.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const profiles = require('./modInstallProfiles');

const DISABLED_DIR = '.projectclub-disabled';
const JUNK = /(^|\/)(__MACOSX(\/|$)|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i;
// Leia-me/imagens soltas: não são instalados quando o resto do mod já
// foi encaminhado pra algum lugar (evita "readme.txt" dentro de ~mods).
const DOC_EXTS = new Set(['.txt', '.md', '.pdf', '.url', '.html', '.htm', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.nfo', '.rtf', '.bmp']);

function sanitizeModFolderName(name) {
  return String(name).trim().replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) || 'mod';
}

// ---------- Utilidades de disco ----------
function listFilesRecursive(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) listFilesRecursive(abs, base, out);
    else if (e.isFile()) out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out;
}

function moveFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    // Discos diferentes (temp no C:, jogo no D:) — copia e apaga.
    if (err.code !== 'EXDEV' && err.code !== 'EPERM') throw err;
    fs.copyFileSync(src, dest);
    fs.rmSync(src, { force: true });
  }
}

function removeEmptyDirs(dirs) {
  // mais fundo primeiro
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
    try { if (fs.existsSync(d) && fs.readdirSync(d).length === 0) fs.rmdirSync(d); } catch { /* em uso / não vazia */ }
  }
}

function pruneEmptyUpTo(startDir, stopDir) {
  let d = startDir;
  while (d && d.length > stopDir.length && isInside(d, stopDir)) {
    try {
      if (!fs.existsSync(d) || fs.readdirSync(d).length > 0) break;
      fs.rmdirSync(d);
    } catch { break; }
    d = path.dirname(d);
  }
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function pathSize(p, budget = { files: 4000 }) {
  try {
    const st = fs.statSync(p);
    if (st.isFile()) return st.size;
    let total = 0;
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      if (budget.files-- <= 0) break;
      total += pathSize(path.join(p, e.name), budget);
    }
    return total;
  } catch { return 0; }
}

// ---------- Contexto do jogo ----------
const appIdCache = new Map();
// Quem chama sem steamAppId (código antigo) — descobre pelo
// appmanifest_*.acf da própria biblioteca Steam (installdir = pasta).
function guessSteamAppId(gameInstallPath) {
  if (appIdCache.has(gameInstallPath)) return appIdCache.get(gameInstallPath);
  let found = null;
  try {
    const steamapps = path.dirname(path.dirname(gameInstallPath));
    const folder = path.basename(gameInstallPath).toLowerCase();
    for (const f of fs.readdirSync(steamapps)) {
      if (!/^appmanifest_\d+\.acf$/i.test(f)) continue;
      const text = fs.readFileSync(path.join(steamapps, f), 'utf8');
      const m = text.match(/"installdir"\s+"([^"]+)"/i);
      if (m && m[1].toLowerCase() === folder) { found = Number(f.match(/\d+/)[0]); break; }
    }
  } catch { /* não é uma biblioteca Steam (pasta escolhida à mão) */ }
  appIdCache.set(gameInstallPath, found);
  return found;
}

function gameContext({ gameInstallPath, steamAppId, platform, home, protonDir }) {
  const appId = steamAppId ? Number(steamAppId) : guessSteamAppId(gameInstallPath);
  const ctx = { gameInstallPath, steamAppId: appId, platform, home, protonDir };
  const profile = profiles.resolveProfile(ctx);
  const targets = {};
  for (const [key, t] of Object.entries(profile.targets)) targets[key] = profiles.resolveTarget(t, ctx);
  return { ctx, profile, targets };
}

// ---------- Manifesto local ----------
function manifestPath(manifestDir, gameInstallPath) {
  const norm = path.resolve(gameInstallPath);
  const keySrc = process.platform === 'win32' ? norm.toLowerCase() : norm;
  const hash = crypto.createHash('sha1').update(keySrc).digest('hex').slice(0, 16);
  return path.join(manifestDir, `${hash}.json`);
}

function loadManifest(manifestDir, gameInstallPath) {
  try {
    const data = JSON.parse(fs.readFileSync(manifestPath(manifestDir, gameInstallPath), 'utf8'));
    if (data && typeof data.mods === 'object') return data;
  } catch { /* ainda não existe */ }
  return { version: 1, gameInstallPath, mods: {} };
}

function saveManifest(manifestDir, gameInstallPath, data) {
  fs.mkdirSync(manifestDir, { recursive: true });
  const file = manifestPath(manifestDir, gameInstallPath);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...data, gameInstallPath, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

// ---------- Planejamento (pra onde vai cada arquivo) ----------
function segEq(a, b) { return a.toLowerCase() === b.toLowerCase(); }

function matchAnchor(segs, route) {
  const m = route.match;
  const last = segs.length - m.length; // precisa sobrar o arquivo depois da âncora (keep=false) ou ao menos a âncora (keep=true)
  for (let i = 0; i <= (route.topOnly ? 0 : last); i += 1) {
    if (i + m.length > segs.length - 1) break;
    let ok = true;
    for (let j = 0; j < m.length; j += 1) if (!segEq(segs[i + j], m[j])) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

function markerDirOf(file, route) {
  const segs = file.split('/');
  const marker = route.file;
  if (route.dirMarker) {
    for (let i = 0; i < segs.length - 1; i += 1) if (segEq(segs[i], marker)) return segs.slice(0, i).join('/');
    return null;
  }
  if (marker.startsWith('*.')) {
    return path.extname(file).toLowerCase() === marker.slice(1).toLowerCase() ? segs.slice(0, -1).join('/') : null;
  }
  const mSegs = marker.split('/');
  if (segs.length < mSegs.length) return null;
  const tail = segs.slice(segs.length - mSegs.length);
  if (!tail.every((s, i) => segEq(s, mSegs[i]))) return null;
  return segs.slice(0, segs.length - mSegs.length).join('/');
}

function expandSub(sub, modFolder) {
  return sub ? sub.replace('{mod}', modFolder).split('/').filter(Boolean) : [];
}

function findLoaderRoot(files, signature) {
  if (!signature) return null;
  for (const f of files) {
    const segs = f.split('/');
    if (signature.anchor) {
      const idx = matchAnchor(segs, { match: signature.anchor });
      if (idx >= 0) return segs.slice(0, idx).join('/');
    } else if (signature.file && segEq(segs[segs.length - 1], signature.file)) {
      return segs.slice(0, -1).join('/');
    }
  }
  return null;
}

// Devolve { placements: [{ src, dest, root }], skipped: [rel], generated: [{dest, root, content}], loader: bool }
function planInstall({ stagingDir, game, modFolder, loaderInstall = false }) {
  const { profile, targets } = game;
  if (profile.blocked) throw new Error(profile.blocked);
  const all = listFilesRecursive(stagingDir).filter((f) => !JUNK.test(f));
  if (all.length === 0) throw new Error('O arquivo do mod está vazio.');

  const placements = [];
  const skipped = [];
  const generated = [];
  const put = (rel, targetKey, destSegs) => {
    const t = targets[targetKey];
    if (!t) throw new Error(`Perfil de instalação inválido (alvo "${targetKey}").`);
    const dest = path.join(t.dir, ...destSegs);
    if (!isInside(dest, t.root)) { skipped.push(rel); return; } // nunca escapa da pasta (ex: "../")
    placements.push({ src: path.join(stagingDir, ...rel.split('/')), dest, root: t.root, rel });
  };

  // 1) É o próprio loader (BepInExPack, MelonLoader, UE4SS, Script Hook...)?
  const loaderRoot = profile.loader ? findLoaderRoot(all, profile.loader.signature) : null;
  if (loaderInstall || loaderRoot !== null) {
    let root = loaderRoot;
    if (root === null) {
      // Thunderstore marcou como loader mas sem assinatura: desembrulha UMA pasta só.
      const firsts = new Set(all.map((f) => f.split('/')[0]));
      root = (firsts.size === 1 && all.every((f) => f.includes('/'))) ? [...firsts][0] : '';
    }
    const installTo = (profile.loader?.installTo || '').split('/').filter(Boolean);
    for (const f of all) {
      if (root && !f.startsWith(`${root}/`)) { skipped.push(f); continue; }
      const rest = root ? f.slice(root.length + 1) : f;
      const destSegs = [...installTo, ...rest.split('/')];
      const dest = path.join(game.ctx.gameInstallPath, ...destSegs);
      if (!isInside(dest, game.ctx.gameInstallPath)) { skipped.push(f); continue; }
      placements.push({ src: path.join(stagingDir, ...f.split('/')), dest, root: game.ctx.gameInstallPath, rel: f });
    }
    return { placements, skipped, generated, loader: true };
  }

  // 2) Desembrulha pastas "embrulho" (Mod-1.2/Mod-1.2/...) — para quando
  // a pasta já é uma âncora conhecida (BepInEx, Data, Mods...).
  const anchorFirsts = new Set((profile.routes || []).filter((r) => r.type === 'anchor').map((r) => r.match[0].toLowerCase()));
  const markerRoutes = (profile.routes || []).filter((r) => r.type === 'marker');
  let files = all;
  let wrapperName = null;
  let wrapperPrefix = '';
  for (let guard = 0; guard < 4; guard += 1) {
    const firsts = new Set(files.map((f) => f.split('/')[0]));
    if (firsts.size !== 1 || files.some((f) => !f.includes('/'))) break;
    const only = [...firsts][0];
    if (anchorFirsts.has(only.toLowerCase())) break;
    // Este nível já é a pasta de um mod (ex: Scripts/main.lua do UE4SS)?
    if (markerRoutes.some((r) => files.some((f) => markerDirOf(f, r) === ''))) break;
    wrapperName = only;
    wrapperPrefix += `${only}/`;
    files = files.map((f) => f.slice(only.length + 1));
  }
  // rel desembrulhado → rel original (pra achar o arquivo no staging)
  const strip = (f) => `${wrapperPrefix}${f}`;
  const remaining = new Set(files);
  const take = (f) => remaining.delete(f);

  for (const route of profile.routes || []) {
    if (route.type === 'anchor') {
      for (const f of [...remaining]) {
        const segs = f.split('/');
        const idx = matchAnchor(segs, route);
        if (idx < 0) continue;
        const tail = route.keep ? segs.slice(idx) : segs.slice(idx + route.match.length);
        if (tail.length === 0) continue;
        const prefix = route.prefix ? route.prefix.split('/') : [];
        put(strip(f), route.target, [...prefix, ...expandSub(route.sub, modFolder), ...tail]);
        take(f);
      }
    } else if (route.type === 'marker') {
      const dirs = [];
      for (const f of remaining) {
        const d = markerDirOf(f, route);
        if (d !== null && !dirs.includes(d)) dirs.push(d);
      }
      dirs.sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length);
      const chosen = [];
      for (const d of dirs) if (!chosen.some((c) => c === '' || d === c || d.startsWith(`${c}/`))) chosen.push(d);
      for (const d of chosen) {
        let name = d ? d.split('/').pop() : (wrapperName || modFolder);
        if (route.prefix && !name.toLowerCase().startsWith(route.prefix.toLowerCase())) name = `${route.prefix}${name}`;
        for (const f of [...remaining]) {
          if (d && !f.startsWith(`${d}/`)) continue;
          const rest = d ? f.slice(d.length + 1) : f;
          put(strip(f), route.target, [name, ...rest.split('/')]);
          take(f);
        }
        if (route.touch) {
          const t = targets[route.target];
          generated.push({ dest: path.join(t.dir, name, route.touch), root: t.root, content: '' });
        }
      }
    } else if (route.type === 'ext') {
      for (const f of [...remaining]) {
        if (route.topOnly && f.includes('/')) continue;
        if (!route.exts.includes(path.extname(f).toLowerCase())) continue;
        put(strip(f), route.target, [...expandSub(route.sub, modFolder), path.basename(f)]);
        take(f);
      }
    }
  }

  const unsupported = new Set((profile.unsupportedExts || []).map((e) => e.toLowerCase()));
  for (const f of [...remaining]) {
    const ext = path.extname(f).toLowerCase();
    if (unsupported.has(ext)) { skipped.push(strip(f)); take(f); continue; }
    if (DOC_EXTS.has(ext) && (placements.length > 0 || !profile.fallback)) { skipped.push(strip(f)); take(f); continue; }
    if (!profile.fallback) { skipped.push(strip(f)); take(f); continue; }
    put(strip(f), profile.fallback.target, [...expandSub(profile.fallback.sub, modFolder), ...f.split('/')]);
    take(f);
  }

  // Paradox: gera o descritor <mod>.mod que o launcher precisa.
  if (profile.paradoxDescriptor && targets.mods) {
    const hasTopMod = placements.some((p) => path.dirname(p.dest) === targets.mods.dir && /\.mod$/i.test(p.dest));
    const descriptor = placements.find((p) => /(^|\/)descriptor\.mod$/i.test(p.rel));
    if (!hasTopMod && descriptor) {
      const modDir = path.dirname(descriptor.dest);
      const text = fs.readFileSync(descriptor.src, 'utf8').replace(/^\s*path\s*=.*$/gim, '').trim();
      generated.push({ dest: path.join(targets.mods.dir, `${path.basename(modDir)}.mod`), root: targets.mods.root, content: `${text}\npath="${modDir.split(path.sep).join('/')}"\n` });
    }
  }

  if (placements.length === 0) {
    const exts = [...new Set(all.map((f) => path.extname(f).toLowerCase()).filter(Boolean))].slice(0, 5).join(', ');
    const err = new Error(`Formato não suportado: nenhum arquivo deste mod (${exts || 'sem extensão'}) tem um lugar conhecido em ${profile.name}.`);
    err.code = 'UNSUPPORTED_FORMAT';
    throw err;
  }
  return { placements, skipped, generated, loader: false };
}

// ---------- Aplicar o plano + registrar no manifesto ----------
function stashPathFor(file, root, key) {
  return path.join(root, DISABLED_DIR, key, path.relative(root, file));
}
function backupPathFor(file, root, key) {
  return path.join(root, DISABLED_DIR, '.backup', key, path.relative(root, file));
}

function ownerOf(manifest, filePath, exceptKey) {
  for (const [key, entry] of Object.entries(manifest.mods)) {
    if (key === exceptKey) continue;
    if ((entry.files || []).some((f) => f.path === filePath)) return key;
  }
  return null;
}

function applyPlan(plan, { manifest, key, meta }) {
  const all = [...plan.placements, ...plan.generated];
  // Pastas que ainda não existem (antes de criar qualquer coisa) — são
  // "deste mod" e somem quando ele sair.
  const createdDirs = new Set();
  for (const p of all) {
    let d = path.dirname(p.dest);
    while (isInside(d, p.root) && d !== p.root && !fs.existsSync(d)) { createdDirs.add(d); d = path.dirname(d); }
  }
  const files = [];
  const backups = [];
  const conflicts = new Set();
  const seen = new Set();
  for (const p of all) {
    if (seen.has(p.dest)) continue; // dois arquivos pro mesmo destino: fica o primeiro
    seen.add(p.dest);
    if (fs.existsSync(p.dest)) {
      const other = ownerOf(manifest, p.dest, key);
      if (other) conflicts.add(manifest.mods[other].name || other);
      const backup = backupPathFor(p.dest, p.root, key);
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(p.dest, backup);
      backups.push({ path: p.dest, backup, owner: other || null });
    }
    if (p.src) moveFile(p.src, p.dest);
    else { fs.mkdirSync(path.dirname(p.dest), { recursive: true }); fs.writeFileSync(p.dest, p.content, 'utf8'); }
    files.push({ path: p.dest, stash: stashPathFor(p.dest, p.root, key), root: p.root });
  }
  const entry = {
    key,
    ...meta,
    enabled: true,
    installedAt: new Date().toISOString(),
    files,
    dirs: [...createdDirs],
    backups,
    skipped: plan.skipped.slice(0, 50),
    isLoader: !!plan.loader,
  };
  manifest.mods[key] = entry;
  return { entry, conflicts: [...conflicts] };
}

// Desfaz um mod do manifesto: apaga os arquivos dele (ativo ou
// desativado), devolve os originais que ele substituiu e remove as
// pastas que ele criou (se ficaram vazias).
function removeEntryFiles(entry) {
  for (const f of entry.files || []) {
    if (entry.enabled !== false) { if (fs.existsSync(f.path)) fs.rmSync(f.path, { force: true }); }
    if (fs.existsSync(f.stash)) fs.rmSync(f.stash, { force: true });
    if (f.root) pruneEmptyUpTo(path.dirname(f.stash), path.join(f.root, DISABLED_DIR));
  }
  for (const b of entry.backups || []) {
    if (fs.existsSync(b.backup)) {
      if (!fs.existsSync(b.path)) moveFile(b.backup, b.path);
      else fs.rmSync(b.backup, { force: true });
    }
  }
  removeEmptyDirs(entry.dirs || []);
}

function setEntryEnabled(entry, enabled) {
  if ((entry.enabled !== false) === enabled) return false;
  if (enabled) {
    for (const f of entry.files) if (fs.existsSync(f.stash)) moveFile(f.stash, f.path);
    for (const f of entry.files) if (f.root) pruneEmptyUpTo(path.dirname(f.stash), path.join(f.root, DISABLED_DIR));
  } else {
    for (const f of entry.files) if (fs.existsSync(f.path)) moveFile(f.path, f.stash);
    // Arquivo original que o mod tinha substituído volta enquanto ele está desligado.
    for (const b of entry.backups || []) if (fs.existsSync(b.backup) && !fs.existsSync(b.path)) { fs.mkdirSync(path.dirname(b.path), { recursive: true }); fs.copyFileSync(b.backup, b.path); }
    removeEmptyDirs(entry.dirs || []);
  }
  entry.enabled = enabled;
  return true;
}

// ---------- Legado (instalações antigas: <alvo>/<nome> + <alvo>.disabled) ----------
function legacyTargetRoot(gameInstallPath) {
  return fs.existsSync(path.join(gameInstallPath, 'BepInEx'))
    ? path.join(gameInstallPath, 'BepInEx', 'plugins')
    : path.join(gameInstallPath, 'Mods');
}
function legacyRoots(gameInstallPath) {
  return [path.join(gameInstallPath, 'BepInEx', 'plugins'), path.join(gameInstallPath, 'Mods')];
}
function findLegacy(gameInstallPath, folderName) {
  for (const r of legacyRoots(gameInstallPath)) {
    const on = path.join(r, folderName);
    const off = path.join(`${r}.disabled`, folderName);
    if (fs.existsSync(off)) return { root: r, enabledDir: on, disabledDir: off, enabled: false };
    // Pasta ativa só conta como "legado" se a pasta .disabled do mesmo
    // alvo existir (assim sabemos que foi o instalador antigo) — senão é
    // tratada como mod detectado normal.
    if (fs.existsSync(on) && fs.existsSync(`${r}.disabled`)) return { root: r, enabledDir: on, disabledDir: off, enabled: true };
  }
  return null;
}

// ---------- Varredura (mods já instalados) ----------
function scanEntries(game, manifest) {
  const managedPaths = new Map();
  for (const [key, entry] of Object.entries(manifest.mods)) {
    for (const f of entry.files || []) managedPaths.set(f.path, key);
  }
  const ownerFor = (p) => {
    if (managedPaths.has(p)) return managedPaths.get(p);
    const prefix = p + path.sep;
    for (const [fp, key] of managedPaths) if (fp.startsWith(prefix)) return key;
    return null;
  };

  const detected = [];
  const seen = new Set();
  for (const spec of game.profile.scan || []) {
    const t = game.targets[spec.target];
    if (!t || !fs.existsSync(t.dir)) continue;
    const skip = new Set((spec.skip || []).map((s) => s.toLowerCase()));
    for (const e of fs.readdirSync(t.dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name.endsWith('.disabled') || skip.has(e.name.toLowerCase())) continue;
      const isDir = e.isDirectory();
      if (!isDir && !e.isFile()) continue;
      if (spec.exts) {
        if (isDir && !spec.dirs) continue;
        if (!isDir && !spec.exts.includes(path.extname(e.name).toLowerCase())) continue;
      }
      if (spec.exclude && spec.exclude.test(e.name)) continue;
      const abs = path.join(t.dir, e.name);
      // Na raiz do jogo só entra o que bate com as extensões do perfil
      // (evita listar o .exe do jogo como "mod").
      if (spec.target === 'root' && (isDir || !spec.exts)) continue;
      if (seen.has(abs)) continue;
      seen.add(abs);
      const owner = ownerFor(abs);
      detected.push({ abs, name: e.name, isDir, owner, location: t.label, root: t.root, target: spec.target });
    }
  }
  return detected;
}

module.exports = {
  DISABLED_DIR, sanitizeModFolderName, listFilesRecursive, moveFile, isInside, pathSize,
  guessSteamAppId, gameContext, loadManifest, saveManifest, manifestPath,
  planInstall, applyPlan, removeEntryFiles, setEntryEnabled,
  legacyTargetRoot, legacyRoots, findLegacy, scanEntries,
};
