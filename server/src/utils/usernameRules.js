// Regras da ClubTag (@usuário) — um lugar só, usado tanto pela inscrição
// (applicationsController.js) quanto pela troca de @ nas Configurações
// (userController.updateUsername). Antes a troca só checava "mínimo 3
// caracteres", então dava pra trocar pra qualquer coisa (espaços, emoji,
// 200 caracteres, "admin"...), furando a regra mostrada na inscrição.
const USERNAME_RE = /^[a-zA-Z0-9_.]{3,32}$/;
const USERNAME_RULE_MESSAGE = 'A ClubTag deve ter de 3 a 32 caracteres: letras, números, _ ou ponto.';

// Nomes que se passariam por conta oficial/da equipe. Comparados sem
// diferenciar maiúsculas e ignorando "_" e "." (então "Admin", "ad.min" e
// "a_d_m_i_n" contam igual). Contas que JÁ têm um desses nomes não são
// afetadas — só não dá pra escolher um deles daqui pra frente.
const RESERVED_USERNAMES = new Set([
  'admin', 'administrador', 'administrator', 'adm', 'staff', 'equipe', 'team',
  'projectclub', 'pc', 'oficial', 'official', 'moderador', 'moderadora', 'moderator', 'mod', 'mods',
  'suporte', 'support', 'ajuda', 'help', 'sistema', 'system', 'root', 'owner', 'dono', 'dona',
  'bot', 'automod', 'everyone', 'here', 'todos', 'null', 'undefined', 'anonimo', 'anonymous',
]);

function normalizeForReserved(username) {
  return String(username || '').toLowerCase().replace(/[._]/g, '');
}

function isReservedUsername(username) {
  const n = normalizeForReserved(username);
  return RESERVED_USERNAMES.has(n) || n.includes('projectclub');
}

// null = válido; senão, a mensagem de erro pra mostrar.
function validateUsername(username) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) return USERNAME_RULE_MESSAGE;
  if (isReservedUsername(username)) return 'Essa ClubTag é reservada. Escolha outra.';
  return null;
}

const USERNAME_CHANGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

module.exports = {
  USERNAME_RE, USERNAME_RULE_MESSAGE, RESERVED_USERNAMES, isReservedUsername, validateUsername,
  USERNAME_CHANGE_COOLDOWN_MS,
};
