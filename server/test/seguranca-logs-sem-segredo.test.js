// Segurança: segredos que vêm na URL (código do OAuth, chave do Nexus,
// token de redefinir senha…) não vão pros logs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { redactUrl } = require('../src/utils/redactUrl');

test('esconde code/state/key/token e mantém o resto', () => {
  assert.equal(
    redactUrl('/api/auth/oauth/google/callback?code=4%2F0AQ-segredo&state=abc123&scope=email'),
    '/api/auth/oauth/google/callback?code=[oculto]&state=[oculto]&scope=email',
  );
  assert.equal(redactUrl('/api/nexus/mods?key=MINHA-CHAVE&page=2'), '/api/nexus/mods?key=[oculto]&page=2');
  assert.equal(redactUrl('/reset-password?token=f00d'), '/reset-password?token=[oculto]');
  assert.equal(redactUrl('/api/x?ACCESS_TOKEN=1'), '/api/x?ACCESS_TOKEN=[oculto]');
});

test('URL sem query ou sem segredo fica igual', () => {
  assert.equal(redactUrl('/api/users/me'), '/api/users/me');
  assert.equal(redactUrl('/api/search?q=oi&page=1'), '/api/search?q=oi&page=1');
  assert.equal(redactUrl(''), '');
  assert.equal(redactUrl(undefined), '');
});

test('o log do morgan usa a URL limpa', async () => {
  const morgan = require('morgan');
  const fmt = morgan.compile(':method :url');
  // o app registra o token :url limpo ao subir; aqui o mesmo registro
  morgan.token('url', (req) => redactUrl(req.originalUrl || req.url));
  const line = fmt(morgan, { method: 'GET', originalUrl: '/api/music/spotify/callback?code=SEGREDO&state=X', headers: {} }, {});
  assert.equal(line, 'GET /api/music/spotify/callback?code=[oculto]&state=[oculto]');
  assert.ok(!line.includes('SEGREDO'));
});
