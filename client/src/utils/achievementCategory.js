// Item pedido: "melhore a aba deixando mais bonita e organizada" —
// categoria amigável por progressType, só pra ORGANIZAR a exibição na
// tela (o banco não tem campo de categoria — não precisa de mudança
// de schema pra isso, é só uma classificação visual do lado do
// cliente). Um progressType desconhecido cai em "Outras".
const CATEGORY_BY_TYPE = {
  POSTS_CREATED: 'Fórum', POST_UPS_RECEIVED: 'Fórum', COMMENTS_CREATED: 'Fórum', COMMENT_UPS_RECEIVED: 'Fórum',
  PROFILE_UPS_RECEIVED: 'Perfil', TESTIMONIALS_RECEIVED: 'Perfil', SCRAPS_RECEIVED: 'Perfil', FANS_COUNT: 'Perfil', PHOTOS_UPLOADED: 'Perfil',
  FRIENDS_COUNT: 'Amizades',
  ACCOUNT_LEVEL: 'Progresso', DAILY_STREAK: 'Progresso',
  MESSAGES_SENT: 'Comunicação', REACTIONS_GIVEN: 'Comunicação', EMOJIS_CREATED: 'Comunicação',
  CARDS_WINS: 'Guerra das Cartas', CARDS_PVP_WINS: 'Guerra das Cartas', CARDS_PACKS: 'Guerra das Cartas', CARDS_COLLECTION: 'Guerra das Cartas', CARDS_FOILS: 'Guerra das Cartas', CARDS_CAMPAIGN: 'Guerra das Cartas',
  CARDS_FLAWLESS: 'Guerra das Cartas', CARDS_CLUTCH: 'Guerra das Cartas', CARDS_DUO_WINS: 'Guerra das Cartas', CARDS_DRAFT_BEST: 'Guerra das Cartas', CARDS_BOSS_DAMAGE: 'Guerra das Cartas', CARDS_GOLDEN: 'Guerra das Cartas',
};

export function categoryFor(progressType) {
  return CATEGORY_BY_TYPE[progressType] || 'Outras';
}

// Ordem fixa de exibição das categorias (em vez de alfabética, que
// ficaria com uma sequência sem lógica nenhuma).
export const CATEGORY_ORDER = ['Fórum', 'Perfil', 'Amizades', 'Comunicação', 'Guerra das Cartas', 'Progresso', 'Outras'];
