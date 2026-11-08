// Lógica PURA do portão do microfone (sem DOM/Web Audio — testada em
// client/test/voice-micgate.test.js). Quem mede o nível e mexe no áudio é
// o micPipeline.js; quem junta tudo é o mediasoupEngine.js.
//
// Igual ao Discord:
//   - Apertar pra falar (PTT): o microfone só vai ao ar com a tecla
//     apertada, e continua aberto `pttReleaseMs` (200ms) depois de soltar —
//     não corta a última sílaba.
//   - Sensibilidade de entrada (detecção de voz): abaixo do limite por mais
//     de `holdMs` (250ms) o portão fecha. Limite manual (dB) ou automático
//     (piso de ruído adaptativo + margem).
//   - Sem PTT e sem sensibilidade configurada: portão sempre aberto.
//   - Sem medida de nível (navegador não deixou o Web Audio rodar): o
//     portão por voz fica ABERTO — nunca deixa a pessoa muda sem saber.
//   - Com o RNNoise ligado, o worklet manda a PROBABILIDADE DE VOZ (VAD) de
//     cada quadro (~20/s). No modo AUTOMÁTICO ela ajuda o portão, de forma
//     CONSERVADORA (voz baixa nunca é cortada): abre se VAD >= 0,5 OU o
//     nível passou do limite; só fecha quando os DOIS ficam baixos por mais
//     de 300ms. O VAD também segura o piso de ruído (não sobe durante a
//     fala; sobe mais rápido com teclado/respiração) e acende o anel verde
//     na hora. Sem VAD (RNNoise desligado / sem mensagem há 500ms): volta o
//     portão antigo, só por nível. No modo MANUAL (limite em dB escolhido
//     pela pessoa) vale só o nível, como antes.

export const GATE_DEFAULTS = Object.freeze({
  holdMs: 250,          // abaixo do limite por mais que isso → fecha
  pttReleaseMs: 200,    // PTT: continua aberto depois de soltar a tecla
  defaultDb: -60,       // limite manual padrão
  autoMarginDb: 10,     // automático: limite = piso de ruído + margem
  autoMinDb: -65,       // automático: limite nunca abaixo disso…
  autoMaxDb: -35,       // …nem acima disso (voz normal fica entre -40 e -15)
  speakingDb: -55,      // anel verde: nível mínimo pra contar como fala
  speakingHoldMs: 300,  // anel verde: continua aceso depois da última sílaba
  vadOpenProb: 0.5,     // VAD: probabilidade de voz que já conta como fala
  vadQuietProb: 0.2,    // VAD: abaixo disso é ruído (teclado, respiração)
  vadHoldMs: 300,       // VAD + nível baixos por mais que isso → fecha
  vadStaleMs: 500,      // sem mensagem do VAD há mais que isso → ignora o VAD
  vadAutoMaxDb: -45,    // com VAD, o limite automático nunca passa disso (voz baixa passa)
  vadNoiseRiseDbPerSec: 6, // piso sobe mais rápido quando o VAD diz "não é voz"
});

// RMS de amostras float (-1..1) → dBFS. Silêncio absoluto = -100.
export function rmsToDb(samples) {
  if (!samples || !samples.length) return -100;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100;
}

// dB → nível 0..1 pra barrinha de volume (-60 dB = 0, 0 dB = 1).
export function dbToLevel(db) {
  if (!Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

// Piso de ruído adaptativo (modo automático): desce rápido quando fica mais
// quieto e sobe DEVAGAR (fala não "vira" ruído de fundo).
export function createNoiseFloor({ initialDb = -60, fallPerTick = 0.3, riseDbPerSec = 1.5 } = {}) {
  let floor = initialDb;
  return {
    // `rise` (dB/s) troca a subida padrão nesta leitura (0 = não sobe).
    update(db, dtMs = 40, rise = riseDbPerSec) {
      if (!Number.isFinite(db)) return floor;
      if (db < floor) floor += (db - floor) * fallPerTick;
      else floor = Math.min(db, floor + (rise * dtMs) / 1000);
      return floor;
    },
    get value() { return floor; },
    reset(v = initialDb) { floor = v; },
  };
}

// Limite efetivo da detecção de voz.
export function vadThreshold({ auto, db, floorDb, withVad = false }, opts = GATE_DEFAULTS) {
  if (!auto) return Number.isFinite(db) ? db : opts.defaultDb;
  const base = Number.isFinite(floorDb) ? floorDb + opts.autoMarginDb : opts.defaultDb;
  const max = withVad ? Math.min(opts.autoMaxDb, opts.vadAutoMaxDb ?? opts.autoMaxDb) : opts.autoMaxDb;
  return Math.max(opts.autoMinDb, Math.min(max, base));
}

// Portão. `update(db, now)` devolve { open, changed }. db = null → sem medida.
export function createMicGate(options = {}) {
  const opts = { ...GATE_DEFAULTS, ...options };
  let ptt = false;
  let pressed = false;
  let releasedAt = -Infinity;
  let vad = false; // sensibilidade configurada?
  let sens = { auto: true, db: opts.defaultDb };
  let lastAboveAt = -Infinity;
  let lastUpdateAt = null;
  let open = true;
  // Última leitura do VAD do RNNoise: probabilidade 0..1, "aberto" (com a
  // segura de 200ms do worklet) e quando chegou.
  let vadP = null;
  let vadFlag = false;
  let vadAt = -Infinity;
  const floor = createNoiseFloor({ initialDb: opts.defaultDb });

  const vadFresh = (now) => vadP != null && now - vadAt <= opts.vadStaleMs;
  const vadSaysVoice = () => vadFlag || (vadP != null && vadP >= opts.vadOpenProb);

  const compute = (db, now) => {
    if (ptt) return pressed || now - releasedAt < opts.pttReleaseMs;
    if (!vad) return true;
    if (db == null || !Number.isFinite(db)) return true; // sem medida: aberto
    const withVad = sens.auto && vadFresh(now);
    const threshold = vadThreshold({ auto: sens.auto, db: sens.db, floorDb: floor.value, withVad }, opts);
    if (withVad) {
      // Conservador: qualquer um dos dois (VAD ou nível) mantém aberto.
      if (vadSaysVoice() || db >= threshold) { lastAboveAt = now; return true; }
      return now - lastAboveAt <= opts.vadHoldMs;
    }
    if (db >= threshold) { lastAboveAt = now; return true; }
    return now - lastAboveAt <= opts.holdMs;
  };

  const step = (db, now) => {
    if (vad && sens.auto && db != null && Number.isFinite(db)) {
      const dt = lastUpdateAt == null ? 40 : Math.max(1, Math.min(1000, now - lastUpdateAt));
      let rise;
      if (vadFresh(now)) {
        // Falando: o piso NÃO sobe (a voz nunca "vira" ruído de fundo).
        // Ruído claro (teclado, respiração): sobe mais rápido.
        if (vadSaysVoice()) rise = 0;
        else if (vadP < opts.vadQuietProb) rise = opts.vadNoiseRiseDbPerSec;
      }
      floor.update(db, dt, rise);
    }
    lastUpdateAt = now;
    const next = compute(db, now);
    const changed = next !== open;
    open = next;
    return { open, changed };
  };

  return {
    update(db, now) { return step(db, now); },
    // PTT liga/desliga. Ligar fecha o portão até apertar a tecla.
    setPushToTalk(on, { releaseMs } = {}) {
      ptt = !!on;
      if (Number.isFinite(releaseMs) && releaseMs >= 0) opts.pttReleaseMs = releaseMs;
      if (!ptt) { pressed = false; releasedAt = -Infinity; }
    },
    setPttPressed(down, now) {
      const d = !!down;
      if (d === pressed) return;
      pressed = d;
      if (!d) releasedAt = now;
    },
    // Sensibilidade: null/undefined desliga a detecção de voz (sempre aberto).
    setSensitivity(cfg) {
      if (!cfg) { vad = false; return; }
      vad = true;
      sens = { auto: cfg.auto !== false, db: Number.isFinite(cfg.db) ? cfg.db : opts.defaultDb };
      if (sens.auto) floor.reset(opts.defaultDb);
    },
    // Leitura do VAD do RNNoise (p = probabilidade de voz 0..1; open = já
    // com a segura do worklet). Recalcula o portão na hora (anel instantâneo).
    setVad(p, flag, now) {
      const n = Number(p);
      if (!Number.isFinite(n) || n < 0) { vadP = null; vadFlag = false; vadAt = -Infinity; return; }
      vadP = Math.min(1, n);
      vadFlag = !!flag;
      vadAt = now;
    },
    // RNNoise desligado: esquece o VAD (volta o portão só por nível).
    clearVad() { vadP = null; vadFlag = false; vadAt = -Infinity; },
    // O VAD está valendo agora? (voz detectada = true/false; sem VAD = null)
    vadVoice(now) { return vadFresh(now) ? vadSaysVoice() : null; },
    // Quando o portão do PTT fecha sozinho (fim da folga depois de soltar).
    releaseDeadline() { return ptt && !pressed && Number.isFinite(releasedAt) ? releasedAt + opts.pttReleaseMs : null; },
    get open() { return open; },
    state() {
      const withVad = vad && sens.auto && lastUpdateAt != null && vadFresh(lastUpdateAt);
      return {
        open, mode: ptt ? 'ptt' : vad ? 'vad' : 'open', pressed,
        thresholdDb: vad ? vadThreshold({ auto: sens.auto, db: sens.db, floorDb: floor.value, withVad }, opts) : null,
        floorDb: floor.value, auto: sens.auto, vadP, vadAssisted: !!withVad,
      };
    },
  };
}

// Anel verde LOCAL: fala = transmitindo (não mudo, portão aberto) e nível
// acima de `speakingDb`; continua aceso `holdMs` depois (não pisca entre
// as palavras). Devolve { speaking, changed }.
export function createSpeakingDetector({ thresholdDb = GATE_DEFAULTS.speakingDb, holdMs = GATE_DEFAULTS.speakingHoldMs } = {}) {
  let lastLoudAt = -Infinity;
  let speaking = false;
  return {
    // `vad` (opcional): o VAD do RNNoise diz que é voz — acende na hora
    // mesmo com o nível baixo.
    update({ db, transmitting, now, vad = false }) {
      if (transmitting && ((Number.isFinite(db) && db >= thresholdDb) || vad === true)) lastLoudAt = now;
      const next = !!transmitting && now - lastLoudAt <= holdMs;
      const changed = next !== speaking;
      speaking = next;
      return { speaking, changed };
    },
    reset() { const changed = speaking; speaking = false; lastLoudAt = -Infinity; return { speaking, changed }; },
    get speaking() { return speaking; },
  };
}

// No máximo 1 vez a cada `ms` (ex.: onLocalLevel ~10/s).
export function createThrottle(ms) {
  let last = -Infinity;
  return (now) => {
    if (now - last < ms) return false;
    last = now;
    return true;
  };
}
