import { gradientStops } from './roleColor';

// Perfis coloridos (User.profileColor) pintam uma faixa forte da cor
// escolhida bem no topo do card (banner + cabeçalho) — ver
// `.profile-modal-box.profile-modal-accented` em global.css. O problema
// que esse util resolve: nome, @usuário e estatísticas ficavam SEMPRE na
// cor de texto padrão do tema (pensada pra um fundo escuro fixo), então
// qualquer um que escolhesse uma cor clara (branco, amarelo, rosa claro...)
// acabava com texto ilegível em cima da própria cor que escolheu.
//
// Cálculo de brilho percebido (fórmula YIQ, a mesma ideia usada por
// Discord/Slack pra decidir se um texto em cima de uma cor arbitrária deve
// ser claro ou escuro) — não é contraste WCAG completo, mas é rápido e
// resolve bem o caso real: cores claras -> texto escuro, cores escuras/
// saturadas -> texto claro.
function readableTextOn(hex) {
  const h = (hex || '').replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n) || full.length !== 6) return '#ffffff';
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 140 ? '#161318' : '#ffffff';
}

// Ponto único pra montar as custom properties que TODO lugar "acentuado
// pela cor de perfil de alguém" precisa (UserProfileModal, MiniProfileCard,
// DMProfilePanel) — antes cada componente reimplementava só o
// --profile-accent-start/-end na mão (ver gradientStops), sem nenhuma
// variável de texto legível, o que é exatamente por isso que nome/@usuário
// ficavam ilegíveis em cima de cores claras. Qualquer novo lugar que queira
// o mesmo tratamento visual só precisa chamar isso e aplicar o resultado
// como `style` no elemento raiz.
export function profileAccentVars(profileColor, fallback = '#F2894D') {
  const [start, end] = gradientStops(profileColor || fallback);
  return {
    '--profile-accent-start': start,
    '--profile-accent-end': end || start,
    '--profile-accent-text': readableTextOn(start),
  };
}

export { readableTextOn };
