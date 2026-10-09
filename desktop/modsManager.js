// Instalador de mods do Project Club — item pedido 12 ("instalação
// automática") e 31 ("não usar o r2modmanPlus como dependência... o
// Project Club deve possuir seu próprio sistema", inspirado nos
// conceitos dele mas implementação própria). Roda só no processo
// principal do Electron (mesma razão do steamDetector.js — o navegador
// não tem acesso a essas pastas).
//
// Regra obrigatória (item 7/12): o ARQUIVO do mod nunca passa pelos
// nossos servidores nem é gravado no banco de dados — este módulo baixa
// DIRETO da URL assinada que o mod.io gera (ver server: getModDownload,
// que só repassa essa URL, nunca o arquivo em si), pra uma pasta
// temporária local, instala, e apaga o temporário. Os únicos bytes que
// tocam o Project Club são os que já estão passando pela própria máquina
// do usuário de qualquer forma.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { app } = require('electron');

function tempDir() {
  const dir = path.join(app.getPath('temp'), 'projectclub-mods');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Mesmo padrão de download com progresso + redirecionamento já usado e
// testado em projectMcManager.js (ver httpsGet lá) — reimplementado aqui
// de propósito, em vez de importado, pra este módulo não depender de
// detalhes internos de outro (cada um pode evoluir/ser removido sem
// arriscar quebrar o outro).
function downloadToFile(url, destPath, onProgress, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, { headers: { 'User-Agent': 'ProjectClub-App' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        res.resume(); file.close();
        downloadToFile(res.headers.location, destPath, onProgress, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        reject(new Error(`Falha ao baixar o mod (HTTP ${res.statusCode}).`));
        res.resume();
        return;
      }
      const total = Number(res.headers['content-length'] || 0);
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (onProgress && total) onProgress(Math.round((received / total) * 100));
      });
      res.on('error', (err) => { file.close(); reject(new Error(`Conexão interrompida durante o download: ${err.message}`)); });
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        // Confere que o arquivo baixado bate com o tamanho anunciado —
        // mesma checagem contra download truncado usada no ProjectMC.
        if (total && fs.statSync(destPath).size !== total) {
          reject(new Error('O download foi interrompido antes de terminar. Tente novamente.'));
          return;
        }
        resolve();
      });
    }).on('error', (err) => { file.close(); reject(err); });
  });
}

// ---------- Instalação por jogo (item pedido: "cada jogo tem seu
// jeito de instalar mods, arrume isso") ----------
// Antes: "BepInEx/plugins se existir BepInEx, senão Mods/<nome>" pra
// qualquer jogo. Agora cada jogo tem um PERFIL (modInstallProfiles.js:
// loader, pastas, tipos de arquivo) e cada arquivo extraído é
// encaminhado pro lugar certo (modRouter.js), com um manifesto local
// por jogo dizendo exatamente o que cada mod colocou onde — é isso que
// deixa desinstalar/ativar/desativar exatos. Mods instalados pela
// lógica antiga continuam reconhecidos (ver "legado" no modRouter).
const router = require('./modRouter');
const archive = require('./modArchive');

const { sanitizeModFolderName } = router;

function manifestDir() {
  return path.join(app.getPath('userData'), 'ModsManifest');
}

function stripExt(name) {
  return name.replace(/\.[a-z0-9]{1,8}$/i, '');
}

// Pasta principal de mods do jogo (usada no "Abrir pasta de mods").
function detectInstallStrategy(gameInstallPath, steamAppId) {
  const game = router.gameContext({ gameInstallPath, steamAppId });
  const primary = game.profile.primary && game.targets[game.profile.primary];
  return { kind: game.profile.family, targetRoot: primary ? primary.dir : router.legacyTargetRoot(gameInstallPath), profile: game.profile.name };
}

// Coloca o arquivo baixado/escolhido numa pasta "staging": extrai se for
// .zip/.7z, copia como está se o jogo lê o pacote direto (ex: .zip do
// Factorio/Celeste, .scs do ETS2) ou se for um arquivo solto (.pak, .dll,
// .esp, .tmod...).
async function stageFile(localFile, filename, game, stagingDir) {
  const ext = path.extname(filename || localFile).toLowerCase();
  fs.mkdirSync(stagingDir, { recursive: true });
  const keep = (game.profile.keepArchive || []).includes(ext);
  if (!keep && archive.isUnsupportedArchive(filename || localFile)) throw archive.unsupportedArchiveError(ext);
  if (!keep && archive.isArchive(filename || localFile)) {
    await archive.extractArchive(localFile, stagingDir, { writableDir: app.getPath('userData') });
    return;
  }
  fs.copyFileSync(localFile, path.join(stagingDir, path.basename(filename || localFile)));
}

function commonDir(paths) {
  if (paths.length === 0) return null;
  if (paths.length === 1) return paths[0];
  let common = path.dirname(paths[0]);
  while (!paths.every((p) => p.startsWith(common + path.sep))) {
    const up = path.dirname(common);
    if (up === common) break;
    common = up;
  }
  return common;
}

// Fluxo comum de instalação (baixado, do PC ou do Thunderstore).
async function installCore({ localFile, filename, gameInstallPath, steamAppId, modName, source, sourceId, version, loaderInstall }, onProgress) {
  if (!fs.existsSync(gameInstallPath)) throw new Error('A pasta do jogo não foi encontrada. Talvez ele tenha sido desinstalado ou movido.');
  const game = router.gameContext({ gameInstallPath, steamAppId });
  const key = sanitizeModFolderName(modName);
  const stagingDir = path.join(tempDir(), `${key}-${Date.now()}.staging`);
  try {
    onProgress?.({ phase: 'extracting', percent: 0 });
    await stageFile(localFile, filename, game, stagingDir);

    onProgress?.({ phase: 'installing', percent: 0 });
    // Planeja ANTES de mexer em qualquer coisa: se o formato não servir
    // pra este jogo, nada do que já estava instalado é tocado.
    const plan = router.planInstall({ stagingDir, game, modFolder: key, loaderInstall });

    const dir = manifestDir();
    const manifest = router.loadManifest(dir, gameInstallPath);
    // Reinstalar/atualizar: tira a versão anterior DESTE mod (só os
    // arquivos dele) — e a cópia do instalador antigo, se houver.
    if (manifest.mods[key]) { router.removeEntryFiles(manifest.mods[key]); delete manifest.mods[key]; }
    const legacy = router.findLegacy(gameInstallPath, key);
    if (legacy) {
      fs.rmSync(legacy.enabledDir, { recursive: true, force: true });
      fs.rmSync(legacy.disabledDir, { recursive: true, force: true });
    }

    const { entry, conflicts } = router.applyPlan(plan, {
      manifest, key, meta: { name: modName, source: source || null, sourceId: sourceId != null ? String(sourceId) : null, version: version || null, profileId: game.profile.id },
    });
    router.saveManifest(dir, gameInstallPath, manifest);
    onProgress?.({ phase: 'done', percent: 100 });
    return {
      installedPath: commonDir(entry.files.map((f) => f.path)),
      strategy: game.profile.family,
      profile: game.profile.name,
      fileCount: entry.files.length,
      skipped: plan.skipped.length,
      conflicts,
      isLoader: entry.isLoader,
    };
  } finally {
    fs.rm(stagingDir, { recursive: true, force: true }, () => {});
  }
}

// Fluxo principal — baixa DIRETO da URL que a fonte gerou (mod.io,
// GameBanana, Thunderstore), pra uma pasta temporária, instala e apaga o
// temporário.
async function installMod({ downloadUrl, filename, gameInstallPath, modName, steamAppId, source, sourceId, version, modioModId }, onProgress) {
  if (!fs.existsSync(gameInstallPath)) throw new Error('A pasta do jogo não foi encontrada. Talvez ele tenha sido desinstalado ou movido.');
  const ext = path.extname(filename || '').toLowerCase();
  if (archive.isUnsupportedArchive(filename)) throw archive.unsupportedArchiveError(ext);
  const archivePath = path.join(tempDir(), `${sanitizeModFolderName(modName)}-${Date.now()}${ext || '.zip'}`);
  onProgress?.({ phase: 'downloading', percent: 0 });
  try {
    await downloadToFile(downloadUrl, archivePath, (percent) => onProgress?.({ phase: 'downloading', percent }));
    return await installCore({
      localFile: archivePath, filename: filename || path.basename(archivePath), gameInstallPath, steamAppId, modName,
      source: source || (modioModId != null ? 'download' : null), sourceId: sourceId ?? modioModId, version,
    }, onProgress);
  } finally {
    fs.rm(archivePath, { force: true }, () => {});
  }
}

// Item pedido: "adicione mods de um arquivo local" — mesmo fluxo, sem
// baixar nada (arquivo escolhido pelo diálogo nativo, ver main.js).
async function installLocalFile({ filePath, gameInstallPath, modName, steamAppId }, onProgress) {
  if (!fs.existsSync(gameInstallPath)) throw new Error('A pasta do jogo não foi encontrada.');
  if (!fs.existsSync(filePath)) throw new Error('O arquivo selecionado não existe mais.');
  return installCore({ localFile: filePath, filename: path.basename(filePath), gameInstallPath, steamAppId, modName, source: 'local' }, onProgress);
}

// Thunderstore: um pacote por vez (a árvore de dependências já vem
// resolvida do backend, na ordem certa). isLoader = BepInExPack — vai
// pra raiz do jogo; o resto segue o perfil do jogo (plugins/, patchers/,
// config/ do padrão Thunderstore viram as pastas certas do BepInEx).
async function installThunderstorePackage({ downloadUrl, filename, gameInstallPath, fullName, isLoader, steamAppId, version }, onProgress) {
  if (!fs.existsSync(gameInstallPath)) throw new Error('A pasta do jogo não foi encontrada. Talvez ele tenha sido desinstalado ou movido.');
  const archivePath = path.join(tempDir(), `${sanitizeModFolderName(fullName)}-${Date.now()}.zip`);
  onProgress?.({ phase: 'downloading', percent: 0 });
  try {
    await downloadToFile(downloadUrl, archivePath, (percent) => onProgress?.({ phase: 'downloading', percent }));
    return await installCore({
      localFile: archivePath, filename: filename || `${fullName}.zip`, gameInstallPath, steamAppId, modName: fullName,
      source: 'thunderstore', sourceId: fullName, version, loaderInstall: !!isLoader,
    }, onProgress);
  } finally {
    fs.rm(archivePath, { force: true }, () => {});
  }
}

// Acha um mod "detectado" (que a pessoa já tinha, fora do manifesto)
// pelo caminho exato ou pelo nome — sempre a partir da varredura das
// pastas do perfil, nunca um caminho qualquer vindo de fora.
function findDetected(game, manifest, { modName, detectedPath }) {
  const detected = router.scanEntries(game, manifest).filter((d) => !d.owner);
  if (detectedPath) return detected.find((d) => path.resolve(d.abs) === path.resolve(detectedPath)) || null;
  const key = sanitizeModFolderName(modName);
  return detected.find((d) => sanitizeModFolderName(d.isDir ? d.name : stripExt(d.name)) === key) || null;
}

// Mod detectado vira "gerenciado" na primeira vez que a pessoa
// desativa: registra os arquivos dele no manifesto (sem mover nada
// ainda) — daí pra frente ativar/desativar é exato como os outros.
function adoptDetected(manifest, det) {
  let key = sanitizeModFolderName(det.isDir ? det.name : stripExt(det.name));
  while (manifest.mods[key]) key = `${key}_`;
  const files = det.isDir ? router.listFilesRecursive(det.abs).map((rel) => path.join(det.abs, ...rel.split('/'))) : [det.abs];
  const dirs = [];
  if (det.isDir) {
    const walk = (d) => { dirs.push(d); for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) walk(path.join(d, e.name)); };
    walk(det.abs);
  }
  const entry = {
    key, name: det.name, source: null, sourceId: null, version: null, adopted: true, enabled: true,
    installedAt: new Date().toISOString(),
    files: files.map((f) => ({ path: f, stash: path.join(det.root, router.DISABLED_DIR, key, path.relative(det.root, f)), root: det.root })),
    dirs, backups: [], skipped: [], isLoader: false,
  };
  manifest.mods[key] = entry;
  return entry;
}

// Item pedido 14: "Desinstalar" — só os arquivos deste mod.
function uninstallMod({ gameInstallPath, modName, steamAppId, path: detectedPath }) {
  const dir = manifestDir();
  const manifest = router.loadManifest(dir, gameInstallPath);
  const key = sanitizeModFolderName(modName || '');
  if (!detectedPath && manifest.mods[key]) {
    router.removeEntryFiles(manifest.mods[key]);
    delete manifest.mods[key];
    router.saveManifest(dir, gameInstallPath, manifest);
    return { uninstalled: true };
  }
  const legacy = !detectedPath && router.findLegacy(gameInstallPath, key);
  if (legacy) {
    fs.rmSync(legacy.enabledDir, { recursive: true, force: true });
    fs.rmSync(legacy.disabledDir, { recursive: true, force: true });
    return { uninstalled: true };
  }
  const game = router.gameContext({ gameInstallPath, steamAppId });
  const det = findDetected(game, manifest, { modName, detectedPath });
  if (det) {
    fs.rmSync(det.abs, { recursive: true, force: true });
    return { uninstalled: true };
  }
  return { uninstalled: false };
}

// Lista de nomes (formato antigo, usado pra marcar "Instalado" na UI e
// pelos modpacks): mods do manifesto + legado + detectados.
function listInstalledMods(gameInstallPath, steamAppId) {
  const enabled = new Set();
  const disabled = new Set();
  if (!gameInstallPath || !fs.existsSync(gameInstallPath)) return { enabled: [], disabled: [] };
  const manifest = router.loadManifest(manifestDir(), gameInstallPath);
  for (const [key, entry] of Object.entries(manifest.mods)) (entry.enabled === false ? disabled : enabled).add(key);
  for (const r of router.legacyRoots(gameInstallPath)) {
    const off = `${r}.disabled`;
    if (fs.existsSync(off)) for (const e of fs.readdirSync(off, { withFileTypes: true })) if (e.isDirectory()) disabled.add(e.name);
  }
  const game = router.gameContext({ gameInstallPath, steamAppId });
  for (const d of router.scanEntries(game, manifest)) {
    if (d.owner) continue;
    enabled.add(sanitizeModFolderName(d.isDir ? d.name : stripExt(d.name)));
  }
  return { enabled: [...enabled], disabled: [...disabled].filter((n) => !enabled.has(n)) };
}

// Item pedido 15: "Ativar"/"Desativar" sem desinstalar. Nunca apaga
// nada — só move os arquivos DO PRÓPRIO mod pra área desativada e de
// volta.
function setModEnabled({ gameInstallPath, modName, enabled, steamAppId, path: detectedPath }) {
  const dir = manifestDir();
  const manifest = router.loadManifest(dir, gameInstallPath);
  const key = sanitizeModFolderName(modName || '');
  let entry = !detectedPath ? manifest.mods[key] : null;

  if (!entry) {
    const legacy = !detectedPath && router.findLegacy(gameInstallPath, key);
    if (legacy) {
      if (enabled === legacy.enabled) return { changed: false };
      if (enabled) { fs.mkdirSync(legacy.root, { recursive: true }); fs.renameSync(legacy.disabledDir, legacy.enabledDir); }
      else { fs.mkdirSync(`${legacy.root}.disabled`, { recursive: true }); fs.renameSync(legacy.enabledDir, legacy.disabledDir); }
      return { changed: true };
    }
    if (enabled) return { changed: false }; // detectado já está ativo
    const game = router.gameContext({ gameInstallPath, steamAppId });
    const det = findDetected(game, manifest, { modName, detectedPath });
    if (!det) return { changed: false };
    entry = adoptDetected(manifest, det);
  }
  const changed = router.setEntryEnabled(entry, !!enabled);
  router.saveManifest(dir, gameInstallPath, manifest);
  return { changed, key: entry.key };
}

// Item pedido 15/28: aplica um PERFIL (modpack) inteiro de uma vez.
function applyProfileMods({ gameInstallPath, enabledModNames, steamAppId }) {
  const wanted = new Set(enabledModNames.map(sanitizeModFolderName));
  // Loaders (BepInEx, MelonLoader...) nunca são desligados por um modpack.
  const manifest = router.loadManifest(manifestDir(), gameInstallPath);
  for (const [key, entry] of Object.entries(manifest.mods)) if (entry.isLoader) wanted.add(key);
  const current = listInstalledMods(gameInstallPath, steamAppId);
  const changed = [];
  for (const name of current.enabled) {
    if (!wanted.has(name)) { setModEnabled({ gameInstallPath, modName: name, enabled: false, steamAppId }); changed.push(name); }
  }
  for (const name of current.disabled) {
    if (wanted.has(name)) { setModEnabled({ gameInstallPath, modName: name, enabled: true, steamAppId }); changed.push(name); }
  }
  const installedNames = new Set([...current.enabled, ...current.disabled]);
  const missing = [...wanted].filter((name) => !installedNames.has(name) && !manifest.mods[name]?.isLoader);
  return { changed, missing };
}

// ---------- Detecção de mods já instalados (item pedido: "identificar
// mods JÁ instalados nos arquivos do jogo") ----------
// Só LÊ o disco: nunca move/apaga nada durante a varredura.
function getInstallProfile({ gameInstallPath, steamAppId }) {
  const game = router.gameContext({ gameInstallPath, steamAppId });
  return require('./modInstallProfiles').describeProfile(game.profile, game.ctx);
}

// Vortex (gerenciador da Nexus Mods) deixa um "vortex.deployment*.json"
// na pasta onde instalou os mods, listando cada arquivo e de qual mod
// ele veio. Lendo isso dá pra mostrar "Instalado pelo Vortex" em vez de
// só "detectado". Só leitura — nada do Vortex é tocado.
function readVortexDeployments(dirs) {
  const files = new Map(); // caminho absoluto -> nome do mod no Vortex
  for (const dir of new Set(dirs.filter(Boolean))) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!/^vortex\.deployment(\..+)?\.json$/i.test(n)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
        const base = data.targetPath || dir;
        for (const f of data.files || []) {
          if (!f || !f.relPath || !f.source) continue;
          files.set(path.normalize(path.join(base, f.relPath)).toLowerCase(), String(f.source));
        }
      } catch { /* arquivo do Vortex ilegível: ignora */ }
    }
  }
  return files;
}

// "SkyUI-12604-5-2SE-1564..." → nome legível + id do mod na Nexus.
function parseVortexSource(source) {
  const m = String(source).match(/^(.*?)-(\d+)-(.+)-(\d{9,11})$/) || String(source).match(/^(.*?)-(\d+)-([\d-]+)$/);
  return m ? { name: m[1].replace(/[_]+/g, ' ').trim(), nexusModId: Number(m[2]) } : { name: source, nexusModId: null };
}

function scanInstalled({ gameInstallPath, steamAppId }) {
  if (!gameInstallPath || !fs.existsSync(gameInstallPath)) throw new Error('A pasta do jogo não foi encontrada.');
  const game = router.gameContext({ gameInstallPath, steamAppId });
  const profile = require('./modInstallProfiles').describeProfile(game.profile, game.ctx);
  const manifest = router.loadManifest(manifestDir(), gameInstallPath);
  const labelFor = (p) => {
    const hit = Object.values(game.targets)
      .filter((t) => t.dir !== gameInstallPath && router.isInside(p, t.dir))
      .sort((a, b) => b.dir.length - a.dir.length)[0];
    return hit ? hit.label : 'pasta do jogo';
  };

  const items = [];
  for (const entry of Object.values(manifest.mods)) {
    const on = entry.enabled !== false;
    const paths = (entry.files || []).map((f) => (on ? f.path : f.stash));
    const present = paths.filter((p) => fs.existsSync(p));
    const rep = commonDir((entry.files || []).map((f) => f.path)) || '';
    items.push({
      key: entry.key, name: entry.name || entry.key, path: rep,
      kind: (entry.files || []).length > 1 ? 'folder' : 'file',
      size: present.reduce((s, p) => s + router.pathSize(p), 0),
      enabled: on, managedByProjectClub: !entry.adopted, adopted: !!entry.adopted,
      source: entry.source || null, sourceId: entry.sourceId || null, version: entry.version || null,
      isLoader: !!entry.isLoader, fileCount: (entry.files || []).length, missingFiles: paths.length - present.length,
      installedAt: entry.installedAt || null, location: labelFor(rep),
    });
  }
  for (const r of router.legacyRoots(gameInstallPath)) {
    const off = `${r}.disabled`;
    if (!fs.existsSync(off)) continue;
    for (const e of fs.readdirSync(off, { withFileTypes: true })) {
      if (!e.isDirectory() || manifest.mods[e.name]) continue;
      const p = path.join(off, e.name);
      items.push({ key: e.name, name: e.name, path: p, kind: 'folder', size: router.pathSize(p), enabled: false, managedByProjectClub: true, legacy: true, location: path.relative(gameInstallPath, r) });
    }
  }
  for (const d of router.scanEntries(game, manifest)) {
    if (d.owner) continue;
    items.push({
      key: `detected:${sanitizeModFolderName(d.isDir ? d.name : stripExt(d.name))}`,
      name: d.name, path: d.abs, kind: d.isDir ? 'folder' : 'file', size: router.pathSize(d.abs),
      enabled: true, managedByProjectClub: false, location: d.location,
    });
  }
  // Marca o que foi instalado pelo Vortex.
  const vortex = readVortexDeployments([gameInstallPath, ...Object.values(game.targets).map((t) => t.dir)]);
  const vortexMods = new Set();
  if (vortex.size > 0) {
    const entries = [...vortex.entries()];
    for (const it of items) {
      if (it.managedByProjectClub || !it.path) continue;
      const base = path.normalize(it.path).toLowerCase();
      const hit = entries.find(([abs]) => abs === base || abs.startsWith(base + path.sep));
      if (!hit) continue;
      const info = parseVortexSource(hit[1]);
      it.managedBy = 'vortex';
      it.vortexMod = info.name;
      if (info.nexusModId) it.nexusModId = info.nexusModId;
      vortexMods.add(hit[1]);
    }
    for (const src of vortex.values()) vortexMods.add(src);
  }
  return {
    profile, loader: profile.loader, items,
    vortex: vortex.size > 0 ? { found: true, modCount: vortexMods.size, fileCount: vortex.size } : null,
  };
}

module.exports = {
  installMod, uninstallMod, listInstalledMods, setModEnabled, applyProfileMods, detectInstallStrategy,
  installLocalFile, listConfigFiles, readConfigFile, writeConfigFile,
  saveModpackLocally, listLocalModpacks, loadLocalModpack, deleteLocalModpack,
  installThunderstorePackage, scanInstalled, getInstallProfile,
};

// ---------- Pasta local de Modpacks (item pedido: "criar uma pasta do
// Project Club chamada modpacks onde salva os modpacks criados... pra
// assim ficar salvos") ----------
// Fica dentro da PRÓPRIA pasta de dados do Project Club (não do jogo)
// — sobrevive mesmo se o servidor cair ou a conta mudar de dispositivo
// sem sincronizar ainda: um arquivo de texto (.json) por modpack,
// organizado por jogo, com o nome de cada mod que faz parte dele. Não
// substitui o registro no servidor (que sincroniza entre
// computadores da mesma conta) — é uma cópia local, sempre disponível
// mesmo offline.
function modpacksRootDir() {
  const dir = path.join(app.getPath('userData'), 'Modpacks');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function gameSlug(gameKey) {
  return sanitizeModFolderName(String(gameKey));
}

function modpackFilePath(gameKey, packName) {
  const dir = path.join(modpacksRootDir(), gameSlug(gameKey));
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${sanitizeModFolderName(packName)}.json`);
}

function saveModpackLocally({ gameKey, gameDisplayName, packName, mods }) {
  const data = { name: packName, game: gameDisplayName, mods, updatedAt: new Date().toISOString() };
  fs.writeFileSync(modpackFilePath(gameKey, packName), JSON.stringify(data, null, 2), 'utf8');
  return { saved: true, path: modpackFilePath(gameKey, packName) };
}

function listLocalModpacks(gameKey) {
  const dir = path.join(modpacksRootDir(), gameSlug(gameKey));
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, e.name), 'utf8')); } catch { return null; }
    })
    .filter(Boolean);
}

function loadLocalModpack(gameKey, packName) {
  const filePath = modpackFilePath(gameKey, packName);
  if (!fs.existsSync(filePath)) throw new Error('Modpack não encontrado localmente.');
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function deleteLocalModpack(gameKey, packName) {
  const filePath = modpackFilePath(gameKey, packName);
  if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  return { deleted: true };
}

// ---------- Configuração dos mods (item pedido: "poder configurar
// mods") ----------
// A maioria dos mods de BepInEx grava as opções configuráveis em
// arquivos de texto simples (formato INI) dentro de BepInEx/config —
// um por mod. Em vez de tentar entender e desenhar um formulário
// pra CADA formato de configuração possível (impossível de fazer
// direito pra todo mod que existe), a edição aqui é de TEXTO puro: a
// pessoa vê o arquivo exatamente como ele é e edita à vontade — mesmo
// modelo que qualquer editor de config de verdade usa por baixo.
function configDir(gameInstallPath) {
  // Pasta de configuração do loader do jogo (BepInEx/config, UserData do
  // MelonLoader...) — padrão BepInEx/config, como sempre foi.
  let rel = 'BepInEx/config';
  try { rel = router.gameContext({ gameInstallPath }).profile.configDir || rel; } catch { /* perfil indisponível */ }
  return path.join(gameInstallPath, ...rel.split('/'));
}

// Nunca deixa escapar da pasta de config (sem "..", sem caminho
// absoluto) — o nome do arquivo vem de uma lista que a gente mesmo
// gerou em listConfigFiles, mas confere de novo aqui por segurança,
// já que esse valor viaja até o processo principal via IPC.
function safeConfigPath(gameInstallPath, filename) {
  const base = configDir(gameInstallPath);
  const resolved = path.resolve(base, filename);
  if (!resolved.startsWith(path.resolve(base) + path.sep) || path.basename(filename) !== filename) {
    throw new Error('Nome de arquivo de configuração inválido.');
  }
  return resolved;
}

function listConfigFiles(gameInstallPath) {
  const dir = configDir(gameInstallPath);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.cfg'))
    .map((e) => e.name)
    .sort();
}

function readConfigFile(gameInstallPath, filename) {
  return fs.readFileSync(safeConfigPath(gameInstallPath, filename), 'utf8');
}

function writeConfigFile(gameInstallPath, filename, content) {
  fs.writeFileSync(safeConfigPath(gameInstallPath, filename), content, 'utf8');
  return { saved: true };
}

// ---------- Roadmap (fora do escopo desta fase) ----------
// - Ordem de carga (plugins.txt da Bethesda, modsettings.lsx do BG3,
//   ModsConfig.xml do RimWorld) continua sendo feita no próprio jogo.
// - Instaladores FOMOD com opções e pacotes .oiv (OpenIV) não são
//   suportados; .rar também não (sem extrator confiável embutido).
// - Conflitos entre mods são só AVISADOS (o arquivo substituído vai pro
//   backup e volta quando o mod que substituiu sai).
