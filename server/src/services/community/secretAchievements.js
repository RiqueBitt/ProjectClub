// Conquistas secretas (e as de temporada) — desbloqueadas por ações
// escondidas, não por uma barra de progresso.
//
// As secretas têm Achievement.hidden = true: na lista aparecem como "???"
// até a pessoa desbloquear (ver achievementsController.listAchievements).
// progressType 'SECRET'/'SEASON' não tem cálculo em getProgressByType (dá 0),
// então checkAndUnlock nunca libera sozinho — só unlock() abaixo.
const { deps } = require('./common');
const { hourSP } = require('../../utils/spTime');

// Entram no catálogo seed (data/achievementsCatalog.js) — a staff edita depois.
const SECRET_ACHIEVEMENTS = [
  { key: 'secreta_coruja', name: 'Coruja da Madrugada', description: 'Mandou mensagem às 3 da manhã. Vai dormir!', rarity: 'RARE', progressType: 'SECRET', target: 1, position: 200, hidden: true },
  { key: 'secreta_reacoes', name: 'Reação em Cadeia', description: 'Reagiu a 100 mensagens.', rarity: 'RARE', progressType: 'REACTIONS_GIVEN', target: 100, position: 201, hidden: true },
  { key: 'secreta_sala_propria', name: 'Dono da Festa', description: 'Criou a sua primeira sala de voz temporária.', rarity: 'COMMON', progressType: 'SECRET', target: 1, position: 202, hidden: true },
  { key: 'secreta_generoso', name: 'Mão Aberta', description: 'Deu a primeira gorjeta pra alguém.', rarity: 'COMMON', progressType: 'SECRET', target: 1, position: 203, hidden: true },
  { key: 'secreta_sortudo', name: 'Pé-Quente', description: 'Ganhou o sorteio da semana.', rarity: 'EPIC', progressType: 'SECRET', target: 1, position: 204, hidden: true },
  { key: 'secreta_gente_boa', name: 'Gente Boa', description: 'Recebeu 10 agradecimentos da comunidade.', rarity: 'RARE', progressType: 'SECRET', target: 1, position: 205, hidden: true },
];

// Uma por temporada temática (services/community/seasons.js): vem junto com
// a primeira recompensa diária da temporada. Não são secretas.
const SEASON_ACHIEVEMENTS = [
  { key: 'temporada_natal', name: 'Espírito Natalino', description: 'Participou da temporada de Natal.', rarity: 'RARE', progressType: 'SEASON', target: 1, position: 220 },
  { key: 'temporada_anonovo', name: 'Fogos de Ano Novo', description: 'Participou da temporada de Ano Novo.', rarity: 'RARE', progressType: 'SEASON', target: 1, position: 221 },
  { key: 'temporada_carnaval', name: 'Folião', description: 'Participou da temporada de Carnaval.', rarity: 'RARE', progressType: 'SEASON', target: 1, position: 222 },
  { key: 'temporada_festajunina', name: 'Arraiá do Club', description: 'Participou da temporada de Festa Junina.', rarity: 'RARE', progressType: 'SEASON', target: 1, position: 223 },
  { key: 'temporada_halloween', name: 'Gostosuras ou Travessuras', description: 'Participou da temporada de Halloween.', rarity: 'RARE', progressType: 'SEASON', target: 1, position: 224 },
  { key: 'temporada_aniversario', name: 'Parabéns, Project Club!', description: 'Comemorou o aniversário do Project Club.', rarity: 'EPIC', progressType: 'SEASON', target: 1, position: 225 },
];

const REACTIONS_CHECK_EVERY = 10;
const THANKS_FOR_GENTE_BOA = 10;

// Memória curta pra não ir ao banco a cada mensagem/reação.
const known = new Set(); // `${userId}|${key}` já desbloqueada (ou tentada nesta hora)
const reactionTicks = new Map();

/** Desbloqueia uma conquista pela chave (se existir e estiver ativa). */
async function unlock(userId, key, io = null, over = {}) {
  const memo = `${userId}|${key}`;
  if (!userId || known.has(memo)) return false;
  const d = deps({ io, ...over });
  try {
    const def = await d.db.achievement.findUnique({ where: { key } });
    if (!def || !def.enabled) return false;
    try {
      await d.db.userAchievement.create({ data: { userId, achievementId: key } });
    } catch (err) {
      if (err?.code === 'P2002') { known.add(memo); return false; }
      throw err;
    }
    known.add(memo);
    d.io?.to?.(`user:${userId}`)?.emit?.('achievement:unlocked', def);
    return true;
  } catch (err) {
    console.error('[conquistas secretas] falhou:', err?.message || err);
    return false;
  }
}

/** Ganchos chamados a cada atividade contada (ver community/hooks.js). */
function onActivity(userId, type, io, now = Date.now(), over = {}) {
  if (type === 'MESSAGES' && hourSP(now) === 3) return unlock(userId, 'secreta_coruja', io, over);
  if (type === 'REACTIONS') {
    if (known.has(`${userId}|secreta_reacoes`)) return Promise.resolve(false);
    const n = (reactionTicks.get(userId) || 0) + 1;
    if (reactionTicks.size > 50000) reactionTicks.clear();
    reactionTicks.set(userId, n);
    if (n % REACTIONS_CHECK_EVERY !== 0) return Promise.resolve(false);
    const d = deps({ io, ...over });
    return d.db.reaction.count({ where: { userId } })
      .then((count) => (count >= 100 ? unlock(userId, 'secreta_reacoes', io, over) : false))
      .catch(() => false);
  }
  return Promise.resolve(false);
}

function _reset() { known.clear(); reactionTicks.clear(); }

module.exports = { unlock, onActivity, SECRET_ACHIEVEMENTS, SEASON_ACHIEVEMENTS, THANKS_FOR_GENTE_BOA, _reset };
