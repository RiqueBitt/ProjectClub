const prisma = require('../config/prisma');
const { SELF_USER_FIELDS } = require('./authController');

// Extras do perfil completo (igual ao Discord): Mural com widgets, Lista
// de desejos da Loja, Atividade dos últimos 30 dias, insígnias de
// estatística e Nota pessoal. Tudo numa chamada só (GET /users/:id/extras),
// respeitando a privacidade de quem é dono do perfil.

const LEVELS = ['Iniciante', 'Casual', 'Intermediário', 'Avançado', 'Profissional'];
const FEELINGS = ['Curtindo muito', 'Meio que amo isso', 'Viciado', 'Só relaxando', 'Voltando agora', 'Odeio que amo'];
const TAGS = ['Procurando grupo', 'Competitivo', 'Cooperativo', 'Ranqueada', 'História', 'Speedrun', 'Completando 100%',
  'Modding', 'Streamando', 'Construindo', 'Explorando', 'PvP', 'PvE', 'Sobrevivência', 'Roleplay'];
const WIDGET_KEYS = ['favorite', 'rotation', 'liked', 'want'];
const LIMITS = { liked: 20, rotation: 5, want: 20 };

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function cleanGame(g) {
  if (!g || typeof g !== 'object') return null;
  const gameKey = str(g.gameKey, 64);
  const name = str(g.name, 100);
  if (!gameKey || !name) return null;
  const out = { gameKey, name };
  if (g.steamAppId != null && /^\d{1,12}$/.test(String(g.steamAppId))) out.steamAppId = String(g.steamAppId);
  if (typeof g.iconUrl === 'string' && g.iconUrl.length <= 500 && /^(https?:\/\/|\/)/i.test(g.iconUrl)) out.iconUrl = g.iconUrl;
  return out;
}
const cleanTags = (v, max) => [...new Set((Array.isArray(v) ? v : []).filter((t) => TAGS.includes(t)))].slice(0, max);
function uniqueGames(list, max, extra) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const g = cleanGame(raw);
    if (!g || seen.has(g.gameKey)) continue;
    seen.add(g.gameKey);
    out.push(extra ? { ...g, ...extra(raw) } : g);
    if (out.length >= max) break;
  }
  return out;
}

// Só campos conhecidos, tamanhos travados — nunca grava um objeto cru.
function sanitizeWidgets(raw) {
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = {};
  const fav = v.favorite && cleanGame(v.favorite);
  if (fav) out.favorite = { ...fav, comment: str(v.favorite.comment, 190), tags: cleanTags(v.favorite.tags, 5) };
  out.rotation = uniqueGames(v.rotation, LIMITS.rotation, (r) => ({
    level: LEVELS.includes(r.level) ? r.level : null,
    feeling: FEELINGS.includes(r.feeling) ? r.feeling : null,
    tags: cleanTags(r.tags, 3),
  }));
  out.liked = uniqueGames(v.liked, LIMITS.liked);
  out.want = uniqueGames(v.want, LIMITS.want);
  const order = (Array.isArray(v.order) ? v.order : []).filter((k) => WIDGET_KEYS.includes(k));
  out.order = [...new Set([...order, ...WIDGET_KEYS])];
  const hidden = (Array.isArray(v.hidden) ? v.hidden : []).filter((k) => WIDGET_KEYS.includes(k));
  out.hidden = [...new Set(hidden)];
  const empty = !out.favorite && !out.rotation.length && !out.liked.length && !out.want.length && !out.hidden.length
    && out.order.join() === WIDGET_KEYS.join();
  return empty ? null : JSON.stringify(out);
}
const parse = (raw, fallback) => { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };

// ---------- Insígnias de estatística ----------
// Calculadas na hora (nada salvo): sobem de nível sozinhas.
const STAT_TIERS = {
  age: { label: 'Idade da conta', icon: 'crown', steps: [0, 1, 6, 12, 24, 48], names: ['Recém-chegado', 'Broto', 'Raiz', 'Tronco', 'Árvore antiga', 'Floresta'] },
  variety: { label: 'Variedade de jogos', icon: 'grid', steps: [1, 5, 15, 30, 50, 100], names: ['Curioso', 'Explorador', 'Navegante', 'Aventureiro', 'Colecionador', 'Enciclopédia'] },
  playtime: { label: 'Tempo de jogo', icon: 'clock', steps: [1, 10, 50, 200, 500, 1000], names: ['Iniciante', 'Jogador', 'Dedicado', 'Veterano', 'Lendário', 'Imortal'] },
  gifts: { label: 'Presentes', icon: 'gift', steps: [1, 2, 3, 6, 10, 20], names: ['Generoso', 'Mão aberta', 'Benfeitor', 'Patrono', 'Mecenas', 'Lenda dos presentes'] },
  ups: { label: 'Ups recebidos', icon: 'heart', steps: [10, 50, 150, 500, 1500, 5000], names: ['Notado', 'Querido', 'Popular', 'Famoso', 'Ídolo', 'Ícone'] },
};
function tierFor(key, value) {
  const t = STAT_TIERS[key];
  let level = 0;
  t.steps.forEach((s, i) => { if (value >= s) level = i + 1; });
  if (!level) return null;
  const next = t.steps[level] ?? null;
  return { key, label: t.label, icon: t.icon, level, name: t.names[level - 1], value, next, nextName: next != null ? t.names[level] : null };
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function describeStat(b) {
  if (!b) return b;
  const v = b.value;
  const text = {
    age: v >= 12 ? `${plural(Math.floor(v / 12), 'ano', 'anos')}${v % 12 ? `, ${plural(v % 12, 'mês', 'meses')}` : ''}` : plural(v, 'mês', 'meses'),
    variety: `${plural(v, 'jogo jogado', 'jogos jogados')}`,
    playtime: `${plural(v, 'hora de jogo', 'horas de jogo')}`,
    gifts: `${plural(v, 'presente dado', 'presentes dados')}`,
    ups: `${plural(v, 'up recebido', 'ups recebidos')}`,
  }[b.key];
  return { ...b, text };
}

async function giftsGiven(userId) {
  return prisma.economyTransaction.count({ where: { userId, kind: 'GIFT' } }).catch(() => 0);
}

async function statBadges(user) {
  const months = Math.max(0, Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (30.44 * 86400000)));
  const [variety, play, gifts, ups] = await Promise.all([
    prisma.gamePlaytime.count({ where: { userId: user.id } }).catch(() => 0),
    prisma.gamePlaytime.aggregate({ where: { userId: user.id }, _sum: { totalSeconds: true } }).catch(() => null),
    giftsGiven(user.id),
    Promise.all([
      prisma.profileVote.count({ where: { toUserId: user.id, value: 1 } }).catch(() => 0),
      prisma.postVote.count({ where: { value: 1, post: { authorId: user.id } } }).catch(() => 0),
    ]).then(([a, b]) => a + b),
  ]);
  const hours = Math.floor((play?._sum?.totalSeconds || 0) / 3600);
  return [
    tierFor('age', months) || { ...tierFor('age', 0), level: 1 },
    tierFor('variety', variety), tierFor('playtime', hours), tierFor('gifts', gifts), tierFor('ups', ups),
  ].filter(Boolean).map(describeStat);
}

// ---------- Atividade dos últimos 30 dias ----------
const dayStr = (d) => d.toISOString().slice(0, 10);
async function recentActivity(userId) {
  const cutoff = dayStr(new Date(Date.now() - 30 * 86400000));
  const days = await prisma.gamePlayDay.findMany({ where: { userId, day: { gte: cutoff } }, select: { gameKey: true, day: true, seconds: true } });
  if (!days.length) return [];
  const byGame = new Map();
  for (const d of days) {
    const g = byGame.get(d.gameKey) || { gameKey: d.gameKey, seconds: 0, firstDay: d.day, lastDay: d.day, days: 0 };
    g.seconds += d.seconds; g.days += 1;
    if (d.day < g.firstDay) g.firstDay = d.day;
    if (d.day > g.lastDay) g.lastDay = d.day;
    byGame.set(d.gameKey, g);
  }
  const keys = [...byGame.keys()];
  const [meta, before] = await Promise.all([
    prisma.gamePlaytime.findMany({ where: { userId, gameKey: { in: keys } }, select: { gameKey: true, name: true, iconUrl: true, steamAppId: true, firstPlayedAt: true } }),
    prisma.gamePlayDay.groupBy({ by: ['gameKey'], where: { userId, gameKey: { in: keys }, day: { lt: cutoff } }, _max: { day: true } }).catch(() => []),
  ]);
  const metaBy = Object.fromEntries(meta.map((m) => [m.gameKey, m]));
  const prevBy = Object.fromEntries(before.map((b) => [b.gameKey, b._max?.day]));
  return [...byGame.values()].map((g) => {
    const m = metaBy[g.gameKey];
    if (!m) return null;
    let tag = null;
    const prev = prevBy[g.gameKey];
    if (!prev && m.firstPlayedAt && dayStr(new Date(m.firstPlayedAt)) >= cutoff) tag = 'Novo jogador';
    else if (prev) {
      const gap = Math.round((new Date(g.firstDay) - new Date(prev)) / 86400000);
      if (gap >= 45) tag = `Retornando após ${Math.max(1, Math.round(gap / 30))} ${Math.round(gap / 30) > 1 ? 'meses' : 'mês'}`;
    }
    return {
      gameKey: g.gameKey, name: m.name, iconUrl: m.iconUrl, steamAppId: m.steamAppId,
      seconds: g.seconds, days: g.days, lastDay: g.lastDay, tag,
    };
  }).filter(Boolean).sort((a, b) => (a.lastDay < b.lastDay ? 1 : a.lastDay > b.lastDay ? -1 : b.seconds - a.seconds)).slice(0, 20);
}

// ---------- Lista de desejos ----------
const WISH_KINDS = ['deco', 'effect', 'font', 'style'];
const WISH_MAX = 30;
function cleanWishlist(raw) {
  const list = parse(raw, []);
  const seen = new Set();
  return (Array.isArray(list) ? list : []).filter((w) => {
    if (!w || !WISH_KINDS.includes(w.kind) || typeof w.id !== 'string' || w.id.length > 64) return false;
    const k = `${w.kind}:${w.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, WISH_MAX).map((w) => ({ kind: w.kind, id: w.id, at: w.at || null }));
}
async function resolveWishlist(list) {
  if (!list.length) return [];
  const ids = (k) => list.filter((w) => w.kind === k).map((w) => w.id);
  const [decos, effects, items] = await Promise.all([
    ids('deco').length ? prisma.avatarDecoration.findMany({ where: { id: { in: ids('deco') } }, select: { id: true, name: true, imageUrl: true, priceCoins: true, priceGems: true, active: true } }) : [],
    ids('effect').length ? prisma.profileEffect.findMany({ where: { id: { in: ids('effect') } }, select: { id: true, name: true, imageUrl: true, priceCoins: true, priceGems: true, active: true } }) : [],
    [...ids('font'), ...ids('style')].length ? prisma.shopItem.findMany({ where: { id: { in: [...ids('font'), ...ids('style')] } }, select: { id: true, kind: true, name: true, previewUrl: true, data: true, priceCoins: true, priceGems: true, active: true } }) : [],
  ]);
  const by = {};
  decos.forEach((d) => { by[`deco:${d.id}`] = { ...d, previewUrl: d.imageUrl }; });
  effects.forEach((e) => { by[`effect:${e.id}`] = { ...e, previewUrl: e.imageUrl }; });
  items.forEach((i) => { by[`${i.kind === 'FONT' ? 'font' : 'style'}:${i.id}`] = { ...i, data: parse(i.data, {}) }; });
  return list.map((w) => {
    const it = by[`${w.kind}:${w.id}`];
    if (!it) return null;
    return {
      kind: w.kind, id: w.id, name: it.name, previewUrl: it.previewUrl || null, data: it.data || null,
      priceCoins: it.priceCoins, priceGems: it.priceGems, available: it.active !== false, at: w.at,
    };
  }).filter(Boolean);
}

async function areFriends(a, b) {
  if (a === b) return true;
  const f = await prisma.friendship.findFirst({
    where: { status: 'ACCEPTED', OR: [{ requesterId: a, addresseeId: b }, { requesterId: b, addresseeId: a }] }, select: { id: true },
  }).catch(() => null);
  return !!f;
}

// GET /users/:id/extras
async function getExtras(req, res, next) {
  try {
    const { id } = req.params;
    const me = req.user.id;
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, createdAt: true, profileWidgets: true, profileWishlist: true } });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const { hasFullProfileAccess, hasActivityAccess } = require('./userController');
    const [full, act, friends] = await Promise.all([
      hasFullProfileAccess(me, id), hasActivityAccess ? hasActivityAccess(me, id) : true, areFriends(me, id),
    ]);
    const [stats, activity, wishlist, note] = await Promise.all([
      statBadges(user),
      act ? recentActivity(id).catch(() => []) : [],
      friends ? resolveWishlist(cleanWishlist(user.profileWishlist)).catch(() => []) : null,
      id !== me ? prisma.userNote.findUnique({ where: { ownerId_targetId: { ownerId: me, targetId: id } } }).catch(() => null) : null,
    ]);
    res.json({
      widgets: full ? parse(user.profileWidgets, null) : null,
      wishlist, // null = não é amigo (lista só pra amigos)
      activity: act ? activity : null,
      stats,
      note: note?.text || '',
      options: { levels: LEVELS, feelings: FEELINGS, tags: TAGS, limits: LIMITS },
    });
  } catch (err) { next(err); }
}

// PUT /users/me/widgets { widgets }
async function setWidgets(req, res, next) {
  try {
    const profileWidgets = sanitizeWidgets(req.body?.widgets);
    const user = await prisma.user.update({ where: { id: req.user.id }, data: { profileWidgets }, select: SELF_USER_FIELDS });
    require('../services/profileUpdates').profileChanged(req, req.user.id).catch(() => {});
    res.json({ user, widgets: parse(profileWidgets, null) });
  } catch (err) { next(err); }
}

// GET /users/me/wishlist  → [{kind,id}]
async function myWishlist(req, res, next) {
  try {
    const u = await prisma.user.findUnique({ where: { id: req.user.id }, select: { profileWishlist: true } });
    const list = cleanWishlist(u?.profileWishlist);
    res.json({ wishlist: list, items: await resolveWishlist(list) });
  } catch (err) { next(err); }
}

// POST /users/me/wishlist { kind, id, on? } — liga/desliga um item.
async function toggleWishlist(req, res, next) {
  try {
    const kind = WISH_KINDS.includes(req.body?.kind) ? req.body.kind : null;
    const id = typeof req.body?.id === 'string' ? req.body.id.slice(0, 64) : null;
    if (!kind || !id) return res.status(400).json({ error: 'Item inválido.' });
    const { findItem } = require('./shopController');
    if (!(await findItem(prisma, kind, id))) return res.status(404).json({ error: 'Item não encontrado.' });
    const u = await prisma.user.findUnique({ where: { id: req.user.id }, select: { profileWishlist: true } });
    let list = cleanWishlist(u?.profileWishlist);
    const has = list.some((w) => w.kind === kind && w.id === id);
    const want = typeof req.body?.on === 'boolean' ? req.body.on : !has;
    if (want && !has) {
      if (list.length >= WISH_MAX) return res.status(400).json({ error: `A lista de desejos aceita até ${WISH_MAX} itens.` });
      list = [{ kind, id, at: new Date().toISOString() }, ...list];
    } else if (!want && has) list = list.filter((w) => !(w.kind === kind && w.id === id));
    await prisma.user.update({ where: { id: req.user.id }, data: { profileWishlist: list.length ? JSON.stringify(list) : null } });
    res.json({ wishlist: list, on: want });
  } catch (err) { next(err); }
}

// PUT /users/:id/note { text } — nota pessoal (só quem escreveu vê).
async function setNote(req, res, next) {
  try {
    const targetId = req.params.id;
    if (targetId === req.user.id) return res.status(400).json({ error: 'Não dá pra escrever nota sobre você mesmo.' });
    const text = str(req.body?.text, 256);
    const where = { ownerId_targetId: { ownerId: req.user.id, targetId } };
    if (!text) {
      await prisma.userNote.deleteMany({ where: { ownerId: req.user.id, targetId } });
      return res.json({ note: '' });
    }
    const exists = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!exists) return res.status(404).json({ error: 'Usuário não encontrado.' });
    await prisma.userNote.upsert({ where, update: { text }, create: { ownerId: req.user.id, targetId, text } });
    res.json({ note: text });
  } catch (err) { next(err); }
}

module.exports = {
  getExtras, setWidgets, myWishlist, toggleWishlist, setNote,
  sanitizeWidgets, tierFor, STAT_TIERS, giftsGiven, describeStat,
};
