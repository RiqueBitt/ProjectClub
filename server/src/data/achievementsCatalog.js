// Catálogo SEED das conquistas — só usado pra popular a tabela
// Achievement no banco na primeira vez que o servidor sobe (ver
// seedAchievements() em services/achievements.js, chamado uma vez no
// boot em src/index.js). Depois disso, o banco é a fonte de verdade —
// staff pode editar/desabilitar/criar novas pelo painel sem precisar
// mexer neste arquivo.
//
// BUG CORRIGIDO ("remova conquistas de casas/figurinhas/economia"): as
// levas anteriores tinham conquistas de Casas, Figurinhas e Economia —
// mas Casas e Figurinhas nascem DESLIGADAS por padrão pra toda a
// comunidade, e a pedido do dono a Economia (moedas/gemas/baú diário/
// compras) também saiu do sistema de Conquistas por completo, mesmo
// estando ativa. Só ficam conquistas ligadas a Feeds, perfil (Ups),
// amizades e nível de conta — as únicas áreas que fazem sentido hoje.
// Removidas daqui — quem já tinha desbloqueado alguma mantém o registro
// (histórico preservado), mas elas somem do catálogo ativo (ver
// DEPRECATED_KEYS logo abaixo, que desativa qualquer uma que já tenha
// sido semeada num deploy anterior).
//
// `progressType` é o que diz ao motor (getProgressByType em
// services/achievements.js) COMO calcular o progresso atual — várias
// conquistas podem reaproveitar o mesmo tipo com metas (target)
// diferentes, criando "tiers" de dificuldade.
const ACHIEVEMENTS = [
  // --- Feeds (posts/comentários) ---
  { key: 'primeiro_post', name: 'Primeiro Post', description: 'Publique seu primeiro post num Clube.', rarity: 'COMMON', progressType: 'POSTS_CREATED', target: 1, position: 0 },
  { key: 'redator', name: 'Redator', description: 'Publique 10 posts.', rarity: 'RARE', progressType: 'POSTS_CREATED', target: 10, position: 1 },
  { key: 'influenciador', name: 'Influenciador', description: 'Receba 50 Ups nos seus posts.', rarity: 'EPIC', progressType: 'POST_UPS_RECEIVED', target: 50, position: 2 },
  { key: 'comentarista', name: 'Comentarista', description: 'Escreva 20 comentários em posts.', rarity: 'COMMON', progressType: 'COMMENTS_CREATED', target: 20, position: 3 },
  { key: 'voz_da_comunidade', name: 'Voz da Comunidade', description: 'Receba 50 Ups nos seus comentários.', rarity: 'RARE', progressType: 'COMMENT_UPS_RECEIVED', target: 50, position: 4 },

  // --- Perfil (Ups) ---
  { key: 'carismatico', name: 'Carismático', description: 'Receba 10 Ups no seu perfil.', rarity: 'COMMON', progressType: 'PROFILE_UPS_RECEIVED', target: 10, position: 5 },
  { key: 'amado_por_todos', name: 'Amado por Todos', description: 'Receba 100 Ups no seu perfil.', rarity: 'EPIC', progressType: 'PROFILE_UPS_RECEIVED', target: 100, position: 6 },

  // --- Amizades ---
  { key: 'primeiro_amigo', name: 'Primeiro Amigo', description: 'Adicione seu primeiro amigo.', rarity: 'COMMON', progressType: 'FRIENDS_COUNT', target: 1, position: 7 },
  { key: 'circulo_social', name: 'Círculo Social', description: 'Tenha 10 amigos.', rarity: 'RARE', progressType: 'FRIENDS_COUNT', target: 10, position: 8 },
  { key: 'rede_gigante', name: 'Rede Gigante', description: 'Tenha 50 amigos.', rarity: 'EPIC', progressType: 'FRIENDS_COUNT', target: 50, position: 9 },

  // --- Nível de conta ---
  { key: 'veterano', name: 'Veterano', description: 'Alcance o nível 10.', rarity: 'RARE', progressType: 'ACCOUNT_LEVEL', target: 10, position: 10 },
  { key: 'lenda_viva', name: 'Lenda Viva', description: 'Alcance o nível 50.', rarity: 'LEGENDARY', progressType: 'ACCOUNT_LEVEL', target: 50, position: 11 },
];

// Chaves que EXISTIRAM no catálogo antes (casas/figurinhas/economia —
// removidas por pedido) e precisam ser desativadas no banco se já
// tiverem sido semeadas num deploy anterior desta mesma plataforma —
// ver uso em seedAchievements() (services/achievements.js). Excluir de
// verdade apagaria o histórico de quem já tinha desbloqueado; desativar
// só tira do catálogo ativo/painel, mantendo o registro.
const DEPRECATED_KEYS = [
  // Casas
  'primeira_casa', 'multi_proprietario', 'magnata_imobiliario',
  'decorador', 'decorador_pro', 'mestre_decorador',
  'querido', 'popular', 'lenda_da_casa',
  'visitado', 'sociavel', 'anfitriao',
  // Economia (moedas/gemas/baú diário)
  'rico', 'magnata', 'bilionario', 'colecionador_gemas',
  'constante', 'inabalavel',
];

module.exports = { ACHIEVEMENTS, DEPRECATED_KEYS };
