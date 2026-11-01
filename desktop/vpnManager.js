// VPN do Project Club (botão ao lado do globo, na barra de título).
//
// Servidores: os do VPN Gate (lista entregue pelo servidor do Project Club,
// /api/vpn). Conexão: OpenVPN, que precisa de permissão de administrador pra
// mexer na rede do computador:
//  - Windows: o OpenVPN oficial vem DENTRO do instalador do Project Club
//    (resources/openvpn/OpenVPN.msi). Na primeira conexão ele é instalado em
//    silêncio (só o driver de rede e o openvpn.exe, sem o OpenVPN GUI) e a
//    cada conexão o Windows pede a confirmação de administrador (UAC).
//  - Linux: usa o openvpn do sistema via pkexec (o sistema pede a senha).
//
// O app conversa com o openvpn pela interface de gerenciamento (127.0.0.1 +
// senha aleatória): estado, bytes e "desconectar". Se o app fechar ou cair,
// a interface cai junto e o openvpn sai sozinho (--management-signal +
// --remap-usr1 SIGTERM) — a VPN nunca fica ligada "órfã".
//
// Segurança: o openvpn roda como administrador, então a configuração é
// filtrada (só diretivas de cliente conhecidas, nada de scripts/plugins),
// "--script-security 1" vem DEPOIS do arquivo e, no Windows, o script elevado
// confere o SHA-256 do arquivo e copia pra uma pasta que só administradores
// podem alterar antes de abrir.
// Fora do Electron (teste ao vivo em test/live/vpn-live.js) não há `app`.
const app = (() => { try { const e = require('electron'); return typeof e === 'object' ? e.app : null; } catch { return null; } })();
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------- configuração ----------------

// Diretivas de cliente permitidas (o resto é descartado). Blocos inline
// (<ca> etc.) são mantidos inteiros.
const ALLOWED = new Set([
  'client', 'dev', 'proto', 'remote', 'cipher', 'data-ciphers', 'data-ciphers-fallback', 'auth', 'resolv-retry', 'nobind',
  'persist-key', 'persist-tun', 'verb', 'remote-cert-tls', 'ns-cert-type', 'tls-client', 'comp-lzo', 'compress',
  'key-direction', 'auth-nocache', 'reneg-sec', 'mute-replay-warnings', 'float', 'keepalive', 'ping', 'ping-restart',
  'tun-mtu', 'mssfix', 'sndbuf', 'rcvbuf', 'pull', 'tls-version-min', 'tls-cipher', 'verify-x509-name', 'remote-random',
  'explicit-exit-notify', 'connect-retry', 'server-poll-timeout', 'allow-compression', 'fragment', 'redirect-gateway',
]);
const BLOCKS = new Set(['ca', 'cert', 'key', 'tls-auth', 'tls-crypt', 'tls-crypt-v2', 'extra-certs']);
const MAX_CONFIG = 64 * 1024;

/**
 * Filtra a configuração OpenVPN: só cliente, sem scripts/plugins/arquivos
 * externos. Lança Error se não sobrar um servidor válido.
 */
function sanitizeConfig(text) {
  const src = String(text || '');
  if (!src || src.length > MAX_CONFIG) throw new Error('configuração de VPN inválida');
  const out = [];
  let block = null;
  let remote = null;
  for (const raw of src.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (block) {
      out.push(line);
      if (line.toLowerCase() === `</${block}>`) block = null;
      continue;
    }
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const open = line.match(/^<([a-z0-9-]+)>$/i);
    if (open) {
      const name = open[1].toLowerCase();
      if (!BLOCKS.has(name)) throw new Error(`bloco não permitido na configuração: ${name}`);
      block = name;
      out.push(`<${name}>`);
      continue;
    }
    const [cmd, ...args] = line.split(/\s+/);
    const key = cmd.toLowerCase().replace(/^--/, '');
    if (!ALLOWED.has(key)) continue;
    // Argumentos só com caracteres seguros (nada de caminhos/aspas/scripts).
    if (args.some((a) => !/^[\w.:@/+=-]+$/.test(a))) continue;
    if (key === 'remote') {
      if (remote || args.length < 2 || !/^[\w.-]+$/.test(args[0]) || !/^\d{1,5}$/.test(args[1])) continue;
      remote = { host: args[0], port: Number(args[1]) };
    }
    if (key === 'dev' && !/^tun\d*$/.test(args[0] || '')) continue;
    out.push([key, ...args].join(' '));
  }
  if (block) throw new Error('configuração de VPN incompleta');
  if (!remote) throw new Error('configuração de VPN sem servidor');
  if (!out.includes('client')) out.unshift('client');
  return { config: `${out.join('\n')}\n`, remote };
}

/** Opções da linha de comando (DEPOIS do --config, então valem por cima dele). */
function openvpnArgs({ cfgPath, port, pwPath, logPath, platform = process.platform }) {
  return [
    '--config', cfgPath,
    '--script-security', '1',
    '--management', '127.0.0.1', String(port), pwPath,
    '--management-signal', '--remap-usr1', 'SIGTERM',
    // Servidores do VPN Gate ainda usam AES-128-CBC.
    '--data-ciphers', 'AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305:AES-128-CBC:AES-256-CBC',
    '--data-ciphers-fallback', 'AES-128-CBC',
    '--connect-retry-max', '2', '--connect-timeout', '10', '--auth-retry', 'none',
    ...(platform === 'win32' ? ['--block-outside-dns'] : []),
    '--verb', '3', '--log', logPath,
  ];
}

/** Uma linha >STATE:… da interface de gerenciamento. */
function parseState(line) {
  const m = String(line).match(/^>STATE:(\d+),([A-Z_]+),([^,]*),([^,]*),([^,]*)/);
  if (!m) return null;
  return { at: Number(m[1]) * 1000, state: m[2], detail: m[3], localIp: m[4] || null, remoteIp: m[5] || null };
}

// ---------------- Windows ----------------

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;
const WIN_FEATURES = 'OpenVPN,Drivers,Drivers.OvpnDco,Drivers.TAPWindows6';

/**
 * Script que roda COMO ADMINISTRADOR (UAC): instala o OpenVPN embutido se
 * preciso, confere e protege a configuração e abre o openvpn escondido.
 * Códigos de saída: 21 = arquivo mudou, 22 = OpenVPN não instalou.
 */
function elevatedScript({ srcPath, sha256, msiPath, port, password }) {
  const args = (cfg, pwf, log) => openvpnArgs({ cfgPath: cfg, port, pwPath: pwf, logPath: log, platform: 'win32' });
  // Os caminhos da pasta protegida não têm espaços, então dá pra montar a linha direto.
  const line = args('__CFG__', '__PW__', '__LOG__').map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
  return [
    "$ErrorActionPreference = 'Stop'",
    "$dir = Join-Path $env:ProgramData 'ProjectClub\\vpn'",
    'New-Item -ItemType Directory -Force -Path $dir | Out-Null',
    // Só Administradores (S-1-5-32-544) e SYSTEM (S-1-5-18) mexem na pasta.
    "& icacls.exe $dir /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' | Out-Null",
    `$bytes = [IO.File]::ReadAllBytes(${psQuote(srcPath)})`,
    "$hash = ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes))).Replace('-', '').ToLower()",
    `if ($hash -ne ${psQuote(sha256)}) { exit 21 }`,
    "$cfg = Join-Path $dir 'atual.ovpn'",
    '[IO.File]::WriteAllBytes($cfg, $bytes)',
    "$pwf = Join-Path $dir 'gerencia.txt'",
    `[IO.File]::WriteAllText($pwf, ${psQuote(password)})`,
    "$log = Join-Path $dir 'openvpn.log'",
    'function Find-OpenVpn {',
    "  $p = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\OpenVPN' -ErrorAction SilentlyContinue).exe_path",
    "  if (-not $p) { $p = Join-Path $env:ProgramFiles 'OpenVPN\\bin\\openvpn.exe' }",
    '  if (Test-Path $p) { return $p } else { return $null }',
    '}',
    '$exe = Find-OpenVpn',
    'if (-not $exe) {',
    `  $msi = ${psQuote(msiPath)}`,
    "  if (-not (Test-Path $msi)) { exit 22 }",
    `  $p = Start-Process -FilePath msiexec.exe -ArgumentList @('/i', ('"' + $msi + '"'), '/qn', '/norestart', 'ADDLOCAL=${WIN_FEATURES}') -Wait -PassThru`,
    '  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { exit 22 }',
    '  $exe = Find-OpenVpn',
    '  if (-not $exe) { exit 22 }',
    '}',
    `$line = ${psQuote(line)}.Replace('__CFG__', $cfg).Replace('__PW__', $pwf).Replace('__LOG__', $log)`,
    'Start-Process -FilePath $exe -ArgumentList $line -WindowStyle Hidden',
    'exit 0',
  ].join('\n');
}

/** powershell.exe (não elevado) que pede o UAC e roda o script elevado. */
function windowsLaunchArgs(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const inner = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded].map(psQuote).join(',');
  const outer = `try { $p = Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList ${inner}; exit $p.ExitCode } catch { exit 30 }`;
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', outer];
}

function windowsNeedsInstall() {
  const p = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'OpenVPN', 'bin', 'openvpn.exe');
  return !fs.existsSync(p);
}

// Ajustes pro teste ao vivo: pasta própria, MSI baixado na hora e Linux sem pkexec (já é root).
const opts = { dir: null, msiPath: null, linuxElevate: 'pkexec', onState: null };
function configure(o) { Object.assign(opts, o || {}); }

function bundledMsi() {
  if (opts.msiPath) return opts.msiPath;
  const base = app?.isPackaged ? process.resourcesPath : path.join(__dirname, 'vendor');
  return path.join(base, 'openvpn', 'OpenVPN.msi');
}

// ---------------- Linux ----------------

const LINUX_OPENVPN = ['/usr/sbin/openvpn', '/usr/bin/openvpn'];
const linuxOpenvpn = () => LINUX_OPENVPN.find((p) => fs.existsSync(p)) || null;

// ---------------- estado e conexão ----------------

let win = null;
let state = { status: 'off', server: null, ip: null, since: null, bytesIn: 0, bytesOut: 0, error: null, firstTime: false };
let mgmt = null;
let child = null;
let userStopped = false;
let connectTimer = null;

const userDir = () => {
  const d = opts.dir || path.join(app.getPath('userData'), 'vpn');
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
};

function setState(patch) {
  state = { ...state, ...patch };
  if (win && !win.isDestroyed()) win.webContents.send('vpn:state', state);
  opts.onState?.(state);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function fail(message) {
  clearTimeout(connectTimer);
  setState({ status: 'error', error: message, since: null });
}

/** Liga na interface de gerenciamento (tenta por até `waitMs`, o tempo do UAC). */
function attachManagement(port, password, waitMs) {
  const deadline = Date.now() + waitMs;
  const tryOnce = () => {
    if (state.status !== 'connecting' || userStopped) return;
    const sock = net.connect(port, '127.0.0.1');
    let buf = '';
    let ok = false;
    sock.setEncoding('utf8');
    sock.on('connect', () => { ok = true; mgmt = sock; });
    sock.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        onManagementLine(line);
      }
      if (/ENTER PASSWORD:\s*$/.test(buf)) { sock.write(`${password}\n`); buf = ''; }
    });
    sock.on('error', () => {});
    sock.on('close', () => {
      if (!ok) { if (Date.now() < deadline) setTimeout(tryOnce, 600); else if (state.status === 'connecting') fail('A VPN não abriu. Se o Windows perguntou, toque em "Sim" para permitir.'); return; }
      mgmt = null;
      clearTimeout(connectTimer);
      if (userStopped || state.status === 'disconnecting') setState({ status: 'off', since: null, ip: null, error: null });
      else if (state.status === 'connected') setState({ status: 'error', since: null, ip: null, error: 'A conexão com o servidor de VPN caiu. Escolha outro servidor.' });
      else if (state.status === 'connecting') fail('O servidor de VPN não respondeu. Escolha outro servidor.');
    });
  };
  tryOnce();
}

function onManagementLine(line) {
  if (line.startsWith('>INFO:')) {
    mgmt?.write('state on\nbytecount 3\nstate\n');
    return;
  }
  if (line.startsWith('>BYTECOUNT:')) {
    const [inB, outB] = line.slice(11).split(',').map(Number);
    if (state.status === 'connected') setState({ bytesIn: inB || 0, bytesOut: outB || 0 });
    return;
  }
  const st = parseState(line.startsWith('>STATE:') ? line : (/^\d+,[A-Z_]+,/.test(line) ? `>STATE:${line}` : ''));
  if (!st) return;
  if (st.state === 'CONNECTED') {
    clearTimeout(connectTimer);
    setState({ status: 'connected', since: Date.now(), ip: st.remoteIp || state.server?.ip || null, error: null });
  } else if (st.state === 'RECONNECTING' && state.status === 'connected') {
    setState({ status: 'connecting' });
  }
}

/**
 * Conecta no servidor escolhido. `server` = { id, country, countryName }
 * (só pra mostrar), `configText` = configuração vinda de /api/vpn.
 */
async function connect(configText, server) {
  if (['connecting', 'connected', 'disconnecting'].includes(state.status)) await disconnect();
  let sanitized;
  try { sanitized = sanitizeConfig(configText); } catch (err) { fail(err.message); return state; }
  userStopped = false;
  const firstTime = process.platform === 'win32' && windowsNeedsInstall();
  setState({
    status: 'connecting', error: null, ip: null, since: null, bytesIn: 0, bytesOut: 0, firstTime,
    server: { id: server?.id || null, country: server?.country || null, countryName: server?.countryName || null, ip: sanitized.remote.host },
  });
  const port = await freePort();
  const password = crypto.randomBytes(24).toString('hex');
  const dir = userDir();
  const cfgPath = path.join(dir, 'servidor.ovpn');
  fs.writeFileSync(cfgPath, sanitized.config, { mode: 0o600 });

  if (process.platform === 'win32') {
    const msiPath = bundledMsi();
    const script = elevatedScript({ srcPath: cfgPath, sha256: crypto.createHash('sha256').update(sanitized.config).digest('hex'), msiPath, port, password });
    const ps = spawn('powershell.exe', windowsLaunchArgs(script), { windowsHide: true });
    ps.on('error', () => fail('Não deu para abrir o PowerShell do Windows.'));
    ps.on('exit', (code) => {
      if (state.status !== 'connecting') return;
      if (code === 30) fail('Você não permitiu a VPN no aviso do Windows.');
      else if (code === 21) fail('A configuração da VPN mudou no meio do caminho. Tente de novo.');
      else if (code === 22) fail('Não deu para instalar o componente de rede da VPN. Tente de novo ou reinicie o computador.');
      else if (code !== 0) fail(`A VPN não abriu (código ${code}).`);
    });
  } else if (process.platform === 'linux') {
    const bin = linuxOpenvpn();
    if (!bin) { fail('Instale o OpenVPN para usar a VPN: sudo apt install openvpn'); return state; }
    const pwPath = path.join(dir, 'gerencia.txt');
    fs.writeFileSync(pwPath, password, { mode: 0o600 });
    const args = openvpnArgs({ cfgPath, port, pwPath, logPath: path.join(dir, 'openvpn.log'), platform: 'linux' });
    child = opts.linuxElevate === 'none' ? spawn(bin, args, { stdio: 'ignore' }) : spawn('pkexec', [bin, ...args], { stdio: 'ignore' });
    child.on('error', () => fail('Não deu para pedir a permissão do sistema (pkexec).'));
    child.on('exit', (code) => {
      child = null;
      if (state.status === 'connecting' && (code === 126 || code === 127)) fail('Você não deu a permissão para a VPN.');
    });
  } else {
    fail('A VPN ainda não funciona neste sistema.');
    return state;
  }
  // Até 90 s pra pessoa responder o aviso (e, na primeira vez, instalar o driver).
  attachManagement(port, password, firstTime ? 180_000 : 90_000);
  clearTimeout(connectTimer);
  connectTimer = setTimeout(() => {
    if (state.status !== 'connecting') return;
    if (mgmt) mgmt.write('signal SIGTERM\n');
    fail('O servidor de VPN demorou demais. Escolha outro servidor.');
  }, firstTime ? 240_000 : 120_000);
  return state;
}

function disconnect() {
  userStopped = true;
  clearTimeout(connectTimer);
  if (!mgmt) {
    if (child) { try { child.kill('SIGTERM'); } catch { /* ok */ } }
    setState({ status: 'off', since: null, ip: null, error: null });
    return Promise.resolve(state);
  }
  setState({ status: 'disconnecting' });
  return new Promise((resolve) => {
    const done = () => { clearTimeout(t); resolve(state); };
    const t = setTimeout(() => { try { mgmt?.destroy(); } catch { /* ok */ } setState({ status: 'off', since: null, ip: null }); resolve(state); }, 6000);
    mgmt.once('close', done);
    mgmt.write('signal SIGTERM\n');
  });
}

let initialized = false;
function init(mainWindow, secureHandle) {
  win = mainWindow;
  if (initialized) return; // janela recriada: só troca a janela
  initialized = true;
  secureHandle('vpn:get-state', () => ({ ...state, supported: process.platform === 'win32' || process.platform === 'linux' }));
  secureHandle('vpn:connect', (_e, configText, server) => connect(configText, server));
  secureHandle('vpn:disconnect', () => disconnect());
  // Fechando o app: desliga a VPN (e a interface caindo já derrubaria o openvpn).
  app.on('will-quit', () => { if (mgmt) { try { mgmt.write('signal SIGTERM\n'); } catch { /* ok */ } } });
}
function setWindow(mainWindow) { win = mainWindow; }

module.exports = {
  init, setWindow, configure, connect, disconnect, getState: () => state,
  // puros (testes)
  sanitizeConfig, openvpnArgs, parseState, elevatedScript, windowsLaunchArgs, WIN_FEATURES,
};
