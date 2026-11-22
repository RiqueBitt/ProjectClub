// Música: login do Spotify (state assinado), conversão das faixas e link de playlist do YouTube.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const src = (p) => path.resolve(__dirname, '../src', p);
require.cache[src('config/prisma.js')] = { id: src('config/prisma.js'), filename: src('config/prisma.js'), loaded: true, exports: {} };
require.cache[src('config/redis.js')] = { id: src('config/redis.js'), filename: src('config/redis.js'), loaded: true, exports: { redis: {} } };
const music = require('../src/services/music');
const yt = require('../src/services/youtubeBrowse');

test('state do login do Spotify: volta o usuário certo e recusa adulterado', () => {
  const st = music.signState('user-123');
  assert.equal(music.readState(st), 'user-123');
  const raw = Buffer.from(st, 'base64url').toString();
  const forged = Buffer.from(raw.replace('user-123', 'user-999')).toString('base64url');
  assert.equal(music.readState(forged), null);
  assert.equal(music.readState('lixo'), null);
});

test('faixas do Spotify e do Last.fm viram o mesmo formato', () => {
  const s = music.fromSpotifyTrack({ id: 'abc', name: 'Evidências', artists: [{ name: 'Chitãozinho' }, { name: 'Xororó' }], album: { name: 'Álbum', images: [{ url: 'g' }, { url: 'm' }] }, duration_ms: 271000 });
  assert.deepEqual(s, { source: 'spotify', id: 'abc', title: 'Evidências', artist: 'Chitãozinho, Xororó', album: 'Álbum', thumbnail: 'm', durationSec: 271 });
  const l = music.fromLastfm({ name: 'Faroeste Caboclo', artist: { name: 'Legião Urbana' }, image: [{ '#text': 'https://x/2a96cbd8b46e442fc41c2b86b821562f.png' }] });
  assert.equal(l.title, 'Faroeste Caboclo');
  assert.equal(l.artist, 'Legião Urbana');
  assert.equal(l.thumbnail, null); // estrela cinza do Last.fm não conta como capa
  assert.equal(music.fromLastfm({ name: 'X', artist: 'Y' }).artist, 'Y');
});

test('reconhece link de playlist do YouTube e do YouTube Music', () => {
  assert.equal(yt.parsePlaylistId('https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG'), 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG');
  assert.equal(yt.parsePlaylistId('https://music.youtube.com/playlist?list=OLAK5uy_abcdefghijklmnop'), 'OLAK5uy_abcdefghijklmnop');
  assert.equal(yt.parsePlaylistId('https://youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890'), 'PL1234567890');
  assert.equal(yt.parsePlaylistId('https://youtube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(yt.parsePlaylistId('nada'), null);
});
