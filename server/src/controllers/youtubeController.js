// Item pedido: "vídeos publicados no canal do YouTube" — usa o feed RSS
// PÚBLICO do YouTube (não precisa de API key/credenciais nenhuma, ao
// contrário da YouTube Data API oficial). Estrutura do feed (formato
// Atom) é previsível o suficiente pra um parse simples por regex, sem
// precisar adicionar uma biblioteca de XML só pra isso.
const CHANNEL_ID = 'UCGC7KnI2123nCXRBgI8cnVw'; // @mrpinguim_br
const FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutos — evita bater no YouTube toda vez que alguém abre a página Início
// Item pedido: "mostra só vídeo, não shorts" — Shorts quase sempre têm
// até 60s de duração; esse limiar é o jeito prático de diferenciar sem
// precisar de API key (o feed RSS não indica shorts vs vídeo normal
// em nenhum campo próprio).
const SHORTS_MAX_SECONDS = 60;

let cache = { videos: null, fetchedAt: 0 };

function parseFeed(xml) {
  const entries = xml.split('<entry>').slice(1); // primeiro pedaço é o cabeçalho do feed, não uma entry
  return entries.map((entry) => {
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

// Busca a duração de um vídeo (em segundos) direto da página pública
// dele — sem precisar de API key. Se não conseguir extrair por algum
// motivo, devolve null (o chamador trata como "não sei, inclui mesmo
// assim", pra um erro de rede não sumir com o vídeo da lista à toa).
async function getVideoDurationSeconds(videoId) {
  try {
    const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
    if (!resp.ok) return null;
    const html = await resp.text();
    const match = html.match(/"lengthSeconds":"(\d+)"/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
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
    const all = parseFeed(xml);

    // Busca a duração de cada um (em paralelo) e filtra os Shorts —
    // olha mais que o total que vamos mostrar de uma vez, já que
    // alguns vão ser descartados como Shorts pelo caminho. O feed RSS
    // do YouTube, na prática, só devolve as ~15 publicações mais
    // recentes do canal (limite do próprio YouTube, não uma escolha
    // aqui) — por isso "mostrar mais" na página tem um teto real, seria
    // preciso uma fonte de dados diferente (scraping da página de
    // vídeos do canal, ou a API oficial com credenciais) pra ir além
    // disso.
    const candidates = all.slice(0, 40);
    const withDuration = await Promise.all(
      candidates.map(async (v) => ({ ...v, durationSeconds: await getVideoDurationSeconds(v.videoId) }))
    );
    const videos = withDuration
      .filter((v) => v.durationSeconds === null || v.durationSeconds > SHORTS_MAX_SECONDS)
      .map(({ durationSeconds, ...v }) => v); // não precisa expor esse detalhe interno pro cliente

    cache = { videos, fetchedAt: now };
    res.json({ videos });
  } catch (err) {
    if (cache.videos) return res.json({ videos: cache.videos });
    next(err);
  }
}

module.exports = { listYoutubeVideos };
