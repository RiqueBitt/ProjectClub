// Reprodução do áudio REMOTO da chamada (faixas do servidor de mídia
// próprio). Usado pelo AudioSink (CallBar.jsx) e
// pela página-teste do e2e WebRTC (client/e2e/harness/mediasoup).
//
// BUG CORRIGIDO ("fala mas não ouve ninguém" no Electron 31 / Chrome 126 e
// no Opera, com o servidor mostrando consumer score 10, ICE ok e bytes
// chegando): antes TODO áudio remoto passava pelo Web Audio
// (createMediaStreamSource → ganho → MediaStreamDestination → <audio>
// escondido + setSinkId). Qualquer elo dessa corrente falhando em silêncio
// (AudioContext suspenso pela política de autoplay, bug do Chromium com
// stream remoto no Web Audio, saída salva inválida) = silêncio total sem
// erro. Agora o caminho PRINCIPAL é o mais simples possível, igual ao app de
// referência do mediasoup (mediasoup-demo): cada faixa remota num <audio>
// próprio (srcObject = MediaStream só com ela, volume ≤ 1). O Web Audio só
// entra pra reforço acima de 100% / auto nivelar, e só com o AudioContext
// 'running' — senão volta pro elemento, com som. Ver voice/playbackPlan.js.
//
// Auto-cura: a cada 3s confere se o elemento está tocando; se está pausado
// (autoplay bloqueado, troca de saída, aba voltou) ou perdeu a faixa, e os
// bytes RTP dessa pessoa continuam chegando, toca de novo. Bloqueado pelo
// navegador → tenta de novo no próximo clique/toque/tecla.
import { planPlayback, pickSinkId, healActions, clampVolume } from './playbackPlan.js';

const HEAL_MS = 3000;

// ---------- AudioContext compartilhado (só criado se alguém precisar) ----------
let sharedCtx = null;
let ctxSinkId = '';
const ctxListeners = new Set();

function AudioCtxClass() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

export function getSharedAudioContext({ create = true } = {}) {
  if (sharedCtx && sharedCtx.state !== 'closed') return sharedCtx;
  if (!create) return null;
  const C = AudioCtxClass();
  if (!C) return null;
  try {
    sharedCtx = new C({ latencyHint: 'interactive' });
  } catch {
    try { sharedCtx = new C(); } catch { sharedCtx = null; return null; }
  }
  try {
    sharedCtx.addEventListener?.('statechange', () => { for (const cb of [...ctxListeners]) { try { cb(); } catch { /* ok */ } } });
  } catch { /* navegador antigo */ }
  if (ctxSinkId && typeof sharedCtx.setSinkId === 'function') sharedCtx.setSinkId(ctxSinkId).catch(() => {});
  return sharedCtx;
}

// AudioContext.setSinkId (Chrome 110+): com saída escolhida e sem isso, o
// reforço por Web Audio tocaria na saída errada — então nem é usado.
export function contextSinkSupported() {
  const C = AudioCtxClass();
  return !!C && typeof C.prototype?.setSinkId === 'function';
}

export function setContextSink(id) {
  ctxSinkId = id || '';
  const ctx = sharedCtx;
  if (ctx && ctx.state !== 'closed' && typeof ctx.setSinkId === 'function') ctx.setSinkId(ctxSinkId).catch(() => {});
}

function onContextState(cb) { ctxListeners.add(cb); return () => ctxListeners.delete(cb); }

// ---------- gesto do usuário (destrava autoplay / AudioContext) ----------
const gestureCbs = new Set();
let gestureBound = false;
const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchend', 'click'];
function handleGesture() {
  try { if (sharedCtx && sharedCtx.state === 'suspended') sharedCtx.resume().catch(() => {}); } catch { /* ok */ }
  for (const cb of [...gestureCbs]) { try { cb(); } catch { /* um ouvinte com erro não para os outros */ } }
}
export function onUserGesture(cb) {
  gestureCbs.add(cb);
  if (!gestureBound && typeof document !== 'undefined') {
    gestureBound = true;
    GESTURE_EVENTS.forEach((ev) => document.addEventListener(ev, handleGesture, { capture: true, passive: true }));
  }
  return () => {
    gestureCbs.delete(cb);
    if (gestureBound && gestureCbs.size === 0 && typeof document !== 'undefined') {
      gestureBound = false;
      GESTURE_EVENTS.forEach((ev) => document.removeEventListener(ev, handleGesture, { capture: true }));
    }
  };
}

// Saída salva → id aplicável, conferindo nos aparelhos reais.
export async function resolveOutputSink(savedId) {
  if (!savedId) return { sinkId: '', stale: false };
  try {
    const list = await navigator.mediaDevices?.enumerateDevices?.();
    return pickSinkId(savedId, list || []);
  } catch {
    return { sinkId: null, stale: false };
  }
}

// ---------- uma faixa remota = um <audio> ----------
export class RemoteTrackPlayer {
  constructor({ track, userId = '', container = null, getInboundBytes = null, onBlocked = null, healMs = HEAL_MS } = {}) {
    if (!track) throw new Error('faixa de áudio ausente');
    this.track = track;
    this.userId = String(userId);
    this.getInboundBytes = getInboundBytes;
    this.onBlocked = onBlocked;
    this.disposed = false;
    this.volume = 1;
    this.autoLevel = false;
    this.sinkId = '';
    this.mode = 'element';
    this.blocked = false;
    this.graph = null;
    this.lastBytes = null;
    this.heals = 0;
    this.unGesture = null;

    const el = document.createElement('audio');
    el.autoplay = true;
    el.setAttribute('playsinline', '');
    el.setAttribute('data-voice-uid', this.userId);
    el.hidden = true;
    this.el = el;
    this.stream = new MediaStream([track]);
    el.srcObject = this.stream;
    try { (container || document.body).appendChild(el); } catch { /* sem DOM: ainda toca */ }

    // A faixa "desmuta" quando o RTP começa a chegar: garante que está tocando.
    this._onUnmute = () => { if (!this.disposed && this.el.paused) this._play(); };
    try { track.addEventListener('unmute', this._onUnmute); } catch { /* ok */ }
    this._offCtx = onContextState(() => { if (!this.disposed) this._apply(); });

    this._apply();
    this._play();
    this.healTimer = setInterval(() => { try { this._heal(); } catch { /* nunca derruba */ } }, healMs);
  }

  _play() {
    if (this.disposed) return;
    let p;
    try { p = this.el.play(); } catch (err) { p = Promise.reject(err); }
    if (!p || typeof p.then !== 'function') return;
    p.then(() => {
      if (this.disposed) return;
      this.blocked = false;
      this._unwatchGesture();
    }).catch((err) => {
      if (this.disposed) return;
      // AbortError = play() interrompido por outro load/pausa (inofensivo).
      if (err && err.name === 'AbortError') return;
      this.blocked = true;
      this._watchGesture();
      try { this.onBlocked?.(err); } catch { /* ok */ }
    });
  }

  _watchGesture() {
    if (this.unGesture) return;
    this.unGesture = onUserGesture(() => { this._apply(); this._play(); });
  }

  _unwatchGesture() {
    const u = this.unGesture;
    this.unGesture = null;
    if (u) { try { u(); } catch { /* ok */ } }
  }

  setVolume(v) { this.volume = clampVolume(v); this._apply(); }
  setAutoLevel(on) { this.autoLevel = !!on; this._apply(); }

  setSinkId(id) {
    if (id == null) return; // desconhecido (sem permissão): não mexe
    this.sinkId = id;
    const el = this.el;
    if (typeof el.setSinkId !== 'function') return;
    if ((el.sinkId || '') === id) return;
    el.setSinkId(id).catch(() => {
      // Saída inválida/sem permissão: volta pra padrão em vez do silêncio.
      if (!this.disposed && id) el.setSinkId('').catch(() => {});
    }).finally(() => { if (!this.disposed && this.el.paused) this._play(); });
  }

  _apply() {
    if (this.disposed) return;
    const wants = this.volume > 0 && (this.volume > 1 || this.autoLevel);
    const ctx = wants ? getSharedAudioContext() : getSharedAudioContext({ create: false });
    if (wants && ctx && ctx.state === 'suspended') { try { ctx.resume().catch(() => {}); } catch { /* ok */ } }
    const plan = planPlayback({
      volume: this.volume,
      autoLevel: this.autoLevel,
      ctxState: ctx ? ctx.state : null,
      ctxSinkOk: !this.sinkId || contextSinkSupported(),
      webAudioAvailable: !!ctx,
    });
    if (plan.mode === 'webaudio') {
      try {
        const g = this._ensureGraph(ctx);
        g.gain.gain.value = plan.gain;
      } catch {
        // Web Audio falhou: fica no elemento (com som, sem o reforço).
        this._dropGraph();
        this.mode = 'element';
        this.el.muted = this.volume === 0;
        this.el.volume = Math.min(1, this.volume);
        return;
      }
    } else {
      this._dropGraph();
    }
    this.el.muted = plan.elementMuted;
    this.el.volume = plan.elementVolume;
    this.mode = plan.mode;
  }

  _ensureGraph(ctx) {
    const g = this.graph;
    if (g && g.ctx === ctx && g.auto === this.autoLevel) return g;
    this._dropGraph();
    const source = ctx.createMediaStreamSource(this.stream);
    const gain = ctx.createGain();
    let leveler = null;
    if (this.autoLevel) {
      // "Auto nivelar volume": compressor leve aproxima quem fala baixo/alto.
      leveler = ctx.createDynamicsCompressor();
      leveler.threshold.value = -30;
      leveler.knee.value = 24;
      leveler.ratio.value = 3;
      leveler.attack.value = 0.01;
      leveler.release.value = 0.25;
      source.connect(leveler);
      leveler.connect(gain);
    } else {
      source.connect(gain);
    }
    gain.connect(ctx.destination);
    this.graph = { ctx, source, gain, leveler, auto: this.autoLevel };
    return this.graph;
  }

  _dropGraph() {
    const g = this.graph;
    this.graph = null;
    if (!g) return;
    try { g.source.disconnect(); } catch { /* ok */ }
    try { g.leveler?.disconnect(); } catch { /* ok */ }
    try { g.gain.disconnect(); } catch { /* ok */ }
  }

  _heal() {
    if (this.disposed) return;
    let bytes = null;
    try { bytes = this.getInboundBytes ? this.getInboundBytes() : null; } catch { bytes = null; }
    const delta = Number.isFinite(bytes) && Number.isFinite(this.lastBytes) ? bytes - this.lastBytes : null;
    this.lastBytes = Number.isFinite(bytes) ? bytes : null;
    const ctx = getSharedAudioContext({ create: false });
    const srcOk = this.el.srcObject === this.stream && this.stream.getAudioTracks()[0] === this.track;
    const actions = healActions({
      trackLive: this.track.readyState === 'live',
      srcOk,
      paused: this.el.paused,
      mode: this.mode,
      ctxState: ctx ? ctx.state : null,
      bytesDelta: delta,
    });
    for (const a of actions) {
      this.heals += 1;
      if (a === 'reattach') {
        if (this.stream.getAudioTracks()[0] !== this.track) this.stream = new MediaStream([this.track]);
        this.el.srcObject = this.stream;
        this._dropGraph();
      } else if (a === 'play') this._play();
      else if (a === 'resume-ctx') { try { ctx?.resume().catch(() => {}); } catch { /* ok */ } }
      else if (a === 'to-element') this._apply();
    }
  }

  state() {
    const ctx = getSharedAudioContext({ create: false });
    const el = this.el;
    return {
      mode: this.mode,
      paused: !!el.paused,
      muted: !!el.muted,
      volume: el.volume,
      currentTime: el.currentTime || 0,
      readyState: el.readyState,
      blocked: this.blocked,
      ctx: ctx ? ctx.state : null,
      sinkId: el.sinkId || '',
      heals: this.heals,
      trackLive: this.track.readyState === 'live',
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try { clearInterval(this.healTimer); } catch { /* ok */ }
    this._unwatchGesture();
    try { this._offCtx?.(); } catch { /* ok */ }
    try { this.track.removeEventListener('unmute', this._onUnmute); } catch { /* ok */ }
    this._dropGraph();
    // Elemento destacado do DOM com srcObject continua tocando no Chrome:
    // pausa e solta a faixa explicitamente (silêncio imediato).
    try { this.el.pause(); } catch { /* ok */ }
    try { this.el.srcObject = null; } catch { /* ok */ }
    try { this.el.remove(); } catch { /* ok */ }
  }
}
