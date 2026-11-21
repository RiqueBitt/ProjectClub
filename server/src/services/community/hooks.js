// Ganchos leves chamados pelos sistemas que já existem (missões, XP, salas
// temporárias, aprovação de inscrição). Nunca lançam erro e nunca esperam
// o banco — quem chama segue normal mesmo se algo aqui falhar.
const activity = require('./activity');

/** Cada evento contado pelas missões (mensagem, minuto em call, post, reação). */
function onTrack(userId, type, amount = 1, io = null) {
  try {
    activity.record(userId, type, amount);
    require('./secretAchievements').onActivity(userId, type, io)?.catch?.(() => {});
  } catch { /* nunca atrapalha quem chamou */ }
}

/** XP ganho (mensagem, call, missão) — entra na retrospectiva do mês. */
function onXp(userId, xp) {
  try { if (xp > 0) activity.record(userId, 'XP', xp); } catch { /* idem */ }
}

/** Primeira sala de voz temporária → conquista secreta. */
function onTempRoomCreated(userId, io = null) {
  try { require('./secretAchievements').unlock(userId, 'secreta_sala_propria', io).catch?.(() => {}); } catch { /* idem */ }
}

/**
 * Conta criada a partir de uma inscrição: liga a indicação (se houver).
 * `applicationId` é null na auto-aprovação do dono.
 */
function onAccountApproved({ userId, applicationId = null, referralCode = null, ip = null }, _io = null) {
  setImmediate(async () => {
    try {
      const referrals = require('./referrals');
      if (applicationId) await referrals.linkInvitee({ applicationId, userId });
      else if (referralCode) await referrals.attachToUser({ code: referralCode, userId, ip });
    } catch (err) { console.error('[indicações] falha ao ligar conta:', err?.message || err); }
  });
}

module.exports = { onTrack, onXp, onTempRoomCreated, onAccountApproved };
