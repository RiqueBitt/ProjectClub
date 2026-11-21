// Portão rápido do microfone (public/voice/voice-gate-worklet.js) rodando
// fora do navegador: o arquivo do worklet é carregado num contexto `vm` com
// AudioWorkletProcessor/registerProcessor de mentira e alimentado com blocos
// de 128 amostras, igual à thread de áudio.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(here, '../public/voice/voice-gate-worklet.js'), 'utf8');

function load() {
  const registered = {};
  class AudioWorkletProcessor {
    constructor() { this.port = { sent: [], onmessage: null, postMessage(m) { this.sent.push(m); } }; }
  }
  const ctx = vm.createContext({
    AudioWorkletProcessor, sampleRate: 48000, Math, Float64Array, Float32Array, Number, Infinity,
    registerProcessor: (name, cls) => { registered[name] = cls; },
  });
  vm.runInContext(SRC, ctx);
  const Cls = registered['voice-gate-processor'];
  assert.ok(Cls, 'registrou voice-gate-processor');
  const node = new Cls();
  const send = (data) => node.port.onmessage({ data });
  // Roda `blocks` blocos de 128 com amplitude `amp` (seno simples); devolve a saída.
  const run = (amp, blocks = 1) => {
    const out = [];
    for (let b = 0; b < blocks; b += 1) {
      const input = new Float32Array(128);
      for (let i = 0; i < 128; i += 1) input[i] = amp * Math.sin((i / 128) * Math.PI * 8);
      const output = new Float32Array(128);
      node.process([[input]], [[output]]);
      out.push(output);
    }
    return out;
  };
  const peak = (blocks) => Math.max(...blocks.map((b) => Math.max(...b.map(Math.abs))));
  // Última mensagem como objeto deste "realm" (o vm cria objetos de outro).
  const last = () => JSON.parse(JSON.stringify(node.port.sent.at(-1) ?? null));
  return { node, send, run, peak, last };
}

test('bypass (padrão): passa o áudio intacto', () => {
  const { run, peak } = load();
  assert.ok(Math.abs(peak(run(0.5, 3)) - 0.5) < 0.01);
  assert.ok(peak(run(0.001, 2)) > 0, 'som baixo também passa');
});

test('auto: silêncio fecha depois da segura; voz ABRE no mesmo bloco (sem comer a 1ª sílaba)', () => {
  const { node, send, run, peak, last } = load();
  send({ type: 'config', mode: 'auto', thresholdDb: -40, holdMs: 100, mainOpen: false });
  // Silêncio/ruído baixo (-60 dB): fecha (rampa de 30ms ≈ 12 blocos).
  const quiet = run(0.001, 16);
  assert.ok(peak(quiet.slice(13)) < 1e-6, 'ruído abaixo do limite não passa');
  assert.deepEqual(last(), { type: 'state', open: false });
  // Voz (-6 dB): o primeiro bloco já sai com som (rampa de 5ms começando).
  const loud = run(0.5, 4);
  assert.ok(peak([loud[0]]) > 0.01, 'abriu no primeiro bloco da voz');
  assert.ok(Math.abs(peak([loud[3]]) - 0.5) < 0.01, 'depois da rampa, ganho cheio');
  assert.deepEqual(last(), { type: 'state', open: true });
  // Pausa curta entre palavras (< segura de 100ms): continua aberto.
  run(0.0001, 20); // ~53ms
  assert.deepEqual(last(), { type: 'state', open: true });
  // Silêncio longo (> janela + segura): fecha com rampa.
  run(0.0001, 60); // ~160ms
  assert.deepEqual(last(), { type: 'state', open: false });
  assert.ok(peak(run(0.0001, 2)) < 1e-6);
});

test('auto: a thread principal (VAD/piso automático) segura aberto mesmo abaixo do limite', () => {
  const { node, send, run, peak, last } = load();
  send({ type: 'config', mode: 'auto', thresholdDb: -20, holdMs: 50, mainOpen: true });
  const out = run(0.01, 30); // -40 dB, abaixo do limite
  assert.ok(peak([out.at(-1)]) > 0.009, 'mainOpen=true: passa');
  send({ type: 'config', mode: 'auto', thresholdDb: -20, holdMs: 50, mainOpen: false });
  run(0.01, 40);
  assert.deepEqual(last(), { type: 'state', open: false });
  // Voltar pro bypass reabre (apertar-pra-falar/portão manual decidem no GainNode).
  send({ type: 'config', mode: 'bypass' });
  const back = run(0.01, 10);
  assert.ok(Math.abs(peak([back.at(-1)]) - 0.01) < 0.001);
});

test('mensagens inválidas não mudam nada e o limite fica entre -100 e 0 dB', () => {
  const { node, send } = load();
  send(null); send({ type: 'x', mode: 'auto' });
  assert.equal(node.mode, 'bypass');
  send({ type: 'config', mode: 'auto', thresholdDb: 50, holdMs: -1 });
  assert.equal(node.thresholdDb, 0);
  send({ type: 'config', mode: 'auto', thresholdDb: -500 });
  assert.equal(node.thresholdDb, -100);
});
