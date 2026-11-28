// Arte da atividade detectada (jogo/música/app).
//
// BUG CORRIGIDO ("Jogando <jogo>" sem capa nos jogos da Steam): o AppID só
// saía do link do header antigo (…/steam/apps/<appid>/header.jpg) e a capa
// dependia só do proxy do servidor — se ele falhasse, a <img> ficava
// quebrada (sem reserva nenhuma). Agora o desktop manda `steamAppId` e o
// site tenta, em ordem, a capa vertical direto do CDN da Steam (igual a
// capa do álbum da música, que vem direto do iTunes), o proxy (que acha
// artes com código no meio do endereço), o header e, por fim, o ícone
// genérico — ver components/SteamGameCover.jsx.
const STEAM_CDN = 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/';

function validAppId(raw) {
  const n = typeof raw === 'string' && /^\d{1,9}$/.test(raw) ? Number(raw) : raw;
  return Number.isInteger(n) && n > 0 && n < 100000000 ? n : null;
}

export function steamAppIdFromActivity(activity) {
  if (!activity) return null;
  const direct = validAppId(activity.steamAppId);
  if (direct) return direct;
  const url = typeof activity.imageUrl === 'string' ? activity.imageUrl : '';
  const m = url.match(/\/steam\/apps\/(\d{1,9})\//) || url.match(/\/api\/proxy\/steam\/(\d{1,9})\//);
  return m ? validAppId(Number(m[1])) : null;
}

// Link direto no CDN da Steam: 'cover' = capa vertical 600x900, 'header' = horizontal 460x215.
export function steamCoverUrl(appId, kind = 'cover') {
  const id = validAppId(appId);
  if (!id) return null;
  return `${STEAM_CDN}${id}/${kind === 'header' ? 'header.jpg' : 'library_600x900.jpg'}`;
}

// Ordem de tentativa da capa (cada falha de carregamento passa pra próxima).
// shape = formato esperado; o componente confere o formato real no onLoad.
// prefer = 'wide' pra lugares com faixa larga (header primeiro).
export function steamCoverCandidates(appId, prefer = 'cover') {
  const id = validAppId(appId);
  if (!id) return [];
  const cover = [
    { src: steamCoverUrl(id, 'cover'), shape: 'cover' },
    { src: `/api/proxy/steam/${id}/cover`, shape: 'cover' },
  ];
  const wide = [
    { src: steamCoverUrl(id, 'header'), shape: 'wide' },
    { src: `/api/proxy/steam/${id}/header`, shape: 'wide' },
  ];
  return prefer === 'wide' ? [...wide, ...cover] : [...cover, ...wide];
}

export function activityArtUrl(activity) {
  if (!activity) return null;
  const appId = activity.type === 'game' ? steamAppIdFromActivity(activity) : null;
  if (appId) return steamCoverUrl(appId, 'cover');
  return activity.imageUrl || null;
}

export const ACTIVITY_VERB = { game: 'Jogando', spotify: 'Ouvindo', app: 'Usando' };
