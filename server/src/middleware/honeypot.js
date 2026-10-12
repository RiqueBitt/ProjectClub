const prisma = require('../config/prisma');
const { verifyAccessToken, hashToken } = require('../services/tokens');

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

// SECURITY (abuso do próprio honeypot): antes, UM único GET numa rota-isca
// bloqueava o IP por 24h. Bastava alguém mandar no chat uma imagem
// `<img src="/wp-login.php">` (ou um link) pra derrubar do site todo
// mundo que abrisse a conversa — inclusive redes inteiras atrás do mesmo
// IP (faculdade, operadora com CGNAT). Agora:
//  - só bloqueia depois de BLOCK_AFTER_DISTINCT_PATHS rotas-isca
//    DIFERENTES do mesmo IP dentro de HIT_WINDOW_MS (scanner de verdade
//    varre várias; um embed malicioso repete sempre a mesma);
//  - ignora (só devolve a isca, sem contar) requisições de navegador que
//    não são navegação de página (Sec-Fetch-Dest: image, iframe, script...)
//    — scanner não manda esses cabeçalhos;
//  - ignora requisições de quem está logado (Authorization com JWT válido
//    ou cookie de sessão válido).
const BLOCK_AFTER_DISTINCT_PATHS = 3;
const BLOCK_AFTER_HITS = BLOCK_AFTER_DISTINCT_PATHS; // mantido no export por compatibilidade
const HIT_WINDOW_MS = 10 * 60 * 1000;
const BLOCK_DURATION_MS = 24 * 60 * 60 * 1000; // 24h — some scanners tentam de novo depois

function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

// Cache em memória (TTL ~60s, tamanho limitado) da checagem de IP
// bloqueado — antes era UMA consulta ao banco em TODA requisição do site.
const BLOCK_CACHE_TTL_MS = 60 * 1000;
const BLOCK_CACHE_MAX = 10000;
const blockCache = new Map(); // ip -> { blockedUntil: number|null (null = não bloqueado; Infinity = sem expiração), cachedAt }

function cacheSet(ip, blockedUntil) {
  if (blockCache.has(ip)) blockCache.delete(ip); // reinsere no fim (ordem de uso — LRU simples)
  blockCache.set(ip, { blockedUntil, cachedAt: Date.now() });
  if (blockCache.size > BLOCK_CACHE_MAX) {
    const oldest = blockCache.keys().next().value;
    blockCache.delete(oldest);
  }
}

function cacheGet(ip) {
  const entry = blockCache.get(ip);
  if (!entry) return undefined;
  if (Date.now() - entry.cachedAt > BLOCK_CACHE_TTL_MS) {
    blockCache.delete(ip);
    return undefined;
  }
  blockCache.delete(ip);
  blockCache.set(ip, entry);
  return entry;
}

// Remove um IP do cache (ex: staff desbloqueou pelo painel) — o próximo
// request volta a consultar o banco.
function invalidateBlockedIpCache(ip) {
  if (ip) blockCache.delete(ip);
  else blockCache.clear();
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const match = header.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  if (!match) return null;
  try { return decodeURIComponent(match.slice(name.length + 1)); } catch { return null; }
}

async function hasValidSession(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    try {
      verifyAccessToken(auth.slice(7));
      return true;
    } catch { /* token inválido — segue checando o cookie */ }
  }
  const raw = readCookie(req, 'refreshToken');
  if (raw) {
    const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(raw) }, select: { revoked: true, expiresAt: true } }).catch(() => null);
    if (row && !row.revoked && row.expiresAt > new Date()) return true;
  }
  return false;
}

// Navegador carregando a rota como recurso embutido (imagem, iframe,
// script, prefetch...) — sinal de que foi OUTRA página que mandou o
// navegador buscar isso, não alguém varrendo o site.
function isEmbeddedBrowserFetch(req) {
  const dest = String(req.headers['sec-fetch-dest'] || '').toLowerCase();
  return !!dest && dest !== 'document';
}

async function recordHitAndMaybeBlock(req, ip) {
  const userAgent = req.headers['user-agent'] || null;
  if (isEmbeddedBrowserFetch(req)) return;
  if (await hasValidSession(req)) return;

  await prisma.honeypotHit.create({ data: { ip, path: req.path, method: req.method, userAgent } });
  const recent = await prisma.honeypotHit.findMany({
    where: { ip, createdAt: { gt: new Date(Date.now() - HIT_WINDOW_MS) } },
    select: { path: true },
    take: 200,
  });
  const distinctPaths = new Set(recent.map((h) => h.path.toLowerCase()));
  if (distinctPaths.size < BLOCK_AFTER_DISTINCT_PATHS) return;

  const expiresAt = new Date(Date.now() + BLOCK_DURATION_MS);
  const reason = `Acessou ${distinctPaths.size} rotas-isca em ${Math.round(HIT_WINDOW_MS / 60000)} min (última: ${req.path})`.slice(0, 190);
  await prisma.blockedIp.upsert({
    where: { ip },
    update: { hitCount: { increment: 1 }, reason, expiresAt },
    create: { ip, reason, hitCount: distinctPaths.size, expiresAt },
  });
  cacheSet(ip, expiresAt.getTime());
}

// Middleware principal — checa se o caminho bate com alguma isca, loga o
// hit, conta pro bloqueio do IP e devolve o conteúdo falso. Se o caminho
// não bater com nenhuma isca, chama next() normalmente (não atrapalha em
// nada o resto do app).
function honeypotMiddleware(req, res, next) {
  const match = HONEYPOT_PATTERNS.find((p) => p.re.test(req.path));
  if (!match) return next();

  const ip = getClientIp(req);
  // Best-effort — não deixa a resposta esperar o banco nem falha se o
  // registro der erro (a prioridade é sempre devolver a isca na hora).
  recordHitAndMaybeBlock(req, ip).catch(() => {});

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
    let entry = cacheGet(ip);
    if (!entry) {
      const blocked = await prisma.blockedIp.findUnique({ where: { ip }, select: { expiresAt: true } });
      const blockedUntil = blocked ? (blocked.expiresAt ? blocked.expiresAt.getTime() : Infinity) : null;
      cacheSet(ip, blockedUntil);
      entry = { blockedUntil };
    }
    if (entry.blockedUntil && entry.blockedUntil > Date.now()) {
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

module.exports = {
  honeypotMiddleware, blockedIpGuard, invalidateBlockedIpCache,
  BLOCK_AFTER_HITS, BLOCK_AFTER_DISTINCT_PATHS, HIT_WINDOW_MS,
  // exportados pra testes
  isEmbeddedBrowserFetch,
};
