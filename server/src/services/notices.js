const prisma = require('../config/prisma');

// Avisos pessoais que ficam salvos (UserNotice): lembrete de evento,
// presente recebido na Loja... Aparecem em Notificações e chegam ao vivo
// pelo socket ('notice:new') + push no celular (best-effort).
// Nunca lança erro: quem chama não deve falhar por causa de um aviso.
async function createNotice(io, userId, { kind, title, body = null, link = null, data = null }) {
  try {
    const notice = await prisma.userNotice.create({
      data: {
        userId, kind: String(kind).slice(0, 32), title: String(title).slice(0, 180),
        body: body ? String(body).slice(0, 1000) : null,
        link: link ? String(link).slice(0, 300) : null,
        data: data ? JSON.stringify(data).slice(0, 4000) : null,
      },
    });
    const shaped = shapeNotice(notice);
    io?.notifyUser?.(userId, 'notice:new', shaped);
    try {
      require('./pushNotifications').sendPushToUser(userId, { title: shaped.title, body: shaped.body || '', data: { link: shaped.link || '/notifications' } })?.catch?.(() => {});
    } catch { /* push opcional */ }
    return shaped;
  } catch (err) {
    console.error('[avisos] falha ao criar aviso:', err?.message || err);
    return null;
  }
}

function shapeNotice(n) {
  let data = null;
  try { data = n.data ? JSON.parse(n.data) : null; } catch { data = null; }
  return { id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, data, readAt: n.readAt, createdAt: n.createdAt };
}

module.exports = { createNotice, shapeNotice };
