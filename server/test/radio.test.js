// Rádio do Project Club (services/radio.js).
const test = require('node:test');
const assert = require('node:assert');
const radio = require('../src/services/radio');

const parseVideoId = (s) => (/^[A-Za-z0-9_-]{11}$/.test(s) ? s : (String(s).match(/v=([A-Za-z0-9_-]{11})/) || [])[1] || null);

test('volta da rádio: na ordem ou embaralhada, sem repetir a última logo de cara', () => {
  const st = { shuffle: false, playlist: JSON.stringify([{ videoId: 'aaaaaaaaaaa' }, { videoId: 'bbbbbbbbbbb' }, { videoId: 'ccccccccccc' }]) };
  assert.deepEqual(radio.nextRound(st).map((t) => t.videoId), ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']);
  assert.equal(radio.nextRound(st, { avoidFirst: 'aaaaaaaaaaa' })[0].videoId, 'bbbbbbbbbbb');
  const sh = radio.nextRound({ ...st, shuffle: true }, { rnd: () => 0 });
  assert.equal(sh.length, 3);
  assert.deepEqual(radio.nextRound({ playlist: 'lixo' }), []);
});

test('salvar: um link por linha, sem repetidos, título do oEmbed', async () => {
  const saved = [];
  const db = {
    radioStation: {
      findUnique: async () => null,
      upsert: async ({ create }) => { saved.push(create); return create; },
    },
  };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ title: 'Música boa' }) });
  const st = await radio.saveStation('ch1', {
    links: 'https://www.youtube.com/watch?v=aaaaaaaaaaa\nbbbbbbbbbbb\nlixo\naaaaaaaaaaa', shuffle: false,
  }, 'staff', { db, parseVideoId, fetchImpl });
  const list = radio.parsePlaylist(st.playlist);
  assert.deepEqual(list.map((t) => t.videoId), ['aaaaaaaaaaa', 'bbbbbbbbbbb']);
  assert.equal(list[0].title, 'Música boa');
  assert.equal(st.enabled, true);
  const empty = await radio.saveStation('ch1', { links: 'nada' }, 'staff', { db, parseVideoId, fetchImpl });
  assert.equal(empty.enabled, false); // lista vazia não liga a rádio
});

test('canal de DM/clã nunca é rádio', async () => {
  assert.equal(await radio.getStation('dm:abc', { db: {} }), null);
  assert.equal(await radio.getStation('clan:1', { db: {} }), null);
});
