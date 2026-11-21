// Capa de jogo da Steam na atividade ("Jogando X"): AppID (direto ou pelo
// link antigo), links do CDN da Steam, lista de domínios do proxy de
// imagens e a mesma conta no lado do site (client/src/utils/activityArt.js)
// e do app de desktop (desktop/steamDetector.js / activityDetector.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Redis falso (o proxy carrega o steamArtService, que usa cache no Redis).
require.cache[path.resolve(__dirname, '../src/config/redis.js')] = {
  exports: { redis: { get: async () => null, set: async () => 'OK' }, cacheGetOrSet: async (k, t, fn) => fn(), cacheInvalidate: async () => {} }, loaded: true, id: 'redis',
};

const { steamAppIdOf, steamAppIdFromUrl, steamCoverUrl } = require('../src/utils/steamCover');
const { isAllowedUrl } = require('../src/routes/imageProxy');

test('AppID: campo direto, link antigo/novo da Steam e proxy', () => {
  assert.equal(steamAppIdOf({ steamAppId: 730 }), 730);
  assert.equal(steamAppIdOf({ steamAppId: '1086940' }), 1086940);
  assert.equal(steamAppIdOf({ imageUrl: 'https://cdn.akamai.steamstatic.com/steam/apps/570/header.jpg' }), 570);
  assert.equal(steamAppIdOf({ imageUrl: 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/3241660/library_600x900.jpg' }), 3241660);
  assert.equal(steamAppIdFromUrl('/api/proxy/steam/440/header'), 440);
  // Inválidos: zero, negativo, texto, gigante, sem nada.
  for (const bad of [{ steamAppId: 0 }, { steamAppId: -5 }, { steamAppId: 'abc' }, { steamAppId: 1e12 }, { imageUrl: 'https://cdn.simpleicons.org/valorant' }, null, {}]) {
    assert.equal(steamAppIdOf(bad), null, JSON.stringify(bad));
  }
});

test('links do CDN: capa vertical 600x900 e header', () => {
  assert.equal(steamCoverUrl(730), 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/730/library_600x900.jpg');
  assert.equal(steamCoverUrl(730, 'header'), 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/730/header.jpg');
  assert.equal(steamCoverUrl(0), null);
  assert.equal(steamCoverUrl(730, 'qualquer'), null);
});

test('proxy de imagens: aceita os CDNs da Steam, recusa o resto', () => {
  for (const ok of [
    'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/730/library_600x900.jpg',
    'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/730/abc123/header.jpg',
    'https://cdn.akamai.steamstatic.com/steam/apps/730/header.jpg',
    'https://steamcdn-a.akamaihd.net/steam/apps/730/header.jpg',
  ]) assert.equal(isAllowedUrl(ok), true, ok);
  for (const bad of [
    'http://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/730/header.jpg', // sem https
    'https://steamstatic.com.evil.example/x.jpg',
    'https://evilsteamstatic.com/x.jpg',
    'https://shared.cloudflare.steamstatic.com:8443/x.jpg',
    'https://user:pass@shared.cloudflare.steamstatic.com/x.jpg',
    'https://example.com/steam/apps/730/header.jpg',
    'javascript:alert(1)',
  ]) assert.equal(isAllowedUrl(bad), false, bad);
});

test('site: AppID e ordem de tentativa da capa (capa → proxy → header)', async () => {
  const art = await import(pathToFileURL(path.resolve(__dirname, '../../client/src/utils/activityArt.js')).href);
  assert.equal(art.steamAppIdFromActivity({ type: 'game', steamAppId: 730 }), 730);
  assert.equal(art.steamAppIdFromActivity({ type: 'game', imageUrl: 'https://cdn.akamai.steamstatic.com/steam/apps/570/header.jpg' }), 570);
  assert.equal(art.steamAppIdFromActivity({ type: 'game', imageUrl: '/api/proxy/steam/440/header' }), 440);
  assert.equal(art.steamAppIdFromActivity({ type: 'game', name: 'Valorant', imageUrl: 'https://cdn.simpleicons.org/valorant' }), null);
  assert.deepEqual(art.steamCoverCandidates(730).map((c) => c.src), [
    'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/730/library_600x900.jpg',
    '/api/proxy/steam/730/cover',
    'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/730/header.jpg',
    '/api/proxy/steam/730/header',
  ]);
  assert.equal(art.steamCoverCandidates(730, 'wide')[0].src, 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/730/header.jpg');
  assert.deepEqual(art.steamCoverCandidates(null), []);
  // Todo link direto que o site usa passa no proxy também.
  for (const c of art.steamCoverCandidates(730)) if (c.src.startsWith('https://')) assert.equal(isAllowedUrl(c.src), true, c.src);
});

test('desktop: RunningAppID da Steam (Windows e Linux) e junção com a lista fixa', () => {
  const sd = require('../../desktop/steamDetector');
  const { mergeSteamGame } = require('../../desktop/activityDetector');
  const { matchProcessName } = require('../../desktop/gameDatabase');
  assert.equal(sd.parseRunningAppIdFromReg('HKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    RunningAppID    REG_DWORD    0x2da\r\n'), 730);
  assert.equal(sd.parseRunningAppIdFromReg('    RunningAppID    REG_DWORD    0x0'), null);
  assert.equal(sd.parseRunningAppIdFromReg('    RunningAppID    REG_DWORD    0x37e74'), null, 'Steamworks Redistributables não é jogo');
  assert.equal(sd.parseRunningAppIdFromReg(''), null);
  const vdf = '"Registry"\n{\n "HKCU"\n {\n  "Software"\n  {\n   "valve"\n   {\n    "Steam"\n    {\n     "RunningAppID"  "1086940"\n    }\n   }\n  }\n }\n}';
  assert.equal(sd.parseRunningAppIdFromRegistryVdf(vdf), 1086940);

  const names = (id) => ({ 1086940: "Baldur's Gate 3", 4000: "Garry's Mod" }[id] || null);
  // Jogo fora da lista fixa: vem da Steam, com capa vertical.
  assert.deepEqual(mergeSteamGame(null, 1086940, names), {
    name: "Baldur's Gate 3", steamAppId: 1086940,
    imageUrl: 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/1086940/library_600x900.jpg',
  });
  // Lista fixa já com AppID: mantém e manda o AppID.
  const cs2 = matchProcessName('cs2.exe', 'win');
  assert.equal(cs2.steamAppId, 730);
  assert.match(cs2.imageUrl, /\/steam\/apps\/730\/library_600x900\.jpg$/);
  assert.equal(mergeSteamGame(cs2, 730, names), cs2);
  // Jogo da lista sem AppID e sem arte (Overwatch 2) ganha o da Steam.
  assert.equal(mergeSteamGame(matchProcessName('Overwatch.exe', 'win'), 2357570, names).steamAppId, 2357570);
  // Jogo fora da Steam com arte própria fica como está.
  assert.equal(mergeSteamGame(matchProcessName('VALORANT-Win64-Shipping.exe', 'win'), 730, names).name, 'Valorant');
  // hl2.exe (vários jogos) + Steam dizendo Garry's Mod: a Steam ganha.
  assert.equal(mergeSteamGame(matchProcessName('hl2.exe', 'win'), 4000, names).name, "Garry's Mod");
  // Sem nada rodando na Steam: nada muda.
  assert.equal(mergeSteamGame(null, null, names), null);
});
