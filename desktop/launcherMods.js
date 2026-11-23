// Mods de Minecraft e Hytale no Mod Manager do Project Club.
//
// Os dois jogos têm launcher próprio no ecossistema (ProjectMC e
// HyProject), e cada launcher guarda os mods numa pasta por instância:
//   - Minecraft (ProjectMC, base X Minecraft Launcher): <dados>/instances/<pasta>/mods
//     <dados> = conteúdo do arquivo %APPDATA%/projectmc/root (ou a própria
//     %APPDATA%/projectmc). instance.json traz o nome, a versão e o loader.
//     O .minecraft oficial também aparece, como "Minecraft (launcher oficial)".
//   - Hytale (HyProject, base HyPrism): %LOCALAPPDATA%/HyPrism/Instances/<id>/UserData/Mods
//     (a pasta das instâncias pode ser trocada em config.json → InstanceDirectory).
//
// Este módulo só mexe DENTRO dessas pastas de mods (listar, ligar/desligar
// renomeando pra .disabled, apagar, instalar baixando de um site permitido
// ou copiando um arquivo escolhido pela pessoa). O resto do jogo não é tocado.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const MOD_EXT = { minecraft: ['.jar'], hytale: ['.jar', '.zip'] };
const DISABLED = '.disabled';
// Downloads só destes sites (Modrinth e CurseForge, os catálogos desses jogos).
const ALLOWED_HOSTS = /(^|\.)(modrinth\.com|forgecdn\.net|curseforge\.com)$/i;
const MAX_BYTES = 512 * 1024 * 1024;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
function appDataDir() {
  if (process.platform === 'win32') return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

// ---------- Minecraft ----------

function projectMcRoot() {
  const base = path.join(appDataDir(), 'projectmc');
  try {
    const r = fs.readFileSync(path.join(base, 'root'), 'utf8').trim();
    if (r && isDir(r)) return r;
  } catch { /* sem arquivo root: os dados ficam na própria pasta */ }
  return base;
}

/** Loader + versão de uma instância do ProjectMC (puro, recebe o instance.json). */
function minecraftRuntime(meta) {
  const rt = meta?.runtime || {};
  const loader = rt.neoForged ? 'neoforge' : rt.fabricLoader ? 'fabric' : rt.quiltLoader ? 'quilt' : rt.forge ? 'forge' : 'vanilla';
  return { gameVersion: rt.minecraft || null, loader };
}

function listMinecraftInstances() {
  const out = [];
  const root = projectMcRoot();
  const instDir = path.join(root, 'instances');
  let dirs = [];
  try { dirs = fs.readdirSync(instDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { /* sem instâncias */ }
  for (const d of dirs) {
    const dir = path.join(instDir, d);
    const meta = readJson(path.join(dir, 'instance.json'));
    if (!meta) continue;
    out.push({ id: `pmc:${d}`, name: meta.name || d, dir, modsDir: path.join(dir, 'mods'), launcher: 'ProjectMC', ...minecraftRuntime(meta) });
  }
  const official = process.platform === 'darwin' ? path.join(appDataDir(), 'minecraft') : path.join(process.platform === 'win32' ? appDataDir() : os.homedir(), '.minecraft');
  if (isDir(official)) out.push({ id: 'official', name: 'Minecraft (launcher oficial)', dir: official, modsDir: path.join(official, 'mods'), launcher: 'Minecraft', gameVersion: null, loader: null });
  return out;
}

// ---------- Hytale ----------

function hyProjectAppDir() {
  if (process.env.HYPRISM_DATA && isDir(process.env.HYPRISM_DATA)) return process.env.HYPRISM_DATA;
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'HyPrism');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'HyPrism');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'HyPrism');
}

function listHytaleInstances() {
  const appDir = hyProjectAppDir();
  const cfg = readJson(path.join(appDir, 'config.json')) || {};
  let root = cfg.InstanceDirectory ? String(cfg.InstanceDirectory) : path.join(appDir, 'Instances');
  if (!path.isAbsolute(root)) root = path.resolve(appDir, root);
  const names = new Map();
  for (const i of (readJson(path.join(root, 'instances.json')) || [])) if (i?.Id) names.set(String(i.Id), i.Name || i.Id);
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return out; }
  for (const d of dirs) {
    const dir = path.join(root, d);
    // Instância nova: <id>/UserData; antiga: <versão>/<branch>/UserData.
    const candidates = [dir, ...(() => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => path.join(dir, x.name)); } catch { return []; } })()];
    const base = candidates.find((c) => isDir(path.join(c, 'UserData')) || fs.existsSync(path.join(c, 'Client')));
    if (!base) continue;
    out.push({ id: `hy:${path.relative(root, base)}`, name: names.get(d) || d, dir: base, modsDir: path.join(base, 'UserData', 'Mods'), launcher: 'HyProject' });
  }
  return out;
}

// ---------- Pasta de mods (comum aos dois) ----------

function instancesOf(game) {
  if (game === 'minecraft') return listMinecraftInstances();
  if (game === 'hytale') return listHytaleInstances();
  throw new Error('Jogo desconhecido.');
}

/** Acha a instância pelo id (nunca aceita um caminho vindo da tela). */
function findInstance(game, instanceId) {
  const inst = instancesOf(game).find((i) => i.id === instanceId);
  if (!inst) throw new Error('Instância não encontrada. Abra o launcher e crie uma instância primeiro.');
  return inst;
}

/** Nome de arquivo seguro dentro da pasta de mods (sem subpastas nem "..").*/
function safeName(name, game) {
  const base = path.basename(String(name || '')).replace(/[<>:"|?*\x00-\x1f]/g, '_');
  if (!base || base === '.' || base === '..') throw new Error('Nome de arquivo inválido.');
  const plain = base.endsWith(DISABLED) ? base.slice(0, -DISABLED.length) : base;
  if (!MOD_EXT[game].includes(path.extname(plain).toLowerCase())) throw new Error(`Esse arquivo não é um mod de ${game === 'minecraft' ? 'Minecraft (.jar)' : 'Hytale (.jar/.zip)'}.`);
  return base;
}

function sha1File(file) {
  const h = crypto.createHash('sha1');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

function listMods(game, instanceId) {
  const inst = findInstance(game, instanceId);
  let files = [];
  try { files = fs.readdirSync(inst.modsDir, { withFileTypes: true }).filter((f) => f.isFile()); } catch { /* pasta ainda não existe */ }
  const mods = [];
  for (const f of files) {
    const enabled = !f.name.endsWith(DISABLED);
    const plain = enabled ? f.name : f.name.slice(0, -DISABLED.length);
    if (!MOD_EXT[game].includes(path.extname(plain).toLowerCase())) continue;
    const full = path.join(inst.modsDir, f.name);
    let st = null;
    try { st = fs.statSync(full); } catch { continue; }
    let sha1 = null;
    try { if (st.size <= 64 * 1024 * 1024) sha1 = sha1File(full); } catch { /* sem hash */ }
    mods.push({ file: f.name, name: plain.replace(/\.(jar|zip)$/i, ''), enabled, size: st.size, modifiedAt: st.mtimeMs, sha1 });
  }
  mods.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return { instance: { ...inst, dir: undefined }, mods, modsDir: inst.modsDir };
}

function setModEnabled(game, instanceId, file, enabled) {
  const inst = findInstance(game, instanceId);
  const name = safeName(file, game);
  const from = path.join(inst.modsDir, name);
  const plain = name.endsWith(DISABLED) ? name.slice(0, -DISABLED.length) : name;
  const to = path.join(inst.modsDir, enabled ? plain : plain + DISABLED);
  if (from === to) return { file: name };
  if (!fs.existsSync(from)) throw new Error('O arquivo do mod sumiu da pasta.');
  fs.renameSync(from, to);
  return { file: path.basename(to) };
}

async function removeMod(game, instanceId, file, { trash } = {}) {
  const inst = findInstance(game, instanceId);
  const full = path.join(inst.modsDir, safeName(file, game));
  if (!fs.existsSync(full)) return { removed: false };
  if (trash) { try { await trash(full); return { removed: true }; } catch { /* sem lixeira: apaga */ } }
  fs.rmSync(full, { force: true });
  return { removed: true };
}

function download(url, dest, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error('Endereço de download inválido.')); }
    if (u.protocol !== 'https:' || !ALLOWED_HOSTS.test(u.hostname)) return reject(new Error('Download bloqueado: esse endereço não é do catálogo de mods do Project Club.'));
    const req = require('https').get(u, { headers: { 'User-Agent': 'ProjectClub-ModManager' }, timeout: 30000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 5) {
        res.resume();
        return resolve(download(new URL(res.headers.location, u).toString(), dest, onProgress, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`O site do mod respondeu ${res.statusCode}.`)); }
      const total = Number(res.headers['content-length']) || 0;
      if (total > MAX_BYTES) { res.resume(); return reject(new Error('Arquivo grande demais.')); }
      let got = 0;
      const out = fs.createWriteStream(dest);
      res.on('data', (c) => {
        got += c.length;
        if (got > MAX_BYTES) { req.destroy(new Error('Arquivo grande demais.')); return; }
        if (onProgress) onProgress({ received: got, total });
      });
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve({ size: got })));
      out.on('error', reject);
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('O download demorou demais.')));
  });
}

/**
 * Instala um mod baixando direto do catálogo (Modrinth/CurseForge) pra pasta
 * da instância, conferindo o sha1 quando o catálogo informa. `replace` = nome
 * do arquivo antigo (atualizar um mod: o antigo só sai depois que o novo chegou).
 */
async function installFromUrl(game, instanceId, { url, fileName, sha1, replace } = {}, onProgress) {
  const inst = findInstance(game, instanceId);
  const name = safeName(fileName || path.basename(new URL(url).pathname), game);
  fs.mkdirSync(inst.modsDir, { recursive: true });
  const tmp = path.join(os.tmpdir(), `pc-mod-${Date.now()}-${name}`);
  try {
    await download(url, tmp, onProgress);
    if (sha1 && sha1File(tmp) !== String(sha1).toLowerCase()) throw new Error('O arquivo baixado veio diferente do esperado (hash não bate). Tente de novo.');
    const dest = path.join(inst.modsDir, name);
    fs.copyFileSync(tmp, dest);
    if (replace && replace !== name) {
      try { fs.rmSync(path.join(inst.modsDir, safeName(replace, game)), { force: true }); } catch { /* o antigo já não estava lá */ }
    }
    return { file: name };
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch { /* temporário */ }
  }
}

/** Copia um arquivo escolhido pela pessoa (diálogo nativo) pra pasta de mods. */
function installFromFile(game, instanceId, filePath) {
  const inst = findInstance(game, instanceId);
  if (!path.isAbsolute(String(filePath || '')) || !fs.existsSync(filePath)) throw new Error('Arquivo não encontrado.');
  const name = safeName(path.basename(filePath), game);
  fs.mkdirSync(inst.modsDir, { recursive: true });
  fs.copyFileSync(filePath, path.join(inst.modsDir, name));
  return { file: name };
}

function modsFolder(game, instanceId) {
  const inst = findInstance(game, instanceId);
  fs.mkdirSync(inst.modsDir, { recursive: true });
  return inst.modsDir;
}

// ---------- Catálogo de mods de Minecraft (sem CSP: roda no processo principal) ----------
// Só estes caminhos da API pública do catálogo, só leitura (o POST de
// atualizações também só lê: manda hashes e recebe as versões novas).
const CATALOG = 'https://api.modrinth.com/v2/';
const CATALOG_PATHS = /^(search|projects|project\/[A-Za-z0-9_-]{1,64}(\/version)?|version_files\/update)$/;

function catalogRequest(route, { query, body } = {}) {
  if (!CATALOG_PATHS.test(String(route || ''))) return Promise.reject(new Error('Consulta não permitida.'));
  const u = new URL(CATALOG + route);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = require('https').request(u, {
      method: data ? 'POST' : 'GET',
      headers: { 'User-Agent': 'RiqueBitt/ProjectClub (mod-manager)', Accept: 'application/json', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) },
      timeout: 15000,
    }, (res) => {
      let txt = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { txt += c; if (txt.length > 8 * 1024 * 1024) req.destroy(new Error('Resposta grande demais.')); });
      res.on('end', () => {
        if (res.statusCode === 404) return resolve(null);
        if (res.statusCode >= 400) return reject(new Error(`O catálogo de mods respondeu ${res.statusCode}.`));
        try { resolve(JSON.parse(txt)); } catch { reject(new Error('Resposta inválida do catálogo de mods.')); }
      });
    });
    req.on('error', () => reject(new Error('Sem conexão com o catálogo de mods.')));
    req.on('timeout', () => req.destroy(new Error('O catálogo de mods demorou demais.')));
    if (data) req.write(data);
    req.end();
  });
}

module.exports = {
  catalogRequest,
  listMinecraftInstances, listHytaleInstances, instancesOf, listMods, setModEnabled, removeMod,
  installFromUrl, installFromFile, modsFolder, minecraftRuntime, safeName, ALLOWED_HOSTS,
};
