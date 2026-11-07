// Helpers puros do filtro em:#canal / in:#canal da busca do chat
// (ChannelSearchPanel). O servidor é quem aplica de verdade — e só entre os
// canais que a pessoa pode ver (ver resolveChannelFilter no servidor).

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s_-]+/g, '-');

// Se a pessoa está digitando um filtro de canal no FIM da busca, devolve o
// pedaço do nome digitado até agora ('' logo depois de "em:#"); senão null.
export function channelFilterQuery(query) {
  const m = String(query || '').match(/(?:^|\s)(?:in|em):(?:#|"#?)?([^\s"]*)$/i);
  return m ? m[1] : null;
}

// Troca o filtro incompleto do fim pelo nome escolhido (entre aspas se
// tiver espaço) e deixa um espaço pra continuar digitando.
export function completeChannelFilter(query, channelName) {
  const name = String(channelName || '').trim();
  const value = /\s/.test(name) ? `"${name}"` : `#${name}`;
  return String(query || '').replace(/(^|\s)(in|em):(?:#|"#?)?[^\s"]*$/i, (_, pre, key) => `${pre}${key}:${value} `);
}

// Canais de texto que combinam com o que foi digitado (começa com vem antes
// de contém). Canais de voz/palco ficam de fora (não têm mensagens).
export function matchChannelsForFilter(channels, typed, limit = 6) {
  const q = fold(typed);
  const list = (Array.isArray(channels) ? channels : []).filter((c) => c && c.name && !['VOICE', 'STAGE', 'RULES'].includes(c.type));
  const seen = new Set();
  const uniq = list.filter((c) => (seen.has(c.id) ? false : seen.add(c.id)));
  if (!q) return uniq.slice(0, limit);
  const starts = uniq.filter((c) => fold(c.name).startsWith(q));
  const contains = uniq.filter((c) => !fold(c.name).startsWith(q) && fold(c.name).includes(q));
  return [...starts, ...contains].slice(0, limit);
}
