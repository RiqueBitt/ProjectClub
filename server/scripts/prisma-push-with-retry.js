// BUG CORRIGIDO ("Can't reach database server" derruba o deploy inteiro):
// o comando "prisma:push" (que roda o `db push` + `generate` + o seed)
// não tinha NENHUMA tentativa de novo — se o banco não respondesse bem
// na hora exata do deploy (banco "acordando" depois de ficar parado,
// reinício momentâneo do host, instabilidade passageira de rede — tudo
// coisa comum logo depois de recriar/reiniciar um banco gerenciado), o
// deploy inteiro falhava ali, mesmo que o banco ficasse disponível de
// novo segundos depois. O comando "start" já tinha essa proteção (ver
// wait-for-db.js) — esse script aqui dá a MESMA proteção pro "db push"
// que roda antes dele, no início do deploy.
const { execSync } = require('child_process');

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 5000; // 5s, 10s, 15s, 20s... entre tentativas — um pouco mais generoso que o do wait-for-db.js, já que "banco recém-criado/reiniciado acordando" costuma levar mais tempo que uma instabilidade de rede passageira comum

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(cmd) {
  execSync(cmd, { stdio: 'inherit', env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' } });
}

async function main() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      run('npx prisma db push --accept-data-loss --skip-generate');
      break; // conseguiu — sai do laço de tentativas e segue pro generate/seed abaixo
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) {
        console.error(`[prisma-push] Banco de dados não respondeu depois de ${MAX_ATTEMPTS} tentativas — desistindo de verdade.`);
        process.exit(1);
      }
      const delay = BASE_DELAY_MS * attempt;
      console.error(`[prisma-push] Tentativa ${attempt}/${MAX_ATTEMPTS} falhou (banco pode ainda estar "acordando"). Tentando de novo em ${delay / 1000}s...`);
      await sleep(delay);
    }
  }

  // generate/seed só rodam depois que o push realmente deu certo — sem
  // retry aqui de propósito: se chegou até aqui é porque o banco já
  // está respondendo, então uma falha nessa parte é um erro de
  // verdade (schema/seed quebrado), não uma questão de timing.
  run('npx prisma generate');
  run('node prisma/seed.js');
}

main();
