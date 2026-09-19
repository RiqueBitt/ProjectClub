// BUG CORRIGIDO ("a cada commit os certificados somem da Square Cloud"):
// a Square Cloud resincroniza a pasta do app com o que está no GitHub a
// cada deploy — como server/certs/ (corretamente) NÃO vai pro Git por
// segurança, todo deploy apagava os arquivos que tinham sido subidos
// manualmente por fora. A solução não é voltar a commitar os
// certificados (isso desfaria a correção de segurança) — é o CONTEÚDO
// deles vir de variáveis de ambiente (que sobrevivem a qualquer
// deploy/redeploy, diferente de arquivo solto na pasta) e esse script
// escrever os arquivos sozinho, do zero, toda vez que o app sobe —
// antes de qualquer coisa tentar ler esses arquivos (Prisma/ioredis).
//
// Variáveis esperadas (conteúdo do .pem inteiro, igual você copiaria
// pro arquivo — se colar tudo numa linha só, sem quebra de linha
// literal, também funciona: aceita "\n" escapado como texto e converte
// pra quebra de linha de verdade):
//   MYSQL_CA_PEM, MYSQL_CLIENT_CERT_PEM, MYSQL_CLIENT_KEY_PEM
//   REDIS_CA_PEM, REDIS_CLIENT_CERT_PEM, REDIS_CLIENT_KEY_PEM
//
// Se uma variável não estiver definida, o arquivo correspondente
// simplesmente não é escrito (sem erro) — cobre tanto quem usa só CA
// (Upstash) quanto quem precisa dos 3 (Square Cloud).
const fs = require('fs');
const path = require('path');

const FILES = [
  { env: 'MYSQL_CA_PEM', out: 'certs/mysql/ca.pem' },
  { env: 'MYSQL_CLIENT_CERT_PEM', out: 'certs/mysql/client-cert.pem' },
  { env: 'MYSQL_CLIENT_KEY_PEM', out: 'certs/mysql/client-key.pem' },
  { env: 'REDIS_CA_PEM', out: 'certs/redis/ca.pem' },
  { env: 'REDIS_CLIENT_CERT_PEM', out: 'certs/redis/client-cert.pem' },
  { env: 'REDIS_CLIENT_KEY_PEM', out: 'certs/redis/client-key.pem' },
];

let written = 0;
for (const { env, out } of FILES) {
  const raw = process.env[env];
  if (!raw) continue;
  const content = raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
  const fullPath = path.join(__dirname, '..', out);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content.trim() + '\n');
  written++;
}

if (written > 0) console.log(`[write-certs] ${written} arquivo(s) de certificado escrito(s) a partir de variáveis de ambiente.`);
