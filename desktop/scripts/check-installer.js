'use strict';
// Testa o instalador do Windows de verdade: instala, confere pasta, registro e atalhos, e
// desinstala. Só roda no Windows; no CI roda numa máquina limpa antes de publicar.
//
//   node scripts/check-installer.js --dist dist/nsis-web --scenarios manifest,fresh,download
//
// Cenários:
//   manifest       tamanho do instalador (menos de 50 MB) e latest.yml batendo com os arquivos
//   fresh          instalação nova, em silêncio, com o pacote já baixado
//   download       instalação nova em que o instalador baixa o pacote sozinho
//   ui             instalação com as telas, clicando em "Instalar" (salva fotos das telas)
//   launch         o app instalado abre e continua aberto
//   start-stress   abre o instalador centenas de vezes numa máquina sem o app (ele nunca pode fechar com erro)
//   legacy-update  versão antiga instalada + atualização automática: fica na pasta em que estava
//   legacy-manual  versão antiga instalada + instalador aberto pela pessoa: vai pra "Project Club"
//
// Opções: --legacy <instalador antigo .exe>   (cenários legacy-*)
//         --serve <porta>   serve o pacote em http://127.0.0.1:<porta> (instalador de teste)
//         --shots <pasta>   onde salvar as fotos das telas

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const INSTALLER_NAME = 'ProjectClub-Setup-Windows.exe';
const EXE_NAME = 'Project Club.exe';
const UNINSTALLER_NAME = 'Uninstall Project Club.exe';
const MAX_INSTALLER_BYTES = 50 * 1024 * 1024;

function option(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

if (process.platform !== 'win32') {
  console.error('Este teste instala o app de verdade e só roda no Windows.');
  process.exit(2);
}

const DIST = path.resolve(option('dist', 'dist/nsis-web'));
const SCENARIOS = option('scenarios', 'manifest,fresh').split(',').map((s) => s.trim()).filter(Boolean);
const LEGACY_INSTALLER = option('legacy') ? path.resolve(option('legacy')) : null;
const SERVE_PORT = option('serve') ? Number(option('serve')) : null;
const SHOTS = path.resolve(option('shots', path.join(os.tmpdir(), 'pc-instalador-fotos')));
const WORK = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'pc-instalador-'));

const LOCAL = process.env.LOCALAPPDATA;
const MODERN_DIR = path.join(LOCAL, 'Programs', 'Project Club');
const LEGACY_DIR = path.join(LOCAL, 'Programs', 'project-club-desktop');
const CACHE_DIR = path.join(LOCAL, 'project-club-desktop-updater');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const same = (a, b) => !!a && !!b && path.normalize(String(a)).toLowerCase() === path.normalize(String(b)).toLowerCase();
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
// O Windows mostra a versão do .exe com quatro números ("1.2.3.0").
const exeVersion = (v) => String(v || '').replace(/^(\d+\.\d+\.\d+)\.0$/, '$1');

// ---------------------------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------------------------
const results = []; // { scenario, ok, text }
let current = '';
function check(ok, text, detail = '') {
  results.push({ scenario: current, ok: !!ok, text });
  console.log(`  ${ok ? 'ok  ' : 'ERRO'} ${text}${!ok && detail ? `\n       ${detail}` : ''}`);
  return !!ok;
}
function equal(actual, expected, text) {
  return check(String(actual) === String(expected), text, `esperado: ${expected}\n       veio:     ${actual}`);
}
function samePath(actual, expected, text) {
  return check(same(actual, expected), text, `esperado: ${expected}\n       veio:     ${actual}`);
}

// ---------------------------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------------------------
const POWERSHELL = (() => {
  try { execFileSync('pwsh', ['-NoProfile', '-Command', '1'], { stdio: 'ignore' }); return 'pwsh'; } catch { return 'powershell'; }
})();

// Roda um trecho de PowerShell a partir de um arquivo (sem depender de como as aspas chegam pela linha de comando).
function ps(script) {
  const file = path.join(WORK, `ps-${process.hrtime.bigint()}.ps1`);
  fs.writeFileSync(file, `\uFEFF[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n${script}\n`);
  try {
    return execFileSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { encoding: 'utf8', maxBuffer: 1 << 24 });
  } finally {
    fs.rmSync(file, { force: true });
  }
}

// Roda um programa sem travar este processo (o servidor de teste precisa continuar respondendo).
function run(file, args, { timeoutMs = 10 * 60 * 1000, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'ignore' });
    let stdout = '';
    let stderr = '';
    if (capture) {
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
    }
    const timer = setTimeout(() => {
      try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* já saiu */ }
      reject(new Error(`${path.basename(file)} não terminou em ${Math.round(timeoutMs / 1000)}s (provável janela de erro esperando resposta)`));
    }, timeoutMs);
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

// Tudo que o instalador deixa no Windows, num objeto só.
function snapshot() {
  const script = `
    $ErrorActionPreference = 'SilentlyContinue'
    $un = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' | Where-Object { $_.DisplayName -like 'Project Club*' } | Select-Object -First 1
    $guid = if ($un) { $un.PSChildName } else { $null }
    $location = if ($guid) { (Get-ItemProperty "HKCU:\\Software\\$guid").InstallLocation } else { $null }
    $machine = @(Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' | Where-Object { $_.DisplayName -like 'Project Club*' }).Count
    $shell = New-Object -ComObject WScript.Shell
    function Target($p) { if (Test-Path -LiteralPath $p) { $shell.CreateShortcut($p).TargetPath } else { $null } }
    function Version($p) { if (Test-Path -LiteralPath $p) { (Get-Item -LiteralPath $p).VersionInfo.ProductVersion } else { $null } }
    $start = Join-Path ([Environment]::GetFolderPath('Programs')) 'Project Club.lnk'
    $desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Project Club.lnk'
    [pscustomobject]@{
      guid = $guid; displayName = $un.DisplayName; displayVersion = $un.DisplayVersion
      uninstallString = $un.UninstallString; quietUninstallString = $un.QuietUninstallString
      installLocation = $location; machineInstalls = $machine
      oldExe = (Get-ItemProperty 'HKCU:\\Software\\ProjectClub').OldExe
      startLink = $start; startTarget = (Target $start)
      desktopLink = $desktop; desktopTarget = (Target $desktop)
      modernVersion = (Version '${path.join(MODERN_DIR, EXE_NAME)}'); legacyVersion = (Version '${path.join(LEGACY_DIR, EXE_NAME)}')
    } | ConvertTo-Json -Compress`;
  const state = JSON.parse(ps(script).trim().split(/\r?\n/).pop());
  state.modernDir = fs.existsSync(MODERN_DIR);
  state.legacyDir = fs.existsSync(LEGACY_DIR);
  state.cachedPackage = fs.existsSync(path.join(CACHE_DIR, 'package.7z'));
  state.cachedOldInstaller = fs.existsSync(path.join(CACHE_DIR, 'installer.exe'));
  state.cacheDir = fs.existsSync(CACHE_DIR);
  return state;
}

function appRunning() {
  try { return execFileSync('tasklist', ['/FI', `IMAGENAME eq ${EXE_NAME}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).includes(EXE_NAME); } catch { return false; }
}
function killApp() {
  try { execFileSync('taskkill', ['/IM', EXE_NAME, '/F', '/T'], { stdio: 'ignore' }); } catch { /* não estava aberto */ }
}

// Desinstala pelo mesmo comando que o Windows usa em "Aplicativos instalados".
async function uninstall() {
  const before = snapshot();
  if (!before.guid) return true;
  const match = String(before.quietUninstallString || '').match(/^"([^"]+)"\s*(.*)$/);
  if (!match) throw new Error(`Comando de desinstalação estranho: ${before.quietUninstallString}`);
  const dir = before.installLocation;
  await run(match[1], match[2].split(/\s+/).filter(Boolean), { timeoutMs: 3 * 60 * 1000 });
  // O desinstalador se copia pra pasta temporária e continua de lá: espera ele acabar.
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    if (!snapshot().guid && !(dir && fs.existsSync(dir))) return true;
  }
  if (dir && fs.existsSync(dir)) {
    const left = fs.readdirSync(dir, { recursive: true }).slice(0, 15);
    console.log(`  sobrou em ${dir}: ${left.length ? left.join(', ') : '(pasta vazia)'}`);
  }
  return false;
}

function clearMarkers() {
  for (const value of ['OldExe', 'PerMachineMigrated']) {
    try { execFileSync('reg', ['delete', 'HKCU\\Software\\ProjectClub', '/v', value, '/f'], { stdio: 'ignore' }); } catch { /* não existia */ }
  }
}

// Deixa a máquina sem nada do app antes de cada cenário.
async function cleanMachine() {
  killApp();
  await uninstall();
  clearMarkers();
  for (const dir of [MODERN_DIR, LEGACY_DIR, CACHE_DIR]) fs.rmSync(dir, { recursive: true, force: true });
  const state = snapshot();
  if (state.guid || state.modernDir || state.legacyDir) throw new Error(`Não deu pra limpar a máquina antes do cenário: ${JSON.stringify(state)}`);
}

// ---------------------------------------------------------------------------------------------
// Arquivos do build
// ---------------------------------------------------------------------------------------------
const installer = path.join(DIST, INSTALLER_NAME);
const packageName = fs.existsSync(DIST) ? fs.readdirSync(DIST).find((f) => /\.nsis\.7z$/i.test(f)) : null;
const packageFile = packageName ? path.join(DIST, packageName) : null;
const manifestFile = path.join(DIST, 'latest.yml');

function sha512(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    fs.createReadStream(file).on('data', (d) => hash.update(d)).on('error', reject).on('end', () => resolve(hash.digest('base64')));
  });
}

// O instalador MOVE o pacote que recebe: sempre entrega uma cópia.
function packageCopy(dir = WORK) {
  const copy = path.join(dir, packageName);
  fs.copyFileSync(packageFile, copy);
  return copy;
}

function serve(dir, port) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const name = path.basename(decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname));
    const file = path.join(dir, name);
    hits.push(name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': fs.statSync(file).size });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ hits, close: () => new Promise((done) => server.close(done)) }));
  });
}

// ---------------------------------------------------------------------------------------------
// Conferências que se repetem
// ---------------------------------------------------------------------------------------------
function expectInstalled(state, { dir, version, shortcuts = true }) {
  const exe = path.join(dir, EXE_NAME);
  check(fs.existsSync(exe), `o app está em ${dir}`);
  check(fs.existsSync(path.join(dir, UNINSTALLER_NAME)), 'o desinstalador está na pasta do app');
  check(fs.existsSync(path.join(dir, 'resources', 'app.asar')), 'os arquivos do app foram extraídos (resources\\app.asar)');
  equal(exeVersion(same(dir, MODERN_DIR) ? state.modernVersion : state.legacyVersion), version, `o .exe instalado é a versão ${version}`);
  samePath(state.installLocation, dir, 'o registro aponta pra pasta certa');
  equal(state.displayVersion, version, `"Aplicativos instalados" mostra a versão ${version}`);
  check(String(state.uninstallString || '').toLowerCase().includes(path.join(dir, UNINSTALLER_NAME).toLowerCase()), 'o Windows desinstala pela pasta certa', String(state.uninstallString));
  equal(state.machineInstalls, 0, 'nada instalado "para todos os usuários" (não pediu administrador)');
  if (shortcuts) {
    samePath(state.startTarget, exe, 'atalho do menu Iniciar abre o app instalado');
    samePath(state.desktopTarget, exe, 'atalho da área de trabalho abre o app instalado');
  }
  check(state.cachedPackage, 'o pacote ficou guardado pra próxima atualização baixar só a diferença');
}

function expectGone(state) {
  check(!state.guid, 'saiu de "Aplicativos instalados"');
  check(!state.modernDir && !state.legacyDir, 'a pasta do app foi apagada');
  check(!state.startTarget && !state.desktopTarget, 'os atalhos foram apagados');
  check(!state.cacheDir, 'o pacote guardado pra atualizações (mais de 100 MB) foi apagado');
}

// Se um programa fechou com erro, o Windows anota qual parte dele quebrou: mostra isso no log.
function crashReport(since) {
  try {
    const out = ps(`$ErrorActionPreference = 'SilentlyContinue'
      Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Id = 1000, 1001; StartTime = [datetime]'${since.toISOString()}' } -MaxEvents 6 |
        ForEach-Object { $_.TimeCreated.ToString('HH:mm:ss') + ' [' + $_.Id + '] ' + ($_.Message -replace '\\s+', ' ') }`).trim();
    console.log(out ? `  registro de erros do Windows:\n    ${out.split(/\r?\n/).join('\n    ')}` : '  (o Windows não registrou nenhum erro de programa)');
  } catch (err) { console.log(`  (não deu pra ler o registro de erros do Windows: ${err.message.split('\n')[0]})`); }
}

async function installSilently(args, text, timeoutMs, file = installer) {
  const started = new Date();
  const { code } = await run(file, args, { timeoutMs });
  const ok = equal(code, 0, `${text} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  if (!ok) crashReport(started);
  return ok;
}

// O instalador antigo (o que estava publicado) tem o defeito que o novo corrige: numa máquina sem
// o app, de vez em quando ele fecha sozinho logo ao abrir. Aqui ele só serve pra montar a
// situação "versão antiga instalada", então tenta de novo até instalar.
async function installLegacy() {
  if (!LEGACY_INSTALLER) throw new Error('Passe --legacy <instalador antigo .exe>.');
  for (let attempt = 1; attempt <= 10; attempt++) {
    const { code } = await run(LEGACY_INSTALLER, ['/S']);
    if (code === 0) {
      return check(true, `instalador antigo (de um clique) instalou${attempt > 1 ? ` (na ${attempt}ª tentativa: nas outras ele fechou sozinho ao abrir)` : ''}`);
    }
  }
  return check(false, 'instalador antigo (de um clique) instalou');
}

// ---------------------------------------------------------------------------------------------
// Cenários
// ---------------------------------------------------------------------------------------------
let version = null;
let appGuid = null; // nome da chave do app no registro (descoberto na primeira instalação)

const scenarios = {
  async manifest() {
    check(fs.existsSync(installer), `o build gerou ${INSTALLER_NAME}`);
    check(!!packageFile, 'o build gerou o pacote do app (.7z)');
    if (!fs.existsSync(installer) || !packageFile) return;
    const size = fs.statSync(installer).size;
    check(size < MAX_INSTALLER_BYTES, `o instalador tem menos de 50 MB (tem ${mb(size)})`);
    check(fs.statSync(packageFile).size > 30 * 1024 * 1024, `o pacote tem o app inteiro (${mb(fs.statSync(packageFile).size)})`);

    const yaml = require('js-yaml');
    const manifest = yaml.load(fs.readFileSync(manifestFile, 'utf8'));
    equal(manifest.version, version, 'latest.yml tem a versão do build');
    equal(manifest.files && manifest.files[0] && manifest.files[0].url, INSTALLER_NAME, 'latest.yml aponta pro instalador pelo nome fixo');
    equal(manifest.files[0].sha512, await sha512(installer), 'latest.yml tem o hash certo do instalador');
    const pkg = manifest.packages && manifest.packages.x64;
    check(!!pkg, 'latest.yml lista o pacote do app');
    if (!pkg) return;
    equal(pkg.size, fs.statSync(packageFile).size, 'latest.yml tem o tamanho certo do pacote');
    equal(pkg.sha512, await sha512(packageFile), 'latest.yml tem o hash certo do pacote');
    check(pkg.blockMapSize > 0, 'o pacote permite baixar só a diferença nas próximas atualizações');

    const { manifestProblems } = require('./installer-manifest');
    const problems = manifestProblems(manifest);
    check(!problems.length, 'latest.yml pronto pra publicar', problems.join('; '));

    // Mesma conta que o app instalado faz pra achar os dois arquivos.
    const feed = new URL(require('../package.json').build.publish.url);
    let resolved = null;
    try {
      resolved = require('electron-updater/out/providers/Provider').resolveFiles(manifest, feed);
    } catch (err) {
      console.log(`  aviso: não deu pra carregar o electron-updater pra conferir os endereços (${err.message})`);
    }
    if (resolved) {
      equal(resolved[0].url.href, `${feed.href}${INSTALLER_NAME}`, 'o app instalado baixa o instalador do link fixo');
      equal(resolved[0].packageInfo && resolved[0].packageInfo.path, pkg.path, 'o app instalado baixa o pacote da release da própria versão');
    }
  },

  async fresh() {
    await cleanMachine();
    if (!await installSilently(['/S', `--package-file=${packageCopy()}`], 'o instalador terminou sem erro')) return;
    const state = snapshot();
    appGuid = state.guid;
    expectInstalled(state, { dir: MODERN_DIR, version });
    check(!state.legacyDir, 'não criou a pasta antiga "project-club-desktop"');
    check(!state.oldExe, 'instalação nova não deixa marca de mudança de pasta');
    check(await uninstall(), 'a desinstalação terminou');
    expectGone(snapshot());
  },

  async download() {
    await cleanMachine();
    // Numa pasta só com o instalador: sem o pacote do lado, ele precisa baixar.
    const alone = fs.mkdtempSync(path.join(WORK, 'so-o-instalador-'));
    const copy = path.join(alone, INSTALLER_NAME);
    fs.copyFileSync(installer, copy);
    const server = SERVE_PORT ? await serve(DIST, SERVE_PORT) : null;
    try {
      if (!await installSilently(['/S'], 'o instalador baixou o pacote e terminou sem erro', 15 * 60 * 1000, copy)) return;
    } finally {
      if (server) await server.close();
    }
    if (server) check(server.hits.includes(packageName), 'o instalador pediu o pacote pela internet', `pedidos: ${server.hits.join(', ') || 'nenhum'}`);
    const state = snapshot();
    expectInstalled(state, { dir: MODERN_DIR, version });
    check(await uninstall(), 'a desinstalação terminou');
    expectGone(snapshot());
  },

  async ui() {
    await cleanMachine();
    const folder = fs.mkdtempSync(path.join(WORK, 'telas-'));
    const copy = path.join(folder, INSTALLER_NAME);
    fs.copyFileSync(installer, copy);
    // Sem servidor de teste, o pacote fica do lado do instalador (ele confere o hash e usa).
    const server = SERVE_PORT ? await serve(DIST, SERVE_PORT) : null;
    if (!server) packageCopy(folder);
    let out;
    try {
      out = await run(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'installer-ui.ps1'),
        '-Installer', copy, '-Shots', SHOTS, '-InstalledExe', path.join(MODERN_DIR, EXE_NAME)], { timeoutMs: 10 * 60 * 1000, capture: true });
    } finally {
      if (server) await server.close();
    }
    if (!equal(out.code, 0, 'o instalador abriu, instalou e chegou na tela final', out.stderr.trim())) return;
    const screens = JSON.parse(out.stdout.trim().split(/\r?\n/).pop());
    console.log(`  janela: "${screens.title}"\n  1ª tela: ${JSON.stringify(screens.start)}\n  última tela: ${JSON.stringify(screens.finish)}`);
    const first = screens.start.join('\n');
    check(/Instalar o Project Club/.test(first), 'a primeira tela diz "Instalar o Project Club"');
    check(first.toLowerCase().includes(MODERN_DIR.toLowerCase()), 'a primeira tela mostra a pasta "Project Club" onde vai instalar', first);
    check(/instalar/i.test(screens.startButton), `o botão da primeira tela é "Instalar" (${screens.startButton})`);
    check(!/todos|all users|anyone/i.test(first), 'não pergunta "para quem instalar"');
    check(/concluir/i.test(screens.finishButton), `a última tela tem o botão "Concluir" (${screens.finishButton})`);
    check(screens.finish.some((t) => /Project Club/.test(t)), 'a última tela oferece abrir o Project Club');
    check(screens.closedByItself, 'o instalador fechou ao clicar em Concluir');
    await sleep(2000);
    check(!appRunning(), 'com a opção desmarcada, o app não abriu sozinho');
    const state = snapshot();
    expectInstalled(state, { dir: MODERN_DIR, version });
    check(await uninstall(), 'a desinstalação terminou');
    expectGone(snapshot());
  },

  // Abrir o instalador numa máquina sem o app é o caminho de quem está instalando pela primeira
  // vez. Um erro que só aparece de vez em quando não é pego por uma instalação só: aqui ele abre
  // muitas vezes seguidas (com --check-start ele faz a partida inteira e sai antes de instalar).
  async 'start-stress'() {
    await cleanMachine();
    const runs = Number(option('stress-runs', 300));
    const started = new Date();
    const bad = {};
    for (let i = 0; i < runs; i++) {
      const { code } = await run(installer, ['/S', '--check-start'], { timeoutMs: 60 * 1000 });
      if (code !== 0) bad[code] = (bad[code] || 0) + 1;
    }
    const failures = Object.values(bad).reduce((a, b) => a + b, 0);
    const detail = Object.entries(bad).map(([code, n]) => `${n}x código ${code} (0x${(Number(code) >>> 0).toString(16)})`).join(', ');
    check(failures === 0, `o instalador abriu ${runs} vezes sem fechar com erro (${((Date.now() - started) / 1000).toFixed(0)}s)`, `${failures} de ${runs}: ${detail}`);
    if (failures) crashReport(started);
    const state = snapshot();
    check(!state.guid && !state.modernDir && !state.legacyDir, 'só abrir o instalador não instala nada');
    if (appGuid) {
      // A anotação temporária que evita o erro de partida (preInit do installer.nsh) tem que sumir.
      let left = true;
      try { execFileSync('reg', ['query', `HKCU\\Software\\${appGuid}`], { stdio: 'ignore' }); } catch { left = false; }
      check(!left, 'abrir o instalador não deixa nada anotado no registro');
    } else {
      console.log('  aviso: sem o cenário "fresh" antes, não dá pra conferir o registro');
    }
  },

  async launch() {
    await cleanMachine();
    if (!await installSilently(['/S', `--package-file=${packageCopy()}`], 'o instalador terminou sem erro')) return;
    const child = spawn(path.join(MODERN_DIR, EXE_NAME), [], { detached: true, stdio: 'ignore' });
    child.unref();
    await sleep(25000);
    check(appRunning(), 'o app instalado abriu e continua aberto depois de 25 segundos');
    try {
      fs.mkdirSync(SHOTS, { recursive: true });
      ps(`Add-Type -AssemblyName System.Windows.Forms, System.Drawing; $b = [System.Windows.Forms.SystemInformation]::VirtualScreen; $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height; $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size); $bmp.Save('${path.join(SHOTS, 'app-aberto.png')}')`);
    } catch (err) { console.log(`  aviso: sem foto do app aberto (${err.message.split('\n')[0]})`); }
    killApp();
    await sleep(3000);
    check(await uninstall(), 'a desinstalação terminou');
    expectGone(snapshot());
  },

  async 'legacy-update'() {
    await cleanMachine();
    if (!await installLegacy()) return;
    const before = snapshot();
    samePath(before.installLocation, LEGACY_DIR, 'a versão antiga fica em "project-club-desktop"');
    check(!!before.legacyVersion && exeVersion(before.legacyVersion) !== version, `versão antiga instalada: ${exeVersion(before.legacyVersion)}`);
    check(before.cachedOldInstaller, 'a versão antiga guardava uma cópia inteira do instalador');

    // Exatamente o comando que o app antigo roda ao se atualizar (sem o --force-run, que abriria o app).
    if (!await installSilently(['--updated', '/S', `--package-file=${packageCopy()}`], 'a atualização automática terminou sem erro')) return;
    const state = snapshot();
    expectInstalled(state, { dir: LEGACY_DIR, version });
    check(!state.modernDir, 'a atualização automática não muda o app de pasta');
    check(!state.oldExe, 'sem mudança de pasta, sem marca de mudança');
    check(!state.cachedOldInstaller, 'a cópia do instalador antigo (mais de 100 MB) foi apagada');

    // A próxima atualização já é do instalador novo por cima do novo.
    if (!await installSilently(['--updated', '/S', `--package-file=${packageCopy()}`], 'a atualização seguinte terminou sem erro')) return;
    expectInstalled(snapshot(), { dir: LEGACY_DIR, version });

    check(await uninstall(), 'a desinstalação terminou');
    expectGone(snapshot());
  },

  async 'legacy-manual'() {
    await cleanMachine();
    if (!await installLegacy()) return;
    samePath(snapshot().installLocation, LEGACY_DIR, 'a versão antiga fica em "project-club-desktop"');

    // A pessoa baixou o instalador novo do site e abriu (aqui em silêncio pra não depender das telas).
    if (!await installSilently(['/S', `--package-file=${packageCopy()}`], 'o instalador novo terminou sem erro')) return;
    const state = snapshot();
    expectInstalled(state, { dir: MODERN_DIR, version });
    check(!state.legacyDir, 'a pasta antiga "project-club-desktop" foi apagada');
    samePath(state.oldExe, path.join(LEGACY_DIR, EXE_NAME), 'ficou anotado o .exe antigo (o app corrige "Iniciar com o Windows" e o ícone fixado)');
    check(!state.cachedOldInstaller, 'a cópia do instalador antigo (mais de 100 MB) foi apagada');

    // Rodar o instalador de novo por cima não pode estragar nada.
    if (!await installSilently(['/S', `--package-file=${packageCopy()}`], 'reinstalar por cima terminou sem erro')) return;
    const again = snapshot();
    expectInstalled(again, { dir: MODERN_DIR, version });
    check(!again.legacyDir, 'reinstalar não recria a pasta antiga');

    check(await uninstall(), 'a desinstalação terminou');
    expectGone(snapshot());
    clearMarkers();
  },
};

// ---------------------------------------------------------------------------------------------
(async () => {
  version = require('../package.json').version;
  console.log(`Instalador: ${installer}\nPacote:     ${packageFile}\nVersão:     ${version}\nCenários:   ${SCENARIOS.join(', ')}\n`);
  for (const name of SCENARIOS) {
    current = name;
    console.log(`\n== ${name}`);
    if (!scenarios[name]) { check(false, `cenário desconhecido: ${name}`); continue; }
    if (name !== 'manifest' && (!fs.existsSync(installer) || !packageFile)) { check(false, 'faltam os arquivos do build'); continue; }
    try {
      await scenarios[name]();
    } catch (err) {
      check(false, `o cenário parou: ${err.message}`);
      try { console.log(`  estado: ${JSON.stringify(snapshot())}`); } catch { /* sem estado */ }
    }
  }
  try { await cleanMachine(); } catch (err) { console.log(`\naviso: limpeza final: ${err.message}`); }
  fs.rmSync(WORK, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  const lines = [`### Instalador do Windows: ${failed.length ? `${failed.length} conferência(s) com erro` : 'tudo certo'}`, '',
    '| Cenário | Conferências | Erros |', '|---|---|---|',
    ...SCENARIOS.map((s) => `| ${s} | ${results.filter((r) => r.scenario === s).length} | ${results.filter((r) => r.scenario === s && !r.ok).map((r) => r.text).join('<br>') || 'nenhum'} |`)];
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  console.log(`\n${results.length - failed.length} de ${results.length} conferências passaram.`);
  process.exit(failed.length ? 1 : 0);
})();
