// Serviço que fala com a API oficial do mod.io (https://docs.mod.io/restapiref/)
// em nome do Project Club — nunca faz scraping do site, sempre usa a REST
// API documentada. Este é o ÚNICO lugar do backend que conhece a URL/chave
// do mod.io; controllers nunca chamam a API externa diretamente, só passam
// por aqui, pra manter cache/rate-limit/tratamento de erro num lugar só.
//
// Item pedido: "Não armazenar arquivos dos mods... o banco de dados deve
// armazenar apenas informações necessárias" — este serviço nunca baixa nem
// grava o arquivo físico de um mod; só repassa metadados (nome, descrição,
// versão, screenshots, URL de download ASSINADA E COM EXPIRAÇÃO que o
// próprio mod.io gera) — quem baixa de verdade é o app desktop (ver
// desktop/modsManager.js), direto do mod.io, sem passar pelos nossos
// servidores.
//
// Item pedido: "Criar cache para reduzir chamadas desnecessárias à API do
// mod.io... deve possuir expiração." — usa o cacheGetOrSet já existente
// (Redis, ver config/redis.js), mesmo padrão usado pelo resto do backend.
const env = require('../config/env');
const { cacheGetOrSet } = require('../config/redis');

const API_BASE = env.MODIO_API_BASE || 'https://api.mod.io/v1';

// Chave de API "read-only" (item pedido: "Consultar a documentação... para
// utilizar os endpoints corretos, autenticação correta") — suficiente pra
// tudo que este serviço faz (buscar jogos/mods/detalhes/categorias), já
// que browsing e download são ações de leitura segundo a doc oficial.
// Ações de escrita (favoritar, dar up, comentar DENTRO do mod.io) não são
// usadas aqui de propósito — o Project Club mantém esses dados nas
// próprias tabelas (ModFavorite, ModUp, ModComment), reaproveitando as
// contas já existentes em vez de exigir login OAuth do mod.io por usuário.
function isConfigured() {
  return !!env.MODIO_API_KEY;
}

class ModioNotConfiguredError extends Error {
  constructor() {
    super('MODIO_API_KEY não está configurada no servidor.');
    this.code = 'MODIO_NOT_CONFIGURED';
  }
}

async function modioFetch(path, { searchParams } = {}) {
  if (!isConfigured()) throw new ModioNotConfiguredError();
  const url = new URL(`${API_BASE}${path}`);
  url.searchParams.set('api_key', env.MODIO_API_KEY);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, value);
    }
  }
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.error?.message || `mod.io respondeu ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.modioErrorRef = body?.error?.error_ref;
    throw err;
  }
  return body;
}

// TTLs — item pedido: "cache... deve possuir expiração". Listas mudam
// pouco minuto a minuto (dá pra cachear mais tempo); detalhe de um mod
// específico (contagem de downloads, avaliação) muda um pouco mais rápido
// quando a pessoa está navegando ativamente nele.
const TTL_GAME_LIST = 60 * 60; // 1h — jogos raramente mudam
const TTL_MOD_LIST = 5 * 60; // 5min — listas/pesquisas
const TTL_MOD_DETAIL = 3 * 60; // 3min
const TTL_CATEGORIES = 60 * 60; // 1h

// GET /games/{id} — usado pra confirmar que o jogo mapeado ainda existe/
// está ativo no mod.io antes de mostrar "mods disponíveis" pra ele.
async function getGame(modioGameId) {
  return cacheGetOrSet(`modio:game:${modioGameId}`, TTL_GAME_LIST, () => modioFetch(`/games/${modioGameId}`));
}

// GET /games/{id}/mods — lista/pesquisa de mods de um jogo. Item pedido:
// "permitir pesquisar por nome, autor, categoria, tags" + filtros
// (populares, mais baixados, melhor avaliados, novos, atualizados) — tudo
// isso já existe nativamente na API via _q (busca textual) e _sort (ver
// docs.mod.io/restapiref, seção Filtering/Sorting), só repassamos os
// parâmetros certos.
const SORT_MAP = {
  popular: '-downloads_total',
  downloads: '-downloads_total',
  rating: '-rating_positive',
  new: '-date_added',
  updated: '-date_updated',
};

async function listMods(modioGameId, { query, sort, category, tags, offset = 0, limit = 20 } = {}) {
  const searchParams = {
    _limit: limit,
    _offset: offset,
    _sort: SORT_MAP[sort] || SORT_MAP.popular,
  };
  if (query) searchParams._q = query;
  if (category) searchParams.tags = category;
  if (tags) searchParams.tags = searchParams.tags ? `${searchParams.tags},${tags}` : tags;
  const cacheKey = `modio:mods:${modioGameId}:${JSON.stringify(searchParams)}`;
  return cacheGetOrSet(cacheKey, TTL_MOD_LIST, () => modioFetch(`/games/${modioGameId}/mods`, { searchParams }));
}

// GET /games/{id}/mods/{id} — detalhe completo (descrição, screenshots,
// tags, changelog vem do modfile atual).
async function getMod(modioGameId, modioModId) {
  return cacheGetOrSet(`modio:mod:${modioGameId}:${modioModId}`, TTL_MOD_DETAIL, () => modioFetch(`/games/${modioGameId}/mods/${modioModId}`));
}

// GET /games/{id}/mods/{id}/dependencies — item pedido: "quando um mod
// precisar de outros mods/frameworks... listar as dependências".
async function getModDependencies(modioGameId, modioModId) {
  return cacheGetOrSet(`modio:mod-deps:${modioGameId}:${modioModId}`, TTL_MOD_DETAIL, () => modioFetch(`/games/${modioGameId}/mods/${modioModId}/dependencies`));
}

// GET /games/{id}/tags — categorias/tags disponíveis pra esse jogo
// (item pedido: filtros de categoria — Gameplay, Gráficos, Mapas, Áudio,
// Interface, QoL "e outras categorias disponíveis na fonte").
async function getGameTags(modioGameId) {
  return cacheGetOrSet(`modio:tags:${modioGameId}`, TTL_CATEGORIES, () => modioFetch(`/games/${modioGameId}/tags`));
}

// GET /games/{id}/mods/{id}/files/{fileId}/download — retorna um Download
// Object com uma binary_url ASSINADA E COM EXPIRAÇÃO (ver docs.mod.io,
// "Response Formats"). Nunca cacheado (a URL expira) e o backend nunca
// baixa o arquivo em si — só repassa essa URL pro app desktop, que baixa
// direto do mod.io. É esta função que garante a regra "não armazenar
// arquivos dos mods": em nenhum momento os bytes do mod passam pelo
// processo do Node do Project Club.
async function getModfileDownload(modioGameId, modioModId, modfileId) {
  return modioFetch(`/games/${modioGameId}/mods/${modioModId}/files/${modfileId}/download`);
}

module.exports = {
  isConfigured, ModioNotConfiguredError,
  getGame, listMods, getMod, getModDependencies, getGameTags, getModfileDownload,
};
