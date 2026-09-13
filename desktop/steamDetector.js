// Detecção de jogos instalados via Steam — item pedido: "Project Club
// consiga detectar automaticamente os jogos instalados através da Steam
// no computador do usuário... o usuário não deve precisar cadastrar
// manualmente." Roda só aqui, no processo principal do Electron (nunca no
// navegador — item pedido 13: "o navegador não possui acesso livre às
// pastas da Steam por questões de segurança"), e só localmente (item
// pedido 30: "a detecção da Steam deve acontecer localmente sempre que
// possível... o servidor deve receber somente os dados necessários").
//
// Não assume um caminho fixo de instalação (item pedido 3: "não assumir
// somente C:\Program Files (x86)\Steam... o usuário pode ter Steam em
// outro disco, várias Steam Libraries, jogos em HD/SSD diferentes") — lê
// a própria configuração da Steam (registro do Windows / pastas padrão do
// Linux) pra achar a instalação, e depois o arquivo oficial dela
// (steamapps/libraryfolders.vdf) pra achar TODAS as bibliotecas
// configuradas, em qualquer disco.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// ---------- Parser mínimo do formato VDF/KeyValues da Valve ----------
// A Steam usa esse formato (texto, chave-valor entre aspas, blocos com
// chaves) pra TODOS os seus arquivos de configuração — não existe JSON
// nem XML aqui. É simples o bastante pra não precisar de nenhuma
// dependência nova só pra isso (mantém o desktop/package.json enxuto,
// sem builds extras); só um tokenizer + parser recursivo pequeno.
function parseVdf(text) {
  let i = 0;
  const len = text.length;

  function skipWhitespaceAndComments() {
    for (;;) {
      while (i < len && /\s/.test(text[i])) i++;
      if (text[i] === '/' && text[i + 1] === '/') {
        while (i < len && text[i] !== '\n') i++;
        continue;
      }
      break;
    }
  }

  function readToken() {
    skipWhitespaceAndComments();
    if (i >= len) return null;
    if (text[i] === '{' || text[i] === '}') return text[i++];
    if (text[i] === '"') {
      i++; // pula a aspa inicial
      let out = '';
      while (i < len && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < len) { out += text[i + 1]; i += 2; continue; }
        out += text[i]; i++;
      }
      i++; // pula a aspa final
      return out;
    }
    // Token sem aspas (raro nesse formato, mas alguns arquivos usam) —
    // lê até achar espaço/chave.
    let out = '';
    while (i < len && !/[\s{}]/.test(text[i])) { out += text[i]; i++; }
    return out || null;
  }

  function parseObject() {
    const obj = {};
    for (;;) {
      const key = readToken();
      if (key === null || key === '}') break;
      const next = readToken();
      if (next === '{') {
        obj[key] = parseObject();
      } else {
        obj[key] = next;
      }
    }
    return obj;
  }

  // O arquivo inteiro é "NomeDaRaiz" { ... } — descarta o nome da raiz e
  // devolve só o conteúdo do bloco.
  readToken(); // nome da raiz (ex: "libraryfolders", "AppState")
  const openBrace = readToken();
  if (openBrace !== '{') return {};
  return parseObject();
}

// ---------- Localizar a instalação da Steam ----------
function findSteamInstallWindows() {
  // 1) Registro do Windows — fonte oficial de onde a Steam foi instalada
  // (a própria Steam escreve isso lá; é o jeito mais confiável de achar
  // uma instalação em qualquer disco, não só o padrão).
  try {
    const out = execFileSync('reg', ['query', 'HKEY_CURRENT_USER\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', windowsHide: true });
    const match = out.match(/SteamPath\s+REG_SZ\s+(.+)/i);
    if (match) {
      const p = match[1].trim().replace(/\//g, '\\');
      if (fs.existsSync(p)) return p;
    }
  } catch { /* registro não encontrado — cai pros caminhos padrão abaixo */ }

  // 2) Caminhos padrão mais comuns, em qualquer letra de unidade que
  // exista no sistema (não assume só C:).
  const drives = 'CDEFGHIJ'.split('');
  const suffixes = ['Program Files (x86)\\Steam', 'Program Files\\Steam', 'Steam', 'SteamLibrary\\Steam'];
  for (const drive of drives) {
    for (const suffix of suffixes) {
      const candidate = `${drive}:\\${suffix}`;
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function findSteamInstallLinux() {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.steam', 'steam'),
    path.join(home, '.local', 'share', 'Steam'),
    path.join(home, '.var', 'app', 'com.valvesoftware.Steam', 'data', 'Steam'), // Flatpak
    path.join(home, 'snap', 'steam', 'common', '.local', 'share', 'Steam'), // Snap
  ];
  return candidates.find((c) => fs.existsSync(c)) || null;
}

function findSteamInstall() {
  return process.platform === 'linux' ? findSteamInstallLinux() : findSteamInstallWindows();
}

// ---------- Bibliotecas Steam (podem estar em vários discos) ----------
// Item pedido: "o usuário pode ter... várias Steam Libraries, jogos
// instalados em HD/SSD diferentes... o sistema deve procurar as
// bibliotecas configuradas pela Steam" — libraryfolders.vdf é o arquivo
// OFICIAL onde a própria Steam registra todas as bibliotecas que a
// pessoa configurou, em qualquer disco.
function listLibraryFolders(steamPath) {
  const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
  if (!fs.existsSync(vdfPath)) return [steamPath]; // instalação antiga sem bibliotecas extras configuradas
  try {
    const parsed = parseVdf(fs.readFileSync(vdfPath, 'utf8'));
    const folders = Object.keys(parsed)
      .filter((k) => /^\d+$/.test(k))
      .map((k) => parsed[k]?.path)
      .filter(Boolean);
    // A biblioteca principal (dentro da própria pasta de instalação) às
    // vezes também aparece listada, às vezes não — inclui sempre, sem
    // duplicar.
    const all = new Set([steamPath, ...folders]);
    return Array.from(all);
  } catch {
    return [steamPath];
  }
}

// ---------- Jogos instalados em cada biblioteca ----------
// Item pedido: "identificar os jogos instalados em cada uma delas" — cada
// jogo instalado tem um "steamapps/appmanifest_<appid>.acf" (também VDF)
// com nome, AppID e pasta de instalação.
function listInstalledGamesInLibrary(libraryPath) {
  const steamappsDir = path.join(libraryPath, 'steamapps');
  if (!fs.existsSync(steamappsDir)) return [];
  const games = [];
  for (const file of fs.readdirSync(steamappsDir)) {
    if (!/^appmanifest_\d+\.acf$/i.test(file)) continue;
    try {
      const manifest = parseVdf(fs.readFileSync(path.join(steamappsDir, file), 'utf8'));
      const appId = Number(manifest.appid);
      if (!appId || !manifest.installdir) continue;
      const installPath = path.join(steamappsDir, 'common', manifest.installdir);
      // "stateflags" 4 = totalmente instalado; outros valores incluem
      // "atualizando"/"baixando parcial" — só interessa o que já pode
      // ser usado de verdade agora.
      const fullyInstalled = fs.existsSync(installPath);
      if (!fullyInstalled) continue;
      games.push({
        steamAppId: appId,
        name: manifest.name,
        installPath,
        libraryPath,
      });
    } catch { /* manifesto corrompido/parcial — ignora só esse jogo, não trava o resto da varredura */ }
  }
  return games;
}

// Item pedido: "o sistema deve mostrar apenas os jogos que realmente
// foram encontrados nas bibliotecas Steam do usuário" — função pública
// principal, chamada pelo IPC (ver main.js: 'mods:detect-steam-games').
function detectInstalledSteamGames() {
  const steamPath = findSteamInstall();
  if (!steamPath) return { steamFound: false, games: [] };
  const libraries = listLibraryFolders(steamPath);
  const games = libraries.flatMap(listInstalledGamesInLibrary);
  // Um mesmo AppID nunca deveria aparecer em duas bibliotecas ao mesmo
  // tempo (a Steam não deixa instalar duplicado), mas por segurança
  // remove duplicata caso aconteça.
  const seen = new Set();
  const deduped = games.filter((g) => (seen.has(g.steamAppId) ? false : (seen.add(g.steamAppId), true)));
  return { steamFound: true, steamPath, games: deduped };
}

// Item pedido 29: "se o sistema não encontrar automaticamente a
// instalação... o usuário poderá selecionar manualmente a pasta." — usado
// quando detectInstalledSteamGames não achar um jogo específico que o
// usuário sabe que tem instalado (Steam fora do padrão, biblioteca em
// HD externo desconectado na hora da varredura, etc). A validação real
// (perguntar o caminho pro usuário) fica pro lado do main.js, que tem
// acesso ao diálogo nativo do Electron.
function looksLikeGameFolder(candidatePath) {
  return fs.existsSync(candidatePath) && fs.statSync(candidatePath).isDirectory();
}

module.exports = { detectInstalledSteamGames, looksLikeGameFolder, findSteamInstall };
