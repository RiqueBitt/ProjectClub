// Wiki da comunidade (/wiki) + busca de trechos pro Pingu.
//
// - Todo mundo lê; só a equipe (ADMIN/MODERATOR) cria, edita e apaga.
// - O Pingu NÃO usa embeddings: cada página é quebrada em seções (pelos
//   títulos "## …") e, pra cada pergunta, as seções ganham nota por
//   palavras em comum no estilo BM25 (puro JS). As 1–2 melhores entram no
//   prompt num trecho curto (≤ 600 caracteres), com "(veja /wiki/slug)".
// - As páginas ficam num cache em memória (poucas, pequenas); qualquer
//   edição recarrega o cache.
const { tokenize, normalize, clip, stripMarkdown } = require('./text');

const db = () => require('../../config/prisma');

const MAX_EXCERPT = 600;
const MAX_TITLE = 120;
const MAX_BODY = 20000;
const MAX_CATEGORY = 60;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// BM25 clássico.
const K1 = 1.2;
const B = 0.75;

// ---------------- seções e pontuação (puro) ----------------

/** Quebra uma página em seções pelos títulos markdown (#, ##, ###). */
function splitSections(page) {
  const lines = String(page.body || '').replace(/\r/g, '').split('\n');
  const sections = [];
  let current = { heading: page.title, lines: [] };
  for (const line of lines) {
    const h = line.match(/^\s{0,3}#{1,3}\s+(.+?)\s*#*\s*$/);
    if (h) {
      if (current.lines.join('').trim()) sections.push(current);
      current = { heading: h[1].trim(), lines: [] };
    } else current.lines.push(line);
  }
  if (current.lines.join('').trim()) sections.push(current);
  return sections.map((s, i) => ({
    slug: page.slug, pageTitle: page.title, heading: s.heading, index: i,
    text: stripMarkdown(s.lines.join('\n')),
  }));
}

/** Tokens da seção: título da página e da seção contam em dobro. */
function sectionTokens(s) {
  const head = tokenize(`${s.pageTitle} ${s.heading}`);
  return [...head, ...head, ...tokenize(s.text)];
}

/**
 * Nota BM25 de cada seção pra pergunta. Devolve as seções com nota > 0,
 * da maior pra menor.
 */
function scoreSections(question, pages) {
  const q = [...new Set(tokenize(question))];
  if (!q.length || !pages?.length) return [];
  const sections = pages.flatMap(splitSections).map((s) => {
    const toks = sectionTokens(s);
    const tf = new Map();
    toks.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
    return { ...s, len: toks.length, tf };
  });
  if (!sections.length) return [];
  const avg = sections.reduce((n, s) => n + s.len, 0) / sections.length || 1;
  const df = new Map(q.map((t) => [t, sections.filter((s) => s.tf.has(t)).length]));
  const N = sections.length;
  return sections.map((s) => {
    let score = 0;
    for (const t of q) {
      const f = s.tf.get(t) || 0;
      if (!f) continue;
      const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
      score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (s.len / avg))));
    }
    return { slug: s.slug, pageTitle: s.pageTitle, heading: s.heading, text: s.text, score };
  }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
}

/**
 * Trecho da seção em volta da primeira frase que fala do assunto, cortado
 * em `max` caracteres sem quebrar palavra.
 */
function excerpt(text, question, max = MAX_EXCERPT) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  const q = new Set(tokenize(question));
  const sentences = t.split(/(?<=[.!?])\s+/);
  let start = 0;
  let pos = 0;
  for (const s of sentences) {
    if (tokenize(s).some((w) => q.has(w))) { start = pos; break; }
    pos += s.length + 1;
  }
  // Começa sempre numa frase inteira.
  return clip(t.slice(start), max);
}

/**
 * Escolhe 1–2 seções e monta o contexto pro prompt (≤ 600 caracteres de
 * trecho no total). A segunda só entra se for quase tão boa quanto a
 * primeira e de outro assunto. Devolve { text, slugs } ou null.
 */
function buildWikiContext(question, pages, { max = MAX_EXCERPT } = {}) {
  const ranked = scoreSections(question, pages);
  if (!ranked.length) return null;
  const picked = [ranked[0]];
  const second = ranked.find((s, i) => i > 0 && !(s.slug === ranked[0].slug && s.heading === ranked[0].heading));
  if (second && second.score >= ranked[0].score * 0.6) picked.push(second);
  const budget = picked.length === 2 ? Math.floor(max / 2) : max;
  const parts = picked.map((s) => {
    const label = s.heading && normalize(s.heading) !== normalize(s.pageTitle) ? `${s.pageTitle} — ${s.heading}` : s.pageTitle;
    return `${label}: ${excerpt(s.text, question, budget)} (veja /wiki/${s.slug})`;
  });
  return { text: parts.join('\n'), slugs: [...new Set(picked.map((s) => s.slug))] };
}

/** Busca simples na lista da wiki (título, categoria e corpo). */
function searchPages(query, pages) {
  const q = normalize(query);
  if (!q) return pages;
  const ranked = scoreSections(query, pages);
  const bySlug = new Map();
  ranked.forEach((s) => bySlug.set(s.slug, Math.max(bySlug.get(s.slug) || 0, s.score)));
  pages.forEach((p) => { if (normalize(`${p.title} ${p.category}`).includes(q)) bySlug.set(p.slug, (bySlug.get(p.slug) || 0) + 10); });
  return pages.filter((p) => bySlug.has(p.slug)).sort((a, b) => bySlug.get(b.slug) - bySlug.get(a.slug));
}

function slugify(text) {
  return normalize(text).replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

// ---------------- banco + cache ----------------

let cache = null; // [{ slug, title, category, body, updatedAt, updatedBy }]

async function loadPages() {
  cache = await db().wikiPage.findMany({ orderBy: [{ category: 'asc' }, { title: 'asc' }] });
  return cache;
}

/** Páginas em memória (sincrono; vazio até carregar). */
const cachedPages = () => cache || [];

async function listPages(query) {
  const pages = cache || await loadPages();
  return searchPages(query, pages).map(({ slug, title, category, updatedAt, body }) => ({
    slug, title, category, updatedAt, preview: clip(stripMarkdown(body), 160),
  }));
}

async function getPage(slug) {
  const pages = cache || await loadPages();
  const page = pages.find((p) => p.slug === String(slug || '').toLowerCase());
  if (!page) return null;
  const updater = page.updatedBy
    ? await db().user.findUnique({ where: { id: page.updatedBy }, select: { id: true, username: true, displayName: true } }).catch(() => null)
    : null;
  return { ...page, updatedByUser: updater };
}

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

function validate(body, { partial = false } = {}) {
  const data = {};
  if (!partial || body.title !== undefined) {
    const title = String(body.title || '').replace(/\s+/g, ' ').trim();
    if (title.length < 2 || title.length > MAX_TITLE) throw bad(`O título precisa ter de 2 a ${MAX_TITLE} caracteres.`);
    data.title = title;
  }
  if (!partial || body.body !== undefined) {
    const text = String(body.body || '').replace(/\r/g, '').trim();
    if (!text) throw bad('Escreva o conteúdo da página.');
    if (text.length > MAX_BODY) throw bad(`A página pode ter até ${MAX_BODY} caracteres.`);
    data.body = text;
  }
  if (!partial || body.category !== undefined) {
    data.category = String(body.category || 'Geral').replace(/\s+/g, ' ').trim().slice(0, MAX_CATEGORY) || 'Geral';
  }
  return data;
}

async function createPage(body, userId) {
  const data = validate(body);
  const slug = String(body.slug || '').trim() ? String(body.slug).trim().toLowerCase() : slugify(data.title);
  if (!SLUG_RE.test(slug) || slug.length > 80) throw bad('Endereço inválido (use letras minúsculas, números e hífen).');
  if (await db().wikiPage.findUnique({ where: { slug } })) throw bad('Já existe uma página com esse endereço.', 409);
  const page = await db().wikiPage.create({ data: { ...data, slug, updatedBy: userId || null } });
  await loadPages();
  return page;
}

async function updatePage(slug, body, userId) {
  const existing = await db().wikiPage.findUnique({ where: { slug } });
  if (!existing) throw bad('Página não encontrada.', 404);
  const page = await db().wikiPage.update({ where: { slug }, data: { ...validate(body, { partial: true }), updatedBy: userId || null } });
  await loadPages();
  return page;
}

async function deletePage(slug) {
  const existing = await db().wikiPage.findUnique({ where: { slug } });
  if (!existing) throw bad('Página não encontrada.', 404);
  await db().wikiPage.delete({ where: { slug } });
  await loadPages();
  return { ok: true };
}

/** Cria as páginas iniciais se a wiki estiver vazia (nunca sobrescreve). */
async function ensureSeed() {
  const count = await db().wikiPage.count();
  if (count === 0) {
    const { WIKI_SEED } = require('../../data/wikiSeed');
    for (const p of WIKI_SEED) {
      // eslint-disable-next-line no-await-in-loop
      await db().wikiPage.create({ data: { slug: p.slug, title: p.title, category: p.category, body: p.body.trim() } }).catch(() => {});
    }
    console.log(`[wiki] ${WIKI_SEED.length} páginas iniciais criadas`);
  }
  await loadPages();
}

module.exports = {
  listPages, getPage, createPage, updatePage, deletePage, ensureSeed, loadPages, cachedPages,
  buildWikiContext, scoreSections, splitSections, excerpt, searchPages, slugify, MAX_EXCERPT,
  _test: { setCache: (pages) => { cache = pages; } },
};
