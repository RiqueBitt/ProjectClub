// O que a pessoa quer com o "@pingu …"? (puro; só olha o texto)
//
// Ordem: comandos com verbo no começo (imagem, de novo, lembrete,
// enquete, explicar/reescrever/resumir isso, ajuda). O resto é pergunta
// normal (ferramentas locais → wiki → IA).
const { fold } = require('./timeparse');

const IMG_NOUN = '(?:imagem|imagens|desenho|ilustracao|figura|arte|foto|pintura|wallpaper|papel de parede|avatar|logo)';
const IMAGE_RE = new RegExp('^(?:(?:por\\s+favor|pfv|pf)[,\\s]+)?(?:'
  + `(?:me\\s+)?(?:crie|cria|criar|desenhe|desenha|desenhar|gere|gera|gerar|faca|faz|fazer|pinte|pinta|ilustre|ilustra)(?:\\s+(?:pra|para)\\s+mim)?(?:\\s+uma?(?=\\s+${IMG_NOUN}))?(?:\\s+${IMG_NOUN})?(?:\\s+(?:de|do|da|dos|das|com|sobre))?`
  + `|(?:imagem|desenho)(?:\\s+(?:de|do|da|com|sobre))?`
  + '|(?:draw|generate|create|make|paint)(?:\\s+me)?(?:\\s+an?(?=\\s+(?:image|picture|drawing)))?(?:\\s+(?:image|picture|drawing|art))?(?:\\s+of)?'
  + '|(?:image|picture)(?:\\s+of)?'
  + ')(?:[\\s:,-]+|$)');
// Verbos que só valem como imagem se vier "imagem/desenho/…" junto (senão
// "faça um resumo" ou "crie uma senha" virariam imagem).
const NEEDS_NOUN_RE = /^(?:(?:por\s+favor|pfv|pf)[,\s]+)?(?:me\s+)?(?:crie|cria|criar|gere|gera|gerar|faca|faz|fazer|create|make|generate)\b/;
const IMAGE_NOUN_RE = /\b(imagem|imagens|desenho|ilustracao|figura|arte|foto|pintura|image|picture|drawing|art|wallpaper|papel de parede|avatar|logo)\b/;
const REROLL_RE = /^(?:de\s+novo|denovo|outra(?:\s+(?:vez|imagem|versao))?|mais\s+uma|again|another(?:\s+one)?|re-?roll|refaz|refaca|gera\s+outra|gere\s+outra|tenta\s+de\s+novo)[\s!.?]*(?:(quadrada|paisagem|retrato|horizontal|vertical))?[\s!.?]*$/;
const SIZE_RE = /\b(quadrad[ao]|paisagem|horizontal|widescreen|retrato|vertical|em pe|square|landscape|portrait)\b/;
const POLL_RE = /^(?:cri[ae]r?\s+(?:uma\s+)?|faz(?:er)?\s+(?:uma\s+)?|faca\s+(?:uma\s+)?)?(?:enquete|votacao|poll)\b[\s:,-]*/;
const EXPLAIN_RE = /^(?:me\s+)?(?:explica|explique|explicar|explain)(?:\s+(?:isso|isto|essa|esse|a\s+mensagem|melhor|pra\s+mim))*\b|^o\s+que\s+(?:isso|essa\s+mensagem|esse\s+texto)\s+quer\s+dizer|^que\s+que\s+(?:isso|ele|ela)\s+(?:quis|quer)\s+dizer/;
const SUMMARIZE_THIS_RE = /^(?:resume|resuma|resumir|resumo\s+d[eoa])\s+(?:isso|isto|essa|esse|a\s+mensagem|o\s+texto|ai|aqui)\b|^tl;?dr\b/;
const REWRITE_RE = /^(?:melhora|melhore|melhorar|reescreve|reescreva|reescrever|corrige|corrija|corrigir|revisa|revise|deixa\s+(?:mais|menos)\s+\w+|deixe\s+(?:mais|menos)\s+\w+|arruma|arrume|rewrite|fix)\b/;
const HELP_RE = /^(?:ajuda|help|comandos|commands|o\s+que\s+(?:voce|vc)\s+(?:faz|sabe\s+fazer|consegue\s+fazer)|como\s+(?:te\s+)?(?:usa|uso|usar)|menu)[\s?!.]*$/;

/** "quadrada" | "paisagem" | "retrato" | null. */
function parseSize(text) {
  const m = fold(text).match(SIZE_RE);
  if (!m) return null;
  if (/^(quadrad|square)/.test(m[1])) return 'quadrada';
  if (/^(paisagem|horizontal|widescreen|landscape)/.test(m[1])) return 'paisagem';
  return 'retrato';
}

/** Tira a palavra de tamanho do prompt ("em formato paisagem", ", retrato"). */
function stripSize(prompt) {
  return String(prompt || '')
    .replace(/[,\s]*(?:em\s+)?(?:formato\s+|modo\s+)?\b(quadrad[ao]|paisagem|horizontal|widescreen|retrato|vertical|em\s+p[ée]|square|landscape|portrait)\b[,.\s]*/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Pedido de enquete: "Qual o melhor jogo? Minecraft / Terraria / Roblox".
 * Devolve { question, options, duration } ou { error }.
 */
function parsePoll(body) {
  let t = String(body || '').replace(/\s+/g, ' ').trim();
  let duration = '24h';
  const dur = t.match(/\s*\((?:dura(?:cao|ção)?\s*)?(1h|4h|16h|24h|3d|1w|1 ?semana|3 ?dias|1 ?dia)\)\s*$|\s+(?:por|durante)\s+(1|4|16|24)\s*h(?:oras?)?\s*$|\s+(?:por|durante)\s+(1|3)\s*dias?\s*$|\s+(?:por|durante)\s+(?:1|uma)\s*semana\s*$/i);
  if (dur) {
    const raw = (dur[1] || (dur[2] ? `${dur[2]}h` : dur[3] ? `${dur[3]}d` : '1w')).replace(/\s/g, '').toLowerCase();
    duration = { '1semana': '1w', '3dias': '3d', '1dia': '24h', '1d': '24h' }[raw] || raw;
    t = t.slice(0, dur.index).trim();
  }
  let question = '';
  let rest = '';
  const q = t.indexOf('?');
  const c = t.indexOf(':');
  if (q > 0) { question = t.slice(0, q + 1); rest = t.slice(q + 1); } else if (c > 0) { question = t.slice(0, c); rest = t.slice(c + 1); } else {
    const parts = t.split(/\s*[|/]\s*/);
    question = parts.shift() || '';
    rest = parts.join(' / ');
  }
  let options = rest.split(/\s*[|/;]\s*/);
  if (options.length < 2) options = rest.split(/\s*,\s*|\s+ou\s+/i);
  options = options.map((o) => o.replace(/^[-•*\d.)\s]+/, '').trim()).filter(Boolean);
  options = options.filter((o, i) => options.findIndex((x) => x.toLowerCase() === o.toLowerCase()) === i);
  question = question.trim();
  if (!question || options.length < 2) {
    return { error: 'Pra criar uma enquete escreve assim: "@pingu enquete Qual o melhor jogo? Minecraft / Terraria / Roblox". 🐧' };
  }
  if (options.length > 7) return { error: 'A enquete pode ter no máximo 7 opções. 🐧' };
  if (question.length > 180) return { error: 'A pergunta da enquete pode ter no máximo 180 caracteres. 🐧' };
  if (options.some((o) => o.length > 80)) return { error: 'Cada opção pode ter no máximo 80 caracteres. 🐧' };
  return { question, options, duration };
}

/**
 * Intenção do texto depois do "@pingu".
 * ctx.hasReply = respondendo outra mensagem (que não é do Pingu) — liga
 * explicar/resumir isso/reescrever.
 * Devolve { type, … }: image | reroll | reminder | poll | explain |
 * summarizeThis | rewrite | help | question.
 */
function parseIntent(question, { hasReply = false } = {}) {
  const raw = String(question || '').trim();
  const f = fold(raw).replace(/\s+/g, ' ');
  if (!f) return { type: 'question', text: raw };

  const reroll = f.match(REROLL_RE);
  if (reroll) return { type: 'reroll', size: reroll[1] ? parseSize(reroll[1]) : null };

  const img = f.match(IMAGE_RE);
  if (img && img[0].trim()) {
    const verbOnly = NEEDS_NOUN_RE.test(f) && !IMAGE_NOUN_RE.test(f.slice(0, img[0].length + 1));
    if (!verbOnly) {
      const prompt = raw.slice(img[0].length).trim();
      return { type: 'image', prompt: stripSize(prompt), size: parseSize(prompt) };
    }
  }

  if (/^(?:(?:por\s+favor|pfv|pf)[,\s]+)?(?:me\s+)?(?:lembrete|lembre-me|lembra-me|lembr[ae]r?)\b/.test(f)) return { type: 'reminder', text: raw };

  const poll = f.match(POLL_RE);
  if (poll) return { type: 'poll', body: raw.slice(poll[0].length) };

  if (HELP_RE.test(f)) return { type: 'help' };

  if (hasReply) {
    if (SUMMARIZE_THIS_RE.test(f)) return { type: 'summarizeThis', text: raw };
    if (REWRITE_RE.test(f)) return { type: 'rewrite', text: raw };
    if (EXPLAIN_RE.test(f)) return { type: 'explain', text: raw };
  }
  return { type: 'question', text: raw };
}

module.exports = { parseIntent, parsePoll, parseSize, stripSize };
