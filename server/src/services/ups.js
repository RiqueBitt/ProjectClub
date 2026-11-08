const prisma = require('../config/prisma');

// Ups totais de um usuário = curtidas no perfil + votos positivos
// recebidos nos posts e comentários dele no Feed. Usado tanto pra
// devolver na resposta HTTP quanto pra emitir em tempo real (ver
// emitUpsUpdate abaixo) sempre que um voto que afeta esse total
// acontece — perfil, post ou comentário.
async function computeTotalUps(userId) {
  const [profileUps, postUps, commentUps] = await Promise.all([
    prisma.profileVote.count({ where: { toUserId: userId, value: 1 } }),
    prisma.postVote.count({ where: { value: 1, post: { authorId: userId } } }),
    prisma.postCommentVote.count({ where: { value: 1, comment: { authorId: userId } } }),
  ]);
  return profileUps + postUps + commentUps;
}

// Emite pra sala pessoal do usuário (user:<id>) — qualquer aba aberta
// com o perfil dele (o próprio, ou outra pessoa olhando) atualiza o
// número na hora, sem precisar recarregar. Best-effort: nunca derruba a
// resposta HTTP principal se isso falhar.
async function emitUpsUpdate(io, userId) {
  try {
    const totalUps = await computeTotalUps(userId);
    io?.to(`user:${userId}`).emit('user:ups-update', { userId, totalUps });
  } catch { /* best-effort */ }
}

module.exports = { computeTotalUps, emitUpsUpdate };
