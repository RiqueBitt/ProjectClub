'use strict';
// Eventos da Praça (Club Penguin) — pedido do dono, nov/2026, inspirado no que
// os projetos de fãs fazem (Club Penguin Journey, Legacy e Zero):
//
//   - Quests sociais por evento (visitar salas, juntar N pinguins numa sala,
//     vestir um item, ficar online, encontrar um mascote) com recompensa em
//     moedas do Project Club, moeda do evento e itens do jogo.
//   - Moeda do evento (carteira por evento) + loja temporária: itens
//     ORIGINAIS do Club Penguin (os sprites já estão na mídia) trocados pela
//     moeda do evento.
//   - Códigos de desbloqueio (moedas, moeda de evento, itens; usos e validade).
//   - Mascotes com agenda: uma conta "veste" o mascote (Pingu, Rockhopper…);
//     quem estiver na mesma sala durante a visita ganha o fundo de brinde.
//   - Calendário do advento (dezembro) e Coins for Change (doações da
//     comunidade com metas e recompensa coletiva).
//
// Nada aqui mexe nos SWFs: toda arte é a do próprio jogo. A staff cria e
// edita tudo no Painel da Equipe → Club Penguin → Eventos (staffGame.js); o
// jogador vê na janela "Festa" dentro do jogo (client/src/praca/Festa.jsx).
//
// Config de um evento (PlazaEvent.config, JSON):
//   quests: [{ key, title, desc, type: 'visit'|'gather'|'wear'|'online'|'mascot'|'donate',
//              rooms: [id], count: n, items: [id], minutes: n, mascot: 'pingu',
//              reward: { coins, eventCoins, items: [id] } }]
//   shop:   [{ key, label, itemIds: [id], price, limit? }]
//   advent: [{ day: 1..25, coins, eventCoins, items: [id] }]
//   cfc:    { goals: [{ amount, label, items: [id], coins }] }
const prisma = require('../../config/prisma');

const TICK_MS = 15000;
const CACHE_MS = 30000;
const MAX_EVENT_COINS = 1_000_000;

let w = null; // instância do Waddle
let store = null;
let waddle = null; // services/waddle (roomPlayers, onRoomChange, roomOfUser…)
let admin = null;
let io = null;
let tickTimer = null;
let eventsCache = { at: 0, list: [] };
const onlineSince = new Map(); // userId -> ms (pra quest 'online')
const progressCache = new Map(); // `${userId}:${eventId}:${key}` -> { progress, done, data }

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
// salas do jogo: id -> { key, name } (o jogo pula de sala pela chave, ex.: 'town')
let roomIndex = null;
function roomInfo(id) {
  if (!roomIndex) {
    roomIndex = new Map();
    try {
      const { ROOMS } = require('../../../waddle/dist/server/game-data/rooms.js');
      for (const [key, r] of Object.entries(ROOMS)) if (r && r.id) roomIndex.set(Number(r.id), { key, name: r.name });
    } catch { /* sem dist */ }
  }
  return roomIndex.get(Number(id)) || { key: null, name: `Sala ${id}` };
}
const ids = (arr) => (Array.isArray(arr) ? arr.map(Number).filter((n) => Number.isInteger(n) && n > 0) : []);

function parseConfig(ev) {
  let c = {};
  try { c = JSON.parse(ev.config || '{}') || {}; } catch { c = {}; }
  return {
    quests: Array.isArray(c.quests) ? c.quests.filter((q) => q && q.key && q.type) : [],
    shop: Array.isArray(c.shop) ? c.shop.filter((s) => s && s.key) : [],
    advent: Array.isArray(c.advent) ? c.advent.filter((a) => a && a.day >= 1 && a.day <= 25) : [],
    cfc: c.cfc && typeof c.cfc === 'object' ? { goals: Array.isArray(c.cfc.goals) ? c.cfc.goals.filter((g) => g && num(g.amount) > 0) : [] } : null,
    // prêmio por completar TODAS as quests (modelo das Island Quests do CP Legacy)
    completion: c.completion && typeof c.completion === 'object' ? { coins: num(c.completion.coins), eventCoins: num(c.completion.eventCoins), items: ids(c.completion.items), label: String(c.completion.label || '') } : null,
  };
}

// Dificuldade (modelo do CP Legacy): moedas padrão quando a quest não define.
const DIFFICULTY = { facil: 50, media: 120, dificil: 250, extrema: 500 };
const DIFF_KEYS = Object.keys(DIFFICULTY);
const DANCE_FRAMES = [26]; // frame 26 = dançando (tecla D)
const COMPLETION_KEY = '__completion';

async function activeEvents(force = false) {
  const now = Date.now();
  if (!force && now - eventsCache.at < CACHE_MS) return eventsCache.list;
  const d = new Date();
  const rows = await prisma.plazaEvent.findMany({ where: { active: true, startsAt: { lte: d }, endsAt: { gte: d } }, orderBy: { startsAt: 'desc' } }).catch(() => []);
  eventsCache = { at: now, list: rows.map((r) => ({ ...r, cfg: parseConfig(r) })) };
  return eventsCache.list;
}
const invalidate = () => { eventsCache.at = 0; };

// ---------------------------------------------------------------------------
// Progresso das quests
// ---------------------------------------------------------------------------
function pkey(userId, eventId, key) { return `${userId}:${eventId}:${key}`; }

async function loadProgress(userId, eventId) {
  const rows = await prisma.plazaQuestProgress.findMany({ where: { userId, eventId } });
  const out = new Map();
  for (const r of rows) {
    let data = null;
    try { data = r.data ? JSON.parse(r.data) : null; } catch { data = null; }
    const p = { progress: r.progress, done: r.done, claimedAt: r.claimedAt, data };
    progressCache.set(pkey(userId, eventId, r.questKey), p);
    out.set(r.questKey, p);
  }
  return out;
}

async function getProgress(userId, eventId, key) {
  const k = pkey(userId, eventId, key);
  if (!progressCache.has(k)) await loadProgress(userId, eventId);
  return progressCache.get(k) || null;
}

async function setProgress(userId, eventId, key, next) {
  const k = pkey(userId, eventId, key);
  const cur = progressCache.get(k);
  if (cur && cur.progress === next.progress && cur.done === next.done && JSON.stringify(cur.data || null) === JSON.stringify(next.data || null)) return false;
  const merged = { ...(cur || {}), ...next, claimedAt: cur?.claimedAt || null };
  progressCache.set(k, merged);
  await prisma.plazaQuestProgress.upsert({
    where: { userId_eventId_questKey: { userId, eventId, questKey: key } },
    create: { userId, eventId, questKey: key, progress: merged.progress, done: merged.done, data: merged.data ? JSON.stringify(merged.data) : null },
    update: { progress: merged.progress, done: merged.done, data: merged.data ? JSON.stringify(merged.data) : null },
  });
  if (!cur?.done && merged.done) notify(userId, 'praca:quest-done', { eventId, questKey: key });
  return true;
}

function notify(userId, event, payload) {
  try { io?.to(`user:${userId}`).emit(event, payload); } catch { /* sem socket */ }
}

/** Avalia as quests de um jogador que está na ilha (sala atual, pinguim vivo). */
async function evaluate(userId, room, live, events, pres = null) {
  for (const ev of events) {
    for (const q of ev.cfg.quests) {
      const cur = (await getProgress(userId, ev.id, q.key)) || { progress: 0, done: false, data: null };
      if (cur.done) continue;
      let next = null;
      switch (q.type) {
        case 'visit': {
          const rooms = ids(q.rooms);
          if (!rooms.includes(room)) break;
          const seen = new Set(Array.isArray(cur.data?.rooms) ? cur.data.rooms : []);
          if (seen.has(room)) break;
          seen.add(room);
          next = { progress: seen.size, done: seen.size >= rooms.length, data: { rooms: [...seen] } };
          break;
        }
        case 'gather': {
          const rooms = ids(q.rooms);
          if (rooms.length && !rooms.includes(room)) break;
          const here = waddle.roomPlayers(room).length;
          const best = Math.max(cur.progress, here);
          if (best !== cur.progress) next = { progress: best, done: best >= num(q.count || 5) };
          break;
        }
        case 'wear': {
          if (!live) break;
          const want = ids(q.items);
          const inv = live.inventory;
          const worn = [inv.color, inv.head, inv.face, inv.neck, inv.body, inv.feet, inv.hand, inv.pin, inv.background].map(Number);
          const hit = want.length ? want.some((i) => worn.includes(i)) : worn.some((i) => i > 0);
          if (hit) next = { progress: 1, done: true };
          break;
        }
        case 'online': {
          const since = onlineSince.get(userId) || Date.now();
          const minutes = Math.floor((Date.now() - since) / 60000) + num(cur.data?.banked);
          if (minutes !== cur.progress) next = { progress: minutes, done: minutes >= num(q.minutes || 10), data: { banked: num(cur.data?.banked) } };
          break;
        }
        case 'donate': {
          const total = await prisma.plazaDonation.aggregate({ where: { userId, eventId: ev.id }, _sum: { amount: true } }).then((r) => num(r._sum.amount)).catch(() => 0);
          if (total !== cur.progress) next = { progress: total, done: total >= num(q.count || 100) };
          break;
        }
        case 'mascot': {
          const met = await prisma.plazaMascotMeet.count({ where: { userId, visit: { mascotKey: String(q.mascot || 'pingu') } } }).catch(() => 0);
          if (met > 0 && !cur.done) next = { progress: 1, done: true };
          break;
        }
        case 'dance': {
          // dançar (ou outro frame) em cada sala da lista — com o item, se pedido
          if (!pres) break;
          const frames = ids(q.frames).length ? ids(q.frames) : DANCE_FRAMES;
          if (!frames.includes(Number(pres.frame))) break;
          const want = ids(q.items);
          if (want.length && live) {
            const inv = live.inventory;
            const worn = [inv.head, inv.face, inv.neck, inv.body, inv.feet, inv.hand, inv.pin, inv.background].map(Number);
            if (!want.some((i) => worn.includes(i))) break;
          }
          const rooms = ids(q.rooms);
          if (!rooms.length) { next = { progress: 1, done: true }; break; }
          if (!rooms.includes(room)) break;
          const seen = new Set(Array.isArray(cur.data?.rooms) ? cur.data.rooms : []);
          if (seen.has(room)) break;
          seen.add(room);
          next = { progress: seen.size, done: seen.size >= rooms.length, data: { rooms: [...seen] } };
          break;
        }
        case 'walk_puffle': {
          // passear com o puffle (de um tipo, se pedido) até a(s) sala(s)
          if (!pres || pres.walking === null || pres.walking === undefined) break;
          const types = ids(q.puffles);
          if (types.length && !types.includes(Number(pres.walking))) break;
          const rooms = ids(q.rooms);
          if (!rooms.length) { next = { progress: 1, done: true }; break; }
          if (!rooms.includes(room)) break;
          const seen = new Set(Array.isArray(cur.data?.rooms) ? cur.data.rooms : []);
          if (seen.has(room)) break;
          seen.add(room);
          next = { progress: seen.size, done: seen.size >= rooms.length, data: { rooms: [...seen] } };
          break;
        }
        default: break;
      }
      if (next) await setProgress(userId, ev.id, q.key, next);
    }
  }
}

// Quem está na ilha agora: [{ userId, penguinId, room }]
function onlineUsers() {
  const out = [];
  if (!waddle || !w) return out;
  for (const p of (w.world.getPresence ? w.world.getPresence() : [])) {
    const userId = waddle.userOfPenguin ? waddle.userOfPenguin(p.id) : null;
    if (userId) out.push({ userId, penguinId: p.id, room: p.room, frame: Number(p.frame) || 0, walking: p.walking ?? null });
  }
  return out;
}

async function tick() {
  const events = await activeEvents();
  const users = onlineUsers();
  const seen = new Set();
  for (const u of users) {
    seen.add(u.userId);
    if (!onlineSince.has(u.userId)) onlineSince.set(u.userId, Date.now());
  }
  // quem saiu: guarda os minutos na quest 'online' e zera o relógio
  for (const uid of [...onlineSince.keys()]) {
    if (seen.has(uid)) continue;
    const mins = Math.floor((Date.now() - onlineSince.get(uid)) / 60000);
    onlineSince.delete(uid);
    for (const ev of events) for (const q of ev.cfg.quests) {
      if (q.type !== 'online') continue;
      const cur = await getProgress(uid, ev.id, q.key);
      if (cur && !cur.done) await setProgress(uid, ev.id, q.key, { progress: cur.progress, done: cur.done, data: { banked: num(cur.data?.banked) + mins } }).catch(() => {});
    }
  }
  if (!events.length && !(await visitsNow()).length) return;
  for (const u of users) {
    const live = w.world.getOnline(u.penguinId);
    await evaluate(u.userId, u.room, live, events, u).catch((err) => console.error('[praça eventos] quest:', err?.message || err));
  }
  await checkMascots(users).catch((err) => console.error('[praça eventos] mascote:', err?.message || err));
}

// ---------------------------------------------------------------------------
// Mascotes com agenda
// ---------------------------------------------------------------------------
let visitsCache = { at: 0, list: [] };
async function visitsNow() {
  if (Date.now() - visitsCache.at < CACHE_MS) return visitsCache.list;
  const d = new Date();
  const list = await prisma.plazaMascotVisit.findMany({ where: { startsAt: { lte: d }, endsAt: { gte: d } } }).catch(() => []);
  visitsCache = { at: Date.now(), list };
  return list;
}

async function checkMascots(users) {
  const visits = await visitsNow();
  if (!visits.length) return;
  for (const v of visits) {
    // o mascote precisa estar na ilha, na sala da visita
    const mascot = v.mascotUserId ? users.find((u) => u.userId === v.mascotUserId) : null;
    if (!mascot || mascot.room !== v.room) continue;
    for (const u of users) {
      if (u.userId === v.mascotUserId || u.room !== v.room) continue;
      const exists = await prisma.plazaMascotMeet.findUnique({ where: { visitId_userId: { visitId: v.id, userId: u.userId } } });
      if (exists) continue;
      await prisma.plazaMascotMeet.create({ data: { visitId: v.id, userId: u.userId } });
      const items = ids(JSON.parse(v.itemIds || '[]'));
      if (v.backgroundItemId) items.push(v.backgroundItemId);
      await grant(u.userId, { coins: v.coins, items, eventCoins: v.eventCoins, eventSlug: null });
      notify(u.userId, 'praca:mascot-meet', { name: v.name, mascotKey: v.mascotKey, items, coins: v.coins });
    }
  }
}

// ---------------------------------------------------------------------------
// Recompensas
// ---------------------------------------------------------------------------
async function grant(userId, { coins = 0, eventCoins = 0, items = [], eventSlug = null, eventId = null }) {
  const out = { coins: 0, eventCoins: 0, items: [] };
  if (num(coins) > 0) { await store.addUserCoins(userId, num(coins)); out.coins = num(coins); }
  if (num(eventCoins) > 0) {
    const ev = eventId ? { id: eventId } : eventSlug ? await prisma.plazaEvent.findUnique({ where: { slug: eventSlug }, select: { id: true } }) : (await activeEvents())[0];
    if (ev) {
      await prisma.plazaEventWallet.upsert({
        where: { userId_eventId: { userId, eventId: ev.id } },
        create: { userId, eventId: ev.id, balance: num(eventCoins), earned: num(eventCoins) },
        update: { balance: { increment: num(eventCoins) }, earned: { increment: num(eventCoins) } },
      });
      out.eventCoins = num(eventCoins);
    }
  }
  const list = ids(items);
  if (list.length) {
    const pid = await store.idForUser(userId);
    if (pid) {
      const r = await admin.updatePenguin(w, store, pid, { items: { add: list } });
      out.items = list;
      out.changes = r?.changes || [];
    }
  }
  return out;
}

async function claimQuest(userId, slug, key) {
  const ev = (await activeEvents()).find((e) => e.slug === slug);
  if (!ev) throw new Error('Esse evento não está rolando.');
  const q = ev.cfg.quests.find((x) => x.key === key);
  if (!q) throw new Error('Quest desconhecida.');
  const cur = await getProgress(userId, ev.id, key);
  if (!cur?.done) throw new Error('Essa quest ainda não foi concluída.');
  if (cur.claimedAt) throw new Error('Você já pegou essa recompensa.');
  const r = await prisma.plazaQuestProgress.updateMany({ where: { userId, eventId: ev.id, questKey: key, claimedAt: null }, data: { claimedAt: new Date() } });
  if (!r.count) throw new Error('Você já pegou essa recompensa.');
  progressCache.set(pkey(userId, ev.id, key), { ...cur, claimedAt: new Date() });
  const reward = questReward(q);
  return grant(userId, { coins: reward.coins, eventCoins: reward.eventCoins, items: reward.items, eventId: ev.id });
}

/** Recompensa efetiva: a da quest, ou as moedas padrão da dificuldade. */
function questReward(q) {
  const r = q.reward || {};
  const diff = DIFF_KEYS.includes(q.difficulty) ? q.difficulty : null;
  const coins = r.coins !== undefined && r.coins !== null && r.coins !== '' ? num(r.coins) : (diff ? DIFFICULTY[diff] : 0);
  return { coins, eventCoins: num(r.eventCoins), items: ids(r.items) };
}

/** Prêmio por completar todas as quests do evento (uma vez). */
async function claimCompletion(userId, slug) {
  const ev = (await activeEvents()).find((e) => e.slug === slug);
  if (!ev) throw new Error('Esse evento não está rolando.');
  if (!ev.cfg.completion || !ev.cfg.quests.length) throw new Error('Esse evento não tem prêmio final.');
  const progress = await loadProgress(userId, ev.id);
  const allDone = ev.cfg.quests.every((q) => progress.get(q.key)?.done);
  if (!allDone) throw new Error('Complete todas as quests primeiro.');
  try { await prisma.plazaEventPurchase.create({ data: { userId, eventId: ev.id, shopKey: COMPLETION_KEY, price: 0 } }); } catch { throw new Error('Você já pegou o prêmio final.'); }
  const c = ev.cfg.completion;
  return grant(userId, { coins: c.coins, eventCoins: c.eventCoins, items: c.items, eventId: ev.id });
}

async function buy(userId, slug, shopKey) {
  const ev = (await activeEvents()).find((e) => e.slug === slug);
  if (!ev) throw new Error('Esse evento não está rolando.');
  const s = ev.cfg.shop.find((x) => x.key === shopKey);
  if (!s) throw new Error('Esse item não está na loja.');
  const price = num(s.price);
  const result = await prisma.$transaction(async (tx) => {
    const wallet = await tx.plazaEventWallet.findUnique({ where: { userId_eventId: { userId, eventId: ev.id } } });
    if (!wallet || wallet.balance < price) throw new Error(`Faltam ${ev.currencyName}: você tem ${wallet?.balance || 0} e custa ${price}.`);
    const already = await tx.plazaEventPurchase.findUnique({ where: { userId_eventId_shopKey: { userId, eventId: ev.id, shopKey } } });
    if (already) throw new Error('Você já comprou isso.');
    const next = wallet.balance - price;
    await tx.plazaEventPurchase.create({ data: { userId, eventId: ev.id, shopKey, price } });
    await tx.plazaEventWallet.update({ where: { id: wallet.id }, data: { balance: { decrement: price } } });
    return next;
  });
  const granted = await grant(userId, { items: s.itemIds });
  return { balance: result, ...granted };
}

async function redeemCode(userId, raw) {
  const code = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!code) throw new Error('Digite um código.');
  const c = await prisma.plazaCode.findUnique({ where: { code } });
  if (!c || !c.active) throw new Error('Código inválido.');
  if (c.expiresAt && c.expiresAt < new Date()) throw new Error('Esse código expirou.');
  if (c.maxUses && c.uses >= c.maxUses) throw new Error('Esse código já foi usado o máximo de vezes.');
  try {
    await prisma.plazaCodeUse.create({ data: { codeId: c.id, userId } });
  } catch { throw new Error('Você já usou esse código.'); }
  await prisma.plazaCode.update({ where: { id: c.id }, data: { uses: { increment: 1 } } });
  let items = [];
  try { items = ids(JSON.parse(c.items || '[]')); } catch { items = []; }
  const granted = await grant(userId, { coins: c.coins, eventCoins: c.eventCoins, items, eventSlug: c.eventSlug });
  return { label: c.label, ...granted };
}

async function donate(userId, slug, amountRaw) {
  const amount = Math.floor(num(amountRaw));
  if (amount < 1 || amount > 100000) throw new Error('Valor inválido.');
  const ev = (await activeEvents()).find((e) => e.slug === slug);
  if (!ev || !ev.cfg.cfc) throw new Error('Esse evento não tem Coins for Change.');
  const coins = await store.userCoins(userId);
  if (coins === null || coins < amount) throw new Error('Você não tem moedas suficientes.');
  await store.addUserCoins(userId, -amount);
  await prisma.plazaDonation.create({ data: { userId, eventId: ev.id, amount } });
  return cfcStatus(ev, userId);
}

async function cfcStatus(ev, userId) {
  if (!ev.cfg.cfc) return null;
  const [total, mine, donors] = await Promise.all([
    prisma.plazaDonation.aggregate({ where: { eventId: ev.id }, _sum: { amount: true } }).then((r) => num(r._sum.amount)),
    userId ? prisma.plazaDonation.aggregate({ where: { eventId: ev.id, userId }, _sum: { amount: true } }).then((r) => num(r._sum.amount)) : 0,
    prisma.plazaDonation.groupBy({ by: ['userId'], where: { eventId: ev.id } }).then((r) => r.length).catch(() => 0),
  ]);
  const claimed = userId ? new Set((await prisma.plazaEventPurchase.findMany({ where: { userId, eventId: ev.id, shopKey: { startsWith: 'cfc:' } }, select: { shopKey: true } })).map((p) => p.shopKey)) : new Set();
  return {
    total, mine, donors,
    goals: ev.cfg.cfc.goals.map((g, i) => ({ index: i, amount: num(g.amount), label: g.label || `Meta ${i + 1}`, items: ids(g.items), coins: num(g.coins), reached: total >= num(g.amount), claimable: total >= num(g.amount) && mine > 0 && !claimed.has(`cfc:${i}`), claimed: claimed.has(`cfc:${i}`) })),
  };
}

async function claimCfc(userId, slug, index) {
  const ev = (await activeEvents()).find((e) => e.slug === slug);
  if (!ev || !ev.cfg.cfc) throw new Error('Esse evento não tem Coins for Change.');
  const st = await cfcStatus(ev, userId);
  const g = st.goals[Number(index)];
  if (!g) throw new Error('Meta desconhecida.');
  if (!g.claimable) throw new Error(g.claimed ? 'Você já pegou essa recompensa.' : g.reached ? 'Só quem doou recebe a recompensa.' : 'A comunidade ainda não bateu essa meta.');
  await prisma.plazaEventPurchase.create({ data: { userId, eventId: ev.id, shopKey: `cfc:${g.index}`, price: 0 } });
  return grant(userId, { coins: g.coins, items: g.items, eventId: ev.id });
}

// ---------------------------------------------------------------------------
// Calendário do advento (1 a 25 de dezembro do ano do evento)
// ---------------------------------------------------------------------------
function adventDay(now = new Date()) {
  // fuso do Brasil
  const br = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return { year: br.getFullYear(), month: br.getMonth() + 1, day: br.getDate() };
}

async function adventStatus(ev, userId) {
  if (!ev.cfg.advent.length) return null;
  const { year, month, day } = adventDay();
  const claimed = new Set((await prisma.plazaAdventClaim.findMany({ where: { userId, year }, select: { day: true } })).map((c) => c.day));
  return {
    today: month === 12 ? Math.min(day, 25) : (month === 1 ? 25 : 0),
    days: ev.cfg.advent.sort((a, b) => a.day - b.day).map((a) => ({ day: a.day, coins: num(a.coins), eventCoins: num(a.eventCoins), items: ids(a.items), claimed: claimed.has(a.day), open: month === 12 ? a.day <= day : month === 1 })),
  };
}

async function claimAdvent(userId, slug, dayRaw) {
  const ev = (await activeEvents()).find((e) => e.slug === slug);
  if (!ev) throw new Error('Esse evento não está rolando.');
  const day = Number(dayRaw);
  const a = ev.cfg.advent.find((x) => Number(x.day) === day);
  if (!a) throw new Error('Esse dia não tem presente.');
  const { year, month, day: today } = adventDay();
  if (!(month === 12 && day <= today) && month !== 1) throw new Error('Esse dia ainda não abriu.');
  try { await prisma.plazaAdventClaim.create({ data: { userId, year: month === 1 ? year - 1 : year, day } }); } catch { throw new Error('Você já abriu esse dia.'); }
  return grant(userId, { coins: a.coins, eventCoins: a.eventCoins, items: a.items, eventId: ev.id });
}

// ---------------------------------------------------------------------------
// Estado pro jogador (janela "Festa")
// ---------------------------------------------------------------------------
async function playerState(userId) {
  const events = await activeEvents();
  const d = new Date();
  const [visits, friendsOnline] = await Promise.all([
    prisma.plazaMascotVisit.findMany({ where: { endsAt: { gte: d } }, orderBy: { startsAt: 'asc' }, take: 20 }),
    friendsOnIsland(userId),
  ]);
  const out = { events: [], mascots: [], friends: friendsOnline, now: d.toISOString() };
  for (const ev of events) {
    const progress = await loadProgress(userId, ev.id);
    const wallet = await prisma.plazaEventWallet.findUnique({ where: { userId_eventId: { userId, eventId: ev.id } } });
    const bought = new Set((await prisma.plazaEventPurchase.findMany({ where: { userId, eventId: ev.id }, select: { shopKey: true } })).map((p) => p.shopKey));
    out.events.push({
      slug: ev.slug, name: ev.name, currencyName: ev.currencyName, party: ev.party, startsAt: ev.startsAt, endsAt: ev.endsAt,
      wallet: { balance: wallet?.balance || 0, earned: wallet?.earned || 0 },
      quests: ev.cfg.quests.map((q) => {
        const p = progress.get(q.key);
        const target = ['visit', 'dance', 'walk_puffle'].includes(q.type) ? Math.max(1, ids(q.rooms).length) : q.type === 'gather' ? num(q.count || 5) : q.type === 'online' ? num(q.minutes || 10) : q.type === 'donate' ? num(q.count || 100) : 1;
        return { key: q.key, title: q.title || q.key, desc: q.desc || '', type: q.type, difficulty: DIFF_KEYS.includes(q.difficulty) ? q.difficulty : null, rooms: ids(q.rooms).map((id) => ({ id, ...roomInfo(id) })), items: ids(q.items), target, progress: Math.min(target, p?.progress || 0), done: !!p?.done, claimed: !!p?.claimedAt, reward: questReward(q) };
      }),
      completion: ev.cfg.completion ? { ...ev.cfg.completion, allDone: ev.cfg.quests.length > 0 && ev.cfg.quests.every((q) => progress.get(q.key)?.done), claimed: bought.has(COMPLETION_KEY) } : null,
      shop: ev.cfg.shop.map((s) => ({ key: s.key, label: s.label || s.key, itemIds: ids(s.itemIds), price: num(s.price), bought: bought.has(s.key) })),
      advent: await adventStatus(ev, userId),
      cfc: await cfcStatus(ev, userId),
    });
  }
  for (const v of visits) {
    const met = await prisma.plazaMascotMeet.findUnique({ where: { visitId_userId: { visitId: v.id, userId } } }).catch(() => null);
    const live = v.mascotUserId && waddle.roomOfUser ? waddle.roomOfUser(v.mascotUserId) : null;
    out.mascots.push({ id: v.id, name: v.name, mascotKey: v.mascotKey, room: v.room, roomKey: roomInfo(v.room).key, roomName: roomInfo(v.room).name, startsAt: v.startsAt, endsAt: v.endsAt, note: v.note, hasBackground: !!v.backgroundItemId, met: !!met, onIsland: live !== null, inRoom: live === v.room, active: v.startsAt <= d && v.endsAt >= d });
  }
  return out;
}

/** Amigos do Project Club que estão na ilha agora, com a sala (pra "ir até ele"). */
async function friendsOnIsland(userId) {
  try {
    const rows = await prisma.friendship.findMany({ where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] }, select: { requesterId: true, addresseeId: true }, take: 2000 });
    const friendIds = new Set(rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId)));
    const out = [];
    for (const u of onlineUsers()) {
      if (!friendIds.has(u.userId)) continue;
      const user = await prisma.user.findUnique({ where: { id: u.userId }, select: { id: true, username: true, displayName: true, avatarUrl: true } });
      if (user) out.push({ ...user, room: u.room, roomKey: roomInfo(u.room).key, roomName: roomInfo(u.room).name, penguinId: u.penguinId });
    }
    return out;
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------
function cleanQuest(q) {
  const types = ['visit', 'gather', 'wear', 'online', 'mascot', 'donate', 'dance', 'walk_puffle'];
  const coins = q.reward?.coins;
  return {
    key: String(q.key || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40),
    title: String(q.title || '').slice(0, 80), desc: String(q.desc || '').slice(0, 300),
    type: types.includes(q.type) ? q.type : 'visit',
    difficulty: DIFF_KEYS.includes(q.difficulty) ? q.difficulty : 'facil',
    rooms: ids(q.rooms), items: ids(q.items), puffles: Array.isArray(q.puffles) ? q.puffles.map(Number).filter((n) => Number.isInteger(n) && n >= 0) : [], frames: ids(q.frames),
    count: Math.max(1, Math.min(200, num(q.count) || 5)), minutes: Math.max(1, Math.min(600, num(q.minutes) || 10)),
    mascot: String(q.mascot || 'pingu').slice(0, 40),
    // coins em branco = usa o padrão da dificuldade
    reward: { coins: coins === undefined || coins === null || coins === '' ? null : Math.max(0, Math.min(100000, num(coins))), eventCoins: Math.max(0, Math.min(MAX_EVENT_COINS, num(q.reward?.eventCoins))), items: ids(q.reward?.items) },
  };
}

function cleanConfig(c = {}) {
  const quests = (Array.isArray(c.quests) ? c.quests : []).map(cleanQuest).filter((q) => q.key);
  const keys = new Set();
  for (const q of quests) { if (keys.has(q.key)) throw new Error(`Quest repetida: ${q.key}`); keys.add(q.key); }
  return {
    quests,
    shop: (Array.isArray(c.shop) ? c.shop : []).map((s) => ({ key: String(s.key || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40), label: String(s.label || '').slice(0, 80), itemIds: ids(s.itemIds), price: Math.max(0, Math.min(MAX_EVENT_COINS, num(s.price))) })).filter((s) => s.key && s.itemIds.length),
    advent: (Array.isArray(c.advent) ? c.advent : []).map((a) => ({ day: num(a.day), coins: Math.max(0, num(a.coins)), eventCoins: Math.max(0, num(a.eventCoins)), items: ids(a.items) })).filter((a) => a.day >= 1 && a.day <= 25),
    cfc: c.cfc && Array.isArray(c.cfc.goals) && c.cfc.goals.length ? { goals: c.cfc.goals.map((g) => ({ amount: Math.max(1, num(g.amount)), label: String(g.label || '').slice(0, 80), items: ids(g.items), coins: Math.max(0, num(g.coins)) })) } : null,
    completion: c.completion && (num(c.completion.coins) || num(c.completion.eventCoins) || ids(c.completion.items).length) ? { coins: Math.max(0, num(c.completion.coins)), eventCoins: Math.max(0, num(c.completion.eventCoins)), items: ids(c.completion.items), label: String(c.completion.label || '').slice(0, 80) } : null,
  };
}

async function listEvents() {
  const rows = await prisma.plazaEvent.findMany({ orderBy: { startsAt: 'desc' }, take: 100 });
  const d = new Date();
  return rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, currencyName: r.currencyName, party: r.party, startsAt: r.startsAt, endsAt: r.endsAt, active: r.active, running: r.active && r.startsAt <= d && r.endsAt >= d, config: parseConfig(r) }));
}

async function saveEvent(body) {
  const slug = String(body.slug || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 60);
  if (!slug) throw new Error('Informe um identificador (slug).');
  const startsAt = new Date(body.startsAt); const endsAt = new Date(body.endsAt);
  if (Number.isNaN(+startsAt) || Number.isNaN(+endsAt) || endsAt <= startsAt) throw new Error('Datas inválidas.');
  const data = { name: String(body.name || slug).slice(0, 80), currencyName: String(body.currencyName || 'Fichas').slice(0, 40), party: body.party ? String(body.party).slice(0, 80) : null, startsAt, endsAt, active: body.active !== false, config: JSON.stringify(cleanConfig(body.config)) };
  const row = await prisma.plazaEvent.upsert({ where: { slug }, create: { slug, ...data }, update: data });
  invalidate();
  return row;
}

async function deleteEvent(slug) {
  await prisma.plazaEvent.delete({ where: { slug } });
  invalidate();
}

async function listCodes() {
  return prisma.plazaCode.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
}
async function saveCode(body) {
  const code = String(body.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40);
  if (code.length < 3) throw new Error('O código precisa de pelo menos 3 letras/números.');
  const data = { label: String(body.label || '').slice(0, 120), coins: Math.max(0, Math.min(1000000, num(body.coins))), eventCoins: Math.max(0, Math.min(MAX_EVENT_COINS, num(body.eventCoins))), eventSlug: body.eventSlug ? String(body.eventSlug).slice(0, 60) : null, items: JSON.stringify(ids(body.items)), maxUses: body.maxUses ? Math.max(1, num(body.maxUses)) : null, expiresAt: body.expiresAt ? new Date(body.expiresAt) : null, active: body.active !== false };
  return prisma.plazaCode.upsert({ where: { code }, create: { code, ...data }, update: data });
}
async function deleteCode(code) { await prisma.plazaCode.delete({ where: { code } }); }

async function listVisits() {
  const rows = await prisma.plazaMascotVisit.findMany({ orderBy: { startsAt: 'desc' }, take: 100, include: { _count: { select: { meets: true } } } });
  return rows.map((v) => ({ ...v, meets: v._count.meets, _count: undefined }));
}
async function saveVisit(body) {
  const startsAt = new Date(body.startsAt); const endsAt = new Date(body.endsAt);
  if (Number.isNaN(+startsAt) || Number.isNaN(+endsAt) || endsAt <= startsAt) throw new Error('Datas inválidas.');
  const data = { mascotKey: String(body.mascotKey || 'pingu').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'pingu', name: String(body.name || 'Pingu').slice(0, 60), mascotUserId: body.mascotUserId ? String(body.mascotUserId) : null, room: Math.max(1, num(body.room) || 100), startsAt, endsAt, backgroundItemId: body.backgroundItemId ? num(body.backgroundItemId) : null, itemIds: JSON.stringify(ids(body.itemIds)), coins: Math.max(0, num(body.coins)), eventCoins: Math.max(0, num(body.eventCoins)), note: String(body.note || '').slice(0, 200) };
  visitsCache.at = 0;
  if (body.id) return prisma.plazaMascotVisit.update({ where: { id: String(body.id) }, data });
  return prisma.plazaMascotVisit.create({ data });
}
async function deleteVisit(id) { visitsCache.at = 0; await prisma.plazaMascotVisit.delete({ where: { id } }); }

/** Modelo pronto de evento pra festa que está na ilha (a staff ajusta depois). */
function templateForParty(party, partyRooms = []) {
  const rooms = ids(partyRooms).slice(0, 6);
  const start = new Date(); const end = new Date(Date.now() + 14 * 86400000);
  return {
    slug: `${String(party?.slug || 'festa').toLowerCase().replace(/[^a-z0-9_-]/g, '-')}-${start.getFullYear()}`.slice(0, 60),
    name: party?.label || party?.name || 'Festa da ilha', currencyName: 'Fichas da festa', party: party?.name || null,
    startsAt: start.toISOString(), endsAt: end.toISOString(), active: true,
    config: {
      quests: [
        rooms.length ? { key: 'explorar', title: 'Explorar a festa', desc: `Visite ${rooms.length} salas decoradas.`, type: 'visit', rooms, reward: { coins: 150, eventCoins: 30 } } : null,
        { key: 'reunir', title: 'Juntar a galera', desc: 'Esteja numa sala com 5 pinguins ao mesmo tempo.', type: 'gather', count: 5, reward: { coins: 100, eventCoins: 20 } },
        { key: 'fantasia', title: 'No clima', desc: 'Vista qualquer item na festa.', type: 'wear', items: [], reward: { coins: 50, eventCoins: 10 } },
        { key: 'ficar', title: 'Curtir a festa', desc: 'Fique 20 minutos na ilha.', type: 'online', minutes: 20, reward: { coins: 100, eventCoins: 20 } },
        { key: 'pingu', title: 'Encontrar o Pingu', desc: 'Esteja na mesma sala que o Pingu numa visita dele.', type: 'mascot', mascot: 'pingu', reward: { coins: 200, eventCoins: 40 } },
      ].filter(Boolean),
      shop: [], advent: [], cfc: null,
    },
  };
}

// ---------------------------------------------------------------------------
function attach(instance, deps) {
  w = instance; store = deps.store; waddle = deps.waddle; admin = deps.admin;
  if (tickTimer) return;
  tickTimer = setInterval(() => { tick().catch((err) => console.error('[praça eventos]', err?.message || err)); }, TICK_MS);
  tickTimer.unref?.();
  // troca de sala conta na hora (sem esperar o tique)
  waddle.onRoomChange((userId, _from, to) => {
    if (to === null || to === undefined) return;
    activeEvents().then((events) => {
      if (!events.length) return;
      const u = onlineUsers().find((x) => x.userId === userId);
      return evaluate(userId, Number(to), u ? w.world.getOnline(u.penguinId) : null, events, u);
    }).catch(() => {});
  });
}
function setIo(socketIo) { io = socketIo; }

module.exports = {
  roomInfo, attach, setIo, activeEvents, playerState, claimQuest, claimCompletion, questReward, DIFFICULTY, buy, redeemCode, donate, claimCfc, claimAdvent, friendsOnIsland,
  listEvents, saveEvent, deleteEvent, listCodes, saveCode, deleteCode, listVisits, saveVisit, deleteVisit, templateForParty, cleanConfig, parseConfig,
  _test: { evaluate, setProgress, getProgress, grant },
};
