// Item pedido: "5 variantes de como vai ser o visual dos meus emoji...
// um deles é o mesmo tema de emoji do Discord" — hoje os emojis são
// renderizados como texto unicode puro, então cada pessoa vê um
// desenho diferente dependendo do sistema operacional/navegador dela
// (Windows, Mac, Android — cada um tem sua própria fonte de emoji).
// Essas 5 opções trocam isso por um conjunto de imagens FIXO, igual
// em qualquer tela — incluindo o Twemoji (fork jdecked, mantido por
// um ex-designer do Twemoji original), que é literalmente o mesmo
// conjunto que o Discord usa (confirmado: Discord nunca desenhou o
// próprio emoji, sempre usou Twemoji).
export const EMOJI_STYLE_OPTIONS = [
  { value: 'native', label: 'Padrão do sistema' },
  { value: 'twemoji', label: 'Estilo Discord' },
  { value: 'noto', label: 'Estilo Google' },
  { value: 'fluent', label: 'Estilo Microsoft' },
  { value: 'openmoji', label: 'Estilo OpenMoji' },
];

// Converte o caractere emoji pros formatos de codepoint que cada CDN
// espera — confirmados um por um antes de usar (não são todos iguais:
// hífen minúsculo pra uns, maiúsculo pra outros).
function toCodepoints(emoji) {
  return [...emoji]
    .map((c) => c.codePointAt(0).toString(16))
    .filter((cp) => cp !== 'fe0f'); // variation selector — a maioria dos conjuntos não usa isso no nome do arquivo
}

function emojiImageUrl(emoji, style) {
  const cps = toCodepoints(emoji);
  if (cps.length === 0) return null;
  const lower = cps.join('-');
  const upper = cps.join('-').toUpperCase();
  switch (style) {
    case 'twemoji':
      return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/svg/${lower}.svg`;
    case 'noto':
      return `https://cdn.jsdelivr.net/npm/@svgmoji/noto@0.2.0/svg/${upper}.svg`;
    case 'openmoji':
      return `https://cdn.jsdelivr.net/npm/@svgmoji/openmoji@2.0.0/svg/${upper}.svg`;
    case 'fluent':
      return `https://cdn.jsdelivr.net/gh/shuding/fluentui-emoji-unicode/assets/${lower}_color.svg`;
    default:
      return null; // 'native' — sem imagem, usa o texto/fonte do sistema
  }
}

export { emojiImageUrl };
