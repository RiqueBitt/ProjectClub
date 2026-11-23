// Pega o cliente na hora (os testes trocam o config/prisma por um falso).
const db = () => require('../config/prisma');

// Instâncias: conjuntos separados de categorias, canais de texto e de voz.
// A Pública é a de sempre (instanceId null no banco) e é de todo mundo.
// As outras são privadas: só entra quem a equipe liberar em
// Painel da Equipe → Instâncias (ADMIN da plataforma entra em todas).
// Canais em destaque, DMs, Loja etc. são iguais em todas.

const PUBLIC_ID = 'publica';
const PUBLIC_INSTANCE = { id: PUBLIC_ID, name: 'Pública', icon: '🌎', position: 0, isPublic: true };

// Criadas sozinhas no boot (se ainda não existirem). Depois a equipe pode
// renomear, criar outras ou apagar pelo painel.
const DEFAULT_INSTANCES = [
  { id: 'amigos', name: 'Amigos', icon: '🤝', position: 1 },
  { id: 'empresarial', name: 'Empresarial', icon: '💼', position: 2 },
  // BLACKOUT: além dos canais próprios, abre o compêndio do RPG (routes/blackoutSite.js).
  { id: 'blackout', name: 'BLACKOUT', icon: '🎲', position: 3 },
];

// Membros de todas as instâncias numa tacada só, em memória por alguns
// segundos: a checagem roda em toda ação de canal (getEffectivePermissions).
const CACHE_MS = 15_000;
let cache = null; // { at, instances: [...], members: Map(instanceId -> Set(userId)) }

async function load() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  const [instances, rows] = await Promise.all([
    db().instance.findMany({ orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
    db().instanceMember.findMany({ select: { instanceId: true, userId: true } }),
  ]);
  const members = new Map(instances.map((i) => [i.id, new Set()]));
  for (const r of rows) {
    if (!members.has(r.instanceId)) members.set(r.instanceId, new Set());
    members.get(r.instanceId).add(r.userId);
  }
  cache = { at: Date.now(), instances, members };
  return cache;
}

function invalidate() { cache = null; }

/** null/'' /'publica' → null (Pública); qualquer outro id fica como está. */
function normalizeId(id) {
  if (id === undefined || id === null) return null;
  const s = String(id).trim().toLowerCase();
  return !s || s === PUBLIC_ID ? null : s;
}

/**
 * A pessoa pode ver/entrar nessa instância? `user` precisa ter
 * { id, platformRole }. Instância que não existe mais = ninguém
 * (os canais dela ficam escondidos até a equipe mover ou apagar).
 */
async function canAccess(user, instanceId) {
  const id = normalizeId(instanceId);
  if (!id) return true;
  if (!user) return false;
  const c = await load();
  if (!c.members.has(id)) return false;
  if (user.platformRole === 'ADMIN') return true;
  return c.members.get(id).has(user.id);
}

/** Versão síncrona pra quem já chamou load() (laços com muitos canais). */
function canAccessLoaded(c, user, instanceId) {
  const id = normalizeId(instanceId);
  if (!id) return true;
  if (!user || !c.members.has(id)) return false;
  return user.platformRole === 'ADMIN' || c.members.get(id).has(user.id);
}

/** Instâncias que a pessoa pode usar (a Pública sempre primeiro). */
async function listForUser(user) {
  const c = await load();
  return [
    PUBLIC_INSTANCE,
    ...c.instances
      .filter((i) => canAccessLoaded(c, user, i.id))
      .map((i) => ({ id: i.id, name: i.name, icon: i.icon || null, position: i.position, isPublic: false })),
  ];
}

/** Instância atual da pessoa (cai pra Pública se perdeu o acesso). */
async function currentFor(user) {
  if (!user) return null;
  const pref = await db().userInstancePref.findUnique({ where: { userId: user.id } }).catch(() => null);
  const id = normalizeId(pref?.instanceId);
  if (!id) return null;
  return (await canAccess(user, id)) ? id : null;
}

async function setCurrent(user, instanceId) {
  const id = normalizeId(instanceId);
  if (id && !(await canAccess(user, id))) {
    const err = new Error('Você não tem acesso a essa instância.');
    err.status = 403;
    throw err;
  }
  if (!id) await db().userInstancePref.deleteMany({ where: { userId: user.id } });
  else {
    await db().userInstancePref.upsert({
      where: { userId: user.id }, update: { instanceId: id }, create: { userId: user.id, instanceId: id },
    });
  }
  return id;
}

/** Cria as instâncias padrão que ainda não existem (roda no boot). */
async function seedDefaultInstances() {
  try {
    await db().instance.createMany({ data: DEFAULT_INSTANCES, skipDuplicates: true });
    invalidate();
  } catch (err) {
    console.warn('[instances] não deu pra criar as instâncias padrão:', err.message);
  }
}

/** Gera um id de instância a partir do nome ("Time de Design" → "time-de-design"). */
function slugify(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

module.exports = {
  PUBLIC_ID, PUBLIC_INSTANCE, DEFAULT_INSTANCES,
  load, invalidate, normalizeId, canAccess, canAccessLoaded, listForUser, currentFor, setCurrent,
  seedDefaultInstances, slugify,
};
