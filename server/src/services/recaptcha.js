const env = require('../config/env');

// reCAPTCHA v2 (checkbox challenge) verification — see routes/auth.js's use
// on /register and /login. Unlike v3 (invisible, score-based), v2's
// siteverify response is just a plain pass/fail (`success`) — no `score`
// or `action` fields at all, so those checks are skipped here rather than
// misread as "0/undefined" and rejected.
//
// Deliberately fails OPEN (returns true / "allow") when RECAPTCHA_SECRET_KEY
// isn't configured, rather than blocking every login/register on a fresh
// install that hasn't set up reCAPTCHA yet — see README for how to turn
// this on for real.
//
// Item pedido: "mesmo que tenha uma key, se não carregou depois de 3
// segundos, deixa se inscrever sem precisar da verificação" — precisa
// bater com client/src/utils/recaptcha.js's RECAPTCHA_TIMEOUT_SENTINEL
// EXATAMENTE (os dois lados usam a mesma string por acordo, não há
// nenhuma outra ligação entre os dois arquivos). Escolha deliberada de
// confiabilidade sobre rigor: perder cadastros legítimos por causa de
// rede instável ou o script do Google sendo bloqueado é pior do que,
// nesses casos específicos, aceitar sem verificação.
const TIMEOUT_SENTINEL = '__recaptcha_unavailable_timeout__';

async function verifyRecaptcha(token) {
  if (!env.RECAPTCHA_SECRET_KEY) return { ok: true, skipped: true };
  if (token === TIMEOUT_SENTINEL) return { ok: true, skipped: true };
  if (!token) return { ok: false, reason: 'Confirme que você não é um robô.' };

  try {
    const params = new URLSearchParams({ secret: env.RECAPTCHA_SECRET_KEY, response: token });
    const res = await fetch('https://www.google.com/recaptcha/api/siteverify', { method: 'POST', body: params });
    const data = await res.json();

    if (!data.success) return { ok: false, reason: 'Falha na verificação do reCAPTCHA. Tente marcar a caixinha de novo.' };
    return { ok: true };
  } catch (err) {
    // A network hiccup talking to Google shouldn't be the thing that takes
    // login down for everyone — logged, but treated as a pass.
    // eslint-disable-next-line no-console
    console.error('[recaptcha] verification request failed:', err.message);
    return { ok: true, skipped: true };
  }
}

module.exports = { verifyRecaptcha };
