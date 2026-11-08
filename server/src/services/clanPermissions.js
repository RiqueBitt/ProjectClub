// Item pedido: "Cada cargo deverá possuir permissões diferentes" — ao
// contrário dos cargos da comunidade (customizáveis pela staff, com um
// conjunto de permissões escolhido bit a bit — ver services/permissions.js),
// os cargos de clã são FIXOS: sempre os mesmos cinco, sempre com as
// mesmas capacidades. Um sistema bem mais simples resolve isso — uma
// hierarquia por nível, mais uma lista de "quem pode fazer o quê".
//
// Item pedido (seção 9, segurança): "Todas as permissões devem ser
// verificadas no backend, e não apenas no frontend" — TODA função
// aqui roda no servidor; o frontend só usa o resultado pra decidir o
// que mostrar/esconder na tela, nunca decide sozinho se uma ação é
// permitida.
const CLAN_ROLES = ['OWNER', 'SUB_OWNER', 'ADMIN', 'MODERATOR', 'MEMBER'];

const ROLE_LEVEL = { OWNER: 4, SUB_OWNER: 3, ADMIN: 2, MODERATOR: 1, MEMBER: 0 };

const ROLE_CAPABILITIES = {
  // Item pedido: "Editar as configurações do clan... alterar nome,
  // ícone e informações... tornar o clan público ou privado" — dono e
  // sub-dono, os dois cargos de maior confiança.
  EDIT_CLAN: ['OWNER', 'SUB_OWNER'],
  // Item pedido: "Gerenciar os membros" — expulsar, ver a lista.
  MANAGE_MEMBERS: ['OWNER', 'SUB_OWNER', 'ADMIN'],
  // Item pedido: "atribuir cargos aos membros" — só dono e sub-dono,
  // pra evitar um admin promover outro admin acima do próprio nível
  // (ver canAssignRole abaixo, que reforça isso com mais uma trava).
  MANAGE_ROLES: ['OWNER', 'SUB_OWNER'],
  // Item pedido: "aceitar ou recusar solicitações de entrada".
  MANAGE_JOIN_REQUESTS: ['OWNER', 'SUB_OWNER', 'ADMIN'],
  // Item pedido: "criar e gerenciar tags".
  MANAGE_TAGS: ['OWNER', 'SUB_OWNER', 'ADMIN'],
  // Moderar o chat do clã (apagar mensagem de outro membro) — não
  // pedido explicitamente, mas o cargo "Moderador" não teria nenhuma
  // capacidade própria sem isso, e é o uso óbvio pro nome do cargo.
  MODERATE_CLAN_CHAT: ['OWNER', 'SUB_OWNER', 'ADMIN', 'MODERATOR'],
  // Item pedido: "Apenas o dono possa transferir a propriedade".
  TRANSFER_OWNERSHIP: ['OWNER'],
  DELETE_CLAN: ['OWNER'],
};

function hasClanCapability(clanRole, capability) {
  if (!clanRole) return false;
  return ROLE_CAPABILITIES[capability]?.includes(clanRole) ?? false;
}

// Item pedido: "Um membro não consiga dar cargos que não possui
// permissão para atribuir" — quem atribui precisa ter MANAGE_ROLES, o
// cargo de destino precisa ser estritamente ABAIXO do nível de quem
// está atribuindo (um admin nunca promove alguém a admin ou dono), e
// ninguém vira OWNER por aqui — isso só acontece via transferOwnership,
// que tem suas próprias regras à parte.
function canAssignRole(assignerRole, targetRole) {
  if (!hasClanCapability(assignerRole, 'MANAGE_ROLES')) return false;
  if (targetRole === 'OWNER') return false;
  if (!CLAN_ROLES.includes(targetRole)) return false;
  return ROLE_LEVEL[targetRole] < ROLE_LEVEL[assignerRole];
}

// Item pedido implícito: ninguém deveria conseguir expulsar/moderar
// alguém de cargo igual ou maior que o próprio — mesmo tendo a
// capacidade geral (MANAGE_MEMBERS), um admin não pode expulsar outro
// admin ou o sub-dono.
function canActOnMember(actorRole, targetRole) {
  return ROLE_LEVEL[actorRole] > ROLE_LEVEL[targetRole];
}

module.exports = { CLAN_ROLES, ROLE_LEVEL, hasClanCapability, canAssignRole, canActOnMember };
