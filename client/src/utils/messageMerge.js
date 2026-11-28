// Junta a página mais recente de mensagens (vinda do servidor) com o que
// já está na tela, sem perder nada que chegou pelo socket nesse meio
// tempo e sem trocar objetos que não mudaram (o React.memo de Message
// continua valendo, então nada pisca nem re-renderiza à toa).
//
// Usado em dois momentos:
//  - ao abrir uma sala: mensagens que chegaram pelo socket ENTRE o pedido
//    da 1ª página e a resposta dela não somem mais (antes a resposta
//    sobrescrevia a lista inteira);
//  - ao reconectar o socket: busca o que se perdeu enquanto a conexão
//    estava caída ("catch-up"), sem precisar recarregar a página.
//
// `fresh` é a página mais recente (ordem crescente, como o servidor manda)
// e `pageSize` é o tamanho máximo dessa página (50 no servidor).
// Retorna { messages, gap } — gap=true quando a página nova não encosta no
// que já existia (perdemos mais de uma página inteira): nesse caso a lista
// antiga é descartada e quem chamou deve liberar "carregar mais antigas".

const isTemp = (m) => String(m?.id || '').startsWith('temp-');
const ts = (m) => new Date(m.createdAt).getTime();

function sameMessage(a, b) {
  if (a === b) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

export function mergeLatestMessages(existing, fresh, pageSize = 50) {
  const prev = Array.isArray(existing) ? existing : [];
  const page = Array.isArray(fresh) ? fresh : [];
  const prevById = new Map(prev.filter((m) => !isTemp(m)).map((m) => [m.id, m]));
  const pageIds = new Set(page.map((m) => m.id));
  // Mensagens otimistas (ainda enviando / falharam) e as que o servidor já
  // confirmou (mesmo nonce) — a otimista sai quando a real está na página.
  const pageNonces = new Set(page.map((m) => m.nonce).filter(Boolean));
  const temps = prev.filter((m) => isTemp(m) && !(m.nonce && pageNonces.has(m.nonce)));

  // Reaproveita o objeto antigo quando nada mudou (mantém nonce/_animateIn,
  // que servem de chave estável e de controle da animação de entrada).
  const merged = page.map((m) => {
    const old = prevById.get(m.id);
    if (!old) return m;
    const candidate = { ...m, nonce: old.nonce ?? m.nonce, _animateIn: old._animateIn };
    if (candidate.nonce === undefined) delete candidate.nonce;
    if (candidate._animateIn === undefined) delete candidate._animateIn;
    return sameMessage(old, candidate) ? old : candidate;
  });

  const oldest = page.length ? ts(page[0]) : Infinity;
  const newest = page.length ? ts(page[page.length - 1]) : -Infinity;
  const pageIsWholeHistory = page.length < pageSize;
  const overlaps = page.some((m) => prevById.has(m.id));
  const prevReal = prev.filter((m) => !isTemp(m));
  const gap = !pageIsWholeHistory && prevReal.length > 0 && !overlaps
    && prevReal.every((m) => ts(m) < oldest);

  const older = [];
  const newer = [];
  if (!gap) {
    prevReal.forEach((m) => {
      if (pageIds.has(m.id)) return;
      const t = ts(m);
      // Chegou pelo socket depois da "foto" do servidor — mantém.
      if (t > newest) newer.push(m);
      // Mais antiga que a página (veio de "carregar mais") — mantém.
      else if (t < oldest && !pageIsWholeHistory) older.push(m);
      // Dentro da janela da página e não veio nela = foi apagada.
    });
  }

  const real = [...older, ...merged, ...newer].sort((a, b) => ts(a) - ts(b));
  const messages = [...real, ...temps];
  // Mesma lista de antes (mesmos objetos, mesma ordem) = devolve a
  // referência antiga, pra não disparar render nenhum.
  if (messages.length === prev.length && messages.every((m, i) => m === prev[i])) return { messages: prev, gap: false };
  return { messages, gap };
}
