const test = require('node:test');
const assert = require('node:assert');
const bc = require('../src/services/browserCheck');

const APP = 'https://projectclub.squareweb.app';

test('frame policy: X-Frame-Options e frame-ancestors', () => {
  assert.equal(bc.framePolicy({}, APP).framable, true);
  assert.equal(bc.framePolicy({ 'x-frame-options': 'DENY' }, APP).framable, false);
  assert.equal(bc.framePolicy({ 'x-frame-options': 'SAMEORIGIN' }, APP).framable, false);
  assert.equal(bc.framePolicy({ 'content-security-policy': "default-src 'self'; frame-ancestors 'self'" }, APP).framable, false);
  assert.equal(bc.framePolicy({ 'content-security-policy': "frame-ancestors 'none'" }, APP).framable, false);
  assert.equal(bc.framePolicy({ 'content-security-policy': 'frame-ancestors *' }, APP).framable, true);
  assert.equal(bc.framePolicy({ 'content-security-policy': 'frame-ancestors https:' }, APP).framable, true);
  assert.equal(bc.framePolicy({ 'content-security-policy': 'frame-ancestors https://*.squareweb.app' }, APP).framable, true);
  assert.equal(bc.framePolicy({ 'content-security-policy': 'frame-ancestors https://example.com' }, APP).framable, false);
  // frame-ancestors manda mais que X-Frame-Options.
  assert.equal(bc.framePolicy({ 'x-frame-options': 'DENY', 'content-security-policy': 'frame-ancestors *' }, APP).framable, true);
});

test('SSRF: endereços locais e privados recusados', () => {
  for (const u of ['http://localhost/', 'http://127.0.0.1/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'http://[fd00::1]/', 'ftp://example.com', 'file:///etc/passwd', 'https://example.com:8443/', 'https://user:pw@example.com/', 'http://intranet/', 'http://printer.local/']) {
    assert.equal(bc.parseTarget(u), null, u);
  }
  assert.ok(bc.parseTarget('https://example.com/a?b=1#x'));
  assert.equal(bc.ipBlocked('8.8.8.8'), false);
  assert.equal(bc.ipBlocked('100.64.1.1'), true);
  assert.equal(bc.ipBlocked('::ffff:127.0.0.1'), true);
  assert.equal(bc.ipBlocked('2606:4700::1111'), false);
});

test('check recusa alvo inválido sem tocar a rede', async () => {
  assert.deepEqual(await bc.check('http://127.0.0.1:22/', APP), { ok: false, error: 'invalid' });
});

test('title', () => {
  assert.equal(bc.titleOf('<html><title> Olá &amp; tchau </title>'), 'Olá & tchau');
});
