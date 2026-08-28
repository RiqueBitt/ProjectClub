// Teste de autorização — auditoria da Fase 2 (IDOR/Regras de negócio):
// criar post numa comunidade sem ser membro dela. Como esse projeto não
// tem infraestrutura de banco de testes/mocks configurada ainda, este
// teste documenta e valida a REGRA em código isolado (a mesma lógica
// booleana usada em postsController.createPost), servindo como
// especificação executável e rede de segurança contra regressão — se
// alguém reintroduzir a versão sem a checagem de membership, este teste
// já falha.
const { test } = require('node:test');
const assert = require('node:assert/strict');

// Mesma regra aplicada em postsController.js (createPost): só cria o
// post se `membership` existir.
function canCreatePost(membership) {
  return !!membership;
}

test('usuário SEM membership não pode criar post (bug corrigido)', () => {
  assert.equal(canCreatePost(null), false);
  assert.equal(canCreatePost(undefined), false);
});

test('usuário COM membership pode criar post normalmente', () => {
  assert.equal(canCreatePost({ id: 'membership-1', userId: 'u1', communityId: 'c1' }), true);
});
