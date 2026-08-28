const prisma = require('../config/prisma');

// Caminhos que uma pessoa de verdade usando o site NUNCA visita — só
// scanners automatizados (bots que varrem a internet inteira procurando
// painéis do WordPress, phpMyAdmin, arquivos .env vazados, chaves SSH
// etc) tentam essas URLs. Qualquer acesso aqui já é 100% sinal de
// reconhecimento automatizado, sem falsos positivos de gente real.
// Cada categoria devolve uma resposta FALSA plausível (não um 403/404
// óbvio) — o objetivo é o script achar que encontrou algo real e perder
// tempo com dado inútil, em vez de aprender "essa rota está bloqueada,
// tento outra".
const HONEYPOT_PATTERNS = [
  { re: /^\/wp-admin|^\/wp-login\.php|^\/wp-content|^\/xmlrpc\.php/i, kind: 'wordpress' },
  { re: /^\/\.env(\.|$)/i, kind: 'dotenv' },
  { re: /^\/\.git\/(config|HEAD)/i, kind: 'git' },
  { re: /^\/phpmyadmin|^\/pma|^\/adminer\.php/i, kind: 'phpmyadmin' },
  { re: /^\/admin\.php|^\/administrator(\/|$)/i, kind: 'genericAdmin' },
  { re: /^\/config\.php|^\/wp-config\.php/i, kind: 'phpConfig' },
  { re: /^\/\.aws\/credentials|^\/id_rsa$/i, kind: 'credentials' },
  { re: /^\/actuator\/env|^\/actuator\/health/i, kind: 'actuator' },
  { re: /^\/debug\/pprof/i, kind: 'debug' },
  { re: /^\/server-status|^\/server-info/i, kind: 'serverStatus' },
  // Rotas de API "óbvias demais" que um scanner tenta na sorte — o app
  // de verdade nunca expõe nada assim sem autenticação nesses caminhos
  // exatos, então servem de isca extra.
  { re: /^\/api\/v1\/users$|^\/api\/admin$|^\/api\/config$/i, kind: 'fakeApi' },
];

// Conteúdo falso por categoria — parece real o bastante pra enganar um
// script automatizado (que só olha "achei um .env? extrai as chaves"),
// mas todos os valores são de mentira, não vazam nada de verdade.
function decoyResponse(kind, res) {
  switch (kind) {
    case 'dotenv':
      res.type('text/plain').send(
        'DB_HOST=127.0.0.1\nDB_USER=root\nDB_PASSWORD=8f2a91c47e6b3d0a\nJWT_SECRET=9c4e7a1f2b8d3e6a5c0f9b2d7e4a1c8f\nSTRIPE_SECRET_KEY=sk_live_51H8x9K2eZvKYlo2C\nAWS_ACCESS_KEY_ID=AKIAFAKE00000EXAMPLE\nAWS_SECRET_ACCESS_KEY=fakeSecretKeyDoNotUseThisIsAHoneypot\n',
      );
      return;
    case 'git':
      res.type('text/plain').send('ref: refs/heads/main\n');
      return;
    case 'wordpress':
      res.type('text/html').send(
        '<!DOCTYPE html><html><head><title>WordPress &rsaquo; Log In</title></head><body>'
        + '<form><p><label>Username<br><input type="text" name="log"></label></p>'
        + '<p><label>Password<br><input type="password" name="pwd"></label></p>'
        + '<p><input type="submit" value="Log In"></p></form></body></html>',
      );
      return;
    case 'phpmyadmin':
      res.type('text/html').send(
        '<!DOCTYPE html><html><head><title>phpMyAdmin</title></head><body>'
        + '<form><input name="pma_username" placeholder="Username">'
        + '<input name="pma_password" type="password" placeholder="Password">'
        + '<button>Go</button></form></body></html>',
      );
      return;
    case 'credentials':
      res.type('text/plain').send(
        '[default]\naws_access_key_id = AKIAFAKE00000EXAMPLE\naws_secret_access_key = fakeSecretKeyDoNotUseThisIsAHoneypot\n',
      );
      return;
    case 'actuator':
      res.json({ status: 'UP', diskSpace: { status: 'UP', total: 499963174912, free: 91943014400 } });
      return;
    case 'fakeApi':
      // Uma lista de "usuários" claramente falsa (ids sequenciais, senhas
      // com hash de mentira) — se o script salvar isso achando que
      // roubou dados de verdade, ele levou só lixo.
      res.json({
        users: [
          { id: 1, username: 'admin', email: 'admin@example.com', passwordHash: '$2a$10$FAKEHONEYPOTHASHDONOTUSE0000000000000000000000000' },
          { id: 2, username: 'test', email: 'test@example.com', passwordHash: '$2a$10$FAKEHONEYPOTHASHDONOTUSE0000000000000000000000001' },
        ],
      });
      return;
    default:
      res.type('text/html').send('<!DOCTYPE html><html><body><h1>403 Forbidden</h1></body></html>');
  }
}

// Depois de quantos hits em rotas-isca o IP já vira bloqueado — 1 hit já
// é sinal forte o bastante (gente real nunca acessa essas URLs por
// engano), mas mantém a contagem pra saber se é um scanner insistente.
const BLOCK_AFTER_HITS = 1;
const BLOCK_DURATION_MS = 24 * 60 * 60 * 1000; // 24h — some scanners tentam de novo depois

function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

// Middleware principal — checa se o caminho bate com alguma isca, loga o
// hit, atualiza/cria o bloqueio do IP e devolve o conteúdo falso. Se o
// caminho não bater com nenhuma isca, chama next() normalmente (não
// atrapalha em nada o resto do app).
function honeypotMiddleware(req, res, next) {
  const match = HONEYPOT_PATTERNS.find((p) => p.re.test(req.path));
  if (!match) return next();

  const ip = getClientIp(req);
  const userAgent = req.headers['user-agent'] || null;

  // Best-effort — não deixa a resposta esperar o banco nem falha se o
  // registro der erro (a prioridade é sempre devolver a isca na hora).
  prisma.honeypotHit.create({ data: { ip, path: req.path, method: req.method, userAgent } }).catch(() => {});
  prisma.blockedIp.upsert({
    where: { ip },
    update: { hitCount: { increment: 1 }, reason: `Acessou rota-isca: ${req.path}`, expiresAt: new Date(Date.now() + BLOCK_DURATION_MS) },
    create: { ip, reason: `Acessou rota-isca: ${req.path}`, expiresAt: new Date(Date.now() + BLOCK_DURATION_MS) },
  }).catch(() => {});

  decoyResponse(match.kind, res);
}

// Middleware de bloqueio — roda ANTES de tudo (ver app.js), pra qualquer
// IP já marcado como bloqueado nunca alcançar rota nenhuma de verdade,
// nem a isca. Em vez de um 403 óbvio (que confirma pro atacante "fui
// detectado, meu IP mudou de comportamento"), devolve um erro genérico
// de servidor — do ponto de vista do script, o site simplesmente "está
// fora do ar" ou "quebrado", sem nenhuma pista de que foi bloqueado por
// comportamento suspeito.
async function blockedIpGuard(req, res, next) {
  try {
    const ip = getClientIp(req);
    const blocked = await prisma.blockedIp.findUnique({ where: { ip } });
    if (blocked && (!blocked.expiresAt || blocked.expiresAt > new Date())) {
      res.status(503).type('text/html').send('<!DOCTYPE html><html><body><h1>503 Service Unavailable</h1><p>The server is temporarily unable to service your request.</p></body></html>');
      return;
    }
    next();
  } catch (err) {
    // Se o banco falhar aqui, não derruba o site inteiro por causa da
    // checagem de segurança — deixa passar (fail-open).
    next();
  }
}

module.exports = { honeypotMiddleware, blockedIpGuard, BLOCK_AFTER_HITS };
