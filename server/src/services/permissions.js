// Discord-style permission bitfield engine.
// Bits are BigInt internally (there are more than 32 distinct permissions),
// but persisted/transmitted as decimal strings so they survive JSON
// serialization without any special handling on either side.

const PERMISSIONS = {
  VIEW_CHANNEL:      1n << 0n,
  SEND_MESSAGES:     1n << 1n,
  MANAGE_MESSAGES:   1n << 2n,
  MANAGE_CHANNELS:   1n << 3n,
  MANAGE_ROLES:      1n << 4n,
  MANAGE_COMMUNITY:  1n << 5n, // antigo MANAGE_SERVER — configurações gerais da comunidade
  KICK_MEMBERS:      1n << 6n, // expulsa a conta da plataforma (equivalente a banir, já que só existe uma comunidade)
  BAN_MEMBERS:       1n << 7n,
  CHANGE_NICKNAME:   1n << 9n,
  MENTION_EVERYONE:  1n << 10n,
  ATTACH_FILES:      1n << 11n,
  ADD_REACTIONS:     1n << 12n,
  CONNECT:           1n << 13n, // join voice/stage channels
  SPEAK:             1n << 14n, // unmute / transmit audio
  VIDEO:             1n << 15n, // camera / screen share
  MUTE_MEMBERS:      1n << 16n,
  DEAFEN_MEMBERS:    1n << 17n,
  MOVE_MEMBERS:      1n << 18n,
  ADMINISTRATOR:     1n << 19n, // bypasses every other check
  MODERATE_MEMBERS:  1n << 20n, // apply/remove timeouts and warnings
  MANAGE_EMOJIS:     1n << 21n, // upload/edit/delete emojis customizados da comunidade
  CREATE_POLLS:      1n << 24n, // start an enquete (poll) in a channel
  CREATE_TOPICS:     1n << 25n, // start a topic/thread off a message
  MANAGE_NICKNAMES:  1n << 26n, // change OTHER members' nicknames (CHANGE_NICKNAME above is only for your own)
  VIEW_AUDIT_LOG:    1n << 27n, // see the server's moderation history (ModerationModal's log tab)
  MANAGE_TOPICS:     1n << 28n, // pin/lock/delete forum topics started by OTHER members
  USE_SOUNDBOARD:    1n << 29n, // trigger soundboard sounds in a voice channel
  // Item pedido: "sistema de figurinhas... podendo criar no painel da
  // staff" — mesmo padrão de MANAGE_EMOJIS acima, próprio bit livre
  // (30 — o modelo Sticker no schema já existia, nunca tinha sido
  // conectado a nenhum controller/rota até agora).
  MANAGE_STICKERS:   1n << 30n, // upload/delete figurinhas customizadas da comunidade
  // Item pedido: "ícones personalizados [de clã]... criados através
  // do Painel da Staff" — mesmo padrão de MANAGE_EMOJIS/MANAGE_STICKERS
  // acima, próprio bit livre (31 — o próximo depois de 30).
  MANAGE_CLAN_ICONS: 1n << 31n,
};

// Sensible defaults for the auto-created @everyone role.
const DEFAULT_EVERYONE_PERMISSIONS = [
  'VIEW_CHANNEL', 'SEND_MESSAGES', 'CHANGE_NICKNAME',
  'ATTACH_FILES', 'ADD_REACTIONS', 'CONNECT', 'SPEAK', 'VIDEO',
  'CREATE_POLLS', 'CREATE_TOPICS', 'USE_SOUNDBOARD',
].reduce((acc, key) => acc | PERMISSIONS[key], 0n);

function toBits(value) {
  try { return BigInt(value ?? '0'); } catch { return 0n; }
}

function toStringBits(bigintValue) {
  return bigintValue.toString();
}

function combine(...bitStrings) {
  return bitStrings.reduce((acc, v) => acc | toBits(v), 0n);
}

function has(bitsValue, permissionKey) {
  const bits = toBits(bitsValue);
  if (bits & PERMISSIONS.ADMINISTRATOR) return true;
  return (bits & PERMISSIONS[permissionKey]) !== 0n;
}

// Base (server-wide) permissions = OR of @everyone + every role the member has.
function computeBasePermissions(roles) {
  return roles.reduce((acc, role) => acc | toBits(role.permissions), 0n);
}

// Applies channel/category permission overwrites on top of base permissions,
// following the same precedence Discord uses:
//   1. @everyone overwrite (category, then channel)
//   2. role-specific overwrites (category, then channel), OR'd together
//   3. member-specific overwrite (category, then channel)
// At every step: deny is applied before allow.
function applyOverwrites(basePermissions, { everyoneRoleId, roleIds, memberId, categoryOverwrites = [], channelOverwrites = [] }) {
  let perms = basePermissions;

  const applyLayer = (overwrites) => {
    const everyone = overwrites.find((o) => o.targetType === 'ROLE' && o.targetId === everyoneRoleId);
    if (everyone) perms = (perms & ~toBits(everyone.deny)) | toBits(everyone.allow);

    let roleAllow = 0n;
    let roleDeny = 0n;
    for (const o of overwrites) {
      if (o.targetType === 'ROLE' && roleIds.includes(o.targetId) && o.targetId !== everyoneRoleId) {
        roleAllow |= toBits(o.allow);
        roleDeny |= toBits(o.deny);
      }
    }
    perms = (perms & ~roleDeny) | roleAllow;

    const member = overwrites.find((o) => o.targetType === 'MEMBER' && o.targetId === memberId);
    if (member) perms = (perms & ~toBits(member.deny)) | toBits(member.allow);
  };

  applyLayer(categoryOverwrites);
  applyLayer(channelOverwrites);

  return perms;
}

module.exports = {
  PERMISSIONS,
  DEFAULT_EVERYONE_PERMISSIONS,
  toBits,
  toStringBits,
  combine,
  has,
  computeBasePermissions,
  applyOverwrites,
};
