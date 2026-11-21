// Links bonitos: em vez de /channels/bcec6258-a00a-..., o endereço usa o
// nome (/canal/chat-geral). Este arquivo cuida dos "slugs" guardados no
// banco (coluna `slug` em Channel, Event, Post e Conversation de grupo):
//
//   - slugify("🌎 | Chat Geral!")  → "chat-geral" (sem acento/emoji/símbolo)
//   - nome repetido ganha -2, -3... (canal único na comunidade; evento/post
//     com o mesmo título idem) — nada de código comprido no endereço
//   - renomear troca o slug e guarda o antigo em SlugHistory, então links
//     velhos continuam abrindo o lugar certo
//   - backfillSlugs() roda na subida do servidor e só preenche quem ainda
//     não tem slug (pode rodar quantas vezes for, não muda nada já feito)
//
// O banco NÃO tem @unique na coluna slug de propósito: o `prisma db push`
// trata unique novo em tabela existente como "possível perda de dados" e
// trava o deploy (ver commit 3574abd). A unicidade é garantida aqui.
//
// Todas as funções aceitam { db } pra testar sem banco (test/links-bonitos).

const KINDS = {
  channel: { model: 'channel', field: 'name', fallback: 'canal' },
  event: { model: 'event', field: 'title', fallback: 'evento' },
  post: { model: 'post', field: 'title', fallback: 'post' },
  // Grupos sempre começam com "grupo-": /dm/<x> também aceita @usuário
  // (DM 1:1), e @usuário nunca tem hífen — então nunca dá conflito.
  conversation: { model: 'conversation', field: 'name', fallback: 'grupo', prefix: 'grupo' },
};

const MAX_LEN = 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function defaultDb() { return require('../config/prisma'); }

// "Chat geral" → "chat-geral"; "🌎 | Ação & Reação!" → "acao-reacao".
// Corta em até `max` caracteres sem deixar hífen sobrando no fim.
function slugify(input, max = MAX_LEN) {
  let s = String(input == null ? '' : input)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // acentos
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/[^a-z0-9]+/g, '-') // emoji, símbolos, espaços → hífen
    .replace(/^-+|-+$/g, '');
  if (s.length > max) {
    s = s.slice(0, max);
    // Corta na última palavra inteira quando dá.
    const cut = s.lastIndexOf('-');
    if (cut >= Math.floor(max / 2)) s = s.slice(0, cut);
    s = s.replace(/-+$/g, '');
  }
  return s;
}

// Base do slug de um tipo (com prefixo/valor padrão quando o nome é só emoji).
function baseSlug(kind, text) {
  const k = KINDS[kind];
  if (!k) throw new Error(`tipo de slug desconhecido: ${kind}`);
  let s = slugify(text, k.prefix ? MAX_LEN - k.prefix.length - 1 : MAX_LEN);
  if (k.prefix) s = s ? `${k.prefix}-${s}` : k.prefix;
  return s || k.fallback;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Primeiro livre entre base, base-2, base-3... dado o conjunto de ocupados.
function pickFreeSlug(base, taken) {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100000; n++) {
    const c = `${base}-${n}`;
    if (!taken.has(c)) return c;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// Slugs já usados que "colidem" com a base (a própria base ou base-N).
async function takenSlugs(kind, base, { db = defaultDb(), excludeId = null } = {}) {
  const { model } = KINDS[kind];
  const rows = await db[model].findMany({ where: { slug: { startsWith: base } }, select: { id: true, slug: true } });
  const re = new RegExp(`^${escapeRe(base)}(-\\d+)?$`);
  return new Set(rows.filter((r) => r.id !== excludeId && r.slug && re.test(r.slug)).map((r) => r.slug));
}

async function uniqueSlug(kind, text, opts = {}) {
  const base = baseSlug(kind, text);
  return pickFreeSlug(base, await takenSlugs(kind, base, opts));
}

// Guarda (ou move) um slug antigo pro histórico — último dono vence.
async function rememberOldSlug(kind, slug, targetId, { db = defaultDb() } = {}) {
  if (!slug || !db.slugHistory) return;
  try {
    await db.slugHistory.upsert({
      where: { kind_slug: { kind, slug } },
      update: { targetId },
      create: { kind, slug, targetId },
    });
  } catch { /* histórico é só conveniência — nunca derruba a gravação */ }
}

// Define o slug de um registro a partir do nome/título. Se o slug atual já
// "pertence" ao mesmo nome (ex.: chat-geral-2 continua valendo pra "Chat
// geral"), não muda nada. Devolve o slug final.
async function assignSlug(kind, id, text, { db = defaultDb(), current } = {}) {
  const { model } = KINDS[kind];
  const base = baseSlug(kind, text);
  if (current === undefined) {
    const row = await db[model].findUnique({ where: { id }, select: { slug: true } });
    current = row?.slug ?? null;
  }
  if (current && new RegExp(`^${escapeRe(base)}(-\\d+)?$`).test(current)) {
    // Ainda é o mesmo nome — mas confere se ninguém mais pegou o mesmo slug.
    const clash = await db[model].findFirst({ where: { slug: current, NOT: { id } }, select: { id: true } });
    if (!clash) return current;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    // eslint-disable-next-line no-await-in-loop
    const slug = pickFreeSlug(base, await takenSlugs(kind, base, { db, excludeId: id }));
    // eslint-disable-next-line no-await-in-loop
    await db[model].update({ where: { id }, data: { slug } });
    // Corrida rara (dois renomeando ao mesmo tempo): confere e tenta de novo.
    // eslint-disable-next-line no-await-in-loop
    const dupe = await db[model].findFirst({ where: { slug, NOT: { id } }, select: { id: true } });
    if (!dupe) {
      if (current && current !== slug) await rememberOldSlug(kind, current, id, { db });
      return slug;
    }
  }
  return current;
}

// Versão "não derruba nada": usada logo depois de criar/renomear.
async function assignSlugSafe(kind, id, text, opts) {
  try { return await assignSlug(kind, id, text, opts); } catch (e) {
    console.warn(`[slugs] não consegui criar o link de ${kind} ${id}:`, e?.message);
    return null;
  }
}

// Preenche quem ainda não tem slug (lotes de 200). Idempotente.
async function backfillSlugs({ db = defaultDb(), log = console } = {}) {
  let total = 0;
  for (const kind of Object.keys(KINDS)) {
    const { model, field } = KINDS[kind];
    const where = kind === 'conversation' ? { slug: null, isGroup: true } : { slug: null };
    const orderBy = kind === 'channel' ? [{ position: 'asc' }, { id: 'asc' }] : [{ createdAt: 'asc' }, { id: 'asc' }];
    for (let guard = 0; guard < 10000; guard++) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await db[model].findMany({ where, orderBy, take: 200, select: { id: true, [field]: true } });
      if (!rows.length) break;
      for (const r of rows) {
        // eslint-disable-next-line no-await-in-loop
        const s = await assignSlug(kind, r.id, r[field], { db, current: null }).catch(() => null);
        if (s) total++;
      }
      if (rows.length < 200) break;
    }
  }
  if (total) log?.log?.(`[slugs] ${total} link(s) bonito(s) criado(s).`);
  return total;
}

// Acha o id a partir de um slug (atual ou antigo) ou do próprio id.
// Não checa permissão — quem chama decide (ver services/linkResolver.js).
async function findBySlugOrId(kind, ref, { db = defaultDb(), select, where: extraWhere = {} } = {}) {
  const { model } = KINDS[kind];
  const raw = String(ref || '').trim();
  if (!raw || raw.length > 191) return null;
  const s = raw.toLowerCase();
  // Id (UUID) primeiro: o caso mais comum dos links antigos — 1 consulta só.
  if (UUID_RE.test(raw)) {
    const byId = await db[model].findFirst({ where: { ...extraWhere, id: raw }, select });
    if (byId) return byId;
  }
  let row = await db[model].findFirst({ where: { ...extraWhere, slug: s }, select });
  if (row) return row;
  if (!UUID_RE.test(raw) && !/^[a-z0-9-]+$/.test(s)) {
    row = await db[model].findFirst({ where: { ...extraWhere, id: raw }, select });
    if (row) return row;
  }
  if (db.slugHistory) {
    const old = await db.slugHistory.findUnique({ where: { kind_slug: { kind, slug: s } } }).catch(() => null);
    if (old) {
      row = await db[model].findFirst({ where: { ...extraWhere, id: old.targetId }, select });
      if (row) return row;
    }
  }
  // Ids curtos (dados de teste/legado) que não são UUID.
  return db[model].findFirst({ where: { ...extraWhere, id: raw }, select });
}

module.exports = {
  KINDS, UUID_RE, slugify, baseSlug, pickFreeSlug, takenSlugs, uniqueSlug,
  assignSlug, assignSlugSafe, backfillSlugs, findBySlugOrId, rememberOldSlug,
};
