// Redutor de ruído "alta qualidade" (DeepFilterNet3) — ENCANAMENTO atrás de
// flag. Ainda não existe um build WASM do DeepFilterNet3 confiável, pequeno
// e hospedável por nós (os pacotes npm achados são forks de uma pessoa só,
// 34 MB, ou baixam o modelo do CDN de terceiros — ver docs/voz-discord-api.md
// "Redutor alta qualidade"). Então:
//
//   - Sem `VITE_VOICE_DFN3_URL` no build, a opção nem aparece e tudo segue
//     no RNNoise (comportamento de hoje).
//   - Com a flag (URL de uma pasta NOSSA com o worklet + wasm + modelo), a
//     pessoa pode escolher "Alta qualidade" em Voz e vídeo; o nó é carregado
//     SÓ quando escolhido; qualquer falha (sem SIMD, CPU fraca, worklet não
//     carrega, processamento atrasando) volta pro RNNoise sozinho.
//
// Contrato do worklet (`<base>/dfn3-worklet.js`, processador
// 'dfn3-processor', 48 kHz mono):
//   entrada  port: { type:'init', base } · { type:'toggle', enabled }
//   saída    port: { type:'ready' } · { type:'error', message }
//                  { type:'vad', p, open }   (opcional, igual ao RNNoise)
//                  { type:'perf', load }     load = tempo de processamento ÷
//                                            tempo real do bloco (1 = no limite)

export const NOISE_MODELS = Object.freeze({ RNNOISE: 'rnnoise', DFN3: 'dfn3' });
export const NOISE_QUALITY = Object.freeze({ STANDARD: 'standard', HIGH: 'high' });

const ENV = (typeof import.meta !== 'undefined' && import.meta.env) || {};
export const DFN3_BASE_URL = String(ENV.VITE_VOICE_DFN3_URL || '').replace(/\/+$/, '');

const MIN_CORES = 4;           // abaixo disso nem oferece
const SLOW_LOAD = 0.8;         // 80% do tempo real do bloco…
const SLOW_STREAK = 3;         // …em 3 relatórios seguidos = CPU lenta
const READY_TIMEOUT_MS = 6000; // worklet + wasm + modelo

// Detecção de SIMD do WebAssembly (o DeepFilterNet3 sem SIMD não dá tempo real).
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
export function wasmSimdSupported(WA = (typeof WebAssembly === 'object' ? WebAssembly : null)) {
  try { return !!WA && WA.validate(SIMD_PROBE); } catch { return false; }
}

// Dá pra OFERECER a opção? (pura — testada em test/voice-noise-models.test.js)
export function highQualityAvailability({ baseUrl = DFN3_BASE_URL, cores, simd } = {}) {
  if (!baseUrl) return { available: false, reason: 'flag' };
  const n = Number(cores);
  if (Number.isFinite(n) && n > 0 && n < MIN_CORES) return { available: false, reason: 'cpu' };
  if (simd === false) return { available: false, reason: 'simd' };
  return { available: true };
}

export function currentHighQualityAvailability() {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
  return highQualityAvailability({ cores, simd: wasmSimdSupported() });
}

// Qual modelo usar dada a preferência (pura).
export function pickNoiseModel({ quality, availability, failed = false } = {}) {
  if (quality !== NOISE_QUALITY.HIGH || failed) return NOISE_MODELS.RNNOISE;
  return availability && availability.available ? NOISE_MODELS.DFN3 : NOISE_MODELS.RNNOISE;
}

// Vigia de CPU (pura): recebe cada `load` do worklet; true = desistir.
export function createSlowCpuWatch({ threshold = SLOW_LOAD, streak = SLOW_STREAK } = {}) {
  let bad = 0;
  return (load) => {
    const v = Number(load);
    if (!Number.isFinite(v)) return false;
    bad = v >= threshold ? bad + 1 : 0;
    return bad >= streak;
  };
}

// Nó do DeepFilterNet3 dentro do AudioContext do pipeline (48 kHz). Devolve
// { node, setEnabled, model:'dfn3' } ou null (aí o pipeline usa o RNNoise).
// `onSlow()` é chamado uma vez se a CPU não der conta (o pipeline troca).
const loaded = new WeakSet();
export async function createDfnNode(ctx, { baseUrl = DFN3_BASE_URL, enabled = true, onVad = null, onSlow = null, log = console } = {}) {
  if (!baseUrl || !ctx || !ctx.audioWorklet || typeof AudioWorkletNode !== 'function') return null;
  if (!wasmSimdSupported()) return null;
  let node = null;
  try {
    if (!loaded.has(ctx)) { await ctx.audioWorklet.addModule(`${baseUrl}/dfn3-worklet.js`); loaded.add(ctx); }
    node = new AudioWorkletNode(ctx, 'dfn3-processor', {
      numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1],
    });
    const watch = createSlowCpuWatch();
    let slowFired = false;
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('DeepFilterNet3 não ficou pronto a tempo')), READY_TIMEOUT_MS);
      node.port.onmessage = (e) => {
        const d = e && e.data;
        if (!d) return;
        if (d.type === 'ready') { clearTimeout(timer); resolve(); return; }
        if (d.type === 'error') { clearTimeout(timer); reject(new Error(d.message || 'erro no DeepFilterNet3')); return; }
        if (d.type === 'vad' && typeof onVad === 'function') { try { onVad(d); } catch { /* ok */ } return; }
        if (d.type === 'perf' && !slowFired && watch(d.load)) {
          slowFired = true;
          try { log.warn?.('[voz] DeepFilterNet3 lento nesta máquina — voltando pro RNNoise'); } catch { /* ok */ }
          try { onSlow?.(); } catch { /* ok */ }
        }
      };
    });
    node.port.postMessage({ type: 'init', base: baseUrl });
    await ready;
    node.port.postMessage({ type: 'toggle', enabled: !!enabled });
    return {
      node,
      model: NOISE_MODELS.DFN3,
      setEnabled(on) { try { node.port.postMessage({ type: 'toggle', enabled: !!on }); } catch { /* ok */ } },
    };
  } catch (err) {
    try { log.warn?.('[voz] DeepFilterNet3 indisponível, usando o RNNoise:', err?.message || err); } catch { /* ok */ }
    try { node?.disconnect(); node?.port?.close?.(); } catch { /* ok */ }
    return null;
  }
}
