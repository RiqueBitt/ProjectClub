// BUG CORRIGIDO ("erro fez o server desligar"): o script "start" fazia
// `prisma db push && node src/index.js` — se o banco de dados não
// respondesse na hora EXATA do deploy (banco hospedado ainda
// "acordando", reinício momentâneo do host, instabilidade de rede
// passageira), o `&&` fazia o comando inteiro parar ali, e o servidor
// NUNCA CHEGAVA a subir de verdade — mesmo que o banco ficasse
// disponível de novo poucos segundos depois. Esse script tenta de
// novo algumas vezes, com uma pausa crescente entre as tentativas,
// antes de desistir de verdade — prática padrão em produção pra não
// tratar uma indisponibilidade PASSAGEIRA de uma dependência externa
// como se fosse um erro permanente.
const { execSync } = require('child_process');

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 3000; // 3s, 6s, 9s, 12s... entre tentativas

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // Caminho explícito pro binário (em vez de confiar que "prisma"
      // sozinho resolve certo no PATH nesse contexto) — mais robusto,
      // não depende de nenhuma configuração de ambiente específica.
      const prismaBin = require('path').join(__dirname, '..', 'node_modules', '.bin', 'prisma');
      execSync(`"${prismaBin}" db push --skip-generate`, {
        stdio: 'inherit',
        env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
      });
      return; // conseguiu — segue a vida normalmente
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) {
        console.error(`[wait-for-db] Banco de dados não respondeu depois de ${MAX_ATTEMPTS} tentativas — desistindo de verdade.`);
        process.exit(1);
      }
      const delay = BASE_DELAY_MS * attempt;
      console.error(`[wait-for-db] Tentativa ${attempt}/${MAX_ATTEMPTS} falhou (banco pode ainda estar "acordando"). Tentando de novo em ${delay / 1000}s...`);
      await sleep(delay);
    }
  }
}

main();
