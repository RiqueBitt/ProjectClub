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

  // --- Item pedido: "adicione mais conquistas" (nada de casas/
  // economia/figurinhas) — cobrindo sistemas que já existem no app e
  // ainda não tinham conquista nenhuma.
  // Sequência diária (o tipo DAILY_STREAK já existia no motor, mas
  // nenhuma conquista o usava ainda).
  { key: 'presenca_constante', name: 'Presença Constante', description: 'Mantenha uma sequência de 7 dias seguidos.', rarity: 'COMMON', progressType: 'DAILY_STREAK', target: 7, position: 12 },
  { key: 'inabalavel_streak', name: 'Inabalável', description: 'Mantenha uma sequência de 30 dias seguidos.', rarity: 'EPIC', progressType: 'DAILY_STREAK', target: 30, position: 13 },

  // Depoimentos
  { key: 'bem_recomendado', name: 'Bem Recomendado', description: 'Receba 5 depoimentos aprovados no seu perfil.', rarity: 'COMMON', progressType: 'TESTIMONIALS_RECEIVED', target: 5, position: 14 },
  { key: 'referencia', name: 'Referência', description: 'Receba 20 depoimentos aprovados no seu perfil.', rarity: 'EPIC', progressType: 'TESTIMONIALS_RECEIVED', target: 20, position: 15 },

  // Recados no mural
  { key: 'popular_no_mural', name: 'Popular no Mural', description: 'Receba 10 recados no seu mural.', rarity: 'COMMON', progressType: 'SCRAPS_RECEIVED', target: 10, position: 16 },
  { key: 'muito_querido', name: 'Muito Querido', description: 'Receba 50 recados no seu mural.', rarity: 'RARE', progressType: 'SCRAPS_RECEIVED', target: 50, position: 17 },

  // Fãs (seguidores)
  { key: 'primeiro_fa', name: 'Primeiro Fã', description: 'Tenha seu primeiro fã.', rarity: 'COMMON', progressType: 'FANS_COUNT', target: 1, position: 18 },
  { key: 'celebridade', name: 'Celebridade', description: 'Tenha 25 fãs.', rarity: 'EPIC', progressType: 'FANS_COUNT', target: 25, position: 19 },

  // Álbum de fotos
  { key: 'fotografo', name: 'Fotógrafo', description: 'Adicione 5 fotos ao seu álbum.', rarity: 'COMMON', progressType: 'PHOTOS_UPLOADED', target: 5, position: 20 },
  { key: 'album_cheio', name: 'Álbum Cheio', description: 'Adicione 20 fotos ao seu álbum.', rarity: 'RARE', progressType: 'PHOTOS_UPLOADED', target: 20, position: 21 },

  // Emojis customizados
  { key: 'criador_de_emoji', name: 'Criador de Emoji', description: 'Crie seu primeiro emoji customizado.', rarity: 'COMMON', progressType: 'EMOJIS_CREATED', target: 1, position: 22 },
  { key: 'artista_da_comunidade', name: 'Artista da Comunidade', description: 'Crie 10 emojis customizados.', rarity: 'EPIC', progressType: 'EMOJIS_CREATED', target: 10, position: 23 },

  // Mensagens
  { key: 'tagarela', name: 'Tagarela', description: 'Envie 100 mensagens.', rarity: 'COMMON', progressType: 'MESSAGES_SENT', target: 100, position: 24 },
  { key: 'comunicador_nato', name: 'Comunicador Nato', description: 'Envie 1.000 mensagens.', rarity: 'RARE', progressType: 'MESSAGES_SENT', target: 1000, position: 25 },
  { key: 'voz_incansavel', name: 'Voz Incansável', description: 'Envie 5.000 mensagens.', rarity: 'LEGENDARY', progressType: 'MESSAGES_SENT', target: 5000, position: 26 },

  // Reações
  { key: 'sempre_reagindo', name: 'Sempre Reagindo', description: 'Reaja a 50 mensagens.', rarity: 'COMMON', progressType: 'REACTIONS_GIVEN', target: 50, position: 27 },
  { key: 'expressivo', name: 'Expressivo', description: 'Reaja a 500 mensagens.', rarity: 'RARE', progressType: 'REACTIONS_GIVEN', target: 500, position: 28 },
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
