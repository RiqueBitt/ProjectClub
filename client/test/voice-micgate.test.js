// Portão do microfone (lógica pura de voice/micGate.js): apertar-pra-falar
// com folga ao soltar, sensibilidade manual e automática (piso de ruído),
// "segura" de 250ms, anel verde local com 300ms e o limite do nível.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMicGate, createSpeakingDetector, createThrottle, createNoiseFloor, rmsToDb, dbToLevel, vadThreshold, GATE_DEFAULTS,
} from '../src/voice/micGate.js';

test('sem PTT e sem sensibilidade: portão sempre aberto (comportamento antigo)', () => {
  const g = createMicGate();
  assert.equal(g.update(-100, 0).open, true);
  assert.equal(g.update(-20, 50).open, true);
  assert.equal(g.state().mode, 'open');
});

test('apertar pra falar: fechado até apertar; continua aberto 200ms depois de soltar', () => {
  const g = createMicGate();
  g.setPushToTalk(true);
  assert.equal(g.update(-20, 0).open, false, 'PTT ligado e tecla solta: mudo mesmo falando alto');
  g.setPttPressed(true, 100);
  assert.equal(g.update(-90, 100).open, true, 'tecla apertada: abre (nem olha o nível)');
  g.setPttPressed(false, 500);
  assert.equal(g.releaseDeadline(), 500 + GATE_DEFAULTS.pttReleaseMs);
  assert.equal(g.update(-20, 650).open, true, 'ainda na folga de 200ms');
  const r = g.update(-20, 701);
  assert.equal(r.open, false); assert.equal(r.changed, true);
  g.setPushToTalk(true, { releaseMs: 0 });
  g.setPttPressed(true, 1000); g.update(null, 1000);
  g.setPttPressed(false, 1001);
  assert.equal(g.update(null, 1001).open, false, 'folga configurável (0)');
  g.setPushToTalk(false);
  assert.equal(g.update(-100, 1100).open, true, 'desligou o PTT: volta a abrir');
});

test('sensibilidade manual: abre acima do limite, fecha só depois de 250ms abaixo', () => {
  const g = createMicGate();
  g.setSensitivity({ auto: false, db: -50 });
  assert.equal(g.update(-80, 0).open, false, 'silêncio: fechado');
  assert.equal(g.update(-40, 40).open, true, 'fala: abre na hora');
  assert.equal(g.update(-80, 200).open, true, 'pausa curta entre palavras: continua aberto');
  assert.equal(g.update(-80, 290).open, true, '250ms exatos ainda abre (segura)');
  assert.equal(g.update(-80, 291).open, false, 'passou de 250ms: fecha');
  assert.equal(g.state().thresholdDb, -50);
});

test('sem medida de nível (Web Audio parado): o portão por voz fica ABERTO — nunca muda a pessoa sem saber', () => {
  const g = createMicGate();
  g.setSensitivity({ auto: false, db: -30 });
  assert.equal(g.update(-90, 0).open, false);
  assert.equal(g.update(null, 1000).open, true);
  g.setSensitivity(null);
  assert.equal(g.update(-100, 2000).open, true, 'sensibilidade desligada');
});

test('sensibilidade automática: o piso acompanha o ruído e a fala passa', () => {
  const g = createMicGate();
  g.setSensitivity({ auto: true });
  let t = 0;
  // 3s de ruído de fundo em -58 dB (ventilador): o portão não abre com ele.
  let opened = 0;
  for (; t < 3000; t += 40) if (g.update(-58 + (t % 80 ? 1 : -1), t).open) opened += 1;
  const st = g.state();
  assert.ok(st.floorDb < -55 && st.floorDb > -62, `piso perto do ruído (${st.floorDb.toFixed(1)})`);
  assert.ok(st.thresholdDb > -58, 'limite acima do ruído');
  assert.equal(g.update(-58, t).open, false, 'ruído de fundo não abre');
  assert.equal(g.update(-30, t + 40).open, true, 'voz normal abre');
  // Falar por 2s não "ensina" que a fala é ruído (o piso sobe devagar).
  for (let k = 0; k < 50; k += 1) g.update(-28, t + 80 + k * 40);
  assert.ok(g.state().thresholdDb < -35 + 0.01, 'limite continua baixo depois de falar');
  assert.ok(opened < 10, 'quase nunca abriu com o ruído');
});

test('vadThreshold respeita os limites do modo automático', () => {
  assert.equal(vadThreshold({ auto: true, floorDb: -100 }), GATE_DEFAULTS.autoMinDb);
  assert.equal(vadThreshold({ auto: true, floorDb: -10 }), GATE_DEFAULTS.autoMaxDb);
  assert.equal(vadThreshold({ auto: false, db: -42 }), -42);
  const f = createNoiseFloor({ initialDb: -60 });
  f.update(-80, 40); assert.ok(f.value < -60, 'desce rápido');
  const before = f.value; f.update(-10, 1000); assert.ok(f.value - before <= 1.6, 'sobe no máximo ~1,5 dB/s');
});

test('anel verde local: só transmitindo, acende na hora e segura 300ms', () => {
  const d = createSpeakingDetector();
  assert.equal(d.update({ db: -20, transmitting: false, now: 0 }).speaking, false, 'mudo/portão fechado: nunca acende');
  let r = d.update({ db: -20, transmitting: true, now: 10 });
  assert.equal(r.speaking, true); assert.equal(r.changed, true);
  assert.equal(d.update({ db: -90, transmitting: true, now: 300 }).speaking, true, 'segura');
  r = d.update({ db: -90, transmitting: true, now: 311 });
  assert.equal(r.speaking, false); assert.equal(r.changed, true);
  d.update({ db: -20, transmitting: true, now: 400 });
  assert.equal(d.update({ db: -20, transmitting: false, now: 420 }).speaking, false, 'mutou: apaga na hora');
  assert.equal(d.reset().speaking, false);
});

test('rmsToDb, dbToLevel e o limite de frequência', () => {
  assert.equal(rmsToDb(new Float32Array(128)), -100);
  const s = new Float32Array(100).fill(0.5);
  assert.ok(Math.abs(rmsToDb(s) - -6.02) < 0.05);
  assert.equal(dbToLevel(-60), 0); assert.equal(dbToLevel(0), 1); assert.equal(dbToLevel(-30), 0.5); assert.equal(dbToLevel(NaN), 0);
  const th = createThrottle(100);
  assert.equal(th(0), true); assert.equal(th(50), false); assert.equal(th(100), true); assert.equal(th(150), false);
});
