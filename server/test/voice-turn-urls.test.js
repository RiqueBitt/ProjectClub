// TURN do servidor de mídia próprio: as URLs configuradas (TURN_URLS /
// TURNS_URLS) aceitam TURN sobre TLS na 443 com transport=tcp — o caminho
// que passa por firewall corporativo/escolar — e saem em ordem
// UDP → TCP → TLS, sem repetição, com credencial temporária.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { turnUrls, turnCredentials, iceServersFor, mintProjectClub } = require('../src/services/voiceTokens');

test('aceita turns:...:443?transport=tcp e ordena UDP → TCP → TLS', () => {
  const env = {
    TURN_URLS: 'turns:turn.exemplo.com:443?transport=tcp, turn:turn.exemplo.com:3478?transport=tcp,turn:turn.exemplo.com:3478',
    TURNS_URLS: 'turns:turn.exemplo.com:5349,turns:turn.exemplo.com:443?transport=tcp, lixo, http://x',
  };
  assert.deepEqual(turnUrls(env), [
    'turn:turn.exemplo.com:3478',
    'turn:turn.exemplo.com:3478?transport=tcp',
    'turns:turn.exemplo.com:443?transport=tcp',
    'turns:turn.exemplo.com:5349',
  ]);
});

test('credencial temporária leva a URL turns: da 443 junto (iceServers do token de mídia)', () => {
  const env = {
    TURN_URLS: 'turn:t.exemplo.com:3478,turns:t.exemplo.com:443?transport=tcp',
    TURN_SECRET: 'segredo-turn',
    MEDIA_SERVER_URL: 'wss://midia.exemplo.com/ws',
    MEDIA_SERVER_SECRET: 'segredo-de-midia-0123456789',
  };
  const now = Date.UTC(2026, 0, 1);
  const cred = turnCredentials('u1', env, now);
  assert.ok(cred.urls.includes('turns:t.exemplo.com:443?transport=tcp'));
  assert.match(cred.username, /^\d+:u1$/);
  const servers = iceServersFor('u1', env, now);
  assert.ok(servers.some((s) => Array.isArray(s.urls) && s.urls.includes('turns:t.exemplo.com:443?transport=tcp') && s.credential));
  const minted = mintProjectClub({ room: 'sala', userId: 'u1', name: 'U' }, env, now);
  assert.deepEqual(minted.iceServers, servers);
});
