'use strict';
// Textos do jornal: lê os textos estáticos (DefineText) de um SWF do jornal
// em parágrafos (com estilo, alinhamento e posição) e monta o campo de texto
// (DefineEditText) equivalente em português, com as fontes completas.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const swfLib = require('./swf');

const EM = 20480;
const GUTTER = 40; // 2 px de margem interna do campo de texto (twips)

// ---------------------------------------------------------------- fontes

const FONT_DIR = path.join(__dirname, 'fonts');
let fontsCache = null;
function fonts() {
  if (fontsCache) return fontsCache;
  const meta = JSON.parse(fs.readFileSync(path.join(FONT_DIR, 'fonts.json'), 'utf-8'));
  fontsCache = {};
  for (const [variant, m] of Object.entries(meta)) {
    fontsCache[variant] = { ...m, variant, body: fs.readFileSync(path.join(FONT_DIR, `${variant}.bin`)) };
  }
  return fontsCache;
}

/** Fonte original → variante completa (Proxima Nova regular/semibold/condensada/itálica). */
function variantFor(name = '', italic = false) {
  const n = name.toLowerCase();
  if ((italic || n.includes('italic')) && !/bold|black|heavy|condensed/.test(n)) return 'italic';
  if (n.includes('condensed') || n.includes('compressed') || n.includes('extrabold') || n.includes('black')) return 'condensed';
  if (n.includes('semibold') || n.includes('bold') || n.includes('heavy')) return 'semibold';
  return 'regular';
}

function measure(text, font, height) {
  let w = 0;
  const adv = font.advances;
  const fallback = adv.n || adv.o || 0;
  for (const ch of text) w += adv[ch] ?? fallback;
  // margem de segurança: o Ruffle quebra um pouco antes do que a soma dos avanços
  return (w * height * 1.08) / EM;
}

/** Quebra de linha como o Flash (por palavras, na largura útil). */
function wrap(text, font, height, width) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const word of words) {
    const tryLine = cur ? `${cur} ${word}` : word;
    if (cur && measure(tryLine, font, height) > width) { lines.push(cur); cur = word; } else cur = tryLine;
  }
  if (cur) lines.push(cur);
  // palavra mais larga que a linha: o Flash quebra no meio dela (conta como linhas a mais)
  const out = [];
  for (const l of lines) {
    const n = Math.ceil(measure(l, font, height) / Math.max(1, width));
    out.push(l);
    for (let i = 1; i < n && !l.includes(' '); i += 1) out.push('');
  }
  return out.length ? out : [''];
}

// ---------------------------------------------------------------- leitura

const keyOf = (text) => crypto.createHash('sha1').update(text).digest('hex');
const hasLetters = (s) => /[A-Za-z]/.test(s);
const isUpper = (s) => hasLetters(s) && s === s.toUpperCase() && (s.match(/[A-Z]/g) || []).length >= 2;

/**
 * Analisa um SWF do jornal. Devolve { swf, texts: [{ tagIndex, id, info, paragraphs }] }.
 * Cada parágrafo: { text, key, upper, variant, height, color, align, lines, baseline0, lineGap, left, right }.
 */
function analyze(data) {
  const swf = swfLib.parse(data);
  if (!swf) return null;
  const fontInfo = new Map();
  for (const t of swf.tags) {
    if (t.code === 48 || t.code === 75) {
      try { const f = swfLib.parseFont(t); fontInfo.set(f.id, f); } catch { /* ignora */ }
    }
  }
  const texts = [];
  swf.tags.forEach((tag, tagIndex) => {
    if (tag.code !== 11 && tag.code !== 33) return;
    let info;
    try { info = swfLib.parseText(tag); } catch { return; }
    const m = info.matrix;
    if (Math.abs(m.a - 1) > 0.01 || Math.abs(m.d - 1) > 0.01 || Math.abs(m.b) > 0.01 || Math.abs(m.c) > 0.01) return; // texto girado/escalado: fica
    // linhas = registros com a mesma linha de base
    const rows = new Map();
    for (const rec of info.records) {
      const font = fontInfo.get(rec.fontId);
      if (!font) return;
      let text = '';
      let width = 0;
      for (const g of rec.glyphs) { text += String.fromCharCode(font.codes[g.index] ?? 32); width += g.advance; }
      const y = rec.y + m.ty;
      const row = rows.get(y) || [];
      row.push({ x: rec.x + m.tx, width, text, font, height: rec.height, color: rec.color });
      rows.set(y, row);
    }
    const lines = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([y, runs]) => {
      runs.sort((a, b) => a.x - b.x);
      const first = runs[0]; const last = runs[runs.length - 1];
      return { y, text: runs.map((r) => r.text).join('').replace(/ /g, ' '), left: first.x, right: last.x + last.width, font: first.font, height: first.height, color: first.color };
    }).filter((l) => l.text.trim() !== '');
    if (!lines.length) return;
    // parágrafos: linhas seguidas com o mesmo estilo e espaçamento regular
    const paragraphs = [];
    let cur = null;
    for (const line of lines) {
      const style = `${variantFor(line.font.name, line.font.italic)}|${line.height}|${line.color}`;
      const gap = cur ? line.y - cur.lines[cur.lines.length - 1].y : 0;
      const sameBlock = cur && cur.style === style && (cur.lineGap === null ? gap <= line.height * 1.8 : Math.abs(gap - cur.lineGap) <= line.height * 0.25);
      if (sameBlock) {
        if (cur.lineGap === null) cur.lineGap = gap;
        cur.lines.push(line);
      } else {
        cur = { style, lines: [line], lineGap: null };
        paragraphs.push(cur);
      }
    }
    const out = paragraphs.map((p) => {
      const first = p.lines[0];
      let text = '';
      for (const l of p.lines) {
        const t = l.text.trim();
        if (!text) text = t;
        else if (/[A-Za-zÀ-ÿ]-$/.test(text) && /^[a-zà-ÿ]/.test(t)) text = text.slice(0, -1) + t; // hifenização
        else text = `${text} ${t}`;
      }
      const lefts = p.lines.map((l) => l.left); const rights = p.lines.map((l) => l.right);
      const centers = p.lines.map((l) => (l.left + l.right) / 2);
      const spread = (a) => Math.max(...a) - Math.min(...a);
      let align = 0;
      if (p.lines.length > 1) {
        if (spread(lefts) > 40 && spread(centers) <= 60) align = 2;
        else if (spread(lefts) > 40 && spread(rights) <= 30) align = 1;
      } else {
        const b = info.bounds;
        const c = (first.left + first.right) / 2;
        if ((b.xmax - b.xmin) - (first.right - first.left) > 200 && Math.abs(c - (b.xmin + b.xmax) / 2 - m.tx) < 60) align = 2;
      }
      return {
        text, key: keyOf(text), upper: isUpper(text), variant: variantFor(first.font.name, first.font.italic),
        height: first.height, color: first.color, align, lines: p.lines.length,
        baseline0: first.y, lineGap: p.lineGap || Math.round(first.height * 1.2),
        left: Math.min(...lefts), right: Math.max(...rights), lineWidths: p.lines.map((l) => l.right - l.left),
      };
    });
    texts.push({ tagIndex, id: info.id, info, paragraphs: out });
  });
  // Aspas soltas (desenhadas como texto à parte na frente da 1ª linha): somem
  // e vão pro começo do parágrafo traduzido — senão ficariam "voando" quando
  // o texto em português quebra as linhas em outro lugar.
  const all = texts.flatMap((t) => t.paragraphs.map((p) => ({ t, p })));
  for (const { t, p } of all) {
    if (t.paragraphs.length !== 1 || !/^[“”"‘’«»]+$/.test(p.text.trim())) continue;
    t.quoteOnly = true;
    const target = all.find(({ t: o, p: q }) => o !== t && !q.leadQuote && Math.abs(q.baseline0 - p.baseline0) <= 100 && q.left >= p.left - 20 && q.left - p.right <= 400);
    if (target) target.p.leadQuote = p.text.trim();
  }
  // Coluna que continua na próxima (frase cortada no meio): traduz as duas
  // partes juntas e divide o português na mesma proporção.
  for (let i = 0; i + 1 < texts.length; i += 1) {
    const a = texts[i].paragraphs[texts[i].paragraphs.length - 1];
    const b = texts[i + 1].paragraphs[0];
    if (!a || !b || a.chainKey || a.variant !== b.variant || a.height !== b.height) continue;
    if (/[.!?:;"”…)]$/.test(a.text) || !/^[a-z]/.test(b.text)) continue;
    const full = `${a.text} ${b.text}`;
    const key = keyOf(full);
    const ratio = a.text.length / full.length;
    Object.assign(a, { chainKey: key, chainText: full, chainPart: 0, chainRatio: ratio });
    Object.assign(b, { chainKey: key, chainText: full, chainPart: 1, chainRatio: ratio });
  }
  return { swf, texts };
}

// ---------------------------------------------------------------- montagem

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

/** Troca caracteres que a fonte não tem (aspas tortas etc. ficam; emoji sai). */
function clean(text, font) {
  let out = '';
  for (const ch of text) out += font.advances[ch] !== undefined ? ch : (/\s/.test(ch) ? ' ' : '');
  return out.replace(/\s+/g, ' ').trim();
}

/** Largura útil de um parágrafo: a menor das linhas "cheias" quando o texto contorna algo (ex.: botão). */
function usableWidth(p) {
  const full = p.right - p.left;
  const w = p.lineWidths || [];
  if (w.length < 3) return full;
  // contorno: as últimas linhas (não só a última) são bem mais curtas
  const max = Math.max(...w);
  const narrow = w.map((x) => x <= max * 0.6);
  if (!narrow[w.length - 1] || !narrow[w.length - 2]) return full;
  return Math.max(...w.filter((x, i) => narrow[i]));
}

/** Português de cada parágrafo (null se faltar tradução). Frases que continuam na outra coluna enchem a 1ª coluna primeiro. */
function resolveTexts(texts, tr) {
  const F = fonts();
  const out = new Map();
  for (const t of texts) {
    for (const p of t.paragraphs) {
      if (out.has(p)) continue;
      if (p.chainKey) {
        const full = tr.get(p.chainKey);
        if (full === undefined || full === null) { out.set(p, null); continue; }
        const a = p.chainPart === 0 ? p : null;
        const pair = texts.flatMap((x) => x.paragraphs).filter((q) => q.chainKey === p.chainKey);
        const pa = pair.find((q) => q.chainPart === 0) || a; const pb = pair.find((q) => q.chainPart === 1);
        const words = full.split(/\s+/).filter(Boolean);
        const fa = F[pa.variant]; const fb = pb ? F[pb.variant] : fa;
        // menor redução de letra (até 78%) em que as duas colunas comportam o texto
        let n = words.length; let scale = 1;
        for (let s = 1; s >= 0.78 - 1e-9; s -= 0.02) {
          scale = s;
          n = words.length;
          while (n > 1 && wrap(words.slice(0, n).join(' '), fa, pa.height * s, usableWidth(pa) + 10).length > pa.lines) n -= 1;
          if (!pb || wrap(words.slice(n).join(' '), fb, pb.height * s, usableWidth(pb) + 10).length <= pb.lines) break;
        }
        pa.forceScale = scale; if (pb) pb.forceScale = scale;
        out.set(pa, words.slice(0, n).join(' '));
        if (pb) out.set(pb, words.slice(n).join(' '));
        continue;
      }
      out.set(p, hasLetters(p.text) ? (tr.get(p.key) ?? null) : p.text);
    }
  }
  return out;
}

/** Monta o DefineEditText de um texto. Devolve null se faltar tradução de algum parágrafo. */
function renderText(text, resolved, fontIds) {
  const F = fonts();
  if (text.quoteOnly) {
    return swfLib.editTextTag({ id: text.id, bounds: { xmin: 0, xmax: 20, ymin: 0, ymax: 20 }, fontId: fontIds.regular, height: 200, color: 0, html: false, text: '' });
  }
  const paras = [];
  for (const p of text.paragraphs) {
    let pt = resolved.get(p);
    if (pt === undefined || pt === null) return null;
    if (p.upper) pt = pt.toUpperCase();
    if (p.leadQuote && pt && !/^[“"«]/.test(pt)) pt = p.leadQuote + pt;
    const font = F[p.variant];
    paras.push({ ...p, pt: clean(pt, font) || (pt === '' ? '' : p.text), font, width: usableWidth(p) });
  }
  const singleLine = paras.every((p) => p.lines === 1);
  const left = Math.min(...paras.map((p) => p.left));
  let right = Math.max(...paras.map((p) => p.right));
  let scale = 1;
  if (singleLine) {
    // rótulos e títulos: nunca quebram; encolhem pra caber (até 60%) e, se
    // ainda assim não couber, o campo fica mais largo
    const need = (s) => Math.max(...paras.map((p) => measure(p.pt, p.font, p.height * s) / Math.max(1, p.right - p.left)));
    while (scale > 0.6 && need(scale) > 1.08) scale -= 0.02;
    const over = need(scale);
    if (over > 1) right = left + (right - left) * over + 40;
  } else {
    // parágrafos: encolhe até 88% pra caber nas mesmas linhas; depois ganha linhas
    const forced = paras.find((p) => p.forceScale);
    // títulos/selos em maiúsculas podem encolher mais (não podem quebrar palavra)
    const base = paras.every((p) => p.upper) ? 0.66 : 0.88;
    const floor = forced ? Math.min(base, forced.forceScale) : base;
    for (let s = forced ? forced.forceScale : 1; s >= floor - 1e-9; s -= 0.02) {
      scale = s;
      if (paras.every((p) => wrap(p.pt, p.font, p.height * s, p.width + 10).length <= p.lines)) break;
    }
  }
  const linesOf = (p) => (singleLine ? 1 : wrap(p.pt, p.font, p.height * scale, p.width + 10).length);
  const p0 = paras[0];
  const asc0 = (p0.font.ascent * p0.height * scale) / EM;
  const ymin = Math.round(p0.baseline0 - asc0 - GUTTER);
  let h = 0;
  paras.forEach((p, i) => {
    const n = linesOf(p);
    if (i < paras.length - 1) {
      const gapNext = paras[i + 1].baseline0 - (p.baseline0 + (p.lines - 1) * p.lineGap);
      h += (n - 1) * p.lineGap + Math.max(gapNext, p.lineGap);
    } else h += (n - 1) * p.lineGap + ((p.font.ascent + p.font.descent) * p.height * scale) / EM;
  });
  const narrow = Math.min(...paras.map((p) => p.width));
  const xmax = paras.some((p) => p.width < p.right - p.left) ? left + narrow : right;
  const bounds = { xmin: Math.round(left - GUTTER), xmax: Math.round(Math.max(xmax, left + 20) + GUTTER + 20), ymin, ymax: Math.round(ymin + GUTTER * 2 + asc0 + h + 60) };
  const sizeOf = (p) => Math.round((p.height * scale) / 2) / 10; // px com 1 casa
  const html = paras.map((p, i) => {
    const size = p.height * scale;
    const natural = ((p.font.ascent + p.font.descent) * size) / EM;
    const leading = Math.round((p.lineGap * (singleLine ? 1 : 1) - natural) / 20);
    const align = p.align === 2 ? 'center' : p.align === 1 ? 'right' : 'left';
    const face = esc(p.font.name);
    let extra = '';
    if (i < paras.length - 1) {
      // espaço até o próximo parágrafo (o Flash não tem margem de parágrafo): uma linha em branco do tamanho certo
      const gap = paras[i + 1].baseline0 - (p.baseline0 + (p.lines - 1) * p.lineGap) - p.lineGap;
      if (gap > p.lineGap * 0.4) extra = `<textformat leading="0"><p align="${align}"><font face="${face}" size="${Math.max(1, Math.round((gap / 20) * 0.75))}"> </font></p></textformat>`;
    }
    return `<textformat leading="${leading}"><p align="${align}"><font face="${face}" size="${sizeOf(p)}" color="${hex(p.color)}">${esc(p.pt)}</font></p></textformat>${extra}`;
  }).join('');
  const lead0 = Math.round(p0.lineGap - ((p0.font.ascent + p0.font.descent) * p0.height * scale) / EM);
  return swfLib.editTextTag({
    id: text.id, bounds, fontId: fontIds[p0.variant], height: p0.height * scale, color: p0.color,
    align: p0.align, leading: lead0, html: true, text: html, wrap: !singleLine,
  });
}

/**
 * SWF traduzido: cada texto com tradução completa vira campo de texto em
 * português; os outros ficam em inglês. Devolve { data, translated, total }.
 */
function translateSwf(analysis, tr) {
  const { swf, texts } = analysis;
  const F = fonts();
  let nextId = swfLib.maxCharacterId(swf) + 1;
  const fontIds = {};
  const fontTags = [];
  // só as variantes usadas neste SWF (cada fonte tem ~30 KB)
  const used = new Set(['regular']);
  for (const t of texts) for (const p of t.paragraphs) used.add(p.variant);
  for (const variant of Object.keys(F)) {
    if (!used.has(variant)) continue;
    fontIds[variant] = nextId;
    fontTags.push(swfLib.fontTag(F[variant].body, nextId));
    nextId += 1;
  }
  const resolved = resolveTexts(texts, tr);
  const tags = swf.tags.slice();
  let translated = 0;
  for (const t of texts) {
    let tag = null;
    try { tag = renderText(t, resolved, fontIds); } catch (err) { console.warn('[jornal] texto não montado:', err?.message || err); }
    if (tag) { tags[t.tagIndex] = tag; translated += 1; }
  }
  if (!translated) return { data: null, translated, total: texts.length };
  // fontes antes do primeiro texto (definição antes do uso)
  const firstText = Math.min(...texts.map((t) => t.tagIndex));
  tags.splice(firstText, 0, ...fontTags);
  return { data: swfLib.build({ ...swf, tags }), translated, total: texts.length };
}

/** Todos os parágrafos (com letras) de um SWF analisado: [{ key, text, upper }]. */
function segmentsOf(analysis) {
  const out = new Map();
  for (const t of analysis.texts) {
    for (const p of t.paragraphs) {
      if (p.chainKey) out.set(p.chainKey, { key: p.chainKey, text: p.chainText, upper: p.upper });
      else if (hasLetters(p.text)) out.set(p.key, { key: p.key, text: p.text, upper: p.upper });
    }
  }
  return [...out.values()];
}

module.exports = { analyze, translateSwf, segmentsOf, keyOf, fonts, variantFor, wrap, measure };
