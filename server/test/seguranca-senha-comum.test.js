// Segurança: senha nova não pode ser comum demais nem o próprio usuário/e-mail.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { passwordProblem, COMMON_MSG, PERSONAL_MSG } = require('../src/utils/passwordPolicy');

test('barra senhas comuns, inclusive com números/símbolos no fim', () => {
  for (const pw of ['senha123', 'Senha@2024', 'Qwerty!1', 'password1', 'Flamengo10', 'abc12345', '12345678', 'Minecraft99']) {
    assert.equal(passwordProblem(pw, { username: 'ana', email: 'ana@x.com' }), COMMON_MSG, pw);
  }
});

test('barra o nome de usuário e o começo do e-mail', () => {
  assert.equal(passwordProblem('riquebitt9', { username: 'RiqueBitt', email: 'r@x.com' }), PERSONAL_MSG);
  assert.equal(passwordProblem('joana777', { username: 'ana', email: 'Joana@x.com' }), PERSONAL_MSG);
});

test('senhas boas passam', () => {
  for (const pw of ['Tr0pical-Lua-77', 'xk29fj3la', 'pinguim azul 2 cafe']) {
    assert.equal(passwordProblem(pw, { username: 'ana', email: 'ana@x.com' }), null, pw);
  }
});

test('mesma mensagem que o Rust', () => {
  const rs = require('fs').readFileSync(require('path').join(__dirname, '../../rust/pc-server/src/routes/account.rs'), 'utf8');
  assert.ok(rs.includes(COMMON_MSG) && rs.includes(PERSONAL_MSG));
  assert.ok(rs.includes('server/src/data/senhas-comuns.txt'));
});
