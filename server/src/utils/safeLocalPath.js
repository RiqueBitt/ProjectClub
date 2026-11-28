// Um caminho "de dentro do site" (/loja, /canal/x?y=1) é seguro pra
// redirecionar ou virar link? O teste antigo (`começa com / e não com //`)
// deixava passar `/\evil.com` e `/<tab>/evil.com`: o navegador trata a barra
// invertida como barra e ignora tab/quebra de linha, então isso vira
// `//evil.com` — outro site (redirecionamento aberto, CWE-601).
// Devolve o próprio caminho, ou null se não for um caminho local. Igual no
// Rust: rust/pc-server/src/routes/qr_login.rs (safe_local_path).
// https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html
const BASE = 'http://local.invalid';

function safeLocalPath(value) {
  if (typeof value !== 'string') return null;
  // uma barra só no começo; sem barra invertida nem caractere de controle em lugar nenhum
  if (!/^\/(?![/\\])/.test(value) || /[\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const u = new URL(value, BASE);
    return u.origin === BASE ? value : null;
  } catch {
    return null;
  }
}

module.exports = { safeLocalPath };
