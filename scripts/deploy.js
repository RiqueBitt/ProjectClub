#!/usr/bin/env node
/* Deploy do Project Club na hospedagem (Square Cloud) — item pedido:
   "otimização máxima" de memória/CPU.
 *
 * O que dava o pico de ~1 GB de RAM e 96% de CPU a cada deploy NÃO era o
 * app rodando (em uso ele fica em ~150–420 MB): era o `npm install` +
 * `vite build` do cliente rodando DENTRO do container de produção. Com
 * vários usuários online, esse pico derruba a qualidade (e já estourou o
 * heap antes — "JavaScript heap out of memory").
 *
 * Agora o build é feito no GitHub Actions (.github/workflows/deploy.yml),
 * que publica o repositório + `client/dist` já compilado no branch
 * `deploy`. Aqui, se o `dist` já veio pronto, a gente PULA o build e
 * instala só as dependências de produção. Se não veio (ex.: hospedagem
 * apontando pro `main`), faz o build como antes, só que com um teto de
 * heap explícito pra nunca estourar.
 *
 * Em todos os casos o servidor sobe com `--max-old-space-size` abaixo do
 * limite do container: o V8 passa a coletar lixo com folga em vez de
 * deixar o heap crescer até o container matar o processo.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST_INDEX = path.join(ROOT, 'client', 'dist', 'index.html');
const prebuilt = fs.existsSync(DIST_INDEX);

// Limite de RAM do container (MB). Square Cloud expõe em variáveis; se
// não achar, assume o plano atual (1560 MB).
const containerMb = Number(process.env.SQUARECLOUD_MEMORY || process.env.MEMORY || process.env.CONTAINER_MEMORY_MB || 1560);
// Heap do servidor: ~70% do container (sobra pro buffers nativos, sharp,
// sockets e o próprio sistema). Heap do build: ~75% (roda sozinho).
const serverHeap = Math.max(512, Math.floor(containerMb * 0.70));
const buildHeap = Math.max(700, Math.floor(containerMb * 0.75));

const SERVER_DIR = path.join(ROOT, 'server');

function run(cmd, args, extraEnv = {}, cwd = ROOT) {
  console.log(`\n[deploy] $ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', cwd, env: { ...process.env, ...extraEnv }, shell: process.platform === 'win32' });
  if (res.status !== 0) { console.error(`[deploy] falhou: ${cmd} ${args.join(' ')} (código ${res.status})`); process.exit(res.status || 1); }
}

console.log(`[deploy] container: ${containerMb} MB · heap do servidor: ${serverHeap} MB · dist pré-compilado: ${prebuilt ? 'SIM (pulando o build)' : 'não (vai compilar aqui)'}`);

// `node scripts/deploy.js --dry-run`: só mostra o plano, não executa nada.
if (process.argv.includes('--dry-run')) {
  console.log(prebuilt
    ? `[deploy] plano: npm ci --omit=dev → prisma:push → node --max-old-space-size=${serverHeap} --max-semi-space-size=32 src/index.js`
    : `[deploy] plano: npm install → build (heap ${buildHeap} MB) → prisma:push → node --max-old-space-size=${serverHeap} --max-semi-space-size=32 src/index.js`);
  process.exit(0);
}

if (prebuilt) {
  // Só produção: sem Playwright/Capacitor CLI do cliente. `npm ci` é mais
  // rápido e determinístico que `npm install` quando há package-lock.
  const hasLock = fs.existsSync(path.join(ROOT, 'package-lock.json'));
  run('npm', [hasLock ? 'ci' : 'install', '--omit=dev', '--no-audit', '--no-fund']);
} else {
  run('npm', ['install', '--no-audit', '--no-fund']);
  run('npm', ['run', 'build', '-w', 'client'], { NODE_OPTIONS: `--max-old-space-size=${buildHeap}` });
}

run('npm', ['run', 'prisma:push', '-w', 'server']);

// O servidor em si: flags de heap + semi-space maior (menos pausas de GC
// na geração jovem, que é onde vivem os objetos curtos de cada request/
// socket). `exec`-like: repassa sinais e o código de saída.
const serverArgs = [
  `--max-old-space-size=${serverHeap}`,
  '--max-semi-space-size=32',
  path.join('src', 'index.js'),
];
// Mesmos passos (e mesma pasta) do "npm start -w server".
run('node', [path.join('scripts', 'write-certs-from-env.js')], {}, SERVER_DIR);
run('node', [path.join('scripts', 'wait-for-db.js')], {}, SERVER_DIR);
console.log(`\n[deploy] $ node ${serverArgs.join(' ')}`);
const child = require('child_process').spawn('node', serverArgs, { stdio: 'inherit', cwd: SERVER_DIR, env: process.env });
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((sig) => process.on(sig, () => { try { child.kill(sig); } catch { /* já saiu */ } }));
child.on('exit', (code, signal) => { process.exit(code == null ? 1 : code); });
