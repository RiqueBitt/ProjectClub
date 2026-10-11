// Cinema (services/archiveBrowse.js): parse da Advanced Search e da
// Metadata API do Internet Archive. Fixtures no formato público das APIs
// (o sandbox de teste não acessa archive.org).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ia = require('../src/services/archiveBrowse');

test('consulta: sempre presa às coleções curadas e sem sintaxe injetada', () => {
  const q = ia.buildQuery({ q: 'nosferatu) OR collection:(opensource_movies', cat: 'terror' });
  assert.match(q, /^mediatype:movies AND collection:\(feature_films OR /);
  assert.match(q, /NOT access-restricted-item:true/);
  // O texto vira palavras soltas; nunca abre um novo filtro de coleção.
  assert.ok(!/collection:\(opensource_movies/.test(q));
  assert.equal((q.match(/collection:/g) || []).length, 2); // a curada + a da categoria Terror
  assert.equal(ia.safeQuery('a:b (c) "d" OR e'), 'a b c d or e');
  const u = new URL(ia.searchUrl({ q: 'chaplin', cat: 'filmes', sort: 'antigos', page: 2 }));
  assert.equal(u.hostname, 'archive.org');
  assert.equal(u.searchParams.get('output'), 'json');
  assert.equal(u.searchParams.get('page'), '2');
  assert.deepEqual(u.searchParams.getAll('sort[]'), ['year asc']);
  assert.ok(u.searchParams.getAll('fl[]').includes('identifier'));
});

test('busca: itens, ano, duração, tipo e paginação', () => {
  const r = ia.parseSearch({
    response: {
      numFound: 30, start: 0,
      docs: [
        { identifier: 'Nosferatu_1922', title: 'Nosferatu', year: '1922', downloads: 900000, runtime: '1:34:00', description: '<p>Clássico <b>mudo</b></p>', collection: ['feature_films', 'SciFi_Horror'], subject: 'horror; vampire' },
        { identifier: 'SuperMan-TheMechanicalMonsters', title: ['Superman - The Mechanical Monsters'], date: '1941-11-28', collection: 'classic_cartoons' },
        { identifier: 'Nosferatu_1922', title: 'dup' },
        { identifier: '../etc', title: 'mau' },
      ],
    },
  }, 1, 24);
  assert.deepEqual(r.items.map((i) => i.id), ['Nosferatu_1922', 'SuperMan-TheMechanicalMonsters']);
  assert.equal(r.items[0].year, 1922);
  assert.equal(r.items[0].duration, 5640);
  assert.equal(r.items[0].description, 'Clássico mudo');
  assert.equal(r.items[0].kind, 'filme');
  assert.equal(r.items[1].year, 1941);
  assert.equal(r.items[1].kind, 'desenho');
  assert.equal(r.items[0].thumbnail, 'https://archive.org/services/img/Nosferatu_1922');
  assert.equal(r.hasMore, true);
});

test('item: episódios por original, qualidades, legendas e restrição', () => {
  const it = ia.parseItem({
    metadata: { identifier: 'bonanza_s1', title: 'Bonanza', year: '1959', collection: ['classic_tv'], subject: ['western', 'television'], description: 'Série' },
    files: [
      { name: 'Bonanza 02.avi', source: 'original', format: 'Cinepack', length: '2950' },
      { name: 'Bonanza 02.mp4', source: 'derivative', original: 'Bonanza 02.avi', format: 'h.264', height: '480', size: '200' },
      { name: 'Bonanza 02_512kb.mp4', source: 'derivative', original: 'Bonanza 02.avi', format: '512Kb MPEG4', size: '80' },
      { name: 'Bonanza 10.mp4', source: 'original', format: 'MPEG4', height: '720', length: '00:49:10', title: 'O Pistoleiro' },
      { name: 'Bonanza 10.ogv', source: 'derivative', original: 'Bonanza 10.mp4', format: 'Ogg Video', height: '300' },
      { name: 'Bonanza 02.pt-BR.srt', source: 'original', format: 'SubRip' },
      { name: 'Bonanza 10.eng.srt', source: 'original', format: 'SubRip' },
      { name: 'bonanza_s1.thumbs/Bonanza 02_000001.jpg', source: 'derivative', format: 'Thumbnail' },
    ],
  });
  assert.equal(it.kind, 'serie');
  assert.equal(it.allowed, true);
  assert.deepEqual(it.episodes.map((e) => e.title), ['Bonanza 02', 'O Pistoleiro']);
  const [e2, e10] = it.episodes;
  assert.equal(e2.duration, 2950);
  assert.deepEqual(e2.sources.map((s) => s.label), ['480p', '360p (leve)']);
  assert.equal(e2.sources[0].url, 'https://archive.org/download/bonanza_s1/Bonanza%2002.mp4');
  assert.deepEqual(e2.subtitles, [{ file: 'Bonanza 02.pt-BR.srt', lang: 'pt-BR', label: 'Português (Brasil)' }]);
  assert.equal(e10.duration, 2950);
  assert.deepEqual(e10.sources.map((s) => [s.label, s.type]), [['720p', 'video/mp4'], ['300p', 'video/ogg']]);
  assert.equal(e10.subtitles[0].lang, 'en');
});

test('item restrito não expõe arquivos', () => {
  const it = ia.parseItem({ metadata: { identifier: 'x1', title: 'X', 'access-restricted-item': 'true', collection: 'feature_films' }, files: [{ name: 'a.mp4', source: 'original' }] });
  assert.equal(it.restricted, true);
  assert.deepEqual(it.episodes, []);
});

test('legendas: SRT vira WebVTT e latin1 é detectado', () => {
  const vtt = ia.srtToVtt('﻿1\r\n00:00:01,500 --> 00:00:03,000\r\nOlá\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,250\r\nTchau\r\n');
  assert.equal(vtt, 'WEBVTT\n\n00:00:01.500 --> 00:00:03.000\nOlá\n\n00:00:04.000 --> 00:00:05.250\nTchau\n');
  assert.equal(ia.decodeText(Uint8Array.from([0x61, 0xe7, 0xe3, 0x6f])), 'ação');
  assert.equal(ia.parseLength('83 min'), 4980);
  assert.equal(ia.parseLength('12:30'), 750);
  assert.equal(ia.subLang('filme.english.srt').lang, 'en');
});
