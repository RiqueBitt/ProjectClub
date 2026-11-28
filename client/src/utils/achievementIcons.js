// Conquistas desenhadas como ícones de traço (estilo Tabler, igual às
// insígnias), na cor da raridade. Conquista com imagem enviada pela equipe
// (iconUrl) continua mostrando a imagem.
import { RARITY_COLOR } from './badgeRarity.js';
import { TABLER_ICONS } from './tablerIcons.js';

// Conquista (Achievement.key) → ícone.
export const ACHIEVEMENT_ICON_BY_KEY = {
  primeiro_post: 'file-text', redator: 'writing', influenciador: 'speakerphone', comentarista: 'message-circle',
  voz_da_comunidade: 'messages', carismatico: 'mood-heart', amado_por_todos: 'hearts', primeiro_amigo: 'user-plus',
  circulo_social: 'users', rede_gigante: 'users-group', veterano: 'military-rank', lenda_viva: 'trophy',
  presenca_constante: 'calendar-check', inabalavel_streak: 'flame', bem_recomendado: 'thumb-up', referencia: 'star',
  popular_no_mural: 'notes', muito_querido: 'user-heart', primeiro_fa: 'user-star', celebridade: 'confetti',
  fotografo: 'camera', album_cheio: 'album', criador_de_emoji: 'mood-plus', artista_da_comunidade: 'palette',
  tagarela: 'message-dots', comunicador_nato: 'microphone-2', voz_incansavel: 'bolt', sempre_reagindo: 'mood-happy',
  expressivo: 'mood-wink', cartas_primeira_vitoria: 'sword', cartas_duelista: 'swords', cartas_mestre: 'cards',
  cartas_pvp: 'target', cartas_colecionador: 'stack-2', cartas_completo: 'album', cartas_pacotes: 'package',
  cartas_brilho: 'diamonds', cartas_lenda: 'shield-star', cartas_intocavel: 'ghost', cartas_por_um_fio: 'heart-broken',
  cartas_dupla: 'users', cartas_draft: 'crown', cartas_cacador: 'skull', cartas_ouro: 'coins',
};

// Conquista nova (criada pela equipe) sem ícone próprio: pelo tipo de progresso.
const ICON_BY_PROGRESS = {
  POSTS_CREATED: 'file-text', POST_UPS_RECEIVED: 'speakerphone', COMMENTS_CREATED: 'message-circle',
  COMMENT_UPS_RECEIVED: 'messages', PROFILE_UPS_RECEIVED: 'mood-heart', FRIENDS_COUNT: 'users', ACCOUNT_LEVEL: 'military-rank',
  DAILY_STREAK: 'flame', TESTIMONIALS_RECEIVED: 'thumb-up', SCRAPS_RECEIVED: 'notes', FANS_COUNT: 'user-star',
  PHOTOS_UPLOADED: 'camera', EMOJIS_CREATED: 'mood-plus', MESSAGES_SENT: 'message-dots', REACTIONS_GIVEN: 'mood-happy',
};

// { kind: 'image', url } (imagem própria) ou { kind: 'icon', color, paths }.
export function achievementVisual(a) {
  if (a?.iconUrl) return { kind: 'image', url: a.iconUrl };
  const name = ACHIEVEMENT_ICON_BY_KEY[a?.key] || ICON_BY_PROGRESS[a?.progressType] || 'trophy';
  const color = RARITY_COLOR[a?.rarity] || RARITY_COLOR.COMMON;
  return { kind: 'icon', icon: name, color, paths: TABLER_ICONS[name] || TABLER_ICONS.trophy };
}
