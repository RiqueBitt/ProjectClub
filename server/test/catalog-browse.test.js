// Catálogo do Cinema (services/catalogBrowse.js): parse de TMDB, Jikan,
// TVmaze e iTunes com fixtures no formato público das APIs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const c = require('../src/services/catalogBrowse');

test('TMDB: lista, anime detectado, sem capa fica de fora', () => {
  const r = c.tmdbList({ page: 1, total_pages: 3, results: [
    { id: 1, media_type: 'movie', title: 'Duna: Parte Dois', original_title: 'Dune: Part Two', release_date: '2024-02-27', poster_path: '/a.jpg', backdrop_path: '/b.jpg', vote_average: 8.15, genre_ids: [878, 12], overview: 'Paul...' },
    { id: 2, media_type: 'tv', name: 'Frieren', original_name: '葬送のフリーレン', first_air_date: '2023-09-29', poster_path: '/f.jpg', genre_ids: [16, 10765], original_language: 'ja', origin_country: ['JP'] },
    { id: 3, media_type: 'person', name: 'Zendaya' },
    { id: 4, media_type: 'movie', title: 'Sem capa' },
  ] });
  assert.deepEqual(r.items.map((i) => [i.id, i.kind]), [['tmdb:movie:1', 'filme'], ['tmdb:tv:2', 'anime']]);
  assert.equal(r.items[0].poster, 'https://image.tmdb.org/t/p/w500/a.jpg');
  assert.equal(r.items[0].rating, 8.2);
  assert.equal(r.items[0].original, 'Dune: Part Two');
  assert.deepEqual(r.items[0].genres, ['Ficção científica', 'Aventura']);
  assert.equal(r.hasMore, true);
});

test('TMDB: detalhe com trailer em português primeiro e onde assistir no Brasil', () => {
  const d = c.tmdbDetail({
    id: 1, title: 'Duna', poster_path: '/a.jpg', release_date: '2024-02-27', runtime: 166, genres: [{ id: 878, name: 'Ficção científica' }], overview: 'x', imdb_id: 'tt15239678',
    videos: { results: [
      { site: 'YouTube', key: 'AAAAAAAAAAA', type: 'Trailer', iso_639_1: 'en', name: 'Official Trailer', official: true },
      { site: 'YouTube', key: 'BBBBBBBBBBB', type: 'Trailer', iso_639_1: 'pt', name: 'Trailer Dublado' },
      { site: 'Vimeo', key: 'zzz', type: 'Trailer' },
      { site: 'YouTube', key: 'CCCCCCCCCCC', type: 'Featurette', iso_639_1: 'pt' },
    ] },
    'watch/providers': { results: { BR: { link: 'https://www.themoviedb.org/movie/1/watch?locale=BR', flatrate: [{ provider_name: 'Max', logo_path: '/m.jpg' }], rent: [{ provider_name: 'Apple TV', logo_path: '/t.jpg' }] } } },
    credits: { cast: [{ name: 'Timothée Chalamet', character: 'Paul', profile_path: '/p.jpg' }], crew: [{ job: 'Director', name: 'Denis Villeneuve' }] },
    release_dates: { results: [{ iso_3166_1: 'BR', release_dates: [{ certification: '14' }] }] },
    recommendations: { results: [{ id: 9, title: 'Duna', poster_path: '/d.jpg' }] },
  }, 'movie');
  assert.deepEqual(d.trailers.map((t) => [t.youtubeId, t.lang]), [['BBBBBBBBBBB', 'Dublado'], ['AAAAAAAAAAA', 'Inglês']]);
  assert.deepEqual(d.providers.stream, [{ name: 'Max', logo: 'https://image.tmdb.org/t/p/w92/m.jpg' }]);
  assert.equal(d.providers.rent[0].name, 'Apple TV');
  assert.deepEqual(d.creators, ['Denis Villeneuve']);
  assert.equal(d.certification, '14');
  assert.equal(d.cast[0].photo, 'https://image.tmdb.org/t/p/w185/p.jpg');
  assert.equal(d.recommendations[0].id, 'tmdb:movie:9');
  assert.ok(d.links.some((l) => l.url === 'https://www.imdb.com/title/tt15239678/'));
  assert.equal(c.pickProviders({ results: { US: {} } }), null);
});

test('Jikan: temporada e detalhe com trailer pelo embed_url e streaming oficial', () => {
  const l = c.malList({ pagination: { current_page: 1, has_next_page: true }, data: [
    { mal_id: 52991, title: 'Sousou no Frieren', title_english: "Frieren: Beyond Journey's End", year: 2023, score: 9.31, images: { webp: { large_image_url: 'https://cdn.myanimelist.net/f.webp' } }, genres: [{ name: 'Adventure' }], synopsis: 'Elf... [Written by MAL Rewrite]' },
    { mal_id: 1, title: 'Sem imagem' },
  ] });
  assert.deepEqual(l.items.map((i) => i.id), ['mal:52991']);
  assert.equal(l.items[0].title, "Frieren: Beyond Journey's End");
  assert.equal(l.items[0].original, 'Sousou no Frieren');
  assert.equal(l.items[0].overview, 'Elf...');
  const d = c.malDetail({
    mal_id: 52991, title: 'Sousou no Frieren', images: { jpg: { large_image_url: 'https://cdn.myanimelist.net/f.jpg' } }, status: 'Finished Airing', episodes: 28, duration: '24 min per ep',
    trailer: { youtube_id: null, embed_url: 'https://www.youtube-nocookie.com/embed/qgQh0R9Kn1A?enablejsapi=1' }, studios: [{ name: 'Madhouse' }], season: 'fall', year: 2023,
    streaming: [{ name: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/GG5H5XQX4' }, { name: 'Ruim', url: 'javascript:alert(1)' }],
  }, { data: [{ entry: { mal_id: 5114, title: 'Fullmetal Alchemist', images: { jpg: { large_image_url: 'https://cdn.myanimelist.net/x.jpg' } } } }] });
  assert.equal(d.trailers[0].youtubeId, 'qgQh0R9Kn1A');
  assert.deepEqual(d.providers.stream.map((s) => s.name), ['Crunchyroll']);
  assert.equal(d.status, 'Finalizado');
  assert.equal(d.runtime, 24);
  assert.equal(d.season, 'Outono 2023');
  assert.equal(d.network, 'Madhouse');
  assert.equal(d.recommendations[0].id, 'mal:5114');
});

test('TVmaze: programação de hoje vira séries únicas por popularidade', () => {
  const show = (id, name, weight) => ({ id, name, weight, premiered: '2022-01-01', image: { original: `https://static.tvmaze.com/${id}.jpg` }, genres: ['Drama'], webChannel: { name: 'Netflix' }, summary: '<p>Resumo <b>aqui</b></p>' });
  const r = c.tvmSchedule([{ _embedded: { show: show(1, 'A', 50) } }, { _embedded: { show: show(2, 'B', 99) } }, { _embedded: { show: show(1, 'A', 50) } }, { _embedded: { show: { id: 3, name: 'Sem capa' } } }]);
  assert.deepEqual(r.map((s) => s.id), ['tvm:2', 'tvm:1']);
  assert.equal(r[0].overview, 'Resumo aqui');
  assert.equal(r[0].network, 'Netflix');
  const d = c.tvmDetail({ ...show(2, 'B', 99), status: 'Running', officialSite: 'https://www.netflix.com/title/1', webChannel: { name: 'Netflix', officialSite: 'https://www.netflix.com' },
    _embedded: { cast: [{ person: { name: 'Ator', image: { medium: 'https://static.tvmaze.com/p.jpg' } }, character: { name: 'Papel' } }], seasons: [{ number: 1, episodeOrder: 8, premiereDate: '2022-01-01' }] } });
  assert.equal(d.status, 'Em exibição');
  assert.equal(d.providers.stream[0].name, 'Netflix');
  assert.equal(d.seasons[0].episodes, 8);
  assert.equal(d.cast[0].role, 'Papel');
});

test('iTunes: RSS de filmes, capa grande e trailer em vídeo', () => {
  const rss = c.itnRss({ feed: { entry: [
    { 'im:name': { label: 'Divertida Mente 2' }, id: { attributes: { 'im:id': '1740019876' } }, 'im:image': [{ label: 'https://is1-ssl.mzstatic.com/image/thumb/a/60x60bb.png' }, { label: 'https://is1-ssl.mzstatic.com/image/thumb/a/170x170bb.png' }], summary: { label: 'Riley...' }, category: { attributes: { label: 'Kids & Family' } }, 'im:releaseDate': { label: '2024-06-14T00:00:00-07:00' } },
  ] } });
  assert.equal(rss[0].id, 'itn:1740019876');
  assert.equal(rss[0].poster, 'https://is1-ssl.mzstatic.com/image/thumb/a/600x900bb.jpg');
  assert.equal(rss[0].year, 2024);
  const d = c.itnDetail({ trackId: 5, trackName: 'Filme', artworkUrl100: 'https://x/100x100bb.jpg', previewUrl: 'https://video-ssl.itunes.apple.com/p.m4v', trackViewUrl: 'https://tv.apple.com/br/movie/5', trackTimeMillis: 6000000, trackRentalPrice: 14.9, longDescription: 'Sinopse' });
  assert.equal(d.trailers[0].url, 'https://video-ssl.itunes.apple.com/p.m4v');
  assert.equal(d.runtime, 100);
  assert.equal(d.providers.rent[0].name, 'Apple TV');
});

test('ids e texto de busca são validados', () => {
  for (const ok of ['tmdb:movie:603', 'tmdb:tv:1399', 'mal:5114', 'tvm:82', 'itn:1234567']) assert.ok(c.ID_RE.test(ok), ok);
  for (const bad of ['tmdb:person:1', 'mal:abc', '../x', 'tvm:1/../../', 'itn:']) assert.ok(!c.ID_RE.test(bad), bad);
  assert.equal(c.safeText('  <b>naruto</b>\n '), 'b naruto /b');
  assert.equal(c.ytIdFrom('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
});

test('Pluto TV: índice via TMDB, filtros locais e carregamento progressivo', async () => {
  process.env.TMDB_API_KEY = 'chave-de-teste';
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    const u = new URL(url); calls.push(u.pathname + '?' + u.searchParams.get('page'));
    const J = (o) => ({ ok: true, status: 200, json: async () => o });
    if (u.pathname === '/3/watch/providers/movie') return J({ results: [{ provider_id: 999, provider_name: 'Netflix' }, { provider_id: 300, provider_name: 'Pluto TV' }] });
    if (u.pathname.startsWith('/3/genre/')) return J({ genres: [{ id: 28, name: 'Ação' }, { id: 35, name: 'Comédia' }, { id: 10759, name: 'Action & Adventure' }] });
    if (u.pathname === '/3/discover/movie') {
      assert.equal(u.searchParams.get('with_watch_providers'), '300');
      assert.equal(u.searchParams.get('watch_region'), 'BR');
      const page = Number(u.searchParams.get('page'));
      return J({ page, total_pages: 2, results: page === 1
        ? [{ id: 1, title: 'Ação em São Paulo', release_date: '2015-05-01', poster_path: '/1.jpg', genre_ids: [28], original_language: 'pt', popularity: 50, vote_average: 7, vote_count: 100 },
          { id: 2, title: 'Comédia Antiga', release_date: '1995-01-01', poster_path: '/2.jpg', genre_ids: [35], original_language: 'en', popularity: 90 }]
        : [{ id: 3, title: 'Robôs 2022', release_date: '2022-03-01', poster_path: '/3.jpg', genre_ids: [28, 35], original_language: 'en', popularity: 70, vote_average: 8, vote_count: 40 }] });
    }
    if (u.pathname === '/3/discover/tv') return J({ page: 1, total_pages: 1, results: [{ id: 7, name: 'Série Policial', first_air_date: '2019-01-01', poster_path: '/7.jpg', genre_ids: [80], original_language: 'en', popularity: 10 }] });
    return { ok: false, status: 404 };
  };
  try {
    const first = await c.plutoSearch({});
    assert.ok(first.items.length >= 1, 'responde já na 1ª página');
    await c._pluto.building; // espera terminar o resto
    const all = await c.plutoSearch({ yearFrom: 0 });
    assert.equal(all.total, 4);
    const def = await c.plutoSearch({}); // padrão: a partir de 2001
    assert.deepEqual(def.items.map((i) => i.id), ['tmdb:movie:3', 'tmdb:movie:1', 'tmdb:tv:7']);
    assert.deepEqual((await c.plutoSearch({ q: 'sao paulo' })).items.map((i) => i.id), ['tmdb:movie:1'], 'busca sem acento');
    assert.deepEqual((await c.plutoSearch({ type: 'movie', genre: 35, yearFrom: 0 })).items.map((i) => i.id), ['tmdb:movie:2', 'tmdb:movie:3']);
    assert.deepEqual((await c.plutoSearch({ lang: 'pt' })).items.map((i) => i.id), ['tmdb:movie:1']);
    assert.deepEqual((await c.plutoSearch({ sort: 'recentes' })).items.map((i) => i.year), [2022, 2019, 2015]);
    const n = calls.length;
    await c.plutoSearch({ q: 'robo' });
    assert.equal(calls.length, n, 'filtros não fazem novos pedidos');
    const meta = await c.plutoMeta();
    assert.equal(meta.enabled, true);
    assert.deepEqual(meta.counts, { movie: 3, tv: 1 });
    assert.ok(meta.langs.find((l) => l.code === 'pt' && l.name === 'Português'));
  } finally {
    global.fetch = realFetch;
    delete process.env.TMDB_API_KEY;
  }
  assert.equal((await c.plutoMeta()).enabled, false);
  await assert.rejects(c.plutoSearch({}), (e) => e.status === 503);
});

test('onde assistir marca quando está na Pluto TV', () => {
  const pv = c.pickProviders({ results: { BR: { link: 'https://www.themoviedb.org/movie/1/watch?locale=BR', ads: [{ provider_name: 'Pluto TV', logo_path: '/p.jpg' }] } } });
  assert.equal(pv.pluto, true);
  assert.equal(pv.free[0].name, 'Pluto TV');
  assert.equal(c.pickProviders({ results: { BR: { flatrate: [{ provider_name: 'Netflix' }] } } }).pluto, false);
});
