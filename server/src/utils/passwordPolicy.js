// Regras de senha nova (cadastro, troca e redefinição). Além do mínimo de
// sempre (8+ caracteres, letra e número — isPasswordStrongEnough), barra:
// - senha comum demais (lista em data/senhas-comuns.txt), inclusive a
//   palavra base com números/símbolos no fim: "senha123", "Qwerty!1";
// - o próprio nome de usuário ou o começo do e-mail (com ou sem números).
// É o tipo de senha que cai primeiro num ataque de "senhas vazadas"
// (credential stuffing) ou de chute. Igual no Rust
// (rust/pc-server/src/routes/account.rs, password_problem).
const fs = require('fs');
const path = require('path');

const COMMON = new Set(
  fs.readFileSync(path.join(__dirname, '../data/senhas-comuns.txt'), 'utf8')
    .split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#')),
);

const COMMON_MSG = 'Essa senha é comum demais e fácil de adivinhar. Escolha outra.';
const PERSONAL_MSG = 'A senha não pode ser o seu nome de usuário ou o seu e-mail.';

// "Senha123!" → "senha"; "abc12345" → "abc"; "12345678" → "12345678".
function base(pw) {
  const lower = String(pw).toLowerCase();
  const stripped = lower.replace(/[^a-z]+$/, '');
  return stripped || lower;
}

/** Problema da senha (texto pra mostrar) ou null se puder usar. */
function passwordProblem(password, { username, email } = {}) {
  if (typeof password !== 'string') return null; // o mínimo de sempre cuida
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || COMMON.has(base(password))) return COMMON_MSG;
  const personal = [username, String(email || '').split('@')[0]]
    .map((v) => String(v || '').toLowerCase().trim())
    .filter((v) => v.length >= 3);
  if (personal.some((p) => lower === p || base(password) === p.replace(/[^a-z]+$/, ''))) return PERSONAL_MSG;
  return null;
}

module.exports = { passwordProblem, COMMON_MSG, PERSONAL_MSG, _common: COMMON };
