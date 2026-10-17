// Pipeline ÚNICO do microfone (Web Audio), igual ao do Discord:
//
//   mic cru ─► [RNNoise opcional] ─► ganho de entrada ─► PORTÃO (0/1) ─► faixa enviada
//                                          └─► Analyser (nível local, detecção de voz, anel verde)
//
// Antes eram 3 peças soltas (RNNoise com AudioContext próprio, portão por
// track.enabled e um medidor com OUTRO AudioContext no VoiceContext). Agora
// é um contexto só: o portão é um GainNode (com rampa curta — sem estalo) e
// o medidor lê o sinal ANTES do portão (dá pra reabrir quando você volta a
// falar) e DEPOIS do RNNoise (o ruído não abre o portão).
//
// À PROVA DE FALHAS: se o AudioContext não roda (sem gesto do usuário,
// Safari/iOS suspendeu por interrupção — ligação, outro app de áudio — ou
// travou), o pipeline entra em modo "direto" (bypass): manda uma cópia da
// faixa CRUA e o portão vira track.enabled. Quem usa recebe onBypass(track)
// pra trocar a faixa do producer — a pessoa nunca fica muda sem saber. Se o
// contexto voltar a rodar, onRestore(track) devolve a faixa processada.
import { createNoiseNode, NOISE_SAMPLE_RATE } from './noiseSuppressor.js';
import { rmsToDb } from './micGate.js';

const GATE_RAMP_S = 0.012;      // rampa do portão (evita estalo)
const RESUME_GRACE_MS = 1500;   // contexto suspenso por mais que isso → modo direto

function audioContextClass() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

// Cria o pipeline pra uma faixa crua. Nunca lança: sem Web Audio, devolve
// um pipeline "direto" (a própria faixa, portão por enabled).
export async function createMicPipeline(rawTrack, { noise = false, onBypass = null, onRestore = null, log = console } = {}) {
  const Ctx = audioContextClass();
  let ctx = null;
  let source = null; let noiseNode = null; let inputGain = null; let gateGain = null; let analyser = null; let dest = null;
  let processed = null;            // faixa de saída do grafo
  let direct = null;               // cópia da faixa crua (modo direto)
  let mode = 'direct';
  let gateOpen = true;
  let noiseWanted = !!noise;
  let disposed = false;
  let suspendTimer = null;
  let buf = null;

  const directTrack = () => {
    if (!direct || direct.readyState === 'ended') {
      direct = rawTrack.clone();
      direct.enabled = gateOpen;
    }
    return direct;
  };

  const wire = () => {
    try { source.disconnect(); } catch { /* ok */ }
    try { noiseNode?.node.disconnect(); } catch { /* ok */ }
    if (noiseNode) { source.connect(noiseNode.node); noiseNode.node.connect(inputGain); } else source.connect(inputGain);
  };

  const goDirect = (why) => {
    if (disposed || mode === 'direct') return;
    mode = 'direct';
    try { log.warn?.(`[voz] microfone em modo direto (${why}) — sem redutor/portão por Web Audio`); } catch { /* ok */ }
    const t = directTrack();
    t.enabled = gateOpen;
    try { onBypass?.(t); } catch { /* ok */ }
  };

  const goGraph = () => {
    if (disposed || mode === 'graph' || !processed) return;
    mode = 'graph';
    try { onRestore?.(processed); } catch { /* ok */ }
  };

  // Contexto suspenso/interrompido (iOS: ligação, Siri, outro app): tenta
  // retomar; não voltou em 1,5s → modo direto.
  const checkRunning = () => {
    if (disposed || !ctx) return;
    if (ctx.state === 'running') { clearTimeout(suspendTimer); suspendTimer = null; goGraph(); return; }
    try { ctx.resume?.().catch(() => {}); } catch { /* ok */ }
    if (suspendTimer) return;
    suspendTimer = setTimeout(() => {
      suspendTimer = null;
      if (!disposed && ctx && ctx.state !== 'running') goDirect(`contexto ${ctx.state}`);
    }, RESUME_GRACE_MS);
  };
  const onVisibility = () => { if (typeof document !== 'undefined' && document.visibilityState === 'visible') checkRunning(); };

  if (Ctx && rawTrack) {
    try {
      // 48 kHz: o RNNoise só trabalha nessa taxa (o navegador reamostra o mic).
      try { ctx = new Ctx({ sampleRate: NOISE_SAMPLE_RATE, latencyHint: 'interactive' }); } catch { ctx = new Ctx(); }
      source = ctx.createMediaStreamSource(new MediaStream([rawTrack]));
      inputGain = ctx.createGain();
      gateGain = ctx.createGain();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      buf = new Float32Array(analyser.fftSize);
      dest = ctx.createMediaStreamDestination();
      inputGain.connect(gateGain);
      inputGain.connect(analyser);
      gateGain.connect(dest);
      if (noiseWanted && ctx.sampleRate === NOISE_SAMPLE_RATE) noiseNode = await createNoiseNode(ctx, { enabled: true });
      wire();
      processed = dest.stream.getAudioTracks()[0] || null;
      if (!processed) throw new Error('sem faixa de saída');
      if (ctx.state !== 'running') {
        try { await Promise.race([ctx.resume(), new Promise((r) => { setTimeout(r, 800); })]); } catch { /* ok */ }
      }
      ctx.onstatechange = checkRunning;
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
      mode = ctx.state === 'running' ? 'graph' : 'direct';
      if (mode === 'direct') {
        try { log.warn?.('[voz] AudioContext não rodou — microfone em modo direto até ele voltar'); } catch { /* ok */ }
        checkRunning();
      }
    } catch (err) {
      try { log.warn?.('[voz] pipeline do microfone indisponível, usando a faixa crua:', err?.message || err); } catch { /* ok */ }
      try { ctx?.close(); } catch { /* ok */ }
      ctx = null; processed = null; noiseNode = null; analyser = null; mode = 'direct';
    }
  }
  // Se a faixa crua acabar (dispositivo removido), a processada acaba junto.
  rawTrack?.addEventListener?.('ended', () => { try { processed?.stop(); } catch { /* ok */ } });

  return {
    rawTrack,
    // Faixa pra publicar AGORA (processada, ou a cópia crua no modo direto).
    get track() { return mode === 'graph' ? processed : directTrack(); },
    get mode() { return mode; },
    get noiseActive() { return mode === 'graph' && !!noiseNode && noiseWanted; },
    get gateOpen() { return gateOpen; },
    // Portão: rampa curta no grafo; enabled no modo direto.
    setGate(open) {
      gateOpen = !!open;
      if (gateGain && ctx) {
        try {
          const t = ctx.currentTime;
          gateGain.gain.cancelScheduledValues(t);
          gateGain.gain.setValueAtTime(gateGain.gain.value, t);
          gateGain.gain.linearRampToValueAtTime(gateOpen ? 1 : 0, t + GATE_RAMP_S);
        } catch { try { gateGain.gain.value = gateOpen ? 1 : 0; } catch { /* ok */ } }
      }
      if (direct && mode === 'direct') direct.enabled = gateOpen;
    },
    gateValue() { return gateGain ? gateGain.gain.value : (gateOpen ? 1 : 0); },
    setInputGain(g) {
      const v = Math.max(0, Math.min(4, Number(g) || 0));
      if (inputGain) { try { inputGain.gain.value = v; } catch { /* ok */ } }
    },
    // Liga/desliga o RNNoise (carrega na hora se ainda não estava no grafo).
    async setNoise(on) {
      noiseWanted = !!on;
      if (!ctx) return false;
      if (noiseNode) { noiseNode.setEnabled(noiseWanted); return true; }
      if (!noiseWanted || ctx.sampleRate !== NOISE_SAMPLE_RATE) return false;
      const n = await createNoiseNode(ctx, { enabled: true });
      if (!n || disposed) return false;
      noiseNode = n;
      try { wire(); } catch { /* ok */ }
      return true;
    },
    // Nível (dBFS) do sinal antes do portão; null = sem medida (modo direto).
    readLevelDb() {
      if (!analyser || mode !== 'graph' || !ctx || ctx.state !== 'running') return null;
      try { analyser.getFloatTimeDomainData(buf); } catch { return null; }
      return rmsToDb(buf);
    },
    // Tenta retomar o contexto (gesto do usuário / voltou pra aba).
    resume() { checkRunning(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(suspendTimer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      try { if (ctx) ctx.onstatechange = null; } catch { /* ok */ }
      try { processed?.stop(); } catch { /* ok */ }
      try { direct?.stop(); } catch { /* ok */ }
      try { source?.disconnect(); noiseNode?.node.disconnect(); inputGain?.disconnect(); gateGain?.disconnect(); } catch { /* ok */ }
      try { ctx?.close(); } catch { /* ok */ }
      try { rawTrack?.stop(); } catch { /* ok */ }
    },
  };
}

export default createMicPipeline;
