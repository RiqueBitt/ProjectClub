// Item pedido: "vídeos publicados no canal do YouTube" — usa o feed RSS
// PÚBLICO do YouTube (não precisa de API key/credenciais nenhuma, ao
// contrário da YouTube Data API oficial). Estrutura do feed (formato
// Atom) é previsível o suficiente pra um parse simples por regex, sem
// precisar adicionar uma biblioteca de XML só pra isso.
const CHANNEL_ID = 'UCGC7KnI2123nCXRBgI8cnVw'; // @mrpinguim_br
const FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutos — evita bater no YouTube toda vez que alguém abre a página Início

let cache = { videos: null, fetchedAt: 0 };

function parseFeed(xml) {
  const entries = xml.split('<entry>').slice(1); // primeiro pedaço é o cabeçalho do feed, não uma entry
  return entries.slice(0, 6).map((entry) => {
    const videoId = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    const title = entry.match(/<title>([^<]*)<\/title>/)?.[1];
    const published = entry.match(/<published>([^<]+)<\/published>/)?.[1];
    if (!videoId || !title) return null;
    return {
      videoId,
      title: title.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'),
      publishedAt: published || null,
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${videoId}`,
    };
  }).filter(Boolean);
}

async function listYoutubeVideos(req, res, next) {
  try {
    const now = Date.now();
    if (cache.videos && now - cache.fetchedAt < CACHE_TTL_MS) {
      return res.json({ videos: cache.videos });
    }
    const resp = await fetch(FEED_URL);
    if (!resp.ok) {
      // Feed fora do ar — devolve o que tinha em cache (mesmo vencido)
      // em vez de quebrar a página Início inteira por causa disso.
      return res.json({ videos: cache.videos || [] });
    }
    const xml = await resp.text();
    const videos = parseFeed(xml);
    cache = { videos, fetchedAt: now };
    res.json({ videos });
  } catch (err) {
    if (cache.videos) return res.json({ videos: cache.videos });
    next(err);
  }
}

module.exports = { listYoutubeVideos };
