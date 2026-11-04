// Painel da equipe → aba "Jogo" (Club Penguin): ver e editar pinguins.
//
// Tudo que o jogo guarda por pinguim (moedas, itens, iglus, móveis, puffles,
// carimbos, assinatura...) está no JSON do WaddlePenguin. Duas situações:
//
// - pinguim OFFLINE: edita o JSON direto no repositório (cache + MySQL);
// - pinguim ONLINE: o servidor do mundo tem o objeto dele em memória e grava
//   por cima a cada mudança — editar o banco seria perdido. Então a edição
//   é feita no objeto vivo (WorldPenguin), gravada na hora e, no que o
//   cliente Flash entende, avisada em tempo real ('ai' item, 'af' móvel...).
//   O que o cliente não atualiza sozinho (remoções, assinatura) aparece na
//   próxima entrada — o painel pode derrubar o jogador pra isso.
const prisma = require('../../config/prisma');

function dist(rel) { return require(`../../../waddle/dist/${rel}`); }

const ITEM_TYPES = { 1: 'Cor', 2: 'Cabeça', 3: 'Rosto', 4: 'Pescoço', 5: 'Corpo', 6: 'Mão', 7: 'Pés', 8: 'Pin', 9: 'Fundo', 10: 'Prêmio' };

let catalogCache = null;
/** Catálogo do jogo (itens, móveis, iglus, pisos, puffles, carimbos) em PT-BR. */
function getCatalog(w) {
  if (catalogCache) return catalogCache;
  const { t } = dist('server/i18n/index.js');
  const { ITEMS } = dist('server/game-logic/items.js');
  const { FURNITURE } = dist('server/game-logic/furniture.js');
  const { IGLOO_TYPES, IGLOO_FLOORING } = dist('server/game-logic/iglooItems.js');
  const { PUFFLES } = dist('server/game-logic/puffle.js');
  const items = ITEMS.rows.map((i) => ({ id: i.id, name: t(i.name), type: i.type, typeLabel: ITEM_TYPES[i.type] || '?', cost: i.cost, member: !!i.isMember }));
  const furniture = FURNITURE.rows.map((f) => ({ id: f.id, name: t(f.name), cost: f.cost, member: !!f.member }));
  const igloos = IGLOO_TYPES.rows.map((i) => ({ id: i.id, name: t(i.name), cost: i.cost }));
  const floorings = IGLOO_FLOORING.rows.map((i) => ({ id: i.id, name: t(i.name), cost: i.cost }));
  const puffles = PUFFLES.rows.filter((p) => !p.parentId).map((p) => ({ id: p.id, name: t(p.name), cost: p.cost, member: !!p.member }));
  const stamps = [];
  try {
    for (const cat of w.gameData.getStampbook()) {
      for (const s of cat.stamps) stamps.push({ id: s.stamp_id, name: t(s.name), description: t(s.description), category: t(cat.name) });
    }
  } catch { /* sem livro de carimbos nessa época */ }
  catalogCache = { items, furniture, igloos, floorings, puffles, stamps, locations: [1, 2, 3, 4, 5, 6].map((id) => ({ id, name: `Local ${id}` })) };
  return catalogCache;
}

async function userOf(userId) {
  if (!userId) return null;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, displayName: true, avatarUrl: true, platformRole: true } });
  return u;
}

function summary(row, json, online) {
  return {
    id: row.id, name: json.name, userId: row.userId, mascot: !!json.mascot || row.id < 1000,
    coins: json.coins, member: !!json.is_member, agent: !!json.is_agent, color: json.color,
    items: (json.inventory || []).length, furniture: Object.values(json.furniture || {}).reduce((n, v) => n + v, 0),
    puffles: (json.puffles || []).length, stamps: (json.stamps || []).length, online,
    updatedAt: row.updatedAt,
  };
}

/** Lista/pesquisa pinguins (por nome do pinguim ou @usuário/nome de exibição). */
async function listPenguins(w, store, { q = '', page = 1, pageSize = 30 } = {}) {
  const term = String(q || '').trim();
  const where = {};
  if (term) {
    const users = await prisma.user.findMany({ where: { OR: [{ username: { contains: term } }, { displayName: { contains: term } }] }, select: { id: true }, take: 50 });
    where.OR = [{ name: { contains: term } }, { userId: { in: users.map((u) => u.id) } }];
    if (/^\d+$/.test(term)) where.OR.push({ id: Number(term) });
  }
  const [total, rows] = await Promise.all([
    prisma.waddlePenguin.count({ where }),
    prisma.waddlePenguin.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, userId: true, data: true, updatedAt: true } }),
  ]);
  const online = new Set(w.world.getAllPlayersInfo().map((p) => p.id));
  const out = [];
  for (const row of rows) {
    const json = (await store.get(row.id)) || JSON.parse(row.data);
    out.push({ ...summary(row, json, online.has(row.id)), user: await userOf(row.userId) });
  }
  return { total, page, pageSize, penguins: out };
}

/** Ficha completa de um pinguim. */
async function getPenguin(w, store, id) {
  id = Number(id);
  const row = await prisma.waddlePenguin.findUnique({ where: { id }, select: { id: true, userId: true, updatedAt: true, createdAt: true } });
  if (!row) return null;
  const live = w.world.getOnline(id);
  const json = live ? live.getJSON() : await store.get(id);
  if (!json) return null;
  return {
    ...summary(row, json, !!live), user: await userOf(row.userId), createdAt: row.createdAt,
    equipped: { color: json.color, head: json.head, face: json.face, neck: json.neck, body: json.body, hand: json.hand, feet: json.feet, pin: json.pin, background: json.background },
    inventory: json.inventory || [], furnitureOwned: json.furniture || {}, iglooTypes: json.iglooTypes || [], iglooFloorings: json.iglooFloorings || [], iglooLocations: json.iglooLocations || [],
    igloos: json.igloos || [], igloo: json.igloo, puffleList: json.puffles || [], stampList: json.stamps || [], minutesPlayed: json.minutes_played || 0,
    registrationDate: json.registration_date, ninja: !!json.isNinja, cards: Object.keys(json.cards || {}).length, nuggets: json.nuggets || 0,
  };
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(n) : null; };
const ids = (arr) => (Array.isArray(arr) ? arr.map(num).filter((n) => n !== null && n >= 0) : []);

/**
 * Aplica uma edição. `ops`:
 *   coins: { set: n } | { add: n }
 *   member: bool, agent: bool
 *   items: { add: [id], remove: [id] }
 *   furniture: { set: [[id, amount]] }            (amount 0 remove)
 *   igloos: { add: [id], remove: [id] }  floorings: { add, remove }  locations: { add, remove }
 *   stamps: { add: [id], remove: [id] }
 *   puffles: { add: [{ name, type }], remove: [id] }
 *   kick: bool  (derruba o jogador no fim, pra ele ver tudo ao entrar de novo)
 * Devolve a ficha atualizada + resumo do que mudou.
 */
async function updatePenguin(w, store, id, ops = {}) {
  id = Number(id);
  const catalog = getCatalog(w);
  const known = { item: new Set(catalog.items.map((i) => i.id)), furniture: new Set(catalog.furniture.map((f) => f.id)), igloo: new Set(catalog.igloos.map((i) => i.id)), flooring: new Set(catalog.floorings.map((i) => i.id)), puffle: new Set(catalog.puffles.map((p) => p.id)), stamp: new Set(catalog.stamps.map((s) => s.id)) };
  const changes = [];
  const live = w.world.getOnline(id);

  if (live) {
    // ---- online: mexe no objeto vivo do mundo ----
    if (ops.coins) {
      if (ops.coins.set !== undefined && num(ops.coins.set) !== null) { live.currency.set(num(ops.coins.set)); changes.push(`moedas = ${live.currency.coins}`); }
      else if (ops.coins.add !== undefined && num(ops.coins.add) !== null) { live.currency.add(num(ops.coins.add)); changes.push(`moedas ${num(ops.coins.add) >= 0 ? '+' : ''}${num(ops.coins.add)}`); }
      w.world.notify(live, 'ac', live.currency.coins);
    }
    if (typeof ops.member === 'boolean' && ops.member !== live.membership.isMember) { live.membership.set(ops.member); changes.push(ops.member ? 'virou assinante' : 'deixou de ser assinante'); }
    if (typeof ops.agent === 'boolean' && ops.agent !== live.psa.isAgent) { live.psa.set(ops.agent); changes.push(ops.agent ? 'agente da EPF' : 'saiu da EPF'); }
    for (const it of ids(ops.items?.add)) if (known.item.has(it) && !live.inventory.has(it)) { live.inventory.add(it); w.world.notify(live, 'ai', it, live.currency.coins); changes.push(`+item ${it}`); }
    for (const it of ids(ops.items?.remove)) if (live.inventory.has(it)) { live.inventory.remove(it); changes.push(`-item ${it}`); }
    for (const pair of Array.isArray(ops.furniture?.set) ? ops.furniture.set : []) {
      const [fid, amount] = [num(pair?.[0]), num(pair?.[1])];
      if (fid === null || amount === null || !known.furniture.has(fid)) continue;
      const before = live.igloo.getFurnitureAmount(fid);
      live.igloo.setFurnitureAmount(fid, amount);
      for (let i = before; i < Math.min(amount, 99); i++) w.world.notify(live, 'af', fid, live.currency.coins);
      changes.push(`móvel ${fid}: ${before} → ${live.igloo.getFurnitureAmount(fid)}`);
    }
    for (const g of ids(ops.igloos?.add)) if (known.igloo.has(g)) { live.igloo.addIglooType(g); w.world.notify(live, 'au', g, live.currency.coins); changes.push(`+iglu ${g}`); }
    for (const g of ids(ops.igloos?.remove)) { live.igloo.removeIglooType(g); changes.push(`-iglu ${g}`); }
    for (const f of ids(ops.floorings?.add)) if (known.flooring.has(f)) { live.igloo.addFlooring(f); w.world.notify(live, 'ag', f, live.currency.coins); changes.push(`+piso ${f}`); }
    for (const f of ids(ops.floorings?.remove)) { live.igloo.removeFlooring(f); changes.push(`-piso ${f}`); }
    for (const l of ids(ops.locations?.add)) { live.igloo.addLocation(l); changes.push(`+local ${l}`); }
    for (const l of ids(ops.locations?.remove)) { live.igloo.removeLocation(l); changes.push(`-local ${l}`); }
    for (const s of ids(ops.stamps?.add)) if (known.stamp.has(s) && !live.stampbook.has(s)) { live.stampbook.add(s); w.world.notify(live, 'aabs', s); changes.push(`+carimbo ${s}`); }
    for (const s of ids(ops.stamps?.remove)) if (live.stampbook.has(s)) { live.stampbook.remove(s); changes.push(`-carimbo ${s}`); }
    for (const p of Array.isArray(ops.puffles?.add) ? ops.puffles.add : []) {
      const type = num(p?.type); const name = String(p?.name || '').trim().slice(0, 12) || 'Puffle';
      if (type === null || !known.puffle.has(type)) continue;
      const puffle = live.puffle.addPuffle(name, type); changes.push(`+puffle ${name} (#${puffle.id})`);
    }
    for (const pid of ids(ops.puffles?.remove)) if (live.puffle.getPuffle(pid)) { live.puffle.removePuffle(pid); changes.push(`-puffle #${pid}`); }
    w.world.persist(live);
    await Promise.resolve();
    if (ops.kick) { w.world.kick(id); changes.push('desconectado'); }
  } else {
    // ---- offline: edita o JSON ----
    const json = await store.get(id);
    if (!json) return null;
    if (ops.coins) {
      if (ops.coins.set !== undefined && num(ops.coins.set) !== null) { json.coins = Math.max(0, num(ops.coins.set)); changes.push(`moedas = ${json.coins}`); }
      else if (ops.coins.add !== undefined && num(ops.coins.add) !== null) { json.coins = Math.max(0, json.coins + num(ops.coins.add)); changes.push(`moedas ${num(ops.coins.add) >= 0 ? '+' : ''}${num(ops.coins.add)}`); }
    }
    if (typeof ops.member === 'boolean' && ops.member !== !!json.is_member) { json.is_member = ops.member; changes.push(ops.member ? 'virou assinante' : 'deixou de ser assinante'); }
    if (typeof ops.agent === 'boolean' && ops.agent !== !!json.is_agent) { json.is_agent = ops.agent; changes.push(ops.agent ? 'agente da EPF' : 'saiu da EPF'); }
    json.inventory = Array.isArray(json.inventory) ? json.inventory : [];
    for (const it of ids(ops.items?.add)) if (known.item.has(it) && !json.inventory.includes(it)) { json.inventory.push(it); changes.push(`+item ${it}`); }
    for (const it of ids(ops.items?.remove)) if (json.inventory.includes(it)) {
      json.inventory = json.inventory.filter((x) => x !== it);
      for (const slot of ['head', 'face', 'neck', 'body', 'hand', 'feet', 'pin', 'background']) if (json[slot] === it) json[slot] = 0;
      changes.push(`-item ${it}`);
    }
    json.furniture = json.furniture && typeof json.furniture === 'object' ? json.furniture : {};
    for (const pair of Array.isArray(ops.furniture?.set) ? ops.furniture.set : []) {
      const [fid, amount] = [num(pair?.[0]), num(pair?.[1])];
      if (fid === null || amount === null || !known.furniture.has(fid)) continue;
      const before = json.furniture[fid] || 0;
      if (amount <= 0) delete json.furniture[fid]; else json.furniture[fid] = Math.min(99, amount);
      changes.push(`móvel ${fid}: ${before} → ${json.furniture[fid] || 0}`);
    }
    const setOps = (key, opsKey, knownSet, keepOne) => {
      json[key] = Array.isArray(json[key]) ? json[key] : [];
      for (const v of ids(ops[opsKey]?.add)) if ((!knownSet || knownSet.has(v)) && !json[key].includes(v)) { json[key].push(v); changes.push(`+${opsKey} ${v}`); }
      for (const v of ids(ops[opsKey]?.remove)) if (json[key].includes(v) && (!keepOne || json[key].length > 1)) { json[key] = json[key].filter((x) => x !== v); changes.push(`-${opsKey} ${v}`); }
    };
    setOps('iglooTypes', 'igloos', known.igloo, true);
    setOps('iglooFloorings', 'floorings', known.flooring, false);
    setOps('iglooLocations', 'locations', null, true);
    json.stamps = Array.isArray(json.stamps) ? json.stamps : [];
    for (const s of ids(ops.stamps?.add)) if (known.stamp.has(s) && !json.stamps.includes(s)) { json.stamps.push(s); changes.push(`+carimbo ${s}`); }
    for (const s of ids(ops.stamps?.remove)) if (json.stamps.includes(s)) {
      json.stamps = json.stamps.filter((x) => x !== s);
      if (json.stampbook) { json.stampbook.recent_stamps = (json.stampbook.recent_stamps || []).filter((x) => x !== s); json.stampbook.stamps = (json.stampbook.stamps || []).filter((x) => x.stamp !== s); }
      changes.push(`-carimbo ${s}`);
    }
    json.puffles = Array.isArray(json.puffles) ? json.puffles : [];
    for (const p of Array.isArray(ops.puffles?.add) ? ops.puffles.add : []) {
      const type = num(p?.type); const name = String(p?.name || '').trim().slice(0, 12) || 'Puffle';
      if (type === null || !known.puffle.has(type)) continue;
      json.puffleSeq = (json.puffleSeq || 0) + 1;
      json.puffles.push({ id: json.puffleSeq, name, type, clean: 100, rest: 100, food: 100 });
      changes.push(`+puffle ${name} (#${json.puffleSeq})`);
    }
    for (const pid of ids(ops.puffles?.remove)) if (json.puffles.some((p) => p.id === pid)) {
      json.puffles = json.puffles.filter((p) => p.id !== pid);
      json.backyard = (json.backyard || []).filter((x) => x !== pid);
      changes.push(`-puffle #${pid}`);
    }
    await store.write(id, json);
  }
  return { changes, penguin: await getPenguin(w, store, id) };
}

async function kickPenguin(w, id) {
  return w.world.kick(Number(id));
}

module.exports = { getCatalog, listPenguins, getPenguin, updatePenguin, kickPenguin };
