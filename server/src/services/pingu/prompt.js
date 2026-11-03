// Montagem dos prompts do Pingu (puro).
//
// Regra de ouro da velocidade: o PRIMEIRO bloco (system) é sempre o mesmo,
// byte a byte, entre pedidos — só a persona fixa + o que a equipe escreveu.
// Assim o Ollama reaproveita o prefixo já calculado (cache de KV) e só lê o
// que mudou: medido na VPS, prompt em cache ~250–290 tokens/s contra
// ~33–43 tokens/s sem cache. Tudo que muda (trecho da wiki, mensagem
// respondida, data, tarefa) vai na mensagem do usuário, no FIM.
const { clip } = require('./text');

const BASE_PROMPT = (name) => `Você é o ${name}, assistente do Project Club (comunidade brasileira com chat, voz, Fórum, Economia, Loja e Guerra das Cartas). Responda em português do Brasil, simples e amigável, em 1 a 3 frases curtas, sem listas nem negrito, a menos que a tarefa peça outro formato. Você não faz ações no site: imagens, lembretes e enquetes saem dos comandos do Pingu (veja /wiki/pingu). Use o contexto entre colchetes quando ajudar e cite o endereço /wiki/... quando usar a wiki. Quando não souber algo do Project Club, admita e indique a equipe. Não invente regras, preços ou datas e nunca peça senhas.`;

/** O system prompt fixo (muda só quando a equipe muda o nome ou as instruções). */
function systemPrompt({ name, instructions }) {
  return instructions
    ? `${BASE_PROMPT(name)}\nO que você sabe sobre o Project Club:\n${instructions}`
    : BASE_PROMPT(name);
}

const WEEKDAY = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const pad = (n) => String(n).padStart(2, '0');
function dateLine(now = Date.now()) {
  const l = new Date(now - 3 * 3600000);
  return `${WEEKDAY[l.getUTCDay()]}, ${pad(l.getUTCDate())}/${pad(l.getUTCMonth() + 1)}/${l.getUTCFullYear()}, ${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())} (Brasília)`;
}

const TIME_WORDS_RE = /\b(hoje|amanha|ontem|agora|data|dia|semana|mes|ano|horas?|idade|aniversario|quando)\b/;
const CREATIVE_RE = /\b(piada|piadas|poema|poesia|historia|historinha|conto|rima|rimas|musica|letra|apelido|apelidos|nome criativo|ideias?|inventa|invente|imagine|charada|trava lingua|elogio|cantada|frase motivacional)\b/;

/**
 * Tipos de pedido e o orçamento de cada um (num_predict = tokens que a IA
 * pode escrever; ~10 tokens/s na VPS).
 */
function budgetFor(kind, text = '') {
  const len = String(text || '').length;
  switch (kind) {
    case 'explain': return { numPredict: 180, temperature: 0.3, maxAnswer: 700 };
    case 'summarizeThis': return { numPredict: 120, temperature: 0.2, maxAnswer: 500 };
    case 'rewrite': return { numPredict: Math.min(360, Math.max(80, Math.ceil(len / 2.5) + 40)), temperature: 0.4, maxAnswer: 1500 };
    case 'enhance': return { numPredict: 70, temperature: 0.3, maxAnswer: 400 };
    default: {
      const creative = CREATIVE_RE.test(text);
      return { numPredict: creative ? 170 : len <= 40 ? 110 : 150, temperature: creative ? 0.7 : 0.3, maxAnswer: 600 };
    }
  }
}

/**
 * Mensagem do usuário com o contexto que muda. ctx: { question, wiki,
 * reply: { author, content }, task, now, normalized }.
 * Sem contexto nenhum, é só a pergunta (prompt menor = mais rápido).
 */
function buildUserTurn({ question, wiki = null, reply = null, task = null, now = Date.now(), normalized = '' }) {
  const parts = [];
  if (wiki?.text) parts.push(`[Wiki do Project Club]\n${wiki.text}`);
  if (reply?.content) parts.push(`[Mensagem de ${clip(reply.author || 'alguém', 32)}]\n${clip(reply.content, task === 'rewrite' ? 1200 : 600)}`);
  if (TIME_WORDS_RE.test(normalized)) parts.push(`[Agora: ${dateLine(now)}]`);
  const q = String(question || '').trim();
  if (task === 'explain') parts.push(`Tarefa: explique a mensagem acima de um jeito simples, em até 3 frases.${q && !/^(me\s+)?expli/i.test(q) ? ` Pedido: ${q}` : ''}`);
  else if (task === 'summarizeThis') parts.push('Tarefa: resuma a mensagem acima em 1 ou 2 frases curtas.');
  else if (task === 'rewrite') parts.push(`Tarefa: reescreva a mensagem acima com gramática certa, clara e no mesmo idioma. Pedido: "${clip(q, 120)}". Responda só com o texto reescrito.`);
  else parts.push(q || 'Oi!');
  return parts.join('\n');
}

/**
 * Lista final pro /api/chat: system fixo, memória curta (pergunta/resposta),
 * a resposta anterior do Pingu (quando a pessoa respondeu ele) e o pedido.
 */
function buildMessages({ system, memory = [], previousAnswer = null, userTurn }) {
  const messages = [{ role: 'system', content: system }];
  for (const m of memory) {
    messages.push({ role: 'user', content: m.q });
    messages.push({ role: 'assistant', content: m.a });
  }
  const lastA = memory.length ? memory[memory.length - 1].a : null;
  if (previousAnswer && !(lastA && previousAnswer.startsWith(lastA.slice(0, 80)))) messages.push({ role: 'assistant', content: previousAnswer });
  messages.push({ role: 'user', content: userTurn });
  return messages;
}

module.exports = { BASE_PROMPT, systemPrompt, buildUserTurn, buildMessages, budgetFor, dateLine, CREATIVE_RE };
