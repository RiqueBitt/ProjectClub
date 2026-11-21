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

// BUG CORRIGIDO ("PEM routines::no start line" no Redis mesmo com as 6
// variáveis preenchidas): alguns campos de variável de ambiente
// "achatam" texto colado com várias linhas — trocam a quebra de linha
// por espaço, ou removem ela sem colocar nada no lugar, deixando o
// certificado inteiro numa string só sem formato nenhum. O `\n`
// escapado (que já tratávamos) resolve um caso; esse normalizador
// resolve os outros: encontra o BEGIN/END do certificado onde quer
// que estejam, extrai só o conteúdo de verdade no meio, tira qualquer
// espaço/quebra de linha estranha que sobrou, e reconstrói o arquivo
// do zero no formato PEM padrão (64 caracteres por linha) — não
// importa muito como o texto chegou espremido, o resultado final
// sempre sai correto.
function normalizePem(raw) {
  let content = raw.trim();
  if (content.includes('\\n')) content = content.replace(/\\n/g, '\n');

  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  const looksFine = lines.length >= 3 && /^-----BEGIN /.test(lines[0]) && /^-----END /.test(lines[lines.length - 1]);
  if (looksFine) return lines.join('\n');

  const beginMatch = content.match(/-----BEGIN ([A-Z ]+)-----/);
  const endMatch = content.match(/-----END ([A-Z ]+)-----/);
  if (!beginMatch || !endMatch) return null; // não achei nem o BEGIN nem o END — não dá pra reconstruir

  const header = `-----BEGIN ${beginMatch[1]}-----`;
  const footer = `-----END ${endMatch[1]}-----`;
  const body = content.slice(beginMatch.index + header.length, endMatch.index).replace(/\s+/g, '');
  const wrapped = (body.match(/.{1,64}/g) || [body]).join('\n');
  return `${header}\n${wrapped}\n${footer}`;
}

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
  const normalized = normalizePem(raw);
  if (!normalized) {
    console.error(`[write-certs] ${env} não parece um certificado válido (sem "-----BEGIN"/"-----END" reconhecível) — confira se colou o conteúdo certo nessa variável.`);
    continue;
  }
  const fullPath = path.join(__dirname, '..', out);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, normalized + '\n');
  written++;
}

if (written > 0) console.log(`[write-certs] ${written} arquivo(s) de certificado escrito(s) a partir de variáveis de ambiente.`);
