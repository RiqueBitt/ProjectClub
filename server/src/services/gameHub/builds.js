// Game Hub → Builds. Cada jogo tem o seu formato, conferido aqui antes de
// salvar (só ids/textos no tamanho certo — nada de HTML):
//  - lol: campeão, rota, runas (árvore principal + pedra angular, árvore
//    secundária), 2 feitiços, itens iniciais / principais / situacionais e a
//    ordem de habilidades (até 18 níveis, Q W E R);
//  - deadlock: herói, itens por fase (começo, meio, fim) e a prioridade das
//    4 habilidades;
//  - darktide: classe, armas, bênçãos, talentos e 3 curios (texto);
//  - outro: qualquer jogo — personagem, itens e habilidades em texto.
const getPrisma = () => require('../../config/prisma');
const { gameKeyFor } = require('../../utils/gameKeys');
const { DARKTIDE_CLASSES } = require('./gameData');

const GAMES = ['lol', 'deadlock', 'darktide', 'outro'];
const LOL_ROLES = ['top', 'jungle', 'mid', 'adc', 'support'];
const USER_SELECT = { id: true, displayName: true, username: true, avatarUrl: true };
const PAGE = 24;

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
const isStaff = (user) => ['ADMIN', 'MODERATOR'].includes(user?.platformRole);
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);
// Campo de uma linha só (título, arma, item…).
const line = (v, max) => clean(String(v ?? '').replace(/\s+/g, ' '), max);
const ids = (v, re, max) => [...new Set((Array.isArray(v) ? v : []).map(String).filter((x) => re.test(x)))].slice(0, max);
const ints = (v, max) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter((x) => Number.isInteger(x) && x > 0))].slice(0, max);

function validateData(game, d = {}) {
  if (game === 'lol') {
    const champion = String(d.champion || '');
    if (!/^[A-Za-z0-9]{2,30}$/.test(champion)) throw httpError(400, 'Escolha o campeão.');
    const role = LOL_ROLES.includes(d.role) ? d.role : null;
    const ITEM = /^\d{3,6}$/;
    const skills = String(d.skills || '').toUpperCase().replace(/[^QWER]/g, '').slice(0, 18);
    return {
      hero: champion, role,
      data: {
        champion, role,
        primaryTree: Number.isInteger(Number(d.primaryTree)) ? Number(d.primaryTree) : null,
        keystone: Number.isInteger(Number(d.keystone)) ? Number(d.keystone) : null,
        secondaryTree: Number.isInteger(Number(d.secondaryTree)) && Number(d.secondaryTree) !== Number(d.primaryTree) ? Number(d.secondaryTree) : null,
        spells: ids(d.spells, /^Summoner[A-Za-z0-9_]{2,30}$/, 2),
        start: ids(d.start, ITEM, 4), core: ids(d.core, ITEM, 6), situational: ids(d.situational, ITEM, 6),
        skills,
      },
    };
  }
  if (game === 'deadlock') {
    const hero = Number(d.hero);
    if (!Number.isInteger(hero) || hero <= 0) throw httpError(400, 'Escolha o herói.');
    const order = ints(d.abilityOrder, 4).filter((n) => n >= 1 && n <= 4);
    return {
      hero: String(hero), role: null,
      data: { hero, early: ints(d.early, 8), mid: ints(d.mid, 8), late: ints(d.late, 10), abilityOrder: order },
    };
  }
  if (game === 'darktide') {
    const klass = DARKTIDE_CLASSES.find((c) => c.id === d.klass);
    if (!klass) throw httpError(400, 'Escolha a classe.');
    const curios = (Array.isArray(d.curios) ? d.curios : []).slice(0, 3).map((c) => line(c, 80));
    return {
      hero: klass.id, heroName: klass.name, role: null,
      data: { klass: klass.id, melee: line(d.melee, 80), ranged: line(d.ranged, 80), blessings: clean(d.blessings, 400), talents: clean(d.talents, 800), curios },
    };
  }
  // outro
  const character = line(d.character, 80);
  const items = (Array.isArray(d.items) ? d.items : []).map((x) => line(x, 60)).filter(Boolean).slice(0, 12);
  return { hero: character ? gameKeyFor(character).slice(0, 80) || null : null, heroName: character || null, role: null, data: { character, items, abilities: clean(d.abilities, 800) } };
}

function parseInput(body = {}) {
  const game = GAMES.includes(body.game) ? body.game : null;
  if (!game) throw httpError(400, 'Escolha o jogo da build.');
  const title = line(body.title, 80);
  if (title.length < 3) throw httpError(400, 'Dê um nome pra build (3 letras ou mais).');
  const v = validateData(game, body.data || {});
  let gameName = null; let gameKey = null; let steamAppId = null;
  if (game === 'outro') {
    gameName = line(body.gameName || body.game_name, 100);
    if (!gameName) throw httpError(400, 'Diga de qual jogo é a build.');
    gameKey = gameKeyFor(gameName) || null;
    const appId = Number(body.steamAppId);
    steamAppId = Number.isInteger(appId) && appId > 0 ? appId : null;
  }
  return {
    game, title, gameName, gameKey, steamAppId,
    hero: v.hero, heroName: line(v.heroName || body.heroName, 80) || null, role: v.role,
    data: JSON.stringify(v.data), notes: clean(String(body.notes || '').replace(/\r/g, ''), 4000) || null,
  };
}

function shapeBuild(b, viewerId, { full = false } = {}) {
  let data = {};
  try { data = JSON.parse(b.data || '{}'); } catch { data = {}; }
  return {
    id: b.id, game: b.game, title: b.title, hero: b.hero, heroName: b.heroName, role: b.role,
    gameInfo: b.gameName ? { key: b.gameKey, name: b.gameName, steamAppId: b.steamAppId } : null,
    data, notes: full ? b.notes : undefined, author: b.author || null,
    likesCount: b.likesCount, liked: !!(b.likes && b.likes.some((l) => l.userId === viewerId)),
    mine: b.authorId === viewerId, createdAt: b.createdAt, updatedAt: b.updatedAt,
  };
}

const include = (viewerId) => ({ author: { select: USER_SELECT }, likes: { where: { userId: viewerId }, select: { userId: true } } });

async function list(viewerId, { db = getPrisma(), game = null, hero = null, sort = 'top', mine = false, q = '', skip = 0 } = {}) {
  const where = {
    ...(GAMES.includes(game) ? { game } : {}),
    ...(hero ? { hero: String(hero).slice(0, 80) } : {}),
    ...(mine ? { authorId: viewerId } : {}),
    ...(q ? { OR: [{ title: { contains: String(q).slice(0, 60) } }, { heroName: { contains: String(q).slice(0, 60) } }, { gameName: { contains: String(q).slice(0, 60) } }] } : {}),
  };
  const rows = await db.gameBuild.findMany({
    where, take: PAGE, skip: Math.max(0, Math.min(500, Number(skip) || 0)),
    orderBy: sort === 'new' ? [{ createdAt: 'desc' }] : [{ likesCount: 'desc' }, { createdAt: 'desc' }],
    include: include(viewerId),
  });
  return { builds: rows.map((b) => shapeBuild(b, viewerId)), more: rows.length === PAGE };
}

async function get(viewerId, id, { db = getPrisma() } = {}) {
  const b = await db.gameBuild.findUnique({ where: { id: String(id) }, include: include(viewerId) });
  if (!b) throw httpError(404, 'Build não encontrada.');
  return shapeBuild(b, viewerId, { full: true });
}

async function create(user, body, { db = getPrisma() } = {}) {
  const data = parseInput(body);
  const b = await db.gameBuild.create({ data: { ...data, authorId: user.id }, include: include(user.id) });
  return shapeBuild(b, user.id, { full: true });
}

async function update(user, id, body, { db = getPrisma() } = {}) {
  const b = await db.gameBuild.findUnique({ where: { id: String(id) }, select: { id: true, authorId: true, game: true } });
  if (!b) throw httpError(404, 'Build não encontrada.');
  if (b.authorId !== user.id) throw httpError(403, 'Só quem criou pode editar.');
  const data = parseInput({ ...body, game: b.game });
  const saved = await db.gameBuild.update({ where: { id: b.id }, data, include: include(user.id) });
  return shapeBuild(saved, user.id, { full: true });
}

async function remove(user, id, { db = getPrisma() } = {}) {
  const b = await db.gameBuild.findUnique({ where: { id: String(id) }, select: { id: true, authorId: true } });
  if (!b) throw httpError(404, 'Build não encontrada.');
  if (b.authorId !== user.id && !isStaff(user)) throw httpError(403, 'Só quem criou pode apagar.');
  await db.gameBuild.delete({ where: { id: b.id } });
  return { ok: true };
}

async function toggleLike(user, id, { db = getPrisma() } = {}) {
  const b = await db.gameBuild.findUnique({ where: { id: String(id) }, select: { id: true } });
  if (!b) throw httpError(404, 'Build não encontrada.');
  const had = await db.gameBuildLike.findUnique({ where: { buildId_userId: { buildId: b.id, userId: user.id } } });
  if (had) {
    await db.$transaction([db.gameBuildLike.delete({ where: { id: had.id } }), db.gameBuild.update({ where: { id: b.id }, data: { likesCount: { decrement: 1 } } })]);
  } else {
    await db.$transaction([db.gameBuildLike.create({ data: { buildId: b.id, userId: user.id } }), db.gameBuild.update({ where: { id: b.id }, data: { likesCount: { increment: 1 } } })]);
  }
  const now = await db.gameBuild.findUnique({ where: { id: b.id }, select: { likesCount: true } });
  return { liked: !had, likesCount: Math.max(0, now?.likesCount || 0) };
}

module.exports = { GAMES, LOL_ROLES, parseInput, validateData, shapeBuild, list, get, create, update, remove, toggleLike };
