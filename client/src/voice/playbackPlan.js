// Decisões PURAS da reprodução do áudio remoto (sem DOM — testadas em
// client/test/voice-playback.test.js). Quem executa é o RemoteTrackPlayer
// (voice/audioPlayback.js).
//
// CAMINHO PRINCIPAL: cada faixa remota num <audio> próprio (srcObject =
// MediaStream só com ela), volume do elemento ≤ 1. É o caminho que o
// Chrome/Electron toca com mais confiança e o único em que o cancelamento de
// eco do Chromium funciona (o AEC não pega áudio tocado pelo Web Audio —
// crbug.com/687574). Web Audio só entra pra passar de 100% ou pro "auto
// nivelar", e SÓ quando o AudioContext está 'running'; senão volta pro
// elemento (com som, sem o reforço) em vez de ficar mudo.

export function clampVolume(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(2, Math.max(0, n));
}

// { mode: 'element'|'webaudio', elementMuted, elementVolume, gain, wantsWebAudio }
export function planPlayback({ volume = 1, autoLevel = false, ctxState = null, ctxSinkOk = true, webAudioAvailable = true } = {}) {
  const v = clampVolume(volume);
  const wantsWebAudio = v > 0 && (v > 1 || !!autoLevel);
  if (wantsWebAudio && webAudioAvailable && ctxSinkOk && ctxState === 'running') {
    // O elemento continua tocando MUDO: no Chromium o áudio remoto do WebRTC
    // só chega no Web Audio se a faixa também estiver num elemento de mídia
    // (crbug.com/121673).
    return { mode: 'webaudio', elementMuted: true, elementVolume: 1, gain: v, wantsWebAudio };
  }
  return { mode: 'element', elementMuted: v === 0, elementVolume: Math.min(1, v), gain: null, wantsWebAudio };
}

// Saída de áudio salva × aparelhos de verdade.
//   { sinkId: string }  → aplicar ('' = padrão do sistema)
//   { sinkId: null }    → não dá pra saber (sem permissão de mídia, os ids vêm
//                         vazios) — não mexe e NÃO apaga a preferência
//   stale: true         → a saída salva não existe mais: esquecer
export function pickSinkId(savedId, devices) {
  if (!savedId || savedId === 'default') return { sinkId: '', stale: false };
  const outs = (Array.isArray(devices) ? devices : []).filter((d) => d && d.kind === 'audiooutput');
  if (!outs.length || outs.every((d) => !d.deviceId)) return { sinkId: null, stale: false };
  if (outs.some((d) => d.deviceId === savedId)) return { sinkId: savedId, stale: false };
  return { sinkId: '', stale: true };
}

// Auto-cura (a cada poucos segundos). Devolve as ações a executar.
//   'reattach'  → o elemento perdeu o srcObject/faixa
//   'play'      → elemento pausado (autoplay bloqueado, aba voltou, troca de saída)
//   'resume-ctx'→ Web Audio em uso mas o contexto suspendeu
//   'to-element'→ Web Audio em uso e o contexto NÃO está rodando: volta pro elemento
// `bytesDelta` = bytes RTP recebidos dessa pessoa desde a última olhada (null
// = desconhecido). Com bytes chegando e nada tocando, é bug de reprodução.
export function healActions({ trackLive = true, srcOk = true, paused = false, mode = 'element', ctxState = null, bytesDelta = null } = {}) {
  const out = [];
  if (!trackLive) return out;
  if (!srcOk) out.push('reattach');
  const mediaFlowing = bytesDelta == null || bytesDelta > 0;
  if ((paused || !srcOk) && mediaFlowing) out.push('play');
  if (mode === 'webaudio' && ctxState !== 'running') {
    out.push('resume-ctx');
    out.push('to-element');
  }
  return out;
}

// "Uma vez por chave" (diagnóstico: 1 por call por pessoa).
export function createOnceSet(max = 300) {
  const seen = new Set();
  return {
    first(key) {
      if (seen.has(key)) return false;
      if (seen.size >= max) seen.clear();
      seen.add(key);
      return true;
    },
  };
}

// Diagnóstico compacto (voz-diag) — cabe numa linha de log.
export function buildDiag({ userId, provider, mode, el, track, ctxState, inboundBytes, sinkCustom, ua } = {}) {
  const d = { u: String(userId ?? '?').slice(0, 40), p: provider || null, m: mode || null };
  if (el) d.el = { p: el.paused ? 1 : 0, mu: el.muted ? 1 : 0, v: Math.round((el.volume ?? 1) * 100), t: Math.round(el.currentTime || 0), rs: el.readyState ?? null };
  if (track) d.tr = { s: track.readyState === 'live' ? 'live' : String(track.readyState || '?'), mu: track.muted ? 1 : 0, en: track.enabled === false ? 0 : 1 };
  d.ctx = ctxState || null;
  d.b = Number.isFinite(inboundBytes) ? inboundBytes : null;
  d.sk = sinkCustom ? 1 : 0;
  if (ua) d.ua = String(ua).slice(0, 90);
  return d;
}
