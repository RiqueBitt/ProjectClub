// Parser do navegador de YouTube (services/youtubeBrowse.js).
// Fixtures montadas a partir da estrutura conhecida do ytInitialData
// (o sandbox de teste não acessa youtube.com).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yt = require('../src/services/youtubeBrowse');

const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');

test('busca: extrai vídeos, ignora Shorts/anúncios/duplicados e acha a continuação', () => {
  const r = yt.parseSearchHtml(fx('yt-search.html'));
  assert.deepEqual(r.videos.map((v) => v.videoId), ['dQw4w9WgXcQ', 'jNQXAC9IVRw', 'LIVE0000001']);
  const [a, , live] = r.videos;
  assert.equal(a.title, 'Rick Astley - Never Gonna Give You Up (Official Video) {4K} "Remastered"');
  assert.equal(a.channel, 'Rick Astley');
  assert.equal(a.channelId, 'UCuAXFkgsw1L7xaCfnd5JJOw');
  assert.equal(a.duration, '3:33');
  assert.equal(a.views, '1,7 bi de visualizações');
  assert.equal(a.published, 'há 15 anos');
  assert.match(a.thumbnail, /^https:\/\/i\.ytimg\.com\/vi\/dQw4w9WgXcQ\/hq720\.jpg\?sqp=big$/);
  assert.equal(a.live, false);
  assert.equal(live.live, true);
  assert.equal(live.duration, '');
  assert.equal(live.title, 'Lofi ao vivo 24/7 \\ beats');
  assert.equal(r.continuation, 'EpcDEgltaW5lY3JhZnQ');
});

test('a seguir: lockupViewModel + compactVideoRenderer, sem o próprio vídeo nem playlists', () => {
  const r = yt.parseWatchHtml(fx('yt-watch.html'), 'dQw4w9WgXcQ');
  assert.deepEqual(r.videos.map((v) => v.videoId), ['kJQP7kiw5Fk', '9bZkp7q19f0']);
  const d = r.videos[0];
  assert.equal(d.title, 'Luis Fonsi - Despacito ft. Daddy Yankee');
  assert.equal(d.channel, 'Luis Fonsi');
  assert.equal(d.duration, '4:42');
  assert.equal(d.views, '8,7 bi de visualizações');
  assert.equal(d.published, 'há 7 anos');
  assert.equal(r.videos[1].duration, '4:13');
});

test('HTML sem ytInitialData / quebrado não lança', () => {
  assert.deepEqual(yt.parseSearchHtml('<html>consent page</html>'), { videos: [], continuation: null });
  assert.deepEqual(yt.parseSearchHtml('var ytInitialData = {"a": "}'), { videos: [], continuation: null });
  assert.deepEqual(yt.parseWatchHtml(null, 'x'), { videos: [], continuation: null });
});

test('thumbnail fora do i.ytimg vira a padrão (CSP/segurança)', () => {
  const r = yt.collectVideos({ videoRenderer: { videoId: 'abcdefghijk', title: { simpleText: 't' }, thumbnail: { thumbnails: [{ url: 'https://evil.example/x.jpg', width: 9 }] } } });
  assert.equal(r.videos[0].thumbnail, 'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg');
});

test('sugestões: JSON e JSONP', () => {
  assert.deepEqual(yt.parseSuggest('["mine",["minecraft","minecraft 1.21"]]'), ['minecraft', 'minecraft 1.21']);
  assert.deepEqual(yt.parseSuggest('window.google.ac.h(["mine",[["minecraft",0,[512]],["mineirinho",0]],{"k":1}])'), ['minecraft', 'mineirinho']);
  assert.deepEqual(yt.parseSuggest('lixo'), []);
});

test('duração ISO da Data API', () => {
  assert.equal(yt.isoDur('PT3M33S'), '3:33');
  assert.equal(yt.isoDur('PT1H2M3S'), '1:02:03');
  assert.equal(yt.isoDur('P0D'), '');
});
