// Links bonitos (/canal/chat-geral em vez de /channels/<uuid>): slugify,
// unicidade (-2, -3), histórico de slug ao renomear, backfill idempotente e
// resolver com a MESMA regra de acesso dos ids (canal privado / grupo de que
// a pessoa não participa = "não encontrado"). Banco falso em memória.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const slugs = require('../src/services/slugs');
const links = require('../src/services/linkResolver');

// ---------- banco falso (só o que os serviços usam) ----------
function matches(row, where = {}) {
  for (const [k, v] of Object.entries(where)) {
    if (k === 'NOT') { if (matches(row, v)) return false; continue; }
    if (k === 'AND') { if (!v.every((w) => matches(row, w))) return false; continue; }
    if (k === 'members') { if (!(row.members || []).some((m) => matches(m, v.some))) return false; continue; }
    const val = row[k];
    if (v && typeof v === 'object' && 'startsWith' in v) { if (!(typeof val === 'string' && val.startsWith(v.startsWith))) return false; continue; }
    // username no MySQL é _ci (sem diferenciar maiúsculas).
    if (k === 'username' && typeof val === 'string' && typeof v === 'string') { if (val.toLowerCase() !== v.toLowerCase()) return false; continue; }
    if ((val ?? null) !== (v ?? null)) return false;
  }
  return true;
}
function table(rows) {
  return {
    rows,
    async findMany({ where, take } = {}) { const r = rows.filter((x) => matches(x, where)); return take ? r.slice(0, take) : r; },
    async findFirst({ where } = {}) { return rows.find((x) => matches(x, where)) || null; },
    async findUnique({ where }) {
      if (where.kind_slug) return rows.find((x) => x.kind === where.kind_slug.kind && x.slug === where.kind_slug.slug) || null;
      return rows.find((x) => matches(x, where)) || null;
    },
    async update({ where, data }) { const r = rows.find((x) => matches(x, where)); Object.assign(r, data); return r; },
    async upsert({ where, update, create }) {
      const r = await this.findUnique({ where });
      if (r) { Object.assign(r, update); return r; }
      rows.push({ ...create }); return create;
    },
  };
}
function makeDb() {
  return {
    channel: table([
      { id: 'c-1', name: '🌎 | Chat geral', position: 0, isPrivate: false, slug: null },
      { id: 'c-2', name: 'Chat Geral!', position: 1, isPrivate: false, slug: null },
      { id: 'c-3', name: '🔒 staff', position: 2, isPrivate: true, slug: null },
      { id: 'c-4', name: '☕', position: 3, isPrivate: false, slug: null },
    ]),
    event: table([
      { id: 'e-1', title: 'Noite de Jogos', createdAt: 1, slug: null },
      { id: 'e-2', title: 'Noite de jogos', createdAt: 2, slug: null },
    ]),
    post: table([{ id: 'p-1', title: 'Como instalar mods no Minecraft? (guia)', createdAt: 1, slug: null }]),
    conversation: table([
      { id: 'g-1', isGroup: true, name: 'Amigos do RPG', createdAt: 1, slug: null, members: [{ userId: 'u-ana', user: { username: 'ana' } }, { userId: 'u-bia', user: { username: 'Bia.x' } }] },
      { id: 'd-1', isGroup: false, name: null, createdAt: 2, slug: null, members: [{ userId: 'u-ana', user: { username: 'ana' } }, { userId: 'u-bia', user: { username: 'Bia.x' } }] },
    ]),
    user: table([
      { id: 'u-ana', username: 'ana', publicId: null },
      { id: 'u-bia', username: 'Bia.x', publicId: null },
      { id: 'u-caio', username: 'caio', publicId: null },
    ]),
    slugHistory: table([]),
  };
}
const deps = (db, { private: priv = new Set(['c-3']) } = {}) => ({
  db,
  // Só a Ana vê o canal privado.
  canViewChannel: async (userId, ch) => !priv.has(ch.id) || userId === 'u-ana',
});

// ---------- slugify ----------
test('slugify: minúsculas, sem acento/emoji/símbolo, espaço vira hífen', () => {
  assert.equal(slugs.slugify('Chat geral'), 'chat-geral');
  assert.equal(slugs.slugify('🌎 | Chat Geral!'), 'chat-geral');
  assert.equal(slugs.slugify('  Ação & Reação — 2ª edição  '), 'acao-reacao-2a-edicao');
  assert.equal(slugs.slugify('ÇÃÕ ñ ü ß'), 'cao-n-u-ss');
  assert.equal(slugs.slugify('☕🎮'), '');
  assert.equal(slugs.slugify(null), '');
  const long = slugs.slugify('palavra '.repeat(30));
  assert.ok(long.length <= 60 && !long.endsWith('-') && long.startsWith('palavra-palavra'));
});

test('baseSlug: nome só de emoji usa um padrão; grupo sempre começa com grupo-', () => {
  assert.equal(slugs.baseSlug('channel', '☕'), 'canal');
  assert.equal(slugs.baseSlug('conversation', 'Amigos do RPG'), 'grupo-amigos-do-rpg');
  assert.equal(slugs.baseSlug('conversation', '🎲'), 'grupo');
  assert.equal(slugs.pickFreeSlug('a', new Set(['a', 'a-2'])), 'a-3');
});

// ---------- unicidade + backfill ----------
test('backfill: preenche todo mundo, repetido ganha -2 e rodar de novo não muda nada', async () => {
  const db = makeDb();
  const n = await slugs.backfillSlugs({ db, log: null });
  assert.equal(n, 4 + 2 + 1 + 1, '4 canais, 2 eventos, 1 post, 1 grupo (DM 1:1 fica sem slug: usa o @)');
  assert.deepEqual(db.channel.rows.map((c) => c.slug), ['chat-geral', 'chat-geral-2', 'staff', 'canal']);
  assert.deepEqual(db.event.rows.map((e) => e.slug), ['noite-de-jogos', 'noite-de-jogos-2']);
  assert.equal(db.post.rows[0].slug, 'como-instalar-mods-no-minecraft-guia');
  assert.equal(db.conversation.rows[0].slug, 'grupo-amigos-do-rpg');
  assert.equal(db.conversation.rows[1].slug, null);
  const before = JSON.stringify(db);
  assert.equal(await slugs.backfillSlugs({ db, log: null }), 0);
  assert.equal(JSON.stringify(db), before, 'idempotente');
});

test('renomear: slug novo, antigo vai pro histórico e continua resolvendo', async () => {
  const db = makeDb();
  await slugs.backfillSlugs({ db, log: null });
  const ch = db.channel.rows[0];
  // Mesmo nome (só mudou emoji/maiúscula): mantém o slug.
  db.channel.rows[0].name = 'Chat GERAL';
  assert.equal(await slugs.assignSlug('channel', 'c-1', ch.name, { db }), 'chat-geral');
  assert.equal(db.slugHistory.rows.length, 0);
  // Nome novo: slug novo + histórico.
  ch.name = 'Bate-papo';
  assert.equal(await slugs.assignSlug('channel', 'c-1', ch.name, { db }), 'bate-papo');
  assert.deepEqual(db.slugHistory.rows.map((r) => [r.kind, r.slug, r.targetId]), [['channel', 'chat-geral', 'c-1']]);
  assert.equal((await slugs.findBySlugOrId('channel', 'chat-geral', { db })).id, 'c-1', 'link velho ainda abre');
  assert.equal((await slugs.findBySlugOrId('channel', 'bate-papo', { db })).id, 'c-1');
  // Outro canal pegando o nome livre: slug atual vence o histórico.
  db.channel.rows[1].name = 'Chat geral';
  assert.equal(await slugs.assignSlug('channel', 'c-2', 'Chat geral', { db }), 'chat-geral-2', 'continua -2 (ainda é o mesmo nome)');
  assert.equal(await slugs.assignSlug('channel', 'c-4', 'Chat geral', { db }), 'chat-geral', 'base livre de novo');
  assert.equal((await slugs.findBySlugOrId('channel', 'chat-geral', { db })).id, 'c-4');
});

// ---------- resolver (com permissão) ----------
test('resolver: canal por slug e por id antigo → endereço bonito', async () => {
  const db = makeDb();
  await slugs.backfillSlugs({ db, log: null });
  const a = await links.resolveLink({ path: '/canal/chat-geral', userId: 'u-bia' }, deps(db));
  assert.equal(a.id, 'c-1');
  assert.equal(a.path, '/canal/chat-geral');
  const old = await links.resolveLink({ path: '/channels/c-2?m=123', userId: 'u-bia' }, deps(db));
  assert.equal(old.path, '/canal/chat-geral-2');
  assert.equal(await links.resolveLink({ path: '/canal/nao-existe', userId: 'u-bia' }, deps(db)), null);
});

test('resolver: canal privado não vaza nem por slug nem por id', async () => {
  const db = makeDb();
  await slugs.backfillSlugs({ db, log: null });
  assert.equal(await links.resolveLink({ path: '/canal/staff', userId: 'u-bia' }, deps(db)), null);
  assert.equal(await links.resolveLink({ path: '/channels/c-3', userId: 'u-bia' }, deps(db)), null);
  assert.equal((await links.resolveLink({ path: '/canal/staff', userId: 'u-ana' }, deps(db))).id, 'c-3');
});

test('resolver: DM 1:1 pelo @, grupo pelo slug só pra membro', async () => {
  const db = makeDb();
  await slugs.backfillSlugs({ db, log: null });
  const dm = await links.resolveLink({ path: '/dm/BIA.X', userId: 'u-ana' }, deps(db));
  assert.equal(dm.id, 'd-1');
  assert.equal(dm.path, '/dm/bia.x');
  // Conversa antiga por id: vira o @ da OUTRA pessoa (quem abre é a Bia).
  assert.equal((await links.resolveLink({ path: '/conversations/d-1', userId: 'u-bia' }, deps(db))).path, '/dm/ana');
  // Ainda sem conversa com o Caio: devolve a pessoa (o site abre uma DM nova).
  const novo = await links.resolveLink({ path: '/dm/caio', userId: 'u-ana' }, deps(db));
  assert.equal(novo.id, null);
  assert.equal(novo.userId, 'u-caio');
  const g = await links.resolveLink({ path: '/dm/grupo-amigos-do-rpg', userId: 'u-bia' }, deps(db));
  assert.equal(g.id, 'g-1');
  assert.equal(g.path, '/dm/grupo-amigos-do-rpg');
  assert.equal(await links.resolveLink({ path: '/dm/grupo-amigos-do-rpg', userId: 'u-caio' }, deps(db)), null, 'quem não é do grupo');
  assert.equal(await links.resolveLink({ path: '/conversations/g-1', userId: 'u-caio' }, deps(db)), null);
});

test('resolver: perfil/biblioteca pelo @, evento e post pelo título (ou id antigo)', async () => {
  const db = makeDb();
  await slugs.backfillSlugs({ db, log: null });
  assert.equal((await links.resolveLink({ path: '/u/u-bia', userId: 'u-ana' }, deps(db))).path, '/perfil/bia.x');
  assert.equal((await links.resolveLink({ path: '/perfil/Bia.X', userId: 'u-ana' }, deps(db))).id, 'u-bia');
  assert.equal((await links.resolveLink({ path: '/jogos/biblioteca/u-caio', userId: 'u-ana' }, deps(db))).path, '/jogos/biblioteca/caio');
  assert.equal((await links.resolveLink({ path: '/eventos/e-2', userId: 'u-ana' }, deps(db))).path, '/evento/noite-de-jogos-2');
  assert.equal((await links.resolveLink({ path: '/evento/noite-de-jogos', userId: 'u-ana' }, deps(db))).id, 'e-1');
  assert.equal((await links.resolveLink({ path: '/posts/p-1', userId: 'u-ana' }, deps(db))).path, '/forum/como-instalar-mods-no-minecraft-guia');
  assert.equal(await links.resolveLink({ path: '/loja', userId: 'u-ana' }, deps(db)), null);
  assert.equal(await links.resolveLink({ path: '/canal/x', userId: null }, deps(db)), null, 'sem login');
});

test('montar links do servidor (avisos/push)', () => {
  assert.equal(links.channelPath({ id: 'c-1', slug: 'chat-geral' }), '/canal/chat-geral');
  assert.equal(links.channelPath({ id: 'c-1' }), '/canal/c-1', 'sem slug ainda: id (o site troca)');
  assert.equal(links.conversationPath({ id: 'd', isGroup: false }, { otherUsername: 'Ana' }), '/dm/ana');
  assert.equal(links.conversationPath({ id: 'g', isGroup: true, slug: 'grupo-x' }), '/dm/grupo-x');
  assert.equal(links.userPath({ id: 'u', username: 'Holanda' }), '/perfil/holanda');
  assert.equal(links.eventPath({ id: 'e', slug: 'torneio' }), '/evento/torneio');
  assert.equal(links.postPath({ id: 'p' }), '/forum/p');
  assert.deepEqual(links.parseAppPath('/canal/chat-geral?m=1'), { kind: 'channel', ref: 'chat-geral', legacy: false });
  assert.equal(links.parseAppPath('/channels/a/b'), null);
});
