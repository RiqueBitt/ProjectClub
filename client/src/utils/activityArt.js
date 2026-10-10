// Arte da atividade detectada (jogo/música/app). Pra jogo da Steam, o app
// de desktop manda o header antigo (…/steam/apps/<appid>/header.jpg), que
// dá 404 em muitos jogos — usa o proxy do servidor, que acha o arquivo certo.
export function steamAppIdFromActivity(activity) {
  if (!activity) return null;
  if (Number.isInteger(activity.steamAppId) && activity.steamAppId > 0) return activity.steamAppId;
  const m = typeof activity.imageUrl === 'string' && activity.imageUrl.match(/\/steam\/apps\/(\d+)\//);
  return m ? Number(m[1]) : null;
}

export function activityArtUrl(activity) {
  if (!activity) return null;
  const appId = activity.type === 'game' ? steamAppIdFromActivity(activity) : null;
  if (appId) return `/api/proxy/steam/${appId}/header`;
  return activity.imageUrl || null;
}

export const ACTIVITY_VERB = { game: 'Jogando', spotify: 'Ouvindo', app: 'Usando' };
