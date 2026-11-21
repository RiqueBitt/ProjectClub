// Processador de cancelamento de ruído usando RNNoise (biblioteca real de
// supressão de ruído por rede neural: https://github.com/xiph/rnnoise) —
// roda como um AudioWorklet (thread de áudio dedicada, não trava a
// interface) entre o microfone e o que é enviado na chamada de voz.
//
// Usa @jitsi/rnnoise-wasm — a mesma versão WASM que o Jitsi Meet usa em
// produção pra isso. O rnnoise-sync.js fica ao lado deste arquivo (cópia
// estática, servida direto, sem passar pelo empacotador do Vite) porque um
// AudioWorklet precisa carregar tudo de forma síncrona.
import createRNNWasmModuleSync from './rnnoise-sync.js';

// RNNoise sempre trabalha em blocos fixos de 480 amostras (10ms a 48kHz) —
// mas o AudioWorklet entrega blocos de 128 amostras por vez, então
// precisamos de um buffer circular pra acumular até ter um quadro
// completo antes de processar, e outro pra devolver o resultado aos
// poucos conforme o AudioWorklet for pedindo mais.
const FRAME_SIZE = 480;
// VAD (detecção de voz): o rnnoise_process_frame devolve a probabilidade de
// ter voz no quadro (0..1). Mandamos pra thread principal ~20 vezes por
// segundo (a cada 5 quadros de 10ms, com o MAIOR valor do intervalo) junto
// com um "aberto" que já tem 200ms de segura (não corta o fim das palavras).
const VAD_EVERY_FRAMES = 5;
const VAD_OPEN_PROB = 0.5;
const VAD_HANGOVER_FRAMES = 20; // 200ms

class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ready = false;
    this.enabled = true;

    this.vadMax = 0;
    this.vadFrames = 0;
    this.framesSinceVoice = Infinity;
    this.port.onmessage = (e) => {
      if (e.data?.type === 'toggle') {
        const was = this.enabled;
        this.enabled = !!e.data.enabled;
        // Desligou: avisa que não tem mais VAD (o portão volta a ser só por nível).
        if (was && !this.enabled) { try { this.port.postMessage({ type: 'vad', p: -1, open: false, off: true }); } catch { /* ok */ } }
      }
    };

    // BUG CORRIGIDO: "(intermediate value)().then is not a function" — o
    // módulo gerado pelo Emscripten (rnnoise-sync.js) é chamado de "Sync"
    // por um motivo: `createRNNWasmModuleSync()` roda TUDO de forma
    // síncrona e devolve o objeto Module diretamente — NÃO uma Promise.
    // A Promise de verdade (que resolve só quando o WASM terminou de
    // inicializar) fica guardada em `Module.ready` (ver o
    // `Module["ready"] = new Promise(...)` dentro do próprio
    // rnnoise-sync.js). Chamar `.then()` direto no retorno da função
    // tentava usar `.then` num objeto comum, que não tem esse método —
    // por isso a redução de ruído nunca terminava de carregar (o erro
    // acontecia antes de `this.ready = true` ser setado, então o áudio
    // sempre passava cru, sem processamento nenhum, e o console enchia
    // desse erro toda vez que alguém entrava num canal de voz).
    const rnnoiseModule = createRNNWasmModuleSync();
    rnnoiseModule.ready.then((Module) => {
      this.module = Module;
      this.state = Module._rnnoise_create();
      this.inputPtr = Module._malloc(FRAME_SIZE * 4);
      this.outputPtr = Module._malloc(FRAME_SIZE * 4);
      this.ready = true;
    }).catch((err) => {
      console.error('[rnnoise] falha ao carregar o módulo WASM:', err);
    });
  }

  processFrame(frame) {
    if (!this.ready || !this.enabled) return frame;
    const { module, state, inputPtr, outputPtr } = this;
    const heap = module.HEAPF32;
    const inOffset = inputPtr / 4;
    for (let i = 0; i < FRAME_SIZE; i++) heap[inOffset + i] = frame[i] * 32768;
    const vad = module._rnnoise_process_frame(state, outputPtr, inputPtr);
    this.trackVad(vad);
    const outOffset = outputPtr / 4;
    const result = this.scratch;
    for (let i = 0; i < FRAME_SIZE; i++) result[i] = heap[outOffset + i] / 32768;
    return result;
  }

  // Junta a probabilidade de voz de 5 quadros (50ms) e manda o maior valor.
  trackVad(p) {
    const v = Number.isFinite(p) ? p : 0;
    if (v >= VAD_OPEN_PROB) this.framesSinceVoice = 0;
    else if (this.framesSinceVoice !== Infinity) this.framesSinceVoice += 1;
    if (v > this.vadMax) this.vadMax = v;
    this.vadFrames += 1;
    if (this.vadFrames < VAD_EVERY_FRAMES) return;
    const open = this.framesSinceVoice <= VAD_HANGOVER_FRAMES;
    try { this.port.postMessage({ type: 'vad', p: Math.round(this.vadMax * 1000) / 1000, open }); } catch { /* ok */ }
    this.vadMax = 0;
    this.vadFrames = 0;
  }

  // Buffers FIXOS (sem alocar a cada bloco de 128 amostras — a thread de
  // áudio não pode parar pra coletar lixo): acumula entrada até fechar um
  // quadro de 480, processa, e vai entregando a saída conforme pedem.
  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0];
    const output = outputs[0] && outputs[0][0];
    if (!input || !output) return true;
    if (!this.inBuf) {
      const cap = FRAME_SIZE * 4;
      this.inBuf = new Float32Array(cap); this.inLen = 0;
      this.outBuf = new Float32Array(cap); this.outLen = 0;
      this.scratch = new Float32Array(FRAME_SIZE);
    }
    // Sem processamento: passa direto, sem latência extra.
    if (!this.ready || !this.enabled) { output.set(input); return true; }

    this.inBuf.set(input, this.inLen); this.inLen += input.length;
    while (this.inLen >= FRAME_SIZE) {
      const processed = this.processFrame(this.inBuf.subarray(0, FRAME_SIZE));
      if (this.outLen + FRAME_SIZE <= this.outBuf.length) { this.outBuf.set(processed, this.outLen); this.outLen += FRAME_SIZE; }
      this.inBuf.copyWithin(0, FRAME_SIZE, this.inLen); this.inLen -= FRAME_SIZE;
    }
    if (this.outLen >= output.length) {
      output.set(this.outBuf.subarray(0, output.length));
      this.outBuf.copyWithin(0, output.length, this.outLen); this.outLen -= output.length;
    } else {
      output.fill(0); // ainda enchendo o primeiro quadro (~10ms)
    }
    return true;
  }
}

registerProcessor('rnnoise-processor', RNNoiseProcessor);
