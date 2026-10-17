// Redutor "alta qualidade" (DeepFilterNet3, atrás de flag): quando oferecer,
// qual modelo usar e o vigia de CPU que volta pro RNNoise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  highQualityAvailability, pickNoiseModel, createSlowCpuWatch, wasmSimdSupported, DFN3_BASE_URL, NOISE_MODELS, NOISE_QUALITY,
} from '../src/voice/noiseModels.js';
import { getVoicePrefs } from '../src/utils/voicePrefs.js';

test('sem a flag do build a opção não existe', () => {
  assert.equal(DFN3_BASE_URL, '');
  assert.deepEqual(highQualityAvailability({ cores: 16, simd: true }), { available: false, reason: 'flag' });
});

test('com a flag: CPU fraca e sem SIMD não oferecem', () => {
  const baseUrl = '/dfn3';
  assert.deepEqual(highQualityAvailability({ baseUrl, cores: 8, simd: true }), { available: true });
  assert.deepEqual(highQualityAvailability({ baseUrl, cores: 2, simd: true }), { available: false, reason: 'cpu' });
  assert.deepEqual(highQualityAvailability({ baseUrl, cores: 8, simd: false }), { available: false, reason: 'simd' });
  assert.equal(highQualityAvailability({ baseUrl }).available, true, 'sem hardwareConcurrency: tenta (vigia de CPU cuida)');
});

test('pickNoiseModel', () => {
  const ok = { available: true };
  assert.equal(pickNoiseModel({ quality: NOISE_QUALITY.HIGH, availability: ok }), NOISE_MODELS.DFN3);
  assert.equal(pickNoiseModel({ quality: NOISE_QUALITY.HIGH, availability: ok, failed: true }), NOISE_MODELS.RNNOISE);
  assert.equal(pickNoiseModel({ quality: NOISE_QUALITY.HIGH, availability: { available: false } }), NOISE_MODELS.RNNOISE);
  assert.equal(pickNoiseModel({ quality: NOISE_QUALITY.STANDARD, availability: ok }), NOISE_MODELS.RNNOISE);
  assert.equal(pickNoiseModel({}), NOISE_MODELS.RNNOISE);
});

test('vigia de CPU: 3 relatórios seguidos no limite = desiste', () => {
  const w = createSlowCpuWatch();
  assert.equal(w(0.9), false);
  assert.equal(w(0.95), false);
  assert.equal(w(0.3), false, 'um bom zera a sequência');
  assert.equal(w(0.8), false);
  assert.equal(w(1.2), false);
  assert.equal(w(0.85), true);
  assert.equal(w('lixo'), false);
});

test('detecção de SIMD do WebAssembly', () => {
  assert.equal(wasmSimdSupported(), true, 'Node tem SIMD');
  assert.equal(wasmSimdSupported(null), false);
  assert.equal(wasmSimdSupported({ validate: () => { throw new Error('x'); } }), false);
});

test('preferência padrão é o RNNoise', () => {
  assert.equal(getVoicePrefs().noiseQuality, 'standard');
});
