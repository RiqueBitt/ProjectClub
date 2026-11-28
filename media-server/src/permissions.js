// Permissões de mídia aplicadas NO SERVIDOR DE MÍDIA (igual ao Discord: o
// cliente pode estar adulterado — quem decide se a pessoa pode falar ou
// ligar vídeo é o servidor, não a interface).
//
// De onde vêm:
//   1. claims do JWT assinado pelo backend (/api/voice/join → voiceTokens.
//      mintProjectClub): canSpeak, canVideo, role ('speaker'|'audience'),
//      serverMuted, serverDeafened;
//   2. ordens do backend em tempo real (POST /control — mudo/ensurdecer do
//      servidor, palco, permissões mudadas no meio da call).
//
// Token ANTIGO (sem as claims) = tudo permitido — compatibilidade com quem
// já está em call durante o deploy.
//
// Lógica pura (sem mediasoup) — testada em test/permissoes.test.js.

const AUDIO_SOURCES = new Set(['mic', 'screenAudio']);
const VIDEO_SOURCES = new Set(['camera', 'screen']);

// Permissões a partir do payload do JWT.
function permsFromClaims(payload = {}) {
  const role = payload.role === 'audience' ? 'audience' : payload.role === 'speaker' ? 'speaker' : null;
  return {
    // Ausente => permitido (token antigo).
    canSpeak: payload.canSpeak !== false && role !== 'audience',
    canVideo: payload.canVideo !== false && role !== 'audience',
    role,
    serverMuted: payload.serverMuted === true,
    serverDeafened: payload.serverDeafened === true,
  };
}

// Mescla uma ordem do backend ({ canSpeak?, canVideo?, role?, serverMuted?,
// serverDeafened? }) por cima das permissões atuais. Campos ausentes ficam.
function mergePerms(current, patch = {}) {
  const next = { ...current };
  if (typeof patch.canSpeak === 'boolean') next.canSpeak = patch.canSpeak;
  if (typeof patch.canVideo === 'boolean') next.canVideo = patch.canVideo;
  if (patch.role === 'audience' || patch.role === 'speaker') next.role = patch.role;
  else if (patch.role === null) next.role = null;
  if (typeof patch.serverMuted === 'boolean') next.serverMuted = patch.serverMuted;
  if (typeof patch.serverDeafened === 'boolean') next.serverDeafened = patch.serverDeafened;
  // Plateia do palco nunca transmite, mesmo que a ordem diga o contrário.
  if (next.role === 'audience') { next.canSpeak = false; next.canVideo = false; }
  return next;
}

// Origem da mídia normalizada (o cliente não inventa categorias novas pra
// escapar das checagens).
function normalizeSource(kind, source) {
  const s = typeof source === 'string' ? source : '';
  if (kind === 'audio') return AUDIO_SOURCES.has(s) ? s : 'mic';
  return VIDEO_SOURCES.has(s) ? s : 'camera';
}

const isMicSource = (kind, source) => kind === 'audio' && source === 'mic';

// Pode publicar? Devolve null (pode) ou { code, message } (recusado).
// `hasScreen`: a pessoa já transmite a tela (o áudio da tela só existe
// junto com ela — senão daria pra mandar o microfone como "áudio da tela"
// e driblar o SPEAK).
function checkProduce(perms, { kind, source, hasScreen = false }) {
  const p = perms || permsFromClaims();
  if (isMicSource(kind, source)) {
    if (!p.canSpeak) return { code: 'speak', message: 'sem permissão para falar neste canal' };
    return null;
  }
  if (kind === 'audio') { // áudio da tela
    if (!p.canVideo) return { code: 'video', message: 'sem permissão para transmitir neste canal' };
    if (!hasScreen) return { code: 'video', message: 'o áudio da tela precisa da transmissão de tela' };
    return null;
  }
  if (!p.canVideo) return { code: 'video', message: 'sem permissão para vídeo neste canal' };
  return null;
}

// O microfone tem que nascer pausado? (mudo do servidor)
function forcePausedOnProduce(perms, { kind, source }) {
  return isMicSource(kind, source) && !!(perms && perms.serverMuted);
}

// Pode RETOMAR (desmutar) este producer? null = pode.
function checkResume(perms, { kind, source }) {
  const p = perms || permsFromClaims();
  if (isMicSource(kind, source)) {
    if (!p.canSpeak) return { code: 'speak', message: 'sem permissão para falar neste canal' };
    if (p.serverMuted) return { code: 'server-muted', message: 'você foi silenciado pela moderação' };
    return null;
  }
  if (!p.canVideo) return { code: 'video', message: 'sem permissão para vídeo neste canal' };
  return null;
}

// O consumer de áudio deve ficar pausado pra quem foi ensurdecido pelo
// servidor? (o cliente também pode pausar por conta própria — economia de
// banda quando ele mesmo se ensurdece)
function consumerShouldPause(perms, { kind, clientPaused }) {
  if (clientPaused) return true;
  return kind === 'audio' && !!(perms && perms.serverDeafened);
}

// Erro com código estável que o cliente reconhece ("forbidden:<code> — …").
function forbiddenError({ code, message }) {
  const e = new Error(`forbidden:${code} — ${message}`);
  e.forbidden = code;
  return e;
}

// Ordem de controle → nova permissão. Ações:
//   pause-audio    → mudo do servidor (e ensurdecer se perms.serverDeafened)
//   resume-allowed → tira mudo/ensurdecer do servidor (o cliente volta ao
//                    próprio estado de mudo)
//   set-perms      → aplica perms (canSpeak/canVideo/role/serverMuted/…)
//   kick           → tratado por quem chama (derruba a pessoa)
function permsForAction(current, action, patch = {}) {
  if (action === 'pause-audio') return mergePerms(current, { ...patch, serverMuted: true });
  if (action === 'resume-allowed') return mergePerms(current, { serverDeafened: false, ...patch, serverMuted: false });
  if (action === 'set-perms') return mergePerms(current, patch);
  return current;
}

const CONTROL_ACTIONS = new Set(['pause-audio', 'resume-allowed', 'kick', 'set-perms']);

module.exports = {
  permsFromClaims, mergePerms, normalizeSource, checkProduce, checkResume, forcePausedOnProduce,
  consumerShouldPause, forbiddenError, permsForAction, isMicSource, CONTROL_ACTIONS,
};
