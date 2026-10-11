// Motor do Jogo de Cartas — PURO e AUTORITATIVO (ideia do phase.rs: o motor
// guarda TODA a regra; transporte e interface só repassam/exibem).
//   createGame(opts)              → estado inicial
//   reduce(state, seat, action)   → { state, events }  (não muta o original)
//   viewFor(state, seat)          → o que aquele jogador pode ver + ações legais
//   spectatorView(state)          → visão de quem assiste (as duas mãos ocultas)
// Aleatoriedade vem de um PRNG com semente guardada no estado (embaralhar,
// alvos aleatórios), então uma partida é reproduzível (replay) e o cliente
// não influencia nada além das ações que escolhe.
const { ELEMENT_BEATS, ABILITIES, levelStats } = require('./config');

class EngineError extends Error {
  constructor(message) { super(message); this.status = 400; this.engine = true; }
}

// mulberry32 — PRNG pequeno e determinístico.
function rand(state) {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function shuffle(state, arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand(state) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const clone = (x) => (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)));
const isSpell = (c) => c.kind === 'SPELL';
// Qual alvo cada feitiço precisa: ENEMY (unidade ou herói inimigo),
// ENEMY_UNIT, FRIENDLY_UNIT ou nenhum.
const SPELL_TARGET = {
  FEITICO_DANO: 'ENEMY', FEITICO_CONGELAR: 'ENEMY_UNIT', FEITICO_BUFF: 'FRIENDLY_UNIT', FEITICO_ESCUDO: 'FRIENDLY_UNIT',
};

function makeInstance(state, card, level) {
  const st = levelStats(card, level);
  state.uid += 1;
  return {
    uid: `u${state.uid}`, cardId: card.id, name: card.name, imageUrl: card.imageUrl || null,
    rarity: card.rarity, element: card.element, kind: card.kind === 'SPELL' ? 'SPELL' : 'UNIT', cost: Math.max(0, card.cost | 0),
    atk: card.kind === 'SPELL' ? 0 : st.attack, hp: card.kind === 'SPELL' ? 0 : st.health,
    maxHp: card.kind === 'SPELL' ? 0 : st.health, baseAtk: card.kind === 'SPELL' ? 0 : st.attack,
    ability: card.ability || 'NONE', value: Math.max(0, card.abilityValue | 0) + (card.kind === 'SPELL' ? Math.floor(((level || 1) - 1) / 2) : 0),
    level: level || 1, foil: !!card.foil,
    shield: card.ability === 'ESCUDO', stealth: card.ability === 'FURTIVO', frozen: false, attacksLeft: 0, sick: true,
  };
}

function makeToken(state, element) {
  state.uid += 1;
  return {
    uid: `u${state.uid}`, cardId: null, token: true, name: 'Recruta', imageUrl: null, rarity: 'COMUM', element, kind: 'UNIT', cost: 0,
    atk: 1, hp: 1, maxHp: 1, baseAtk: 1, ability: 'NONE', value: 0, level: 1, shield: false, stealth: false, frozen: false, attacksLeft: 0, sick: true,
  };
}

/**
 * players: [{ userId, name, avatarUrl, isBot, hp, deck: [{ card, level }] }] (2 jogadores)
 */
function createGame({ players, rules, seed, first }) {
  if (!Array.isArray(players) || players.length !== 2) throw new EngineError('A partida precisa de 2 jogadores.');
  const state = {
    v: 2, rng: (seed >>> 0) || 1, uid: 0, turn: 1, seq: 0,
    active: first === 1 ? 1 : 0, firstSeat: first === 1 ? 1 : 0, winner: null, over: false, endReason: null,
    rules: { ...rules }, log: [], played: [[], []],
    players: [],
  };
  state.players = players.map((p) => ({
    userId: p.userId || null, name: String(p.name || 'Jogador').slice(0, 40), avatarUrl: p.avatarUrl || null,
    isBot: !!p.isBot, hp: p.hp || rules.startHp, maxHp: p.hp || rules.startHp,
    energy: 0, maxEnergy: 0, fatigue: 0, timeouts: 0,
    deck: shuffle(state, p.deck.map((d) => makeInstance(state, d.card, d.level))),
    hand: [], board: [], graveyard: 0,
  }));
  const events = [];
  for (let s = 0; s < 2; s += 1) {
    // Quem joga depois começa com uma carta a mais (compensa a iniciativa).
    const n = rules.startHand + (s === state.active ? 0 : 1);
    for (let i = 0; i < n; i += 1) draw(state, s, events);
  }
  startTurn(state, state.active, events);
  return state;
}

function pushLog(state, text) {
  state.log.push({ t: state.turn, text });
  if (state.log.length > 40) state.log.splice(0, state.log.length - 40);
}

function draw(state, seat, events) {
  const p = state.players[seat];
  const card = p.deck.shift();
  if (!card) {
    p.fatigue += 1;
    damageHero(state, seat, p.fatigue, events, { source: 'fatigue' });
    events.push({ type: 'fatigue', seat, amount: p.fatigue });
    return;
  }
  if (p.hand.length >= state.rules.maxHand) {
    p.graveyard += 1;
    events.push({ type: 'burn', seat, card: publicCard(card) });
    return;
  }
  p.hand.push(card);
  events.push({ type: 'draw', seat });
}

function startTurn(state, seat, events) {
  const p = state.players[seat];
  p.maxEnergy = Math.min(state.rules.maxEnergy, p.maxEnergy + 1);
  p.energy = p.maxEnergy;
  for (const u of p.board) {
    u.sick = false;
    if (u.frozen) {
      // Congelada: perde este turno de ataque e descongela.
      u.attacksLeft = 0;
      u.frozen = false;
      events.push({ type: 'thaw', seat, uid: u.uid });
    } else {
      u.attacksLeft = u.ability === 'FURIA' ? 2 : 1;
    }
    if (u.ability === 'REGENERA' && u.hp < u.maxHp) {
      const heal = Math.min(u.value, u.maxHp - u.hp);
      u.hp += heal;
      if (heal) events.push({ type: 'heal', seat, uid: u.uid, amount: heal });
    }
  }
  state.turnStartedSeq = state.seq;
  events.push({ type: 'turn', seat, turn: state.turn });
  draw(state, seat, events);
}

function damageHero(state, seat, amount, events, meta = {}) {
  if (amount <= 0 || state.over) return;
  const p = state.players[seat];
  p.hp -= amount;
  events.push({ type: 'heroDamage', seat, amount, ...meta });
  if (p.hp <= 0) finish(state, 1 - seat, 'hp', events);
}

function healHero(state, seat, amount, events) {
  const p = state.players[seat];
  const h = Math.min(amount, p.maxHp - p.hp);
  if (h > 0) { p.hp += h; events.push({ type: 'heroHeal', seat, amount: h }); }
}

function finish(state, winnerSeat, reason, events) {
  if (state.over) return;
  state.over = true;
  state.winner = winnerSeat;
  state.endReason = reason;
  events.push({ type: 'gameOver', winner: winnerSeat, reason });
  pushLog(state, `${state.players[winnerSeat].name} venceu a partida!`);
}

// Dano em unidade, com escudo, veneno e congelamento. Devolve o dano efetivo.
function damageUnit(state, seat, unit, amount, events, { poison = false, freeze = false } = {}) {
  if (amount <= 0) return 0;
  if (unit.shield) {
    unit.shield = false;
    events.push({ type: 'shieldBreak', seat, uid: unit.uid });
    return 0;
  }
  unit.hp -= amount;
  events.push({ type: 'unitDamage', seat, uid: unit.uid, amount });
  if (poison && unit.hp > 0) { unit.hp = 0; events.push({ type: 'poison', seat, uid: unit.uid }); }
  if (freeze && unit.hp > 0 && !unit.frozen) { unit.frozen = true; events.push({ type: 'freeze', seat, uid: unit.uid }); }
  return amount;
}

function cleanupDead(state, events) {
  for (let s = 0; s < 2; s += 1) {
    const p = state.players[s];
    const dead = p.board.filter((u) => u.hp <= 0);
    if (!dead.length) continue;
    p.board = p.board.filter((u) => u.hp > 0);
    for (const u of dead) {
      if (!u.token) p.graveyard += 1;
      events.push({ type: 'death', seat: s, uid: u.uid });
      if (u.ability === 'ULTIMO_SUSPIRO') damageHero(state, 1 - s, u.value, events, { source: u.uid });
    }
  }
}

function elementBonus(state, attacker, defenderElement) {
  return (ELEMENT_BEATS[attacker.element] || []).includes(defenderElement) ? state.rules.elementBonus : 0;
}

// Unidades que o inimigo consegue mirar (Furtivo esconde até atacar).
const targetable = (p) => p.board.filter((u) => !u.stealth);

function spellTargets(state, seat, card) {
  const me = state.players[seat];
  const foe = state.players[1 - seat];
  switch (SPELL_TARGET[card.ability]) {
    case 'ENEMY': return ['hero', ...targetable(foe).map((u) => u.uid)];
    case 'ENEMY_UNIT': return targetable(foe).map((u) => u.uid);
    case 'FRIENDLY_UNIT': return me.board.map((u) => u.uid);
    default: return null; // sem alvo
  }
}

// ---------- Ações legais (o cliente só exibe isto) ----------
function legalActions(state, seat) {
  const empty = { playable: [], spellTargets: {}, attackers: [], targets: {}, canEndTurn: false };
  if (state.over || state.active !== seat) return empty;
  const me = state.players[seat];
  const foe = state.players[1 - seat];
  const boardFull = me.board.length >= state.rules.boardSize;
  const playable = [];
  const spellT = {};
  for (const c of me.hand) {
    if (c.cost > me.energy) continue;
    if (isSpell(c)) {
      const t = spellTargets(state, seat, c);
      if (t && !t.length) continue; // feitiço com alvo sem alvo possível
      playable.push(c.uid);
      if (t) spellT[c.uid] = t;
    } else if (!boardFull) playable.push(c.uid);
  }
  const attackers = me.board.filter((u) => u.attacksLeft > 0 && u.atk > 0 && !u.frozen && (!u.sick || u.ability === 'INVESTIDA')).map((u) => u.uid);
  const visible = targetable(foe);
  const guards = visible.filter((u) => u.ability === 'GUARDA').map((u) => u.uid);
  const validTargets = guards.length ? guards : ['hero', ...visible.map((u) => u.uid)];
  const targets = Object.fromEntries(attackers.map((a) => [a, validTargets]));
  return { playable, spellTargets: spellT, attackers, targets, canEndTurn: true };
}

// ---------- Reducer ----------
function reduce(prev, seat, action) {
  if (!prev || prev.over) throw new EngineError('A partida já terminou.');
  if (seat !== 0 && seat !== 1) throw new EngineError('Jogador inválido.');
  const type = action?.type;
  const state = clone(prev);
  if (!state.played) state.played = [[], []];
  const events = [];

  if (type === 'SURRENDER') {
    pushLog(state, `${state.players[seat].name} desistiu.`);
    finish(state, 1 - seat, 'surrender', events);
    state.seq += 1;
    return { state, events };
  }
  if (type === 'TIMEOUT') {
    // Só o servidor manda isto (prazo do turno estourou).
    const p = state.players[state.active];
    p.timeouts += 1;
    pushLog(state, `${p.name} demorou demais — turno passado.`);
    if (p.timeouts >= state.rules.maxTimeouts) {
      finish(state, 1 - state.active, 'timeout', events);
      state.seq += 1;
      return { state, events };
    }
    endTurn(state, events);
    state.seq += 1;
    return { state, events };
  }

  if (state.active !== seat) throw new EngineError('Não é a sua vez.');
  const me = state.players[seat];
  const foe = state.players[1 - seat];

  if (type === 'PLAY') {
    const idx = me.hand.findIndex((c) => c.uid === action.uid);
    if (idx < 0) throw new EngineError('Essa carta não está na sua mão.');
    const card = me.hand[idx];
    if (card.cost > me.energy) throw new EngineError('Energia insuficiente.');
    if (isSpell(card)) {
      const t = spellTargets(state, seat, card);
      if (t) {
        if (!t.length) throw new EngineError('Esse feitiço não tem alvo agora.');
        if (!t.includes(action.target)) throw new EngineError('Escolha um alvo válido para o feitiço.');
      }
      me.energy -= card.cost;
      me.hand.splice(idx, 1);
      me.graveyard += 1;
      me.timeouts = 0;
      state.played[seat].push(card.cardId);
      events.push({ type: 'spell', seat, card: publicCard(card), target: t ? action.target : null });
      pushLog(state, `${me.name} lançou ${card.name}.`);
      castSpell(state, seat, card, t ? action.target : null, events);
      cleanupDead(state, events);
    } else {
      if (me.board.length >= state.rules.boardSize) throw new EngineError('Seu campo está cheio.');
      me.energy -= card.cost;
      me.hand.splice(idx, 1);
      card.sick = true;
      card.attacksLeft = card.ability === 'FURIA' ? 2 : 1;
      me.board.push(card);
      me.timeouts = 0;
      state.played[seat].push(card.cardId);
      events.push({ type: 'play', seat, card: publicCard(card) });
      pushLog(state, `${me.name} jogou ${card.name}.`);
      onPlay(state, seat, card, events);
      cleanupDead(state, events);
    }
  } else if (type === 'ATTACK') {
    const legal = legalActions(state, seat);
    if (!legal.attackers.includes(action.uid)) throw new EngineError('Essa unidade não pode atacar agora.');
    if (!legal.targets[action.uid].includes(action.target)) {
      throw new EngineError(targetable(foe).some((u) => u.ability === 'GUARDA') ? 'Você precisa atacar uma unidade com Guarda primeiro.' : 'Alvo inválido.');
    }
    const att = me.board.find((u) => u.uid === action.uid);
    att.attacksLeft -= 1;
    if (att.stealth) { att.stealth = false; events.push({ type: 'reveal', seat, uid: att.uid }); }
    me.timeouts = 0;
    if (action.target === 'hero') {
      events.push({ type: 'attack', seat, uid: att.uid, target: 'hero' });
      damageHero(state, 1 - seat, att.atk, events, { source: att.uid });
      if (att.ability === 'ROUBO_VIDA') healHero(state, seat, att.atk, events);
      pushLog(state, `${att.name} atacou ${foe.name} (${att.atk}).`);
    } else {
      const def = foe.board.find((u) => u.uid === action.target);
      events.push({ type: 'attack', seat, uid: att.uid, target: def.uid });
      const dmgA = att.atk + elementBonus(state, att, def.element);
      const dmgD = def.atk + elementBonus(state, def, att.element) + (def.ability === 'ESPINHOS' ? def.value : 0);
      const dealt = damageUnit(state, 1 - seat, def, dmgA, events, { poison: att.ability === 'VENENO', freeze: att.ability === 'CONGELA' });
      const taken = damageUnit(state, seat, att, dmgD, events, { poison: def.ability === 'VENENO', freeze: def.ability === 'CONGELA' });
      if (att.ability === 'ROUBO_VIDA' && dealt) healHero(state, seat, dealt, events);
      if (def.ability === 'ROUBO_VIDA' && taken) healHero(state, 1 - seat, taken, events);
      pushLog(state, `${att.name} atacou ${def.name}.`);
      cleanupDead(state, events);
    }
  } else if (type === 'END_TURN') {
    me.timeouts = 0;
    endTurn(state, events);
  } else {
    throw new EngineError('Ação desconhecida.');
  }
  state.seq += 1;
  return { state, events };
}

function endTurn(state, events) {
  if (state.over) return;
  const next = 1 - state.active;
  for (const u of state.players[state.active].board) u.attacksLeft = 0;
  state.active = next;
  if (next === state.firstSeat) state.turn += 1; // um "turno" = cada jogador jogou uma vez
  startTurn(state, next, events);
}

function strongest(list) {
  return [...list].sort((a, b) => (b.atk + b.hp) - (a.atk + a.hp))[0];
}

function onPlay(state, seat, card, events) {
  const me = state.players[seat];
  const foe = state.players[1 - seat];
  switch (card.ability) {
    case 'GRITO_DANO': damageHero(state, 1 - seat, card.value, events, { source: card.uid }); break;
    case 'GRITO_CURA': healHero(state, seat, card.value, events); break;
    case 'GRITO_COMPRA': for (let i = 0; i < card.value; i += 1) draw(state, seat, events); break;
    case 'ENERGIA': me.energy = Math.min(state.rules.maxEnergy, me.energy + card.value); events.push({ type: 'energy', seat, amount: card.value }); break;
    case 'AURA':
      for (const u of me.board) if (u.uid !== card.uid) { u.atk += card.value; events.push({ type: 'buff', seat, uid: u.uid, atk: card.value }); }
      break;
    case 'PROTEGER':
      for (const u of me.board) if (u.uid !== card.uid && !u.shield) { u.shield = true; events.push({ type: 'shieldUp', seat, uid: u.uid }); }
      break;
    case 'INVOCAR':
      for (let i = 0; i < Math.max(1, card.value) && me.board.length < state.rules.boardSize; i += 1) {
        const tk = makeToken(state, card.element);
        me.board.push(tk);
        events.push({ type: 'summon', seat, card: publicCard(tk) });
      }
      break;
    case 'GRITO_RAIO': {
      const vis = targetable(foe);
      if (!vis.length) { damageHero(state, 1 - seat, card.value, events, { source: card.uid }); break; }
      const target = strongest(vis);
      events.push({ type: 'bolt', seat, uid: card.uid, target: target.uid });
      damageUnit(state, 1 - seat, target, card.value, events);
      break;
    }
    default: break;
  }
}

function castSpell(state, seat, card, target, events) {
  const me = state.players[seat];
  const foe = state.players[1 - seat];
  const v = card.value;
  switch (card.ability) {
    case 'FEITICO_DANO':
      if (target === 'hero') damageHero(state, 1 - seat, v, events, { source: card.uid });
      else { const u = foe.board.find((x) => x.uid === target); events.push({ type: 'bolt', seat, uid: null, target }); damageUnit(state, 1 - seat, u, v, events); }
      break;
    case 'FEITICO_AREA':
      for (const u of [...foe.board]) damageUnit(state, 1 - seat, u, v, events);
      break;
    case 'FEITICO_CURA': healHero(state, seat, v, events); break;
    case 'FEITICO_COMPRA': for (let i = 0; i < Math.max(1, v); i += 1) draw(state, seat, events); break;
    case 'FEITICO_BUFF': {
      const u = me.board.find((x) => x.uid === target);
      u.atk += v; u.hp += v; u.maxHp += v;
      events.push({ type: 'buff', seat, uid: u.uid, atk: v, hp: v });
      break;
    }
    case 'FEITICO_ESCUDO': {
      const u = me.board.find((x) => x.uid === target);
      u.shield = true;
      events.push({ type: 'shieldUp', seat, uid: u.uid });
      break;
    }
    case 'FEITICO_CONGELAR': {
      const u = foe.board.find((x) => x.uid === target);
      u.frozen = true;
      events.push({ type: 'freeze', seat: 1 - seat, uid: u.uid });
      if (v > 0) damageUnit(state, 1 - seat, u, v, events);
      break;
    }
    default: break;
  }
}

// O que vai pro cliente sobre uma carta (sem nada escondido).
function publicCard(c) {
  return {
    uid: c.uid, cardId: c.cardId, name: c.name, imageUrl: c.imageUrl, rarity: c.rarity, element: c.element, kind: c.kind || 'UNIT',
    cost: c.cost, atk: c.atk, hp: c.hp, maxHp: c.maxHp, baseAtk: c.baseAtk, ability: c.ability, value: c.value,
    level: c.level, foil: !!c.foil, token: !!c.token, shield: c.shield, stealth: !!c.stealth, frozen: !!c.frozen,
    attacksLeft: c.attacksLeft, sick: c.sick,
  };
}

function playerView(state, p, s, showHand) {
  return {
    seat: s, userId: p.userId, name: p.name, avatarUrl: p.avatarUrl, isBot: p.isBot,
    hp: p.hp, maxHp: p.maxHp, energy: p.energy, maxEnergy: p.maxEnergy,
    deckCount: p.deck.length, handCount: p.hand.length, graveyard: p.graveyard, fatigue: p.fatigue,
    hand: showHand ? p.hand.map(publicCard) : undefined,
    board: p.board.map(publicCard),
  };
}

// Visão de um jogador: mão do oponente e os dois baralhos ficam ocultos.
function viewFor(state, seat) {
  return {
    seat, turn: state.turn, active: state.active, over: state.over, winner: state.winner, endReason: state.endReason,
    seq: state.seq, rules: state.rules, log: state.log.slice(-15),
    me: playerView(state, state.players[seat], seat, true), foe: playerView(state, state.players[1 - seat], 1 - seat, false),
    legal: legalActions(state, seat),
  };
}

// Visão de espectador / replay: as duas mãos ocultas, nenhuma ação.
function spectatorView(state, seat = 0) {
  const v = viewFor(state, seat === 1 ? 1 : 0);
  v.me.hand = undefined;
  v.legal = { playable: [], spellTargets: {}, attackers: [], targets: {}, canEndTurn: false };
  v.spectator = true;
  return v;
}

// Eventos filtrados pra um jogador (não revela a carta comprada pelo oponente).
function eventsFor(events, seat) {
  return events.map((e) => (e.type === 'burn' && e.seat !== seat ? { type: 'burn', seat: e.seat } : e));
}

module.exports = { createGame, reduce, viewFor, spectatorView, eventsFor, legalActions, EngineError, publicCard, SPELL_TARGET, ABILITIES };
