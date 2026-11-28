// Chat/tempo real: helpers puros (sem banco/rede) das correções de
// segurança e desempenho do chat.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isBlockedIp, validateUrl, parseOpenGraph } = require('../src/services/unfurl');
const { mentionCandidates, parseMentions } = require('../src/services/mentions');
const { isValidReactionEmoji } = require('../src/utils/reactionEmoji');
const { createTokenBucket } = require('../src/utils/tokenBucket');
const { visibleStatus, maskUserStatus } = require('../src/utils/presenceVisibility');

test('unfurl: bloqueia IPs internos (v4, v6 e v4 mapeado)', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.10', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:a00:1', 'lixo']) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111']) {
    assert.equal(isBlockedIp(ip), false, ip);
  }
});

test('unfurl: só http/https públicos, sem credencial nem porta estranha', () => {
  assert.ok(validateUrl('https://example.com/a?b=1#x'));
  assert.equal(validateUrl('https://example.com/a#x').hash, '');
  for (const bad of ['ftp://example.com', 'file:///etc/passwd', 'http://localhost/', 'http://127.0.0.1/',
    'http://[::1]/', 'http://user:pw@example.com/', 'http://example.com:8080/', 'javascript:alert(1)', 'http://10.0.0.1/', 'http://foo.internal/']) {
    assert.equal(validateUrl(bad), null, bad);
  }
});

test('unfurl: lê og:title/description/image/site_name e theme-color', () => {
  const html = `<html><head><title>Fallback</title>
    <meta property="og:title" content="Título &amp; mais">
    <meta name="description" content="desc normal">
    <meta property='og:description' content='Descrição OG'>
    <meta property="og:image" content="/img/capa.png">
    <meta property="og:site_name" content="Site">
    <meta name="theme-color" content="#ff0066">
  </head></html>`;
  const og = parseOpenGraph(html, 'https://exemplo.com/post/1');
  assert.equal(og.title, 'Título & mais');
  assert.equal(og.description, 'Descrição OG');
  assert.equal(og.image, 'https://exemplo.com/img/capa.png');
  assert.equal(og.siteName, 'Site');
  assert.equal(og.themeColor, '#ff0066');
  const bare = parseOpenGraph('<title>Só título</title><meta property="og:image" content="javascript:alert(1)">', 'https://www.a.com/');
  assert.equal(bare.title, 'Só título');
  assert.equal(bare.image, null);
  assert.equal(bare.siteName, 'a.com');
});

test('menções: candidatos só a partir de "@" e parse no subconjunto', () => {
  const c = mentionCandidates('oi @Ana Clara, tudo bem? @everyone e @Mod!');
  assert.ok(c.includes('Ana'));
  assert.ok(c.includes('Ana Clara'));
  assert.ok(c.includes('Mod'));
  assert.ok(!c.includes('everyone'));
  assert.deepEqual(mentionCandidates('sem arroba nenhuma'), []);
  const rows = parseMentions('oi @Ana Clara e @Mods @everyone', {
    members: [{ id: 'u1', displayName: 'Ana' }, { id: 'u2', displayName: 'Ana Clara' }],
    roles: [{ id: 'r1', name: 'Mods', mentionable: true }],
  });
  assert.deepEqual(rows.map((r) => `${r.targetType}:${r.targetId}`).sort(), ['EVERYONE:null', 'ROLE:r1', 'USER:u1', 'USER:u2'].sort());
});

test('reação: só emoji de verdade ou :custom:', () => {
  for (const ok of ['👍', '❤️', '👍🏽', '👨‍👩‍👧', '🇧🇷', '1️⃣', ':kek:', ':pepe_ok:']) assert.equal(isValidReactionEmoji(ok), true, ok);
  for (const bad of ['', 'a', '1', 'abc', '<b>x</b>', ' 👍', '👍'.repeat(40), null, 5, ':a b:']) assert.equal(isValidReactionEmoji(bad), false, String(bad));
});

test('balde de fichas: limita rajada e repõe com o tempo', () => {
  let now = 0;
  const take = createTokenBucket({ capacity: 3, refillPerSec: 1, now: () => now });
  assert.equal(take(), true); assert.equal(take(), true); assert.equal(take(), true);
  assert.equal(take(), false);
  now += 1000;
  assert.equal(take(), true);
  assert.equal(take(), false);
});

test('presença: Invisível vira Offline pros outros', () => {
  assert.equal(visibleStatus('INVISIBLE', false), 'OFFLINE');
  assert.equal(visibleStatus('INVISIBLE', true), 'INVISIBLE');
  assert.equal(visibleStatus('DND', false), 'DND');
  assert.equal(maskUserStatus({ id: 'a', status: 'INVISIBLE' }, 'b').status, 'OFFLINE');
  assert.equal(maskUserStatus({ id: 'a', status: 'INVISIBLE' }, 'a').status, 'INVISIBLE');
});
