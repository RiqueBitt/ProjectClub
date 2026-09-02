// Item pedido: "melhore a aba deixando mais bonita e organizada" —
// categoria amigável por progressType, só pra ORGANIZAR a exibição na
// tela (o banco não tem campo de categoria — não precisa de mudança
// de schema pra isso, é só uma classificação visual do lado do
// cliente). Um progressType desconhecido cai em "Outras".
const CATEGORY_BY_TYPE = {
  POSTS_CREATED: 'Feeds', POST_UPS_RECEIVED: 'Feeds', COMMENTS_CREATED: 'Feeds', COMMENT_UPS_RECEIVED: 'Feeds',
  PROFILE_UPS_RECEIVED: 'Perfil', TESTIMONIALS_RECEIVED: 'Perfil', SCRAPS_RECEIVED: 'Perfil', FANS_COUNT: 'Perfil', PHOTOS_UPLOADED: 'Perfil',
  FRIENDS_COUNT: 'Amizades',
  ACCOUNT_LEVEL: 'Progresso', DAILY_STREAK: 'Progresso',
  MESSAGES_SENT: 'Comunicação', REACTIONS_GIVEN: 'Comunicação', EMOJIS_CREATED: 'Comunicação',
};

export function categoryFor(progressType) {
  return CATEGORY_BY_TYPE[progressType] || 'Outras';
}

// Ordem fixa de exibição das categorias (em vez de alfabética, que
// ficaria com uma sequência sem lógica nenhuma).
export const CATEGORY_ORDER = ['Feeds', 'Perfil', 'Amizades', 'Comunicação', 'Progresso', 'Outras'];
