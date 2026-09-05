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

// Exportada pra quem precisa saber a fonte de verdade de cada opção
// sem passar por nameStyleProps inteiro (ver o seletor visual de fonte
// em UserSettingsModal.jsx, que mostra uma amostra "Abc" de cada uma).
export const FONT_FAMILY = {
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

// Item pedido: "diminua o tamanho de algumas fontes que acabam
// ficando muito grandes" — fontes decorativas/display (bold, letras
// em caixa alta, traços largos) desenham visualmente MAIORES que uma
// fonte de texto comum no mesmo font-size nominal — é uma diferença
// normal de design entre fontes, não um bug de medida. As mais
// "pesadas" visualmente entre as 15 ganham uma escala reduzida,
// aplicada como font-size relativo (ver nameStyleProps abaixo);
// ausente do mapa = 1 (tamanho normal, sem ajuste).
const FONT_SIZE_SCALE = {
  PIXEL: 0.75,          // Press Start 2P — bitmap bem quadrado/largo
  CARTOON: 0.8,          // Bangers — caixa alta, traços grossos
  CREEPY: 0.8,           // Creepster — bem larga
  BOLD_CONDENSED: 0.85,  // Bebas Neue — caixa alta condensada, mas alta
  ROUNDED: 0.85,         // Righteous — bold arredondada
  RETRO_NEON: 0.85,      // Monoton — linhas finas mas MUITO alta
  URBAN: 0.85,           // Bungee — bold estilo urbano
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
// Item pedido: "poder editar cada cor... tipo todas as cores que
// aparecem no arco-íris... deixa mais bonito do seu jeito" — RAINBOW e
// GLITCH usavam cores FIXAS no código, sem nenhum jeito de
// personalizar. Esses são os valores PADRÃO de cada um (usados quando
// a pessoa nunca customizou nada — profileNameColors vazio/null) e a
// função que resolve as cores de verdade a usar.
export const DEFAULT_MULTI_COLORS = {
  RAINBOW: ['#ff5757', '#ffb443', '#ffe75e', '#61e786', '#4c9fff', '#b26cff'],
  GLITCH: ['#ff3b3b', '#3bd6ff'],
};

export function resolveMultiColors(user, effect) {
  const defaults = DEFAULT_MULTI_COLORS[effect];
  if (!defaults) return null; // esse efeito não tem cores múltiplas
  if (!user?.profileNameColors) return defaults;
  try {
    const parsed = JSON.parse(user.profileNameColors);
    if (Array.isArray(parsed) && parsed.length === defaults.length) return parsed;
  } catch { /* JSON inválido/antigo — cai pro padrão */ }
  return defaults;
}

const DEFAULT_NAME_STYLE = { profileNameFont: 'NORMAL', profileNameEffect: 'SOLID', profileNameColor: '#1877F2', profileNameColor2: '#FFFFFF' };
export function hasCustomNameStyle(user) {
  if (!user) return false;
  return Object.entries(DEFAULT_NAME_STYLE).some(([key, def]) => user[key] && user[key] !== def);
}

// Item pedido: "adicione animações tipo em arco-íris... uma animação
// de cores trocando... afina várias" — style INLINE (o que
// nameStyleProps devolve) não pode conter @keyframes, então essa
// segunda função separada devolve só o NOME DA CLASSE CSS que carrega
// a animação (ver as @keyframes correspondentes em global.css) — cada
// lugar que já usa nameStyleProps(user) como style precisa TAMBÉM
// aplicar essa classe (className={nameStyleClassName(user)}) pra
// animação funcionar; sem ela, o efeito ainda funciona, só fica
// parado (a cor "final" do gradiente, sem ciclar).
export function nameStyleClassName(user) {
  const effect = user?.profileNameEffect;
  if (effect === 'RAINBOW') return 'name-style-anim-rainbow';
  if (effect === 'NEON') return 'name-style-anim-neon';
  if (effect === 'GLITCH') return 'name-style-anim-glitch';
  if (effect === 'SHINE') return 'name-style-anim-shine';
  if (effect === 'FIRE') return 'name-style-anim-fire';
  return '';
}

export function nameStyleProps(user) {
  const font = FONT_FAMILY[user?.profileNameFont] || undefined;
  const color = user?.profileNameColor || '#F2894D';
  const color2 = user?.profileNameColor2 || '#FFFFFF';
  const effect = user?.profileNameEffect || 'SOLID';
  // BUG CORRIGIDO ("a fonte Cartoon está ficando meio cortada no
  // final"): problema clássico e conhecido de fontes customizadas —
  // overflow:hidden combinado com um line-height apertado corta as
  // "pernas" de letras como g/y/p/q/j (Bangers, a fonte Cartoon, tem
  // essas partes bem pronunciadas). Line-height só um pouco maior dá
  // espaço de sobra sem afetar o alinhamento vertical em nenhum lugar
  // que já funcionava bem antes.
  const scale = FONT_SIZE_SCALE[user?.profileNameFont];
  const base = { fontFamily: font, ...(font ? { lineHeight: 1.3 } : {}), ...(scale ? { fontSize: `${scale}em` } : {}) };

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
    case 'RAINBOW': {
      const cs = resolveMultiColors(user, 'RAINBOW');
      // BUG CORRIGIDO ("a primeira cor vem sem degradê na animação,
      // ficando uma linha sólida repetindo"): a animação move o
      // gradiente em loop (background-position 0% -> 100%) — sem
      // REPETIR a sequência de cores duas vezes seguidas, o "fim" do
      // gradiente (última cor) precisa saltar abruptamente de volta
      // pro "início" (primeira cor) toda vez que o loop reinicia, sem
      // nenhuma transição suave entre elas. Repetindo as mesmas cores
      // duas vezes no gradiente, a segunda metade fica idêntica à
      // primeira — no momento em que a animação reinicia, a posição
      // visual já é exatamente a mesma de onde começou, sem salto.
      return {
        ...base, backgroundImage: `linear-gradient(90deg, ${[...cs, ...cs].join(', ')})`,
        backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent',
      };
    }
    case 'GLITCH': {
      // O text-shadow animado vive na classe .name-style-anim-glitch
      // (ver global.css) — as cores agora vêm daqui via CSS custom
      // properties (--glitch-c1/--glitch-c2), que a animação lê com
      // var() dentro do @keyframes. style inline sempre venceria um
      // text-shadow fixo na classe, então a cor PRECISA chegar como
      // variável, não como propriedade direta.
      const [c1, c2] = resolveMultiColors(user, 'GLITCH');
      return { ...base, color, '--glitch-c1': c1, '--glitch-c2': c2 };
    }
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
