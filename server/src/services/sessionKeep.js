// "Lembrar login" com iron-session: um cookie selado (criptografado e
// assinado) que guarda só { uid, iat }. Serve de rede de segurança quando o
// cookie de refresh some ou é rejeitado por engano (ex.: atualização do app
// no meio de uma renovação) — sem ele a pessoa tinha que logar de novo.
//
// Segurança:
// - selado com uma senha derivada do JWT_REFRESH_SECRET (não precisa de
//   variável nova); só o servidor abre/cria.
// - invalidação: qualquer "derrubar sessões" (logout de tudo, troca de senha,
//   banimento, suspeita de roubo) grava no Redis o horário; cookies criados
//   antes disso deixam de valer. Sem Redis respondendo, o cookie NÃO é aceito.
// - logout normal apaga o cookie.
const crypto = require('crypto');
const env = require('../config/env');
const { redis } = require('../config/redis');

const COOKIE = 'pcKeep';
const TTL_SECONDS = 90 * 24 * 60 * 60; // 90 dias (renova a cada uso)
const PASSWORD = crypto.createHmac('sha256', String(env.JWT_REFRESH_SECRET)).update('pc-keep-session-v1').digest('hex');
const revKey = (uid) => `sess:revoked-at:${uid}`;

let ironP = null;
const iron = () => (ironP ||= import('iron-session'));

const cookieOpts = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: env.NODE_ENV === 'production',
  maxAge: TTL_SECONDS * 1000,
  path: '/api/auth',
});

// `refreshTokenId` (Fase 5): o cookie passa a lembrar QUAL sessão (refresh
// token) o criou. Assim, encerrar só aquele aparelho em Configurações →
// Segurança também invalida o "lembrar login" dele (ver keepSessionAlive
// em authController.js) — antes só "derrubar todas" fazia isso.
async function setKeepCookie(res, userId, refreshTokenId = null) {
  try {
    const { sealData } = await iron();
    const payload = { uid: userId, iat: Date.now(), ...(refreshTokenId ? { rid: String(refreshTokenId) } : {}) };
    const sealed = await sealData(payload, { password: PASSWORD, ttl: TTL_SECONDS });
    res.cookie(COOKIE, sealed, cookieOpts());
  } catch (err) {
    console.warn('[sessão] não deu pra criar o cookie de lembrar login:', err?.message || err);
  }
}

function clearKeepCookie(res) {
  res.clearCookie(COOKIE, { path: '/api/auth' });
}

// Devolve { uid, rid } se o cookie for válido e não tiver sido derrubado
// (rid = refresh token que criou o cookie; ausente em cookies antigos).
async function readKeepCookieData(req) {
  const raw = req.cookies?.[COOKIE];
  if (!raw) return null;
  try {
    const { unsealData } = await iron();
    const data = await unsealData(raw, { password: PASSWORD, ttl: TTL_SECONDS });
    if (!data?.uid || !data?.iat) return null;
    const revokedAt = Number(await redis.get(revKey(data.uid))) || 0; // erro no Redis → cai no catch → recusa
    if (data.iat < revokedAt) return null;
    return { uid: data.uid, rid: typeof data.rid === 'string' ? data.rid : null };
  } catch {
    return null;
  }
}

// Devolve o userId se o cookie for válido e não tiver sido derrubado.
async function readKeepCookie(req) {
  const data = await readKeepCookieData(req);
  return data ? data.uid : null;
}

// Chamar sempre que todas as sessões de alguém forem derrubadas.
async function markSessionsRevoked(userId) {
  try { await redis.set(revKey(userId), String(Date.now()), 'EX', TTL_SECONDS); } catch (err) {
    console.warn('[sessão] falha ao registrar derrubada de sessões:', err?.message || err);
  }
}

module.exports = { setKeepCookie, clearKeepCookie, readKeepCookie, readKeepCookieData, markSessionsRevoked };
