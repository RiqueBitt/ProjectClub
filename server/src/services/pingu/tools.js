// Respostas instantâneas do Pingu SEM IA (zero CPU na VPS): ajuda, hora e
// data, calculadora, conversões, dado/sorteio/escolha, cara ou coroa,
// contagem regressiva e perguntas frequentes respondidas direto da wiki.
// Tudo puro: relógio (now), sorteio (rng) e páginas da wiki injetáveis.
const { evaluate, looksLikeMath, formatNumber } = require('./calc');
const { convert } = require('./convert');
const { fold } = require('./timeparse');
const { tokenize, clip } = require('./text');

const TZ_OFFSET_MIN = -180; // Brasília
const WEEKDAY = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MONTH = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// Lista de comandos (o chat e o popover "Comandos do Pingu" usam a mesma).
const COMMANDS = [
  { group: 'Perguntas', cmd: '@pingu <pergunta>', desc: 'Respondo na hora, escrevendo ao vivo. Responda uma mensagem minha pra continuar o assunto.' },
  { group: 'Perguntas', cmd: '@pingu explica / resume isso / melhora esse texto', desc: 'Respondendo a mensagem de alguém: explico, resumo ou reescrevo ela.' },
  { group: 'Imagens', cmd: '@pingu desenhe <descrição>', desc: 'Crio uma imagem (também: crie uma imagem, gere, imagem, draw). Diga "quadrada", "paisagem" ou "retrato".' },
  { group: 'Imagens', cmd: '@pingu de novo', desc: 'Outra versão da sua última imagem (nova semente).' },
  { group: 'Úteis', cmd: '@pingu me lembra em 20 min de …', desc: 'Lembrete: "amanhã às 9h", "sexta às 10h", "dia 15 às 14h"…' },
  { group: 'Úteis', cmd: '@pingu enquete Pergunta? A / B / C', desc: 'Crio uma enquete de verdade no canal (até 7 opções).' },
  { group: 'Úteis', cmd: '@pingu resume', desc: 'Resumo do que você perdeu no canal (só você vê).' },
  { group: 'Instantâneos', cmd: '@pingu quanto é 15% de 200', desc: 'Calculadora (sem IA, na hora).' },
  { group: 'Instantâneos', cmd: '@pingu 10 km em milhas', desc: 'Conversões de unidades (comprimento, peso, temperatura, volume, dados…).' },
  { group: 'Instantâneos', cmd: '@pingu que horas são / que dia é hoje', desc: 'Hora e data de Brasília.' },
  { group: 'Instantâneos', cmd: '@pingu rola um d20 / cara ou coroa', desc: 'Dados, moeda, "sorteia de 1 a 100" e "escolhe entre A, B ou C".' },
  { group: 'Instantâneos', cmd: '@pingu quanto falta pro natal', desc: 'Contagem regressiva (natal, ano novo ou uma data como 25/12).' },
  { group: 'Privado', cmd: 'Mensagem direta pro Pingu', desc: 'Converse comigo no privado: mesmas regras, ninguém mais vê.' },
];

function helpText() {
  const lines = ['🐧 Comandos do Pingu (sempre com @pingu na frente):'];
  for (const c of COMMANDS.filter((x) => x.group !== 'Privado')) lines.push(`• ${c.cmd.replace(/^@pingu /, '')}: ${c.desc}`);
  lines.push('Também dá pra me mandar mensagem direta. Mais em /wiki/pingu');
  return lines.join('\n');
}

/** Relógio de Brasília (campos UTC de uma data deslocada). */
function brt(now) { return new Date(now + TZ_OFFSET_MIN * 60000); }
const pad = (n) => String(n).padStart(2, '0');

function timeAnswer(f, now) {
  const l = brt(now);
  if (/\b(que|quais|qual)\s+(?:horas?|hora)\b|\bhoras?\s+(?:sao|e)\s+agora\b|\bque\s+horas\b|\bhorario\s+agora\b/.test(f) && !/\b(dia|data)\b/.test(f)) {
    return `🕐 Agora são ${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())} (horário de Brasília).`;
  }
  if (/\b(que|qual)\s+(?:dia|data)\s+(?:e|eh|sera|e\s+hoje|de\s+hoje|hoje)\b|\bdia\s+(?:e\s+)?hoje\b|\bdata\s+de\s+hoje\b|\bhoje\s+e\s+que\s+dia\b|\bque\s+dia\s+da\s+semana\b/.test(f)) {
    return `📅 Hoje é ${WEEKDAY[l.getUTCDay()]}, ${l.getUTCDate()} de ${MONTH[l.getUTCMonth()]} de ${l.getUTCFullYear()} (${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())} em Brasília).`;
  }
  if (/\b(que|qual)\s+ano\s+(?:e|estamos)\b|\bem\s+que\s+ano\s+estamos\b/.test(f)) return `📅 Estamos em ${l.getUTCFullYear()}.`;
  return null;
}

function rngInt(rng, min, max) { return min + Math.floor(rng() * (max - min + 1)); }

function diceAnswer(f, rng) {
  if (/\b(cara\s+ou\s+coroa|coroa\s+ou\s+cara|joga(?:r)?\s+(?:uma\s+)?moeda|flip\s+a\s+coin|heads\s+or\s+tails)\b/.test(f)) {
    return rng() < 0.5 ? '🪙 Deu cara!' : '🪙 Deu coroa!';
  }
  const nd = f.match(/\b(\d{0,2})d(\d{1,4})\b(?:\s*([+-])\s*(\d{1,4}))?/);
  const word = f.match(/\b(?:rola|rolar|joga|jogar|lanca|lancar|roll)\s+(?:um|uma|o|1)?\s*(?:dado|dados|die|dice)(?:\s+de\s+(\d{1,4})(?:\s+lados|\s+faces)?)?/);
  if (nd && (/\b(rola|rolar|joga|jogar|roll|dado|dados)\b/.test(f) || /^\s*\d{0,2}d\d{1,4}(\s*[+-]\s*\d+)?\s*$/.test(f))) {
    const count = Math.min(Math.max(Number(nd[1] || 1), 1), 20);
    const sides = Number(nd[2]);
    if (sides < 2 || sides > 1000) return '🎲 Esse dado não existe! Use de 2 a 1000 lados.';
    const rolls = Array.from({ length: count }, () => rngInt(rng, 1, sides));
    const mod = nd[3] ? (nd[3] === '-' ? -1 : 1) * Number(nd[4]) : 0;
    const total = rolls.reduce((a, b) => a + b, 0) + mod;
    if (count === 1 && !mod) return `🎲 d${sides}: ${rolls[0]}`;
    return `🎲 ${count}d${sides}${mod ? `${nd[3]}${nd[4]}` : ''}: ${rolls.join(' + ')}${mod ? ` ${nd[3]} ${nd[4]}` : ''} = ${total}`;
  }
  if (word) {
    const sides = Math.min(Math.max(Number(word[1] || 6), 2), 1000);
    return `🎲 Deu ${rngInt(rng, 1, sides)} (dado de ${sides} lados).`;
  }
  const range = f.match(/\b(?:sorteia|sortear|sorteie|numero\s+aleatorio|random(?:\s+number)?|escolhe\s+um\s+numero|escolha\s+um\s+numero)\b.*?(-?\d+)\s*(?:a|ate|e|-|to|and)\s*(-?\d+)/);
  if (range) {
    let a = Number(range[1]);
    let b = Number(range[2]);
    if (a > b) [a, b] = [b, a];
    if (b - a > 1e9) return null;
    return `🎲 Sorteei: ${rngInt(rng, a, b)} (de ${a} a ${b}).`;
  }
  return null;
}

function chooseAnswer(raw, f, rng) {
  const m = f.match(/^(?:escolhe|escolha|escolher|decide|decida|sorteia|sorteie|sortear|choose|pick)\s+(?:um|uma|pra\s+mim|para\s+mim)?\s*(?:entre|between|:)?\s*(.+)$/);
  if (!m) return null;
  const start = f.length - m[1].length;
  const list = raw.slice(start).replace(/[?!.]+$/, '').split(/\s*(?:,|;|\/|\|)\s*|\s+(?:ou|or|e)\s+/i).map((s) => s.trim()).filter(Boolean);
  if (list.length < 2 || list.length > 20) return null;
  return `🎯 Escolhi: ${list[Math.floor(rng() * list.length)]}`;
}

const HOLIDAYS = [
  { re: /\bnatal\b|\bchristmas\b/, m: 12, d: 25, name: 'o Natal' },
  { re: /\bano\s+novo\b|\breveillon\b|\bnew\s+year\b/, m: 1, d: 1, name: 'o Ano Novo' },
  { re: /\bdia\s+das\s+criancas\b/, m: 10, d: 12, name: 'o Dia das Crianças' },
  { re: /\bhalloween\b|\bdia\s+das\s+bruxas\b/, m: 10, d: 31, name: 'o Halloween' },
  { re: /\bdia\s+dos\s+namorados\b/, m: 6, d: 12, name: 'o Dia dos Namorados' },
  { re: /\bindependencia\b|\b7\s+de\s+setembro\b/, m: 9, d: 7, name: 'o 7 de Setembro' },
];

function countdownAnswer(f, now) {
  if (!/\b(quanto\s+(?:tempo\s+)?falta|quantos\s+dias\s+(?:faltam|falta|ate|pra|para)|dias\s+(?:ate|pra|para)|contagem\s+regressiva|how\s+many\s+days)\b/.test(f)) return null;
  const l = brt(now);
  const today = Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate());
  let target = null;
  let name = null;
  const h = HOLIDAYS.find((x) => x.re.test(f));
  if (h) { target = { m: h.m, d: h.d, y: null }; name = h.name; } else {
    const dm = f.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (dm) {
      let y = dm[3] ? Number(dm[3]) : null;
      if (y !== null && y < 100) y += 2000;
      target = { d: Number(dm[1]), m: Number(dm[2]), y };
      name = `${pad(target.d)}/${pad(target.m)}${y ? `/${y}` : ''}`;
    }
  }
  if (!target || target.m < 1 || target.m > 12 || target.d < 1 || target.d > 31) return null;
  let y = target.y ?? l.getUTCFullYear();
  let t = Date.UTC(y, target.m - 1, target.d);
  if (target.y === null && t < today) { y += 1; t = Date.UTC(y, target.m - 1, target.d); }
  const days = Math.round((t - today) / 86400000);
  if (days < 0) return `⏳ Essa data (${name}) já passou.`;
  if (days === 0) return `🎉 É hoje: ${name}!`;
  if (days === 1) return `⏳ Falta 1 dia para ${name} (amanhã!).`;
  return `⏳ Faltam ${days} dias para ${name} (${pad(target.d)}/${pad(target.m)}/${y}).`;
}

function mathAnswer(raw) {
  if (!looksLikeMath(raw) && !/^(quanto\s+(e|da|eh|sao|fica)|calcul[ae]r?|resolv[ae])\b/.test(fold(raw).trim())) return null;
  try {
    const r = evaluate(raw);
    return r ? `🧮 ${r.text}` : null;
  } catch (err) {
    if (err.code === 'DIV0') return '🧮 Não dá pra dividir por zero! 🐧';
    return null;
  }
}

// Perguntas genéricas demais pra contar na "cobertura" da wiki.
const GENERIC = new Set(['funciona', 'funcionam', 'como', 'consigo', 'faco', 'posso', 'usar', 'usa', 'serve', 'existe', 'tem', 'onde', 'qual', 'quai', 'quando', 'fazer']);
const FAQ_MIN_SCORE = 5;
const FAQ_RATIO = 1.15;
const FAQ_COVERAGE = 0.6;

/**
 * Pergunta frequente respondida direto da wiki (sem IA): só quando a
 * melhor seção ganha com folga e o título dela cobre a pergunta.
 * Devolve { text, slug } ou null.
 */
function wikiFaq(question, pages, wiki) {
  if (!pages?.length || !wiki) return null;
  const f = fold(question).trim();
  // "O que é o Project Club?" → resposta pronta montada com a lista da wiki.
  if (/^(?:o\s+)?(?:que|oque)\s+(?:e|eh|seria)\s+(?:o\s+|esse\s+|este\s+)?(?:project\s*club|projectclub|pc)\b|^(?:o\s+)?que\s+(?:e|eh)\s+(?:isso|esse\s+site|essa\s+comunidade|esse\s+app)\s+aqui/.test(f)) {
    const list = pages.slice(0, 6).map((p) => `${p.title} (/wiki/${p.slug})`).join(', ');
    return {
      slug: null,
      text: `🐧 O Project Club é uma comunidade brasileira com chat, voz, Fórum, Economia, Loja e Guerra das Cartas, tudo num lugar só. Pra conhecer: ${list}.`,
    };
  }
  const ranked = wiki.scoreSections(question, pages);
  if (!ranked.length) return null;
  const [top] = ranked;
  const second = ranked.find((s) => !(s.slug === top.slug && s.heading === top.heading));
  if (top.score < FAQ_MIN_SCORE || (second && top.score < second.score * FAQ_RATIO)) return null;
  const q = [...new Set(tokenize(question))].filter((t) => !GENERIC.has(t));
  if (!q.length) return null;
  const head = new Set(tokenize(`${top.pageTitle} ${top.heading}`));
  const covered = q.filter((t) => head.has(t)).length / q.length;
  if (covered < FAQ_COVERAGE) return null;
  const label = fold(top.heading) !== fold(top.pageTitle) ? `${top.pageTitle} — ${top.heading}` : top.pageTitle;
  const quote = clip(wiki.excerpt(top.text, question, 360), 360);
  return { slug: top.slug, text: `📖 ${label}: "${quote}" (veja /wiki/${top.slug})` };
}

/**
 * Tenta responder sem IA. Devolve { tool, text } ou null.
 * opts: { now, rng, pages, wiki, rates }
 */
function tryLocalTool(question, { now = Date.now(), rng = Math.random, pages = [], wiki = null, rates } = {}) {
  const raw = String(question || '').trim();
  if (!raw || raw.length > 300) return null;
  const f = fold(raw).replace(/\s+/g, ' ').trim();
  let text = timeAnswer(f, now);
  if (text) return { tool: 'time', text };
  text = countdownAnswer(f, now);
  if (text) return { tool: 'countdown', text };
  text = chooseAnswer(raw, f, rng);
  if (text) return { tool: 'choose', text };
  text = diceAnswer(f, rng);
  if (text) return { tool: 'dice', text };
  const conv = convert(raw, { rates });
  if (conv) return { tool: 'convert', text: `📏 ${conv.text}` };
  text = mathAnswer(raw);
  if (text) return { tool: 'calc', text };
  const faq = wikiFaq(raw, pages, wiki);
  if (faq) return { tool: 'wiki', text: faq.text, slug: faq.slug };
  return null;
}

module.exports = { tryLocalTool, helpText, COMMANDS, wikiFaq, formatNumber };
