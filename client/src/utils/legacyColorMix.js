// color-mix() em navegador antigo (Chromium < 111: o Project Club Lite no
// Windows 7/8, que usa o Electron 22, e celulares/PCs com navegador velho).
//
// O CSS do site usa color-mix() em mais de mil lugares. Um navegador que não
// conhece a função JOGA FORA a declaração inteira — fundos e bordas somem.
// Aqui, só nesses navegadores, cada folha de estilo do site é relida como
// texto e cada color-mix(...) vira uma cor pronta (rgba), calculada com as
// variáveis do tema atual (--brand, --bg-primary...). A folha convertida
// entra no lugar da original. Trocou o tema? Converte de novo.
//
// Limite: variável definida só dentro de um componente (não no <html>) não é
// conhecida aqui; a declaração fica de fora, como já ficava sem o conserto.
// Em navegador atual nada disto roda.

const MARK = 'data-pc-colormix';
// Cores-base do tema: se nenhuma mudou, as cores calculadas continuam valendo.
const SIGNATURE_VARS = ['--bg-deepest', '--bg-secondary', '--bg-primary', '--bg-elevated', '--brand', '--text-normal', '--text-muted', '--header-primary', '--accent', '--border'];
const FN = 'color-mix(';

export function supportsColorMix(css = typeof CSS !== 'undefined' ? CSS : null) {
  try { return !!css?.supports?.('color', 'color-mix(in srgb, red 50%, blue)'); } catch { return false; }
}

// ---------- cores ----------
const NAMED = { transparent: [0, 0, 0, 0], white: [255, 255, 255, 1], black: [0, 0, 0, 1], red: [255, 0, 0, 1], blue: [0, 0, 255, 1], currentcolor: null };

/** "#4C9FFF", "rgb(...)", "rgba(...)", "transparent" → [r, g, b, a] (ou null). */
export function parseColor(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  if (Object.prototype.hasOwnProperty.call(NAMED, s)) return NAMED[s];
  if (s[0] === '#') {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(h)) return null;
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  const m = s.match(/^rgba?\(\s*([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const ch = (v) => (v.endsWith('%') ? (parseFloat(v) * 255) / 100 : parseFloat(v));
    const a = parts[3] == null ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    const out = [ch(parts[0]), ch(parts[1]), ch(parts[2]), a];
    return out.every((v) => Number.isFinite(v)) ? out : null;
  }
  return null;
}

const fmt = ([r, g, b, a]) => {
  const c = (v) => Math.round(Math.min(255, Math.max(0, v)));
  const al = Math.round(Math.min(1, Math.max(0, a)) * 1000) / 1000;
  return al >= 1 ? `rgb(${c(r)}, ${c(g)}, ${c(b)})` : `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${al})`;
};

// Divide "a, b(c, d), e" nas vírgulas de fora dos parênteses.
function splitTop(str) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of str) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((p) => p.trim());
}

// Posição do ")" que fecha o "(" em `open`.
function closeOf(str, open) {
  let depth = 0;
  for (let i = open; i < str.length; i += 1) {
    if (str[i] === '(') depth += 1;
    else if (str[i] === ')') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

/** Troca var(--x, reserva) pelo valor (lookup = nome → valor ou ''), várias camadas. */
export function resolveVars(value, lookup, depth = 0) {
  if (depth > 8 || !value.includes('var(')) return value;
  let out = ''; let i = 0;
  while (i < value.length) {
    const at = value.indexOf('var(', i);
    if (at === -1) { out += value.slice(i); break; }
    const end = closeOf(value, at + 3);
    if (end === -1) return null;
    out += value.slice(i, at);
    const [name, ...rest] = splitTop(value.slice(at + 4, end));
    let v = (lookup(name.trim()) || '').trim();
    if (!v && rest.length) v = rest.join(',').trim();
    if (!v) return null; // variável desconhecida: não dá pra calcular
    out += v;
    i = end + 1;
  }
  return resolveVars(out, lookup, depth + 1);
}

/** Calcula um color-mix(in <espaço>, A p%, B q%) já sem var(). null se não der. */
export function mixValue(inner, lookup) {
  const args = splitTop(inner);
  if (args.length !== 3 || !/^in\s/i.test(args[0])) return null;
  const side = (arg) => {
    const m = arg.match(/^(.*?)(?:\s+(-?[\d.]+)%)?$/s);
    let color = (m && m[1]) || arg;
    let pct = m && m[2] != null ? parseFloat(m[2]) : null;
    // A porcentagem também pode vir antes da cor.
    const pre = color.match(/^(-?[\d.]+)%\s+(.*)$/s);
    if (pre) { pct = parseFloat(pre[1]); color = pre[2]; }
    return { color: convert(color.trim(), lookup), pct };
  };
  const a = side(args[1]); const b = side(args[2]);
  const ca = parseColor(a.color); const cb = parseColor(b.color);
  if (!ca || !cb) return null;
  let p1 = a.pct; let p2 = b.pct;
  if (p1 == null && p2 == null) { p1 = 50; p2 = 50; } else if (p1 == null) p1 = 100 - p2; else if (p2 == null) p2 = 100 - p1;
  const sum = p1 + p2;
  if (!(sum > 0)) return null;
  const w1 = p1 / sum; const w2 = p2 / sum;
  const alphaScale = sum < 100 ? sum / 100 : 1;
  // Mistura com alfa pré-multiplicado (como o navegador faz): misturar com
  // "transparent" só deixa a cor mais transparente, sem escurecer.
  const al = ca[3] * w1 + cb[3] * w2;
  const ch = (k) => (al > 0 ? (ca[k] * ca[3] * w1 + cb[k] * cb[3] * w2) / al : 0);
  return fmt([ch(0), ch(1), ch(2), al * alphaScale]);
}

/** Troca todos os color-mix(...) (e as var() de dentro deles) num texto de CSS. */
export function convert(text, lookup) {
  if (!text.includes(FN)) return text;
  let out = ''; let i = 0;
  while (i < text.length) {
    const at = text.indexOf(FN, i);
    if (at === -1) { out += text.slice(i); break; }
    const end = closeOf(text, at + FN.length - 1);
    if (end === -1) { out += text.slice(i); break; }
    out += text.slice(i, at);
    const inner = resolveVars(text.slice(at + FN.length, end), lookup);
    const val = inner == null ? null : mixValue(inner, lookup);
    // Sem como calcular: deixa como estava (o navegador ignora, igual antes).
    out += val || text.slice(at, end + 1);
    i = end + 1;
  }
  return out;
}

// ---------- folhas de estilo da página ----------
function rootLookup(doc) {
  const cs = doc.defaultView.getComputedStyle(doc.documentElement);
  const cache = new Map();
  return (name) => {
    if (!cache.has(name)) cache.set(name, cs.getPropertyValue(name));
    return cache.get(name);
  };
}

/**
 * Liga o conserto (só onde precisa). Devolve a função que desliga.
 * Converte as <style> e as <link rel=stylesheet> do próprio site.
 */
export function installColorMixFallback({ doc = typeof document !== 'undefined' ? document : null, fetchText = (url) => fetch(url, { credentials: 'same-origin' }).then((r) => (r.ok ? r.text() : '')) } = {}) {
  if (!doc || supportsColorMix(doc.defaultView?.CSS)) return () => {};
  const originals = new Map(); // nó original → texto do CSS
  const copies = new Map(); // nó original → <style> convertida
  let timer = 0;

  const sameOrigin = (href) => { try { return new URL(href, doc.baseURI).origin === doc.defaultView.location.origin; } catch { return false; } };

  const apply = (node, text) => {
    // Converte ANTES de mexer nas folhas: o estilo calculado do <html> é
    // "ao vivo" — com a original já desligada, as variáveis sumiriam.
    const converted = convert(text, rootLookup(doc));
    let copy = copies.get(node);
    if (!copy) {
      copy = doc.createElement('style');
      copy.setAttribute(MARK, '');
      copy.textContent = converted;
      node.after(copy);
      copies.set(node, copy);
      // A original fica desligada (a convertida tem tudo dela).
      if (node.tagName === 'LINK') node.disabled = true; else node.media = 'not all';
    } else {
      copy.textContent = converted;
    }
  };

  const take = (node) => {
    if (originals.has(node) || node.hasAttribute?.(MARK)) return;
    if (node.tagName === 'STYLE') {
      const text = node.textContent || '';
      if (!text.includes(FN)) return;
      originals.set(node, text);
      apply(node, text);
    } else if (node.tagName === 'LINK' && /stylesheet/i.test(node.rel) && node.href && sameOrigin(node.href)) {
      originals.set(node, null); // marcado: buscando
      fetchText(node.href).then((text) => {
        if (!text || !text.includes(FN)) return;
        originals.set(node, text);
        apply(node, text);
      }).catch(() => {});
    }
  };

  const scan = () => doc.querySelectorAll('style, link[rel~="stylesheet"]').forEach(take);
  // Tema trocou (data-theme/classe/estilo do <html>): recalcula as cores —
  // só se as cores-base mudaram de verdade (o <html> muda por outros motivos
  // também, e reconverter tudo à toa pesaria em PC fraco).
  const signature = () => {
    const cs = doc.defaultView.getComputedStyle(doc.documentElement);
    return SIGNATURE_VARS.map((v) => cs.getPropertyValue(v).trim()).join('|');
  };
  let lastSig = '';
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const sig = signature();
      if (sig === lastSig) return;
      lastSig = sig;
      originals.forEach((text, node) => { if (text) apply(node, text); });
    }, 150);
  };

  lastSig = signature();
  scan();
  const headObs = new doc.defaultView.MutationObserver((muts) => {
    muts.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) take(n); }));
  });
  headObs.observe(doc.head, { childList: true });
  const rootObs = new doc.defaultView.MutationObserver(refresh);
  rootObs.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
  return () => { headObs.disconnect(); rootObs.disconnect(); clearTimeout(timer); };
}
