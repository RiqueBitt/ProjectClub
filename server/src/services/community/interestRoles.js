// Cargos por interesse (ex.: "Minecraft", "Valorant", "Desenho").
//
// A staff marca alguns cargos como "por interesse" (Role.selfAssignable) e
// cada pessoa escolhe os seus numa lista. Segurança:
//  - só cargos SEM nenhuma permissão podem ser marcados/escolhidos (um cargo
//    de interesse nunca dá poder a ninguém) — se alguém der permissão a um
//    cargo marcado depois, ele deixa de ser "por interesse" (roleController);
//  - quem marca precisa de "Gerenciar cargos" e só mexe em cargos abaixo do
//    seu cargo mais alto (mesma regra de hierarquia do resto do app);
//  - @todos nunca entra na lista.
const { toBits } = require('../permissions');
const { deps, httpError } = require('./common');

const MAX_PER_USER = 15;
const MAX_FLAGGED_ROLES = 60;

const isInterestRole = (role) => !!role && role.selfAssignable && !role.isDefault && toBits(role.permissions) === 0n;

async function catalog(userId, over = {}) {
  const d = deps(over);
  const roles = await d.db.role.findMany({ where: { selfAssignable: true, isDefault: false }, orderBy: { position: 'desc' } });
  const usable = roles.filter(isInterestRole);
  const mine = usable.length
    ? await d.db.userRole.findMany({ where: { userId, roleId: { in: usable.map((r) => r.id) } }, select: { roleId: true } })
    : [];
  const held = new Set(mine.map((m) => m.roleId));
  return {
    roles: usable.map((r) => ({ id: r.id, name: r.name, color: r.color, icon: r.icon, selected: held.has(r.id) })),
    max: MAX_PER_USER,
  };
}

/** Troca a seleção inteira da pessoa pelos ids enviados (só cargos de interesse). */
async function setMine(userId, roleIds, over = {}) {
  const d = deps(over);
  if (!Array.isArray(roleIds) || !roleIds.every((id) => typeof id === 'string')) throw httpError(400, 'Lista de cargos inválida.');
  const wanted = [...new Set(roleIds)];
  if (wanted.length > MAX_PER_USER) throw httpError(400, `Escolha no máximo ${MAX_PER_USER} interesses.`);
  const roles = await d.db.role.findMany({ where: { selfAssignable: true, isDefault: false } });
  const allowed = new Map(roles.filter(isInterestRole).map((r) => [r.id, r]));
  const invalid = wanted.filter((id) => !allowed.has(id));
  if (invalid.length) throw httpError(400, 'Algum desses cargos não é um cargo de interesse.');
  const current = await d.db.userRole.findMany({ where: { userId, roleId: { in: [...allowed.keys()] } }, select: { roleId: true } });
  const have = new Set(current.map((c) => c.roleId));
  const add = wanted.filter((id) => !have.has(id));
  const remove = [...have].filter((id) => !wanted.includes(id));
  if (remove.length) await d.db.userRole.deleteMany({ where: { userId, roleId: { in: remove } } });
  for (const roleId of add) {
    // eslint-disable-next-line no-await-in-loop
    await d.db.userRole.create({ data: { userId, roleId } }).catch((err) => { if (err?.code !== 'P2002') throw err; });
  }
  if (add.length || remove.length) d.io?.to?.('community')?.emit?.('member:roles-update', { userId });
  return { added: add.length, removed: remove.length, selected: wanted };
}

/**
 * Staff marca/desmarca um cargo como "por interesse". `authz` (injeção nos
 * testes) precisa ter requireCommunityPermission e getRoleCeiling.
 */
async function setFlag(staffUserId, roleId, flag, over = {}) {
  const d = deps(over);
  const authz = over.authz || require('../authz');
  await authz.requireCommunityPermission(staffUserId, 'MANAGE_ROLES');
  const role = await d.db.role.findUnique({ where: { id: String(roleId || '') } });
  if (!role) throw httpError(404, 'Cargo não encontrado.');
  if (role.isDefault) throw httpError(400, 'O cargo @todos não pode ser de interesse.');
  if (role.position >= await authz.getRoleCeiling(staffUserId)) throw httpError(403, 'Você só pode gerenciar cargos abaixo do seu cargo mais alto.');
  const on = !!flag;
  if (on && toBits(role.permissions) !== 0n) throw httpError(400, 'Só cargos sem nenhuma permissão podem ser de interesse. Tire as permissões desse cargo primeiro.');
  if (on) {
    const flagged = await d.db.role.count({ where: { selfAssignable: true } });
    if (flagged >= MAX_FLAGGED_ROLES) throw httpError(400, `Limite de ${MAX_FLAGGED_ROLES} cargos de interesse.`);
  }
  const updated = await d.db.role.update({ where: { id: role.id }, data: { selfAssignable: on } });
  d.io?.to?.('community')?.emit?.('role:update', updated);
  return updated;
}

module.exports = { catalog, setMine, setFlag, isInterestRole, MAX_PER_USER };
