// Espelha server/src/services/permissions.js — mantido como constantes de
// bit em BigInt puro pra o client poder decidir o que mostrar/esconder na
// UI do mesmo jeito que o servidor aplica de verdade. O servidor é sempre a
// fonte da verdade; isso aqui é só pra UX (evitar piscar um botão que o
// usuário não pode usar de fato).

export const PERMISSIONS = {
  VIEW_CHANNEL: 1n << 0n,
  SEND_MESSAGES: 1n << 1n,
  MANAGE_MESSAGES: 1n << 2n,
  MANAGE_CHANNELS: 1n << 3n,
  MANAGE_ROLES: 1n << 4n,
  MANAGE_COMMUNITY: 1n << 5n,
  KICK_MEMBERS: 1n << 6n,
  BAN_MEMBERS: 1n << 7n,
  CHANGE_NICKNAME: 1n << 9n,
  MENTION_EVERYONE: 1n << 10n,
  ATTACH_FILES: 1n << 11n,
  ADD_REACTIONS: 1n << 12n,
  CONNECT: 1n << 13n,
  SPEAK: 1n << 14n,
  VIDEO: 1n << 15n,
  MUTE_MEMBERS: 1n << 16n,
  DEAFEN_MEMBERS: 1n << 17n,
  MOVE_MEMBERS: 1n << 18n,
  ADMINISTRATOR: 1n << 19n,
  MODERATE_MEMBERS: 1n << 20n,
  MANAGE_EMOJIS: 1n << 21n,
  CREATE_POLLS: 1n << 24n,
  CREATE_TOPICS: 1n << 25n,
  MANAGE_NICKNAMES: 1n << 26n,
  VIEW_AUDIT_LOG: 1n << 27n,
  MANAGE_TOPICS: 1n << 28n,
  USE_SOUNDBOARD: 1n << 29n,
};

export const PERMISSION_LABELS = {
  VIEW_CHANNEL: 'Ver canais',
  SEND_MESSAGES: 'Enviar mensagens',
  MANAGE_MESSAGES: 'Gerenciar mensagens',
  MANAGE_CHANNELS: 'Gerenciar canais',
  MANAGE_ROLES: 'Gerenciar cargos',
  MANAGE_COMMUNITY: 'Gerenciar a comunidade',
  KICK_MEMBERS: 'Expulsar membros',
  BAN_MEMBERS: 'Banir membros',
  CHANGE_NICKNAME: 'Alterar apelido',
  MENTION_EVERYONE: 'Mencionar @everyone',
  ATTACH_FILES: 'Anexar arquivos',
  ADD_REACTIONS: 'Adicionar reações',
  CONNECT: 'Conectar (voz)',
  SPEAK: 'Falar (voz)',
  VIDEO: 'Vídeo / compartilhar tela',
  MUTE_MEMBERS: 'Silenciar membros',
  DEAFEN_MEMBERS: 'Ensurdecer membros',
  MOVE_MEMBERS: 'Mover membros',
  ADMINISTRATOR: 'Administrador',
  MODERATE_MEMBERS: 'Aplicar silêncio temporário e advertências',
  MANAGE_EMOJIS: 'Gerenciar emojis',
  CREATE_POLLS: 'Criar enquetes',
  CREATE_TOPICS: 'Criar tópicos',
  MANAGE_NICKNAMES: 'Gerenciar apelidos de outros membros',
  VIEW_AUDIT_LOG: 'Ver registro de auditoria',
  MANAGE_TOPICS: 'Gerenciar tópicos do fórum (fixar, excluir de outros)',
  USE_SOUNDBOARD: 'Usar efeitos sonoros',
};

function toBits(value) {
  try { return BigInt(value ?? '0'); } catch { return 0n; }
}

export function hasPermission(bitsString, key) {
  const bits = toBits(bitsString);
  if (bits & PERMISSIONS.ADMINISTRATOR) return true;
  return (bits & PERMISSIONS[key]) !== 0n;
}

export function combinedPermissions(roles) {
  return roles.reduce((acc, role) => acc | toBits(role.permissions), 0n).toString();
}

// Calcula o que um membro pode fazer na comunidade inteira, a partir das
// listas globais de roles/members (do useStore) + o id do usuário atual —
// usado pra habilitar/esconder botões como "criar canal", "gerenciar cargos" etc.
export function getMyCommunityPermissions(roles, members, myUserId, platformRole) {
  if (platformRole === 'ADMIN') {
    return Object.values(PERMISSIONS).reduce((acc, b) => acc | b, 0n).toString();
  }
  const me = (members || []).find((m) => m.user.id === myUserId);
  if (!me) return '0';
  const myRoles = (roles || []).filter((r) => r.isDefault || me.roleIds?.includes(r.id));
  return combinedPermissions(myRoles);
}

export function permissionsToKeys(bitsString) {
  return Object.keys(PERMISSIONS).filter((key) => key !== 'ADMINISTRATOR' && (toBits(bitsString) & PERMISSIONS[key]) !== 0n);
}
