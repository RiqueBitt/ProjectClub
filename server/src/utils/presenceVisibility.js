// "Invisível" é um status que só a PRÓPRIA pessoa enxerga — pra todo o
// resto ela aparece offline. Antes o valor cru (INVISIBLE) ia pros outros
// clientes no presence:sync/presence:update e na lista de membros, e
// qualquer um via no DevTools quem estava "invisível" online.
function visibleStatus(status, isSelf = false) {
  if (!isSelf && status === 'INVISIBLE') return 'OFFLINE';
  return status;
}

// Devolve uma cópia do usuário com o status mascarado pra quem está vendo
// (viewerId). Não mexe no objeto original.
function maskUserStatus(user, viewerId) {
  if (!user || user.status !== 'INVISIBLE' || user.id === viewerId) return user;
  return { ...user, status: 'OFFLINE' };
}

module.exports = { visibleStatus, maskUserStatus };
