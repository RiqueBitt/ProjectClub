// Portão do microfone NA THREAD DE ÁUDIO (revisão "voz-turbo").
//
// Por quê: a detecção de voz ("sensibilidade de entrada") era decidida num
// setInterval de 40ms na thread principal, olhando um Analyser. Resultado:
//   - o começo de cada fala (a 1ª sílaba) era comido: até ~40ms do tique +
//     a janela do Analyser antes do portão abrir;
//   - com a aba em segundo plano o Chrome limita timers a 1x/s — o portão
//     podia levar até 1 SEGUNDO pra abrir ("a primeira palavra some");
//   - qualquer travada da interface (React, GC) atrasava o portão junto.
// Aqui o nível é medido a cada bloco de 128 amostras (2,7ms a 48 kHz), na
// mesma janela de ~21ms (1024 amostras) do Analyser antigo — mesmo limite em
// dB, mesma sensibilidade a ruído — e o portão ABRE no mesmo bloco em que a
// voz passa do limite, com rampa de 5ms (sem estalo). Fechar continua igual:
// depois da "segura" (holdMs) sem voz E com a thread principal concordando
// (`mainOpen`: lá ficam o piso de ruído automático e o VAD do RNNoise).
//
// Modos (mensagem { type: 'config', ... } da thread principal):
//   'bypass' → passa o áudio direto (apertar-pra-falar / portão manual / sem
//              sensibilidade: quem manda é o GainNode do pipeline, como antes)
//   'auto'   → portão por nível aqui + `mainOpen` da thread principal
// Devolve { type: 'state', open } quando o portão muda (pro medidor/testes).
// Sem alocação nenhuma dentro do process() (a thread de áudio não pode parar
// pra coletar lixo).
const WINDOW_BLOCKS = 8; // 8 × 128 = 1024 amostras ≈ 21ms (igual ao Analyser)
const OPEN_RAMP_S = 0.005;
const CLOSE_RAMP_S = 0.03;

class VoiceGateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const rate = typeof sampleRate === 'number' && sampleRate > 0 ? sampleRate : 48000;
    this.rate = rate;
    this.mode = 'bypass';
    this.thresholdDb = -60;
    this.holdSamples = Math.round(0.3 * rate);
    this.mainOpen = true;
    this.energies = new Float64Array(WINDOW_BLOCKS);
    this.counts = new Float64Array(WINDOW_BLOCKS);
    this.slot = 0;
    this.sinceAbove = Infinity; // amostras desde a última vez acima do limite
    this.gain = 1;
    this.openStep = 1 / Math.max(1, OPEN_RAMP_S * rate);
    this.closeStep = 1 / Math.max(1, CLOSE_RAMP_S * rate);
    this.reported = null;
    this.lastDb = -100;
    this.port.onmessage = (e) => { this.configure(e && e.data); };
  }

  configure(d) {
    if (!d || d.type !== 'config') return;
    const mode = d.mode === 'auto' ? 'auto' : 'bypass';
    if (mode === 'auto' && this.mode !== 'auto') this.sinceAbove = Infinity;
    this.mode = mode;
    if (Number.isFinite(d.thresholdDb)) this.thresholdDb = Math.max(-100, Math.min(0, d.thresholdDb));
    if (Number.isFinite(d.holdMs) && d.holdMs >= 0) this.holdSamples = Math.round((Math.min(5000, d.holdMs) / 1000) * this.rate);
    if (typeof d.mainOpen === 'boolean') this.mainOpen = d.mainOpen;
  }

  // dB da janela (soma das energias dos últimos 8 blocos).
  windowDb() {
    let e = 0; let n = 0;
    for (let i = 0; i < WINDOW_BLOCKS; i += 1) { e += this.energies[i]; n += this.counts[i]; }
    if (n <= 0 || e <= 0) return -100;
    const rms = Math.sqrt(e / n);
    return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100;
  }

  process(inputs, outputs) {
    const output = outputs[0] && outputs[0][0];
    if (!output) return true;
    const input = inputs[0] && inputs[0][0];
    const n = output.length;
    let energy = 0;
    if (input) for (let i = 0; i < input.length; i += 1) energy += input[i] * input[i];
    this.energies[this.slot] = energy;
    this.counts[this.slot] = input ? input.length : n;
    this.slot = (this.slot + 1) % WINDOW_BLOCKS;

    let target = 1;
    if (this.mode === 'auto') {
      const db = this.windowDb();
      this.lastDb = db;
      if (db >= this.thresholdDb) this.sinceAbove = 0;
      else if (this.sinceAbove !== Infinity) this.sinceAbove += n;
      target = (this.mainOpen || this.sinceAbove <= this.holdSamples) ? 1 : 0;
    }

    if (!input) {
      output.fill(0);
    } else if (this.gain === target) {
      if (target === 1) output.set(input);
      else output.fill(0);
    } else {
      let g = this.gain;
      const step = target > g ? this.openStep : this.closeStep;
      for (let i = 0; i < n; i += 1) {
        if (g < target) { g += step; if (g > target) g = target; } else if (g > target) { g -= step; if (g < target) g = target; }
        output[i] = (input[i] || 0) * g;
      }
      this.gain = g;
    }

    if (target !== this.reported) {
      this.reported = target;
      try { this.port.postMessage({ type: 'state', open: target === 1 }); } catch { /* ok */ }
    }
    return true;
  }
}

registerProcessor('voice-gate-processor', VoiceGateProcessor);
