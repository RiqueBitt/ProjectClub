// Redução de ruído por rede neural (RNNoise) pra QUALQUER engine de voz.
//
// Recebe a faixa crua do microfone e devolve uma faixa nova, já limpa
// (ventilador, teclado, chiado...), passando o áudio por um AudioWorklet
// (thread de áudio dedicada — não trava a interface) que roda o RNNoise em
// WebAssembly. O worklet e o WASM ficam em /rnnoise/ (servidos estáticos,
// fora do empacotador, porque um AudioWorklet carrega tudo de forma
// síncrona).
//
//   const sup = await createNoiseSuppressedTrack(rawTrack);
//   producer = transport.produce({ track: sup.track })
//   sup.setEnabled(false)   // passa o áudio cru sem recriar nada
//   sup.dispose()           // fecha o AudioContext e para a faixa crua
//
// Se o navegador não suporta AudioWorklet (ou o WASM falhar), `create`
// resolve com null e quem chamou usa a faixa crua — a chamada nunca deixa
// de funcionar por causa do redutor.
const WORKLET_URL = '/rnnoise/rnnoise-worklet.js';
// RNNoise só trabalha a 48 kHz: o AudioContext é criado nessa taxa pra não
// precisar reamostrar (o navegador reamostra o mic sozinho, se preciso).
const SAMPLE_RATE = 48000;

export function isNoiseSuppressionSupported() {
  return typeof window !== 'undefined'
    && typeof window.AudioContext === 'function'
    && typeof window.AudioWorkletNode === 'function'
    && typeof WebAssembly === 'object';
}

// Só o NÓ do RNNoise, dentro de um AudioContext que já existe (o pipeline
// único do microfone — voice/micPipeline.js — usa assim: mic → RNNoise →
// ganho → portão → envio, tudo num contexto só). O contexto tem que estar a
// 48 kHz. Devolve { node, setEnabled } ou null se não der (aí o pipeline
// segue sem o redutor). `onVad({ p, open, off })`: probabilidade de voz que o
// RNNoise calcula (~20/s); `off` = redutor desligado (sem VAD).
const loadedContexts = new WeakSet();
export async function createNoiseNode(ctx, { enabled = true, onVad = null } = {}) {
  if (!ctx || typeof window === 'undefined' || typeof window.AudioWorkletNode !== 'function' || !ctx.audioWorklet) return null;
  try {
    if (!loadedContexts.has(ctx)) { await ctx.audioWorklet.addModule(WORKLET_URL); loadedContexts.add(ctx); }
    const node = new AudioWorkletNode(ctx, 'rnnoise-processor', {
      numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1],
    });
    node.port.onmessage = (e) => {
      const d = e?.data;
      if (d && d.type === 'vad' && typeof onVad === 'function') { try { onVad(d); } catch { /* ok */ } }
    };
    node.port.postMessage({ type: 'toggle', enabled: !!enabled });
    return {
      node,
      setEnabled(on) { try { node.port.postMessage({ type: 'toggle', enabled: !!on }); } catch { /* ok */ } },
    };
  } catch (err) {
    console.warn('[voz] redutor de ruído indisponível, seguindo sem ele:', err?.message || err);
    return null;
  }
}

export const NOISE_SAMPLE_RATE = SAMPLE_RATE;

export async function createNoiseSuppressedTrack(rawTrack, { enabled = true } = {}) {
  if (!rawTrack || !isNoiseSuppressionSupported()) return null;
  let ctx = null;
  try {
    ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
    await ctx.audioWorklet.addModule(WORKLET_URL);
    const source = ctx.createMediaStreamSource(new MediaStream([rawTrack]));
    const node = new AudioWorkletNode(ctx, 'rnnoise-processor', {
      numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1],
    });
    const dest = ctx.createMediaStreamDestination();
    source.connect(node);
    node.connect(dest);
    node.port.postMessage({ type: 'toggle', enabled: !!enabled });
    // Alguns navegadores criam o contexto suspenso até um gesto; o clique
    // de "entrar na chamada" já aconteceu, então resume() passa.
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* segue */ } }
    const track = dest.stream.getAudioTracks()[0];
    if (!track) throw new Error('sem faixa de saída');
    // Se o mic cru acabar (dispositivo removido), a faixa processada acaba
    // junto — quem usa ouve o 'ended' normalmente.
    rawTrack.addEventListener('ended', () => { try { track.stop(); } catch { /* ok */ } });
    let disposed = false;
    return {
      track,
      rawTrack,
      setEnabled(on) { try { node.port.postMessage({ type: 'toggle', enabled: !!on }); } catch { /* ok */ } },
      dispose() {
        if (disposed) return;
        disposed = true;
        try { track.stop(); } catch { /* ok */ }
        try { rawTrack.stop(); } catch { /* ok */ }
        try { source.disconnect(); node.disconnect(); } catch { /* ok */ }
        try { ctx.close(); } catch { /* ok */ }
      },
    };
  } catch (err) {
    console.warn('[voz] redutor de ruído indisponível, usando o microfone cru:', err?.message || err);
    try { ctx?.close(); } catch { /* ok */ }
    return null;
  }
}

export default createNoiseSuppressedTrack;
