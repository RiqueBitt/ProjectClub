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
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { startWarmupServer, resolveServerPort } = require('./warmupServer');

const ROOT = path.resolve(__dirname, '..');
const DIST_INDEX = path.join(ROOT, 'client', 'dist', 'index.html');
const prebuilt = fs.existsSync(DIST_INDEX);

// Limite de RAM do container (MB). Square Cloud expõe em variáveis; se
// não achar, assume o plano atual (1560 MB).
const containerMb = Number(process.env.SQUARECLOUD_MEMORY || process.env.MEMORY || process.env.CONTAINER_MEMORY_MB || 1560);
// Heap do servidor: ~70% do container (sobra pro buffers nativos, sharp,
// sockets e o próprio sistema). Heap do build: ~75% (roda sozinho).
// 60% (antes 70%): o V8 deixa o heap crescer "preguiçosamente" até perto do
// teto, e tudo que fica FORA do heap (buffers de upload, sharp, zlib, buffers
// de saída do socket.io) somava por cima — perto do limite do container o
// kernel mata o processo sem log nenhum (só aparece o reinício).
const serverHeap = Math.max(512, Math.floor(containerMb * 0.60));
const buildHeap = Math.max(700, Math.floor(containerMb * 0.75));

const SERVER_DIR = path.join(ROOT, 'server');

// Assíncrono de propósito (antes era spawnSync): com o processo travado
// esperando o npm/prisma, o aviso "atualizando" (warmupServer.js) não
// conseguiria responder ninguém nesse meio-tempo.
function run(cmd, args, extraEnv = {}, cwd = ROOT) {
  console.log(`\n[deploy] $ ${cmd} ${args.join(' ')}`);
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit', cwd, env: { ...process.env, ...extraEnv }, shell: process.platform === 'win32' });
    child.on('error', (err) => { console.error(`[deploy] falhou: ${cmd} ${args.join(' ')} (${err.message})`); process.exit(1); });
    child.on('exit', (code, signal) => {
      if (code === 0) return resolve();
      console.error(`[deploy] falhou: ${cmd} ${args.join(' ')} (código ${code ?? signal})`);
      process.exit(code || 1);
    });
  });
}

console.log(`[deploy] container: ${containerMb} MB · heap do servidor: ${serverHeap} MB · dist pré-compilado: ${prebuilt ? 'SIM (pulando o build)' : 'não (vai compilar aqui)'}`);

// `node scripts/deploy.js --dry-run`: só mostra o plano, não executa nada.
if (process.argv.includes('--dry-run')) {
  console.log(prebuilt
    ? `[deploy] plano: npm ci --omit=dev → prisma:push → node --max-old-space-size=${serverHeap} --max-semi-space-size=32 src/index.js`
    : `[deploy] plano: npm install → build (heap ${buildHeap} MB) → prisma:push → node --max-old-space-size=${serverHeap} --max-semi-space-size=32 src/index.js`);
  process.exit(0);
}

async function main() {
  // Enquanto o servidor novo não sobe, a porta responde "atualizando" em vez
  // do 503 genérico da hospedagem (ver warmupServer.js). Fecha logo antes do
  // servidor de verdade abrir a mesma porta.
  let dotenvText = '';
  try { dotenvText = fs.readFileSync(path.join(SERVER_DIR, '.env'), 'utf8'); } catch { /* sem .env: só variáveis do ambiente */ }
  const warmPort = process.env.DEPLOY_WARMUP === '0' ? null : resolveServerPort(process.env, dotenvText);
  const warmup = warmPort ? startWarmupServer(warmPort) : null;

  if (prebuilt) {
    // Só produção: sem Playwright/Capacitor CLI do cliente. `npm ci` é mais
    // rápido e determinístico que `npm install` quando há package-lock.
    // Reinício sem mudança de dependências (crash, restart manual, a
    // hospedagem reciclando o container) NÃO reinstala tudo de novo: o
    // `npm ci` apaga e recria o node_modules inteiro (~20s de CPU/disco
    // pesados) bem na hora em que todo mundo está reconectando.
    const lockPath = path.join(ROOT, 'package-lock.json');
    const hasLock = fs.existsSync(lockPath);
    const stamp = path.join(ROOT, 'node_modules', '.pc-lockhash');
    const lockHash = hasLock ? require('crypto').createHash('sha256').update(fs.readFileSync(lockPath)).update(`${process.version}|${process.platform}|${process.arch}`).digest('hex') : null;
    let installed = null;
    try { installed = fs.readFileSync(stamp, 'utf8').trim(); } catch { /* primeira vez */ }
    if (lockHash && installed === lockHash && fs.existsSync(path.join(ROOT, 'node_modules', '@prisma', 'client'))) {
      console.log('[deploy] dependências já instaladas para este package-lock (pulando npm ci)');
    } else {
      await run('npm', [hasLock ? 'ci' : 'install', '--omit=dev', '--no-audit', '--no-fund']);
      if (lockHash) { try { fs.writeFileSync(stamp, lockHash); } catch { /* sem permissão: instala de novo na próxima */ } }
    }
  } else {
    await run('npm', ['install', '--no-audit', '--no-fund']);
    await run('npm', ['run', 'build', '-w', 'client'], { NODE_OPTIONS: `--max-old-space-size=${buildHeap}` });
  }

  await run('npm', ['run', 'prisma:push', '-w', 'server']);

  // O servidor em si: flags de heap + semi-space maior (menos pausas de GC
  // na geração jovem, que é onde vivem os objetos curtos de cada request/
  // socket). `exec`-like: repassa sinais e o código de saída.
  const serverArgs = [
    `--max-old-space-size=${serverHeap}`,
    '--max-semi-space-size=32',
    // Se o V8 morrer por falta de heap, deixa um relatório em
    // server/reports/ (pilha + uso de memória) em vez de sumir sem log.
    // (Não cobre o kernel matando o container por falta de RAM — esse caso
    // aparece nos avisos "[métricas] ATENÇÃO" de runtimeMetrics.js.)
    // --report-exclude-env: o relatório NÃO grava as variáveis de ambiente
    // (senhas do banco, chaves) em disco.
    '--report-on-fatalerror',
    '--report-exclude-env',
    `--report-directory=${path.join(SERVER_DIR, 'reports')}`,
    path.join('src', 'index.js'),
  ];
  // Mesmos passos (e mesma pasta) do "npm start -w server".
  await run('node', [path.join('scripts', 'write-certs-from-env.js')], {}, SERVER_DIR);
  await run('node', [path.join('scripts', 'wait-for-db.js')], {}, SERVER_DIR);
  // O Node não cria a pasta do relatório sozinho.
  try { fs.mkdirSync(path.join(SERVER_DIR, 'reports'), { recursive: true }); } catch { /* sem permissão: só fica sem relatório */ }
  if (warmup) await warmup.close();
  console.log(`\n[deploy] $ node ${serverArgs.join(' ')}`);
  const child = require('child_process').spawn('node', serverArgs, { stdio: 'inherit', cwd: SERVER_DIR, env: process.env });
  ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((sig) => process.on(sig, () => { try { child.kill(sig); } catch { /* já saiu */ } }));
  child.on('exit', (code, signal) => { process.exit(code == null ? 1 : code); });
}

main().catch((err) => { console.error('[deploy] falhou:', err?.stack || err); process.exit(1); });
