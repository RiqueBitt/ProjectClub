// Cache (Redis, TTL curto) das partes do carregamento que são IGUAIS pra
// todo mundo: estrutura da comunidade (categorias/canais/cargos/membros),
// status da plataforma, eventos, layout da interface, catálogo de apps.
// Antes cada abertura do app (/api/bootstrap) e cada refresh ao vivo
// refazia essas consultas — a de membros lê a tabela inteira de usuários.
//
// O que depende de QUEM pede (canal privado visível, RSVP, anúncio já
// dispensado, status "invisível" mascarado) continua sendo calculado por
// pessoa em cima do dado em cache — nada de dado pessoal no cache.
//
// Invalidação: qualquer escrita bem-sucedida (POST/PUT/PATCH/DELETE 2xx)
// nas rotas que mexem nesses dados apaga as chaves na hora (ver
// invalidateOnWrite); o TTL é só a rede de segurança.
const { cacheGetOrSet, cacheInvalidate } = require('../config/redis');

const TTL_SECONDS = 30;
const KEYS = {
  community: 'shared:community',
  status: 'shared:platform-status',
  events: 'shared:events',
  uiLayout: 'shared:ui-layout',
  announcement: 'shared:announcement',
  appCatalog: 'shared:app-catalog',
};

function getShared(name, compute, ttl = TTL_SECONDS) {
  return cacheGetOrSet(KEYS[name], ttl, compute);
}

function invalidateShared(...names) {
  const list = names.length ? names : Object.keys(KEYS);
  return Promise.all(list.map((n) => cacheInvalidate(KEYS[n]))).catch(() => {});
}

// prefixo da rota (em /api) -> seções afetadas. Perfis/status mudam a
// lista de membros da comunidade; a staff mexe em quase tudo via /admin.
const WRITE_PREFIXES = [
  ['/community', ['community']],
  ['/users', ['community']],
  ['/clans', ['community']],
  ['/decorations', ['community']],
  ['/admin', ['community', 'status', 'announcement', 'uiLayout', 'events', 'appCatalog']],
  ['/platform', ['status', 'announcement', 'community']],
  ['/ui-layout', ['uiLayout']],
  ['/events', ['events']],
];

function sectionsForPath(path) {
  const hit = new Set();
  for (const [prefix, names] of WRITE_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) names.forEach((n) => hit.add(n));
  }
  return [...hit];
}

// Montado em app.use('/api', ...): req.path já vem sem o "/api".
function invalidateOnWrite(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const names = sectionsForPath(req.path);
  if (!names.length) return next();
  res.on('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) invalidateShared(...names);
  });
  return next();
}

module.exports = { getShared, invalidateShared, invalidateOnWrite, sectionsForPath, KEYS, TTL_SECONDS };
