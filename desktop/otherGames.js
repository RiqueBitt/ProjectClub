// Jogos de outras lojas pro Mod Manager (além da Steam): Epic Games e GOG.
//
// Roda só no processo principal do Electron (precisa ler pastas e o
// registro do Windows). Só o NOME e a PASTA de cada jogo saem daqui; o
// Mod Manager cruza o nome com a Steam pra achar o mesmo jogo nos
// catálogos de mods (mod.io, Workshop, GameBanana, Thunderstore...), que
// são indexados pelo AppID da Steam.
//
// Onde cada loja guarda a lista de instalados:
//   - Epic (Windows): %ProgramData%\Epic\EpicGamesLauncher\Data\Manifests\*.item (JSON)
//   - Epic (Linux, Heroic/Legendary): ~/.config/heroic/legendaryConfig/legendary/installed.json
//   - GOG (Windows): registro HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\<id>
//   - GOG (Linux, Heroic): ~/.config/heroic/gog_store/installed.json
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

// ---------- Epic ----------

/** Lê os manifestos .item do launcher da Epic (puro, recebe a pasta). */
function parseEpicManifests(dir) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.item')); } catch { return []; }
  const out = [];
  for (const f of files) {
    const m = readJson(path.join(dir, f));
    if (!m || m.bIsIncompleteInstall) continue;
    // DLC/plugins aparecem como item próprio; só o jogo principal interessa.
    if (m.MainGameAppName && m.AppName && m.MainGameAppName !== m.AppName) continue;
    const cats = Array.isArray(m.AppCategories) ? m.AppCategories : [];
    if (cats.length && !cats.includes('games')) continue;
    if (!m.DisplayName || !m.InstallLocation) continue;
    out.push({ platform: 'epic', id: String(m.AppName || m.CatalogItemId || m.DisplayName), name: String(m.DisplayName), installPath: String(m.InstallLocation) });
  }
  return out;
}

/** installed.json do Legendary (usado pelo Heroic no Linux). */
function parseLegendaryInstalled(json) {
  if (!json || typeof json !== 'object') return [];
  return Object.entries(json)
    .filter(([, g]) => g && !g.is_dlc && g.install_path && g.title)
    .map(([id, g]) => ({ platform: 'epic', id: String(id), name: String(g.title), installPath: String(g.install_path) }));
}

function detectEpic() {
  if (process.platform === 'win32') {
    const base = process.env.ProgramData || 'C:\\ProgramData';
    return parseEpicManifests(path.join(base, 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests'));
  }
  const home = os.homedir();
  for (const f of [
    path.join(home, '.config', 'heroic', 'legendaryConfig', 'legendary', 'installed.json'),
    path.join(home, '.config', 'legendary', 'installed.json'),
    path.join(home, '.var', 'app', 'com.heroicgameslauncher.hgl', 'config', 'heroic', 'legendaryConfig', 'legendary', 'installed.json'),
  ]) {
    const list = parseLegendaryInstalled(readJson(f));
    if (list.length) return list;
  }
  return [];
}

// ---------- GOG ----------

/** Saída de `reg query ...\GOG.com\Games /s` → jogos (puro, pra teste). */
function parseGogRegistry(text) {
  const out = [];
  let cur = null;
  const flush = () => { if (cur && cur.name && cur.installPath) out.push(cur); cur = null; };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (/^HKEY_/i.test(line)) {
      flush();
      const id = line.split('\\').pop();
      if (/^\d+$/.test(id)) cur = { platform: 'gog', id, name: '', installPath: '' };
      continue;
    }
    if (!cur) continue;
    const m = line.match(/^(\w+)\s+REG_\w+\s+(.*)$/);
    if (!m) continue;
    const [, key, val] = m;
    if (key === 'gameName') cur.name = val.trim();
    else if (key === 'path') cur.installPath = val.trim();
    else if (key === 'dependsOn' && val.trim()) cur.dlc = true;
  }
  flush();
  return out.filter((g) => !g.dlc).map(({ dlc, ...g }) => g);
}

function regQuery(key) {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/s'], { windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

async function detectGog() {
  if (process.platform === 'win32') {
    const a = await regQuery('HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games');
    const b = a ? '' : await regQuery('HKLM\\SOFTWARE\\GOG.com\\Games');
    return parseGogRegistry(a || b);
  }
  const home = os.homedir();
  const j = readJson(path.join(home, '.config', 'heroic', 'gog_store', 'installed.json'));
  const lib = readJson(path.join(home, '.config', 'heroic', 'store_cache', 'gog_library.json'));
  const titles = new Map();
  for (const g of (lib?.games || lib?.library || [])) if (g?.app_name) titles.set(String(g.app_name), g.title);
  return (j?.installed || [])
    .filter((g) => g?.install_path && !g.is_dlc)
    .map((g) => ({ platform: 'gog', id: String(g.appName), name: String(titles.get(String(g.appName)) || path.basename(g.install_path)), installPath: String(g.install_path) }));
}

// ---------- Ligação com a Steam (pros catálogos de mods) ----------

/** Nome "limpo" pra comparar entre lojas (sem ™/®, edição, pontuação). */
function normName(n) {
  return String(n || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/\b(game of the year|goty|definitive|enhanced|complete|deluxe|anniversary|remastered|director'?s cut)( edition)?\b/g, '')
    .replace(/\b(edition|for windows)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Escolhe o AppID da Steam com o mesmo nome (puro): só aceita nome igual. */
function pickSteamApp(name, results) {
  const want = normName(name);
  if (!want || !Array.isArray(results)) return null;
  const hit = results.find((r) => normName(r?.name) === want);
  return hit ? Number(hit.appid) || null : null;
}

function getJson(url) {
  return new Promise((resolve) => {
    const req = require('https').get(url, { headers: { 'User-Agent': 'ProjectClub-ModManager' }, timeout: 8000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; if (body.length > 512 * 1024) req.destroy(); });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => req.destroy());
  });
}

/**
 * Detecta os jogos da Epic e da GOG e acha o AppID da Steam de cada um
 * (cache em disco: o nome não muda). `cacheFile` = JSON { [normName]: appId|0 }.
 */
async function detectOtherGames({ cacheFile } = {}) {
  const [epic, gog] = await Promise.all([Promise.resolve().then(detectEpic).catch(() => []), detectGog().catch(() => [])]);
  const games = [...epic, ...gog].filter((g) => isDir(g.installPath));
  const cache = (cacheFile && readJson(cacheFile)) || {};
  let dirty = false;
  for (const g of games) {
    const key = normName(g.name);
    if (key in cache) { g.steamAppId = cache[key] || null; continue; }
    const results = await getJson(`https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(g.name)}`);
    if (results === null) { g.steamAppId = null; continue; } // sem rede: tenta de novo na próxima
    g.steamAppId = pickSteamApp(g.name, results);
    cache[key] = g.steamAppId || 0;
    dirty = true;
  }
  if (dirty && cacheFile) { try { fs.writeFileSync(cacheFile, JSON.stringify(cache)); } catch { /* cache opcional */ } }
  return { epicFound: epic.length > 0, gogFound: gog.length > 0, games };
}

module.exports = { detectOtherGames, parseEpicManifests, parseLegendaryInstalled, parseGogRegistry, normName, pickSteamApp };
