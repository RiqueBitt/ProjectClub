// Cosmetic display-name styling — font/color/effect the person picked in
// Configurações > Meu Perfil (see schema.prisma's User.profileNameFont).
// Applied wherever a display name shows (profile page, chat messages,
// member list) — see hasCustomNameStyle() below for how each caller
// decides whether to bother applying it at all.

export const NAME_FONTS = [
  { value: 'NORMAL', label: 'Normal' },
  { value: 'PIXEL', label: 'Pixel' },
  { value: 'CARTOON', label: 'Cartoon' },
  { value: 'MEDIEVAL', label: 'Medieval' },
  { value: 'HANDWRITING', label: 'Manuscrita' },
  // Item pedido: "adicione mais fontes... mais 10" — todas conferidas
  // no catálogo real do Google Fonts antes de usar (ver o <link> em
  // index.html, onde elas são de fato carregadas — sem isso, o nome
  // cairia silenciosamente na fonte padrão do sistema).
  { value: 'CREEPY', label: 'Assombrada' },
  { value: 'FUTURISTIC', label: 'Futurista' },
  { value: 'SIGNATURE', label: 'Assinatura' },
  { value: 'BOLD_CONDENSED', label: 'Impacto' },
  { value: 'ROUNDED', label: 'Arredondada' },
  { value: 'CASUAL_SCRIPT', label: 'Casual' },
  { value: 'RETRO_NEON', label: 'Retrô' },
  { value: 'URBAN', label: 'Urbana' },
  { value: 'ELEGANT_SERIF', label: 'Elegante' },
  { value: 'PLAYFUL', label: 'Divertida' },
];

export const NAME_EFFECTS = [
  { value: 'SOLID', label: 'Normal (Sólido)' },
  { value: 'NEON', label: 'Néon' },
  { value: 'GRADIENT', label: 'Gradiente' },
  { value: 'POP', label: 'Pop' },
  { value: 'SKETCH', label: 'Desenho' },
  // Item pedido: "adicione mais... 10 estilos de nome"
  { value: 'SHADOW_3D', label: 'Sombra 3D' },
  { value: 'OUTLINE', label: 'Só contorno' },
  { value: 'RAINBOW', label: 'Arco-íris' },
  { value: 'GLITCH', label: 'Falha (Glitch)' },
  { value: 'ICE', label: 'Gelo' },
  { value: 'FIRE', label: 'Fogo' },
  { value: 'METALLIC', label: 'Metálico' },
  { value: 'SHINE', label: 'Brilho' },
  { value: 'EMBOSS', label: 'Relevo' },
  { value: 'DOUBLE_STROKE', label: 'Contorno duplo' },
];

const FONT_FAMILY = {
  NORMAL: undefined, // inherits the app's own default font
  PIXEL: "'Press Start 2P', monospace",
  CARTOON: "'Bangers', cursive",
  MEDIEVAL: "'MedievalSharp', cursive",
  HANDWRITING: "'Permanent Marker', cursive",
  CREEPY: "'Creepster', cursive",
  FUTURISTIC: "'Orbitron', sans-serif",
  SIGNATURE: "'Pacifico', cursive",
  BOLD_CONDENSED: "'Bebas Neue', sans-serif",
  ROUNDED: "'Righteous', cursive",
  CASUAL_SCRIPT: "'Caveat', cursive",
  RETRO_NEON: "'Monoton', cursive",
  URBAN: "'Bungee', cursive",
  ELEGANT_SERIF: "'Playfair Display', serif",
  PLAYFUL: "'Fredoka One', cursive",
};

// Returns the actual inline `style` object for a <h2>/<span> rendering
// someone's styled display name — combines their chosen font-family with
// whatever their chosen effect needs (a solid color, a glowing text-shadow,
// a gradient via background-clip, etc). `color` is the one field every
// effect needs one way or another, so it's always read from
// user.profileNameColor.
// Item pedido: "atualize as cores e as fontes do nome... vão aparecer
// nos chats, barra lateral que mostra os online, etc, em vez de
// aparecer só no perfil" — reverte a decisão anterior (documentada
// acima) de restringir isso só à página de perfil.
//
// Cuidado importante: TODO usuário sempre tem um valor nesses 4
// campos (profileNameFont/Effect/Color/Color2 têm @default() no
// schema.prisma, nunca ficam null) — não dá pra diferenciar "nunca
// mexeu nisso" de "escolheu ativamente os mesmos valores padrão" só
// olhando o banco. Sem essa checagem, TODO mundo que nunca abriu essa
// configuração passaria a ter o nome pintado de azul (#1877F2, a cor
// padrão) em chats/lista de membros — uma mudança visual em massa e
// não intencional. Só aplica o estilo se pelo menos UM dos 4 campos
// for diferente do valor padrão — ou seja, se a pessoa mexeu em algo
// de propósito.
const DEFAULT_NAME_STYLE = { profileNameFont: 'NORMAL', profileNameEffect: 'SOLID', profileNameColor: '#1877F2', profileNameColor2: '#FFFFFF' };
export function hasCustomNameStyle(user) {
  if (!user) return false;
  return Object.entries(DEFAULT_NAME_STYLE).some(([key, def]) => user[key] && user[key] !== def);
}

export function nameStyleProps(user) {
  const font = FONT_FAMILY[user?.profileNameFont] || undefined;
  const color = user?.profileNameColor || '#F2894D';
  const color2 = user?.profileNameColor2 || '#FFFFFF';
  const effect = user?.profileNameEffect || 'SOLID';
  const base = { fontFamily: font };

  switch (effect) {
    case 'NEON':
      return { ...base, color, textShadow: `0 0 4px ${color}, 0 0 11px ${color}, 0 0 19px ${color}` };
    case 'GRADIENT':
      return {
        ...base, backgroundImage: `linear-gradient(90deg, ${color}, ${color2})`,
        backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent',
      };
    case 'POP':
      // color2 is the front fill, color is the outline/back layer sitting
      // behind it — both pickable, instead of a fixed white-on-color combo.
      return { ...base, color: color2, WebkitTextStroke: `2px ${color}`, textShadow: `3px 3px 0 ${color}` };
    case 'SKETCH':
      return { ...base, color, textShadow: `1px 1px 0 ${color}88, -1px -1px 0 ${color}44`, letterSpacing: '0.5px' };
    // Item pedido: "adicione mais... 10 estilos de nome"
    case 'SHADOW_3D':
      return { ...base, color, textShadow: `1px 1px 0 ${color2}, 2px 2px 0 ${color2}, 3px 3px 0 ${color2}, 4px 4px 6px rgba(0,0,0,.4)` };
    case 'OUTLINE':
      return { ...base, color: 'transparent', WebkitTextStroke: `1.5px ${color}` };
    case 'RAINBOW':
      return {
        ...base, backgroundImage: 'linear-gradient(90deg, #ff5757, #ffb443, #ffe75e, #61e786, #4c9fff, #b26cff)',
        backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent',
      };
    case 'GLITCH':
      return { ...base, color, textShadow: `-2px 0 #ff3b3b, 2px 0 #3bd6ff` };
    case 'ICE':
      return {
        ...base, backgroundImage: `linear-gradient(180deg, #ffffff, ${color})`,
        backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent',
        textShadow: `0 0 8px ${color}66`,
      };
    case 'FIRE':
      return {
        ...base, backgroundImage: `linear-gradient(0deg, ${color}, #ffd23f)`,
        backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent',
        textShadow: `0 0 10px ${color}88`,
      };
    case 'METALLIC':
      return {
        ...base, backgroundImage: `linear-gradient(180deg, #f5f5f5, ${color} 45%, #ffffff 55%, ${color2 || '#8a8a8a'})`,
        backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent',
      };
    case 'SHINE':
      // Mais discreto que NEON — um brilho bem sutil, sem o halo grande.
      return { ...base, color, textShadow: `0 0 6px ${color}55` };
    case 'EMBOSS':
      return { ...base, color, textShadow: `1px 1px 1px rgba(255,255,255,.5), -1px -1px 1px rgba(0,0,0,.6)` };
    case 'DOUBLE_STROKE':
      return { ...base, color, WebkitTextStroke: `3px ${color2}`, paintOrder: 'stroke fill' };
    case 'SOLID':
    default:
      return { ...base, color };
  }
}
