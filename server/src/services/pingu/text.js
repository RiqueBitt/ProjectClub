// Pingu — utilitários de texto puros (sem banco, sem rede).
// Usados pela busca na wiki, pelo quiz (resposta sem acento) e pela
// moderação. Tudo aqui é testável sem conectar em nada.

/** minúsculas, sem acento, só letras/números e espaço simples. */
function normalize(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Palavras muito comuns que não ajudam a achar o assunto.
const STOPWORDS = new Set(`
a o as os um uma uns umas de da do das dos em na no nas nos por pra pro para com sem
e ou mas que se como quando onde qual quais quem porque pq porq ja nao sim eu voce vc voces
ele ela eles elas me te lhe nos vos meu minha seu sua isso isto esse essa este esta aqui ali
la ao aos ser estar ter tem tenho tinha foi sao era fica ficar faz fazer posso pode podem
muito mais menos tambem so ate sobre entre depois antes the of and to is in it how what
oi ola eai pingu favor alguem tudo bem obrigado obrigada
`.split(/\s+/).filter(Boolean));

/** "Raiz" bem simples: tira plural/variações comuns do português. */
function stem(token) {
  let t = token;
  if (t.length > 5 && /(coes|soes)$/.test(t)) t = `${t.slice(0, -4)}cao`;
  else if (t.length > 4 && /oes$/.test(t)) t = `${t.slice(0, -3)}ao`;
  else if (t.length > 4 && /ais$/.test(t)) t = `${t.slice(0, -3)}al`;
  else if (t.length > 4 && /eis$/.test(t)) t = `${t.slice(0, -3)}el`;
  else if (t.length > 3 && /s$/.test(t)) t = t.slice(0, -1);
  return t;
}

/** Palavras úteis de um texto (normalizadas, sem stopwords, com raiz). */
function tokenize(text) {
  return normalize(text).split(' ').filter((w) => w.length > 1 && !STOPWORDS.has(w)).map(stem);
}

/** Distância de edição (Levenshtein) com teto — barata pra palavras curtas. */
function editDistance(a, b, max = 2) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Corta no limite sem quebrar palavra, com reticências. */
function clip(text, max) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

/** Markdown → texto corrido (pra mandar pra IA ou mostrar trecho). */
function stripMarkdown(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Limitador simples por chave (pessoa): no máximo `max` usos em `windowMs`.
 * take() devolve { ok, retryInMs }; refund() devolve o último uso (quando a
 * IA nem chegou a trabalhar, ex.: offline).
 */
function createLimiter({ windowMs, max = 1, now = () => Date.now() }) {
  const hits = new Map();
  const sweep = () => {
    const t = now();
    for (const [k, list] of hits) if (!list.length || t - list[list.length - 1] > windowMs) hits.delete(k);
  };
  return {
    take(key) {
      const t = now();
      if (hits.size > 5000) sweep();
      const list = (hits.get(key) || []).filter((x) => t - x < windowMs);
      if (list.length >= max) {
        hits.set(key, list);
        return { ok: false, retryInMs: windowMs - (t - list[0]) };
      }
      list.push(t);
      hits.set(key, list);
      return { ok: true, retryInMs: 0 };
    },
    refund(key) {
      const list = hits.get(key);
      if (list?.length) list.pop();
    },
  };
}

module.exports = { normalize, tokenize, stem, editDistance, clip, stripMarkdown, createLimiter, STOPWORDS };
