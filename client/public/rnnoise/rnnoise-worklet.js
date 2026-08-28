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

class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ready = false;
    this.inputBuffer = new Float32Array(0);
    this.outputBuffer = new Float32Array(0);
    this.enabled = true;

    this.port.onmessage = (e) => {
      if (e.data?.type === 'toggle') this.enabled = !!e.data.enabled;
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
    module._rnnoise_process_frame(state, outputPtr, inputPtr);
    const outOffset = outputPtr / 4;
    const result = new Float32Array(FRAME_SIZE);
    for (let i = 0; i < FRAME_SIZE; i++) result[i] = heap[outOffset + i] / 32768;
    return result;
  }

  process(inputs, outputs) {
    const input = inputs[0][0];
    const output = outputs[0][0];
    if (!input || !output) return true;

    const merged = new Float32Array(this.inputBuffer.length + input.length);
    merged.set(this.inputBuffer);
    merged.set(input, this.inputBuffer.length);
    this.inputBuffer = merged;

    while (this.inputBuffer.length >= FRAME_SIZE) {
      const frame = this.inputBuffer.subarray(0, FRAME_SIZE);
      const processed = this.processFrame(frame);
      const combined = new Float32Array(this.outputBuffer.length + FRAME_SIZE);
      combined.set(this.outputBuffer);
      combined.set(processed, this.outputBuffer.length);
      this.outputBuffer = combined;
      this.inputBuffer = this.inputBuffer.subarray(FRAME_SIZE);
    }

    if (this.outputBuffer.length >= output.length) {
      output.set(this.outputBuffer.subarray(0, output.length));
      this.outputBuffer = this.outputBuffer.subarray(output.length);
    }

    return true;
  }
}

registerProcessor('rnnoise-processor', RNNoiseProcessor);
