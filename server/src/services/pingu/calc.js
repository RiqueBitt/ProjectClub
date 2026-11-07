// Calculadora do Pingu — parser próprio (descida recursiva), SEM eval.
// Aceita: + - * / ^ %, parênteses, vírgula decimal ("2,5"), "x"/"×"/"÷",
// palavras ("mais", "menos", "vezes", "dividido por", "elevado a",
// "raiz de"), "15% de 200", funções (raiz/sqrt, abs, round/arredonda,
// floor, ceil, sin, cos, tan, log, ln) e as constantes pi e e.
// Tudo puro e limitado (tamanho da expressão, profundidade, resultado finito).

const MAX_LEN = 160;
const MAX_DEPTH = 32;

const FUNCS = {
  sqrt: Math.sqrt, raiz: Math.sqrt, abs: Math.abs, round: Math.round, arredonda: Math.round,
  floor: Math.floor, ceil: Math.ceil, sin: Math.sin, sen: Math.sin, cos: Math.cos, tan: Math.tan, tg: Math.tan,
  log: Math.log10, ln: Math.log,
};
const CONSTS = { pi: Math.PI, e: Math.E };

/** Troca palavras em português pelos símbolos. */
function prepare(input) {
  let t = String(input || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim();
  t = t.replace(/^(quanto (e|da|eh|sao|fica)|calcule|calcula|calcular|qual (e|eh) o resultado de|resolve|resolva)\s+/, '');
  t = t.replace(/[?=]+\s*$/, '').trim();
  t = t
    .replace(/(\d+(?:[.,]\d+)?)\s*% de /g, '($1/100)*')
    .replace(/\bpor cento de\b/g, '/100*')
    .replace(/\bdividido por\b/g, '/')
    .replace(/\bdivide por\b/g, '/')
    .replace(/\bvezes\b/g, '*')
    .replace(/\bmultiplicado por\b/g, '*')
    .replace(/\bmais\b/g, '+')
    .replace(/\bmenos\b/g, '-')
    .replace(/\belevado a\b/g, '^')
    .replace(/\bao quadrado\b/g, '^2')
    .replace(/\bao cubo\b/g, '^3')
    .replace(/\braiz quadrada de\b/g, 'raiz ')
    .replace(/\braiz de\b/g, 'raiz ')
    .replace(/[×]/g, '*')
    .replace(/[÷:]/g, '/')
    .replace(/(\d)\s*x\s*(?=[\d(])/g, '$1*');
  // Vírgula decimal: "2,5" → "2.5" (só entre dígitos; sem separador de milhar).
  t = t.replace(/(\d),(\d)/g, '$1.$2');
  return t;
}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ') { i += 1; continue; }
    if (/[0-9.]/.test(c)) {
      const m = src.slice(i).match(/^\d*\.?\d+(?:e[+-]?\d+)?|^\d+\.?/);
      if (!m) throw new Error('número inválido');
      tokens.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[a-z]/.test(c)) {
      const m = src.slice(i).match(/^[a-z]+/);
      const w = m[0];
      if (FUNCS[w]) tokens.push({ t: 'fn', v: w });
      else if (CONSTS[w] !== undefined) tokens.push({ t: 'num', v: CONSTS[w] });
      else throw new Error(`palavra desconhecida: ${w}`);
      i += w.length;
      continue;
    }
    if ('+-*/^%()'.includes(c)) { tokens.push({ t: 'op', v: c }); i += 1; continue; }
    throw new Error(`caractere inválido: ${c}`);
  }
  return tokens;
}

/**
 * Gramática:
 *   expr   := term (('+'|'-') term)*
 *   term   := unary (('*'|'/'|'%') unary | implícito)*
 *   unary  := ('-'|'+') unary | power
 *   power  := atom ('^' unary)?
 *   atom   := num | fn atom | '(' expr ')'
 */
function parse(tokens) {
  let pos = 0;
  let depth = 0;
  const peek = () => tokens[pos];
  const eat = (v) => { if (peek()?.v === v) { pos += 1; return true; } return false; };
  const guard = () => { depth += 1; if (depth > MAX_DEPTH) throw new Error('expressão funda demais'); };

  function atom() {
    guard();
    const tk = peek();
    if (!tk) throw new Error('fim inesperado');
    let out;
    if (tk.t === 'num') { pos += 1; out = tk.v; } else if (tk.t === 'fn') {
      pos += 1;
      out = FUNCS[tk.v](unary());
    } else if (tk.v === '(') {
      pos += 1;
      out = expr();
      if (!eat(')')) throw new Error('faltou fechar parêntese');
    } else throw new Error('esperava um número');
    depth -= 1;
    return out;
  }
  function power() {
    const base = atom();
    if (eat('^')) return base ** unary();
    return base;
  }
  function unary() {
    guard();
    let out;
    if (eat('-')) out = -unary();
    else if (eat('+')) out = unary();
    else out = power();
    depth -= 1;
    return out;
  }
  function term() {
    let v = unary();
    for (;;) {
      if (eat('*')) v *= unary();
      else if (eat('/')) {
        const d = unary();
        if (d === 0) throw Object.assign(new Error('divisão por zero'), { code: 'DIV0' });
        v /= d;
      } else if (eat('%')) {
        // "50%" sozinho = 0,5; "10 % 3" = resto.
        const nx = peek();
        if (nx && (nx.t === 'num' || nx.t === 'fn' || nx.v === '(')) v %= unary();
        else v /= 100;
      } else if (peek() && (peek().v === '(' || peek().t === 'fn')) v *= unary(); // 2(3+4), 2 raiz 9
      else break;
    }
    return v;
  }
  function expr() {
    let v = term();
    for (;;) {
      if (eat('+')) v += term();
      else if (eat('-')) v -= term();
      else break;
    }
    return v;
  }
  const result = expr();
  if (pos !== tokens.length) throw new Error('sobrou coisa na conta');
  return result;
}

/** Número no formato brasileiro, sem casas demais. */
function formatNumber(n) {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-6)) return n.toExponential(6).replace('.', ',');
  const rounded = Math.round(n * 1e10) / 1e10;
  return rounded.toLocaleString('pt-BR', { maximumFractionDigits: 10 });
}

/**
 * Avalia uma conta. Devolve { value, text } ou null (não é conta / inválida).
 * Lança Error com code 'DIV0' na divisão por zero (pra resposta amigável).
 */
function evaluate(input) {
  const src = prepare(input);
  if (!src || src.length > MAX_LEN) return null;
  // Precisa ter pelo menos um número e um operador/função — "42" sozinho não é conta.
  if (!/\d|pi\b/.test(src) || !/[-+*/^%]|\b(raiz|sqrt|abs|round|arredonda|floor|ceil|sin|sen|cos|tan|tg|log|ln)\b/.test(src)) return null;
  if (!/^[\d\s.+\-*/^%()a-z]+$/.test(src)) return null;
  let tokens;
  try { tokens = tokenize(src); } catch { return null; }
  try {
    const value = parse(tokens);
    if (!Number.isFinite(value)) return null;
    return { value, text: formatNumber(value) };
  } catch (err) {
    if (err.code === 'DIV0') throw err;
    return null;
  }
}

/** A mensagem parece uma conta? (barato, pra decidir antes de chamar a IA). */
function looksLikeMath(input) {
  const src = prepare(input);
  return src.length <= MAX_LEN && /\d/.test(src) && /^[\d\s.+\-*/^%()a-z]+$/.test(src)
    && /[-+*/^%]|\b(raiz|sqrt)\b/.test(src) && !/[a-z]{2,}/.test(src.replace(/\b(raiz|sqrt|abs|round|arredonda|floor|ceil|sin|sen|cos|tan|tg|log|ln|pi)\b/g, ''));
}

module.exports = { evaluate, looksLikeMath, formatNumber, prepare };
