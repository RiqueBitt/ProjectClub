// Testes das partes "puras" (sem banco) do pacote de segurança de conta:
// regras de ClubTag, códigos de recuperação do 2FA, códigos numéricos e o
// escape de HTML dos e-mails.
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateUsername, isReservedUsername } = require('../src/utils/usernameRules');
const { generateRecoveryCode, normalizeRecoveryCode, generateNumericCode, hashToken } = require('../src/services/tokens');
const { escapeHtml } = require('../src/services/email');

test('ClubTag: mesmas regras da inscrição', () => {
  assert.equal(validateUsername('joao_silva.2'), null);
  assert.ok(validateUsername('ab'));
  assert.ok(validateUsername('a'.repeat(33)));
  assert.ok(validateUsername('com espaço'));
  assert.ok(validateUsername('emoji😀'));
  assert.ok(validateUsername({ nope: true }));
});

test('ClubTag: nomes reservados (sem diferenciar maiúsculas, ignorando _ e .)', () => {
  for (const name of ['admin', 'Admin', 'ad.min', 'a_d_m_i_n', 'Staff', 'suporte', 'Moderador', 'ProjectClub', 'projectclub_oficial']) {
    assert.ok(isReservedUsername(name), name);
    assert.ok(validateUsername(name), name);
  }
  assert.equal(isReservedUsername('adminho_gamer'), false);
});

test('códigos de recuperação: formato e normalização', () => {
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const code = generateRecoveryCode();
    assert.match(code, /^[a-z2-9]{5}-[a-z2-9]{5}$/);
    seen.add(code);
  }
  assert.equal(seen.size, 50);
  const code = generateRecoveryCode();
  assert.equal(normalizeRecoveryCode(code.toUpperCase()), code);
  assert.equal(normalizeRecoveryCode(` ${code.replace('-', '')} `), code);
  assert.equal(hashToken(normalizeRecoveryCode(code.replace('-', ' '))), hashToken(code));
  assert.equal(normalizeRecoveryCode('curto'), null);
  assert.equal(normalizeRecoveryCode(null), null);
});

test('código numérico: só dígitos, tamanho certo', () => {
  for (let i = 0; i < 20; i++) assert.match(generateNumericCode(6), /^\d{6}$/);
});

test('e-mail: valores do usuário são escapados', () => {
  assert.equal(escapeHtml('<a href="x">oi</a> & \'b\''), '&lt;a href=&quot;x&quot;&gt;oi&lt;/a&gt; &amp; &#39;b&#39;');
  assert.equal(escapeHtml(null), '');
});
