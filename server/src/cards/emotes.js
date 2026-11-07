// Emotes rápidos durante a partida (em memória, somem em segundos).
const EMOTES = {
  hello: 'Olá!', gg: 'Bom jogo!', nice: 'Boa jogada!', wow: 'Uau!', think: 'Hmm…', oops: 'Ops!', thanks: 'Valeu!', threat: 'Prepare-se!',
};
const recentByMatch = new Map(); // matchId -> [{ id, by, seat, key, at }]
const lastBy = new Map(); // userId -> ts
let seq = 0;

function push(matchId, by, seat, key) {
  const now = Date.now();
  if (now - (lastBy.get(by) || 0) < 2500) return null;
  lastBy.set(by, now);
  seq += 1;
  const e = { id: seq, by, seat, key, text: EMOTES[key], at: now };
  const list = (recentByMatch.get(matchId) || []).filter((x) => now - x.at < 10_000);
  list.push(e);
  recentByMatch.set(matchId, list.slice(-6));
  if (recentByMatch.size > 3000) for (const k of [...recentByMatch.keys()].slice(0, 500)) recentByMatch.delete(k);
  return e;
}
function recent(matchId) {
  const now = Date.now();
  return (recentByMatch.get(matchId) || []).filter((x) => now - x.at < 8_000);
}
module.exports = { EMOTES, push, recent };
