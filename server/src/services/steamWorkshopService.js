// Serviço que fala com a Steamworks Web API oficial (api.steampowered.com)
// pra buscar/listar itens do Steam Workshop — mesma filosofia do
// modioService.js: nunca baixa o arquivo do mod em si (isso quem faz é a
// própria Steam, no computador da pessoa, quando ela clica "Inscrever-se"
// — ver desktop/steamDetector.js), só repassa metadados (título,
// descrição, imagem de prévia, contagem de inscrições/votos).
//
// Duas interfaces diferentes são usadas aqui:
// - IPublishedFileService/QueryFiles — busca/lista itens (paginação por
//   cursor, não por offset — é assim que a API da Valve funciona).
// - ISteamRemoteStorage/GetPublishedFileDetails — detalhe de um item
//   específico pelo ID.
// As duas são de LEITURA e funcionam com uma chave pública gratuita
// (steamcommunity.com/dev/apikey) — nunca a chave de parceiro/publisher
// (essa outra exigiria rodar num servidor de confiança da Valve, não é
// o nosso caso).
const env = require('../config/env');
const { cacheGetOrSet } = require('../config/redis');

const API_BASE = 'https://api.steampowered.com';

function isConfigured() {
  return !!env.STEAM_WEB_API_KEY;
}

class SteamWorkshopNotConfiguredError extends Error {
  constructor() {
    super('STEAM_WEB_API_KEY não está configurada no servidor.');
    this.code = 'STEAM_WORKSHOP_NOT_CONFIGURED';
  }
}

const TTL_LIST = 5 * 60;
const TTL_DETAIL = 5 * 60;

// EPublishedFileQueryType (Steamworks) — os valores que usamos pros
// filtros que a UI oferece (item pedido 10: populares, mais baixados/
// inscrições, novos, atualizados).
const SORT_QUERY_TYPE = {
  popular: 0, // RankedByVote
  downloads: 10, // RankedByTotalUniqueSubscriptions
  new: 1, // RankedByPublicationDate
  updated: 21, // RankedByLastUpdatedDate
};
const TEXT_SEARCH_QUERY_TYPE = 13; // RankedByTextSearch — usado quando tem busca por texto

async function queryFiles(workshopAppId, { query, sort = 'popular', cursor = '*', limit = 20 } = {}) {
  if (!isConfigured()) throw new SteamWorkshopNotConfiguredError();
  const queryType = query ? TEXT_SEARCH_QUERY_TYPE : (SORT_QUERY_TYPE[sort] ?? SORT_QUERY_TYPE.popular);
  const params = new URLSearchParams({
    key: env.STEAM_WEB_API_KEY,
    appid: String(workshopAppId),
    query_type: String(queryType),
    numperpage: String(Math.min(limit, 50)),
    cursor,
    return_details: 'true',
    return_short_description: 'true',
    return_vote_data: 'true',
    return_tags: 'true',
    return_metadata: 'false',
  });
  if (query) params.set('search_text', query);

  const cacheKey = `workshop:list:${workshopAppId}:${params.toString()}`;
  return cacheGetOrSet(cacheKey, TTL_LIST, async () => {
    const res = await fetch(`${API_BASE}/IPublishedFileService/QueryFiles/v1/?${params.toString()}`);
    if (!res.ok) throw new Error(`Steam Web API respondeu ${res.status}`);
    const body = await res.json();
    return body.response || { total: 0, publishedfiledetails: [] };
  });
}

async function getFileDetails(publishedFileIds) {
  if (!isConfigured()) throw new SteamWorkshopNotConfiguredError();
  const ids = Array.isArray(publishedFileIds) ? publishedFileIds : [publishedFileIds];
  const cacheKey = `workshop:detail:${ids.join(',')}`;
  return cacheGetOrSet(cacheKey, TTL_DETAIL, async () => {
    const form = new URLSearchParams({ key: env.STEAM_WEB_API_KEY, itemcount: String(ids.length) });
    ids.forEach((id, i) => form.set(`publishedfileids[${i}]`, String(id)));
    const res = await fetch(`${API_BASE}/ISteamRemoteStorage/GetPublishedFileDetails/v1/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!res.ok) throw new Error(`Steam Web API respondeu ${res.status}`);
    const body = await res.json();
    return body.response?.publishedfiledetails || [];
  });
}

module.exports = { isConfigured, SteamWorkshopNotConfiguredError, queryFiles, getFileDetails };
