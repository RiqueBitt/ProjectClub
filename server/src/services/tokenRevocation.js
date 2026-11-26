// Derrubar sessões vale NA HORA, não só quando o token de acesso vence.
//
// O token de acesso (JWT) vale 15 min por conta própria. Antes, depois de
// "trocar a senha", "redefinir a senha", "sair dos outros aparelhos",
// "excluir/desativar a conta" ou uma ação da staff, quem já tinha um token
// (roubado, por exemplo) continuava usando a API por até 15 min — e um
// socket aberto continuava recebendo DMs em tempo real sem prazo nenhum.
//
// Toda derrubada já grava no Redis `sess:revoked-at:<userId>` (horário em
// ms — sessionKeep.markSessionsRevoked no Node, session::mark_sessions_revoked
// no Rust). Aqui: token emitido ANTES desse horário não vale mais. O
// aparelho que continua logado renova sozinho (o refresh dele segue valendo)
// e ganha um token novo, emitido depois.
//
// Comparação em segundos inteiros (o `iat` do JWT é em segundos): um token
// emitido no MESMO segundo da derrubada ainda vale — sem isso, quem acabou
// de trocar a senha podia renovar e receber outro token "velho" no mesmo
// segundo e cair fora. Igual no Rust (rust/pc-server/src/auth.rs).
//
// Redis fora do ar → não derruba ninguém (o token vence em 15 min de
// qualquer jeito); o pedido nunca fica preso esperando o Redis.
// Carregado só na hora de usar: o middleware de login (que importa este
// arquivo) não abre conexão com o Redis só por ser importado (testes e
// scripts que só usam o middleware não ficavam presos esperando o Redis).
const redisClient = () => require('../config/redis').redis;

const revKey = (uid) => `sess:revoked-at:${uid}`;
const REDIS_WAIT_MS = 300;

async function revokedAtMs(userId) {
  if (!userId) return 0;
  try {
    const v = await Promise.race([
      redisClient().get(revKey(userId)),
      new Promise((resolve) => { const t = setTimeout(() => resolve(null), REDIS_WAIT_MS); t.unref?.(); }),
    ]);
    return Number(v) || 0;
  } catch {
    return 0;
  }
}

/** Vários de uma vez (varredura dos sockets): array de ms (0 = nunca). */
async function revokedAtMany(userIds) {
  if (!userIds.length) return [];
  try {
    const vals = await redisClient().mget(userIds.map(revKey));
    return vals.map((v) => Number(v) || 0);
  } catch {
    return userIds.map(() => 0);
  }
}

/** `iatSec` (segundos, do JWT) é de antes da derrubada em `revokedMs`? */
function isStale(iatSec, revokedMs) {
  if (!revokedMs || !Number.isFinite(Number(iatSec))) return false;
  return Number(iatSec) < Math.floor(revokedMs / 1000);
}

/** O token (payload já verificado) foi derrubado? */
async function isAccessTokenRevoked(payload) {
  if (!payload?.sub || payload.iat === undefined) return false;
  return isStale(payload.iat, await revokedAtMs(payload.sub));
}

// Quem quer saber na hora (os sockets): derrubada feita aqui no Node.
const listeners = new Set();
function onRevoke(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notifyRevoked(userId, atMs = Date.now()) {
  for (const fn of listeners) {
    try { fn(userId, atMs); } catch (err) { console.warn('[sessão] aviso de derrubada falhou:', err?.message || err); }
  }
}

module.exports = { revokedAtMs, revokedAtMany, isStale, isAccessTokenRevoked, onRevoke, notifyRevoked, revKey };
