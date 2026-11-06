'use strict';
// Jukebox da Danceteria do Club Penguin (ver services/waddle/jukebox.js).
//   cpjb:get                 → manda o estado da sala (cpjb:state)
//   cpjb:add {videoId|url, hint:{title,channel,duration}}
//   cpjb:skip                → pula (quem colocou/equipe) ou vota
//   cpjb:remove {id}         → tira da fila (a própria ou equipe)
//   cpjb:clear               → equipe: desliga e limpa a fila
//   cpjb:report {videoId, kind:'error'|'ended'} → aviso do player
const jukebox = require('../services/waddle/jukebox');

function register(socket, userId) {
  // anti-spam simples por conexão: 12 eventos a cada 5 s
  let bucket = 0; let since = Date.now();
  const allow = () => {
    const t = Date.now();
    if (t - since > 5000) { since = t; bucket = 0; }
    bucket += 1;
    return bucket <= 12;
  };
  const on = (event, fn) => socket.on(event, async (payload = {}, ack) => {
    try {
      const jb = jukebox.get();
      if (!jb || !allow()) { if (typeof ack === 'function') ack({ ok: false }); return; }
      const out = await fn(jb, payload && typeof payload === 'object' ? payload : {});
      if (typeof ack === 'function') ack(out || { ok: true });
    } catch (err) {
      console.error(`[socket] ${event} falhou:`, err?.message || err);
      if (typeof ack === 'function') ack({ ok: false });
    }
  });
  on('cpjb:get', (jb) => { jb.get(userId); return { ok: true }; });
  on('cpjb:add', (jb, p) => jb.add(userId, { videoId: p.videoId, url: p.url, hint: p.hint }));
  on('cpjb:skip', (jb) => jb.skip(userId));
  on('cpjb:remove', (jb, p) => jb.remove(userId, String(p.id || '')));
  on('cpjb:clear', (jb) => jb.clear(userId));
  on('cpjb:report', (jb, p) => { jb.report(userId, { videoId: String(p.videoId || ''), kind: String(p.kind || '') }); return { ok: true }; });
}

module.exports = { register };
