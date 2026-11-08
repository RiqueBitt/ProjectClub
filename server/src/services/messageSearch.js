// Busca de mensagens por texto com o índice FULLTEXT de Message.content
// (schema.prisma: @@fulltext([content])).
//
// Como funciona: o MATCH ... AGAINST (modo booleano, cada palavra
// obrigatória e com prefixo: "+bolo* +choc*") devolve os ids candidatos
// mais recentes DENTRO do escopo que a pessoa pode ver (canais visíveis +
// conversas dela). Depois o Prisma aplica os outros filtros (de:, tem:,
// antes:, depois:, fixada:) e o `contains` normal em cima desses ids — o
// resultado continua igual ao da busca por LIKE, só que sem varrer a
// tabela inteira quando a palavra é rara.
//
// Cai pro LIKE puro (caminho antigo) quando:
//   - alguma palavra tem menos de 3 letras (o InnoDB não indexa — padrão
//     innodb_ft_min_token_size=3) ou não sobra palavra nenhuma;
//   - o índice ainda não existe / o banco recusou (fica desligado por
//     alguns minutos pra não tentar a cada busca);
//   - o FULLTEXT não achou nada (pode ser trecho no MEIO de uma palavra,
//     que o índice não cobre).
const MIN_TOKEN = 3;
const MAX_TOKENS = 8;
const CANDIDATE_LIMIT = 1000;
const DISABLE_MS = 10 * 60 * 1000;

let disabledUntil = 0;

// Texto livre → expressão booleana segura (sem operadores do usuário).
function buildBooleanQuery(text) {
  const tokens = String(text || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean);
  if (!tokens.length || tokens.length > MAX_TOKENS) return null;
  if (tokens.some((t) => t.length < MIN_TOKEN)) return null;
  return tokens.map((t) => `+${t.slice(0, 64)}*`).join(' ');
}

function placeholders(list) { return list.map(() => '?').join(','); }

// Monta o SQL (separado pra dar pra testar sem banco).
function buildCandidateSql({ booleanQuery, channelIds = [], conversationIds = [], cursor = null, limit = CANDIDATE_LIMIT }) {
  const params = [booleanQuery];
  const scope = [];
  if (channelIds.length) { scope.push(`channelId IN (${placeholders(channelIds)})`); params.push(...channelIds); }
  if (conversationIds.length) { scope.push(`conversationId IN (${placeholders(conversationIds)})`); params.push(...conversationIds); }
  if (!scope.length) return null;
  let sql = 'SELECT id FROM `Message` WHERE MATCH(content) AGAINST (? IN BOOLEAN MODE) AND deleted = 0';
  sql += ` AND (${scope.join(' OR ')})`;
  if (cursor?.date && cursor?.id) {
    sql += ' AND (createdAt < ? OR (createdAt = ? AND id < ?))';
    params.push(cursor.date, cursor.date, cursor.id);
  }
  sql += ' ORDER BY createdAt DESC, id DESC LIMIT ?';
  params.push(Math.max(1, Math.min(CANDIDATE_LIMIT, Number(limit) || CANDIDATE_LIMIT)));
  return { sql, params };
}

// Ids candidatos (array) ou null = "use o LIKE".
async function fulltextCandidateIds(prisma, { text, channelIds, conversationIds, cursor, now = Date.now() }) {
  if (process.env.MESSAGE_SEARCH_FULLTEXT === '0') return null;
  if (now < disabledUntil) return null;
  const booleanQuery = buildBooleanQuery(text);
  if (!booleanQuery) return null;
  const built = buildCandidateSql({ booleanQuery, channelIds, conversationIds, cursor });
  if (!built) return null;
  try {
    const rows = await prisma.$queryRawUnsafe(built.sql, ...built.params);
    const ids = (rows || []).map((r) => r.id).filter(Boolean);
    return ids.length ? ids : null;
  } catch (err) {
    disabledUntil = now + DISABLE_MS;
    console.warn('[busca] FULLTEXT indisponível, usando LIKE:', err?.message || err);
    return null;
  }
}

function resetFulltextState() { disabledUntil = 0; }

module.exports = { buildBooleanQuery, buildCandidateSql, fulltextCandidateIds, resetFulltextState, CANDIDATE_LIMIT };
