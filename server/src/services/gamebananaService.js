// Serviço que fala com a API do GameBanana (gamebanana.com/apiv11) —
// item pedido: "integrar sem precisar de login". A API deles é
// semi-oficial (documentada pela própria comunidade, não pelo site
// oficial num lugar único) mas totalmente aberta pra leitura: sem
// chave, sem token, sem login nenhum, nem do nosso servidor nem da
// pessoa usando o Project Club — só um cabeçalho User-Agent educado.
//
// AVISO PRA QUEM FOR MANTER ISSO DEPOIS: por ser semi-oficial, alguns
// nomes de campo exatos das respostas de LISTAGEM (Subfeed/Search) não
// têm 100% de certeza documentada — o controller (gamebananaController.js)
// já normaliza o que vem de lá com vários nomes alternativos possíveis
// pra cada campo, então um pequeno desalinhamento de nome não deveria
// quebrar a tela inteira, só deixar um campo em branco. Se algo vier
// diferente do esperado, o jeito de descobrir é abrir o DevTools do
// navegador em gamebanana.com e olhar as chamadas de rede de verdade.
const { cacheGetOrSet } = require('../config/redis');

const API_BASE = 'https://gamebanana.com/apiv11';
const USER_AGENT = 'ProjectClub/1.0 (contato via projectclub)';

async function gbFetch(path, searchParams) {
  const url = new URL(`${API_BASE}${path}`);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, value);
    }
  }
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!res.ok) {
    const err = new Error(`GameBanana respondeu ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const TTL_LIST = 5 * 60;
const TTL_DETAIL = 5 * 60;

// Busca por palavra-chave (Util/Search/Results) OU navegação sem busca
// (Game/{id}/Subfeed, ordem "em destaque" da própria GameBanana) —
// item pedido 10: pesquisar por nome + filtro de "novos".
async function browseOrSearch(gameBananaGameId, { query, sort = 'default', page = 1, limit = 20 } = {}) {
  if (query) {
    const params = {
      _sSearchString: query, _idGameRow: gameBananaGameId,
      _csvModelInclusions: 'Mod', _nPage: page, _nPerpage: Math.min(limit, 50),
    };
    const cacheKey = `gamebanana:search:${gameBananaGameId}:${JSON.stringify(params)}`;
    return cacheGetOrSet(cacheKey, TTL_LIST, () => gbFetch('/Util/Search/Results', params));
  }
  const params = { _nPage: page, _nPerpage: Math.min(limit, 50) };
  if (sort === 'new') params._sSort = 'new';
  const cacheKey = `gamebanana:subfeed:${gameBananaGameId}:${JSON.stringify(params)}`;
  return cacheGetOrSet(cacheKey, TTL_LIST, () => gbFetch(`/Game/${gameBananaGameId}/Subfeed`, params));
}

// Mod/{id} com _csvProperties pedindo só o que a gente usa — a API deles
// deixa escolher os campos exatos em vez de sempre devolver tudo.
async function getMod(modId) {
  const properties = [
    '_sName', '_sProfileUrl', '_sDescription', '_sText',
    '_aSubmitter', '_tsDateAdded', '_tsDateModified',
    '_aPreviewMedia', '_aFiles', '_nViewCount', '_nLikeCount', '_aCategory',
  ].join(',');
  const cacheKey = `gamebanana:mod:${modId}`;
  return cacheGetOrSet(cacheKey, TTL_DETAIL, () => gbFetch(`/Mod/${modId}`, { _csvProperties: properties }));
}

module.exports = { browseOrSearch, getMod };
