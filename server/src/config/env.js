require('dotenv').config();

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  return value;
}

const NODE_ENV = process.env.NODE_ENV || 'development';

const DEFAULT_ACCESS_SECRET = 'dev_access_secret_change_me';
const DEFAULT_REFRESH_SECRET = 'dev_refresh_secret_change_me';
const jwtAccessSecret = required('JWT_ACCESS_SECRET', DEFAULT_ACCESS_SECRET);
const jwtRefreshSecret = required('JWT_REFRESH_SECRET', DEFAULT_REFRESH_SECRET);

// Fail loudly at boot rather than silently accepting requests signed with a
// secret that's public in this repo's own source code. Without this guard, a
// production deploy that simply forgot to set JWT_ACCESS_SECRET/
// JWT_REFRESH_SECRET would run "fine" — but anyone could forge valid login
// tokens for any account by signing with the well-known default string.
if (NODE_ENV === 'production' && (jwtAccessSecret === DEFAULT_ACCESS_SECRET || jwtRefreshSecret === DEFAULT_REFRESH_SECRET)) {
  throw new Error(
    '[config] JWT_ACCESS_SECRET e/ou JWT_REFRESH_SECRET ainda estão com o valor padrão de desenvolvimento. ' +
    'Defina segredos fortes e únicos nas variáveis de ambiente antes de rodar em produção (ex.: `openssl rand -hex 32`).'
  );
}

module.exports = {
  NODE_ENV,
  // Square Cloud proxies external web traffic to port 80 for hosted sites
  // (confirmed in their docs — a Node app that binds anywhere else is simply
  // unreachable from the outside, even though the process itself runs fine
  // and logs look healthy). Locally there's no such proxy, so dev defaults
  // to 3000 (matches the Vite dev-server proxy target in
  // client/vite.config.js). Set PORT explicitly in .env to override either.
  PORT: parseInt(process.env.PORT || (NODE_ENV === 'production' ? '80' : '3000'), 10),
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  DATABASE_URL: process.env.DATABASE_URL || 'file:./dev.db',

  JWT_ACCESS_SECRET: jwtAccessSecret,
  JWT_REFRESH_SECRET: jwtRefreshSecret,
  ACCESS_TOKEN_TTL: process.env.ACCESS_TOKEN_TTL || '15m',
  REFRESH_TOKEN_TTL_DAYS: parseInt(process.env.REFRESH_TOKEN_TTL_DAYS || '30', 10),

  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  SMTP_FROM: process.env.SMTP_FROM || 'no-reply@embercord.local',

  UPLOAD_DIR: process.env.UPLOAD_DIR || 'uploads',
  MAX_UPLOAD_MB: parseInt(process.env.MAX_UPLOAD_MB || '25', 10),

  // Redis (presença online/offline, canais de voz, cache, rate limit,
  // filas, tudo que é rápido/temporário — nunca a fonte de verdade dos
  // dados, isso é sempre o MySQL). Padrão aponta pro Redis local — em
  // produção, aponte pro seu Redis gerenciado (Upstash, Redis Cloud, etc).
  REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  // TLS mútuo (certificado + chave do cliente, mais o certificado da
  // autoridade/CA) — alguns provedores gerenciados de Redis (como o do
  // Square Cloud) exigem isso além de usuário/senha. Sem essas 3
  // variáveis preenchidas, a conexão é feita normalmente sem TLS.
  REDIS_CA_PATH: process.env.REDIS_CA_PATH || '',
  REDIS_CERT_PATH: process.env.REDIS_CERT_PATH || '',
  REDIS_KEY_PATH: process.env.REDIS_KEY_PATH || '',

  // Backblaze B2 (armazenamento de arquivos — fotos de perfil, banners,
  // anexos de mensagem, GIFs favoritos, áudio, qualquer upload de
  // usuário). B2 fala o protocolo S3, então usamos o SDK da AWS apontado
  // pro endpoint do B2. Crie um "Application Key" com acesso ao bucket em
  // https://www.backblaze.com/b2/cloud-storage.html — sem essas variáveis
  // configuradas, os uploads continuam funcionando em disco local (modo
  // antigo), só não vão pro B2.
  B2_ENDPOINT: process.env.B2_ENDPOINT || '', // ex.: https://s3.us-west-004.backblazeb2.com
  B2_REGION: process.env.B2_REGION || 'us-west-004',
  B2_BUCKET: process.env.B2_BUCKET || '',
  B2_KEY_ID: process.env.B2_KEY_ID || '',
  B2_APPLICATION_KEY: process.env.B2_APPLICATION_KEY || '',
  // URL pública de leitura do bucket (o "Friendly URL" que o B2 mostra na
  // tela do bucket, ou o domínio do seu CDN se tiver um na frente) — é o
  // que vira o prefixo de toda imagem/arquivo servido no site.
  B2_PUBLIC_URL: process.env.B2_PUBLIC_URL || '',

  // Optional: e-mail of the account to auto-promote to platform ADMIN on
  // every server start (see services/adminBootstrap.js). Leave unset to
  // manage admins entirely by hand.
  PLATFORM_ADMIN_EMAIL: process.env.PLATFORM_ADMIN_EMAIL || '',

  // reCAPTCHA v3 (see services/recaptcha.js) — bot protection on login/
  // register. Get a site key + secret key pair from
  // https://www.google.com/recaptcha/admin (choose "v3" when creating the
  // key, register your actual domain). Left unset, verification is simply
  // skipped — this is opt-in, not a hard requirement to run the app.
  RECAPTCHA_SECRET_KEY: process.env.RECAPTCHA_SECRET_KEY || '',
  // How low a score (0.0 = certainly a bot, 1.0 = certainly human) to
  // still allow through. Google's own docs suggest 0.5 as a reasonable
  // starting point.
  RECAPTCHA_MIN_SCORE: parseFloat(process.env.RECAPTCHA_MIN_SCORE || '0.5'),
};
