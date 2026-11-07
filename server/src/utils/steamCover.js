// Capa de jogo da Steam na atividade ("Jogando X").
//
// BUG CORRIGIDO ("Jogando <jogo>" sem capa nos jogos da Steam): o AppID só
// era descoberto "adivinhando" pelo link da imagem que o app de desktop
// mandava — jogo fora da lista fixa do desktop chegava sem AppID nenhum e
// ficava sem capa. Agora o desktop manda `steamAppId` direto (pergunta pra
// própria Steam qual jogo está rodando), e aqui ele é validado, com o link
// antigo como reserva (versões antigas do app de desktop).
//
// As capas vêm do CDN público da Steam (mesmo esquema do site: capa
// vertical primeiro, header como reserva, e o proxy /api/proxy/steam pra
// jogos com arte num endereço com código no meio).

const STEAM_CDN = 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/';
const FILES = { cover: 'library_600x900.jpg', header: 'header.jpg' };
const MAX_APP_ID = 100000000;

function validAppId(raw) {
  const n = typeof raw === 'string' && /^\d{1,9}$/.test(raw) ? Number(raw) : raw;
  return Number.isInteger(n) && n > 0 && n < MAX_APP_ID ? n : null;
}

// App ID a partir de um link de arte da Steam (CDN antigo/novo) ou do
// nosso proxy (/api/proxy/steam/<id>/...).
function steamAppIdFromUrl(url) {
  if (typeof url !== 'string' || url.length > 2000) return null;
  const m = /\/steam\/apps\/(\d{1,9})\//.exec(url) || /\/api\/proxy\/steam\/(\d{1,9})\//.exec(url);
  return m ? validAppId(Number(m[1])) : null;
}

// { steamAppId?, imageUrl? } → AppID ou null.
function steamAppIdOf(activity) {
  if (!activity || typeof activity !== 'object') return null;
  return validAppId(activity.steamAppId) || steamAppIdFromUrl(activity.imageUrl);
}

// Link direto da arte no CDN da Steam ('cover' = vertical 600x900, 'header' = horizontal).
function steamCoverUrl(appId, kind = 'cover') {
  const id = validAppId(appId);
  if (!id || !FILES[kind]) return null;
  return `${STEAM_CDN}${id}/${FILES[kind]}`;
}

module.exports = { steamAppIdOf, steamAppIdFromUrl, steamCoverUrl, validAppId, STEAM_CDN };
