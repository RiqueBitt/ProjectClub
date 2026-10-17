// Aviso automático de anúncio novo e evento novo pra todo mundo:
//  - PC/navegador aberto: um evento leve no socket da comunidade
//    ('broadcast:notify'); cada app decide mostrar a notificação do sistema
//    pelas preferências locais (Configurações → Notificações).
//  - Celular/app fechado: push (FCM no Android + Web Push) só pra quem tem
//    aparelho registrado, respeitando a chave da pessoa (notifyAnnouncements
//    / notifyEvents) e o "Não perturbe" agendado.
// Em lotes: busca os aparelhos e as preferências de BATCH pessoas por vez e
// manda no máximo CONCURRENCY pushes ao mesmo tempo.

const KINDS = {
  announcement: { pref: 'notifyAnnouncements', tag: 'anuncio', link: '/anuncios' },
  event: { pref: 'notifyEvents', tag: 'evento', link: '/comunidade/eventos' },
};
const BATCH = 200;
const CONCURRENCY = 10;

function defaultDeps() {
  /* eslint-disable global-require */
  const prisma = require('../config/prisma');
  const np = require('./notificationPrefs');
  return {
    prisma,
    loadExtraPrefs: np.loadExtraPrefs,
    isQuietHoursActive: np.isQuietHoursActive,
    sendPush: (uid, payload) => require('./pushNotifications').sendPushToUser(uid, payload),
  };
  /* eslint-enable global-require */
}

// A pessoa quer esse aviso agora? (chave ligada por padrão)
function wantsBroadcast(extra, kind, { now = Date.now(), isQuietHoursActive } = {}) {
  const k = KINDS[kind];
  if (!k) return false;
  if (extra && extra[k.pref] === false) return false;
  if (isQuietHoursActive && isQuietHoursActive(extra?.quietHours, now)) return false;
  return true;
}

// Quem tem algum aparelho pra receber push (Android ou navegador).
async function pushCapableUserIds(prisma) {
  const [fcm, web] = await Promise.all([
    prisma.pushToken.findMany({ select: { userId: true }, distinct: ['userId'] }).catch(() => []),
    prisma.webPushSubscription.findMany({ select: { userId: true }, distinct: ['userId'] }).catch(() => []),
  ]);
  return [...new Set([...fcm, ...web].map((r) => r.userId))];
}

async function runLimited(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i]; i += 1;
      // eslint-disable-next-line no-await-in-loop
      await fn(item).catch(() => {});
    }
  });
  await Promise.all(workers);
}

function shapeText(kind, { title, body }) {
  const t = String(title || '').trim().slice(0, 120);
  const b = String(body || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  if (kind === 'announcement') return { title: `Novo anúncio: ${t}`, body: b || 'Toque pra ler.' };
  return { title: `Novo evento: ${t}`, body: b || 'Toque pra ver os detalhes.' };
}

// kind: 'announcement' | 'event'. Devolve { pushed, skipped } (pra testes/log).
async function notifyBroadcast(io, { kind, id, title, body, authorId = null, link = null }, deps = defaultDeps()) {
  const k = KINDS[kind];
  if (!k) return { pushed: 0, skipped: 0 };
  const text = shapeText(kind, { title, body });
  const target = link || (kind === 'event' && id ? `/eventos/${encodeURIComponent(id)}` : k.link);
  io?.to?.('community')?.emit?.('broadcast:notify', { kind, id, ...text, link: target, authorId });

  const now = Date.now();
  const ids = (await pushCapableUserIds(deps.prisma)).filter((uid) => uid !== authorId);
  let pushed = 0; let skipped = 0;
  for (let start = 0; start < ids.length; start += BATCH) {
    const chunk = ids.slice(start, start + BATCH);
    // eslint-disable-next-line no-await-in-loop
    const prefs = await deps.loadExtraPrefs(chunk);
    const allowed = chunk.filter((uid) => wantsBroadcast(prefs[uid], kind, { now, isQuietHoursActive: deps.isQuietHoursActive }));
    skipped += chunk.length - allowed.length;
    // eslint-disable-next-line no-await-in-loop
    await runLimited(allowed, CONCURRENCY, async (uid) => {
      await deps.sendPush(uid, { title: text.title, body: text.body, data: { link: target, tag: `${k.tag}:${id || ''}` } });
      pushed += 1;
    });
  }
  return { pushed, skipped };
}

// Dispara sem travar a resposta da requisição e sem nunca lançar erro.
function notifyBroadcastLater(io, payload) {
  setImmediate(() => {
    notifyBroadcast(io, payload).catch((e) => console.error('[avisos] falha ao avisar todo mundo:', e?.message || e));
  });
}

module.exports = { KINDS, BATCH, wantsBroadcast, pushCapableUserIds, shapeText, notifyBroadcast, notifyBroadcastLater };
