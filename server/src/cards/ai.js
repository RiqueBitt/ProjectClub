// IA dos bots — busca gulosa de 1 jogada com função de avaliação (mesma
// ideia do phase-ai: simular cada ação legal no próprio motor e escolher a
// que deixa o estado mais favorável). A dificuldade muda o quanto a IA
// "erra" de propósito e o peso que dá a trocas vs. dano no herói.
const { reduce, legalActions } = require('./engine');
const { ABILITIES } = require('./config');

const PROFILE = {
  FACIL: { noise: 1.6, face: 0.5, lookahead: false },
  MEDIO: { noise: 0.35, face: 0.9, lookahead: false },
  DIFICIL: { noise: 0.08, face: 1, lookahead: true },
  LENDARIO: { noise: 0, face: 1.1, lookahead: true },
};

function unitValue(u) {
  const ab = ABILITIES[u.ability] || ABILITIES.NONE;
  const abv = ab.value ? ab.power * u.value * 0.5 : ab.power;
  return u.atk * 1.2 + u.hp + abv + (u.shield ? 1.5 : 0);
}

// Avaliação do ponto de vista de `seat` (maior = melhor).
function evaluate(state, seat, prof) {
  if (state.over) return state.winner === seat ? 1e6 : -1e6;
  const me = state.players[seat];
  const foe = state.players[1 - seat];
  const myBoard = me.board.reduce((s, u) => s + unitValue(u), 0);
  const foeBoard = foe.board.reduce((s, u) => s + unitValue(u), 0);
  // Ameaça: dano potencial que o inimigo causa no próximo turno.
  const foeThreat = foe.board.reduce((s, u) => s + u.atk, 0);
  const myThreat = me.board.reduce((s, u) => s + u.atk, 0);
  return (
    (me.hp - foe.hp * prof.face) * 1.6
    + (myBoard - foeBoard) * 2
    + (me.hand.length - foe.hand.length) * 0.8
    - (foeThreat >= me.hp ? 200 : 0)
    + (myThreat >= foe.hp ? 60 : 0)
    - me.energy * 0.6 // energia sobrando é desperdício
  );
}

function candidateActions(state, seat) {
  const legal = legalActions(state, seat);
  const out = legal.playable.map((uid) => ({ type: 'PLAY', uid }));
  for (const a of legal.attackers) for (const t of legal.targets[a]) out.push({ type: 'ATTACK', uid: a, target: t });
  return out;
}

/** Joga o turno inteiro do bot. Devolve { state, events } acumulados. */
function playTurn(initial, seat, difficulty = 'MEDIO', rng = Math.random) {
  const prof = PROFILE[difficulty] || PROFILE.MEDIO;
  let state = initial;
  const events = [];
  for (let step = 0; step < 40 && !state.over && state.active === seat; step += 1) {
    const cands = candidateActions(state, seat);
    let best = null;
    let bestScore = evaluate(state, seat, prof); // passar a vez é a base
    for (const a of cands) {
      let r;
      try { r = reduce(state, seat, a); } catch { continue; }
      let score = evaluate(r.state, seat, prof);
      if (prof.lookahead && !r.state.over && a.type === 'PLAY') {
        // Olha uma jogada à frente: vale jogar isto se abrir um bom ataque?
        const next = candidateActions(r.state, seat).filter((x) => x.type === 'ATTACK').slice(0, 8);
        for (const b of next) {
          try { score = Math.max(score, evaluate(reduce(r.state, seat, b).state, seat, prof) - 0.5); } catch { /* ignora */ }
        }
      }
      score += (rng() - 0.5) * prof.noise * 12;
      if (score > bestScore + 0.01) { bestScore = score; best = { a, r }; }
    }
    if (!best) break;
    state = best.r.state;
    events.push(...best.r.events);
  }
  if (!state.over && state.active === seat) {
    const r = reduce(state, seat, { type: 'END_TURN' });
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

module.exports = { playTurn, evaluate };
