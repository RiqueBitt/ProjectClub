// Validação do emoji de uma reação (POST /messages/:id/react). Antes
// qualquer texto entrava como "emoji" — dava pra reagir com uma frase
// inteira, HTML, ou 10 mil caracteres.
//
// Aceita:
//  - emoji unicode de verdade (inclui sequências com ZWJ, modificador de
//    tom de pele, bandeiras e o seletor de variação FE0F) — só caracteres
//    de emoji, nada de letras/números soltos;
//  - emoji personalizado no formato que o cliente usa: ":nome:" ou
//    "<:nome:id>" / "<a:nome:id>" (nome alfanumérico/_ e id uuid/numérico).
const MAX_LEN = 64;

const CUSTOM_RE = /^(?::[A-Za-z0-9_~-]{1,48}:|<a?:[A-Za-z0-9_~-]{1,48}:[A-Za-z0-9-]{1,40}>)$/;
// Cada "pedaço" precisa ser um pictograma/emoji, um componente de emoji
// (tom de pele, keycap, tag) ou os juntadores ZWJ/FE0F/FE0E.
const UNICODE_RE = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\p{Regional_Indicator}|‍|️|︎|⃣)+$/u;

function isValidReactionEmoji(value) {
  if (typeof value !== 'string') return false;
  const emoji = value.trim();
  if (!emoji || emoji.length > MAX_LEN || emoji !== value) return false;
  if (CUSTOM_RE.test(emoji)) return true;
  if (!UNICODE_RE.test(emoji)) return false;
  // \p{Emoji_Component} inclui dígitos, # e * — sozinhos não são emoji.
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(emoji);
}

module.exports = { isValidReactionEmoji, MAX_LEN };
