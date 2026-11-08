// Lógica PURA da revisão "voz-turbo" no cliente (sem DOM/WebRTC — testada em
// client/test/voice-net-adapt.test.js). Quem usa é o mediasoupEngine.js.
//
//  - jitteredDelay: espera de reconexão com "jitter" (±30%). Quando o
//    servidor de mídia reinicia uma sala (1012) TODO MUNDO cai junto; sem
//    jitter todos voltavam no mesmo milissegundo (1s, 2s, 4s…) e o VPS de
//    2 vCPU recebia a rajada inteira de uma vez.
//  - jitterTargetDecision: buffer de recepção ADAPTATIVO pro áudio. O NetEq
//    do navegador só cresce o buffer por causa de jitter, não de PERDA — e o
//    pacote de voz perdido que o servidor retransmite (NACK/RTX do Opus) chega
//    ~1 RTT depois, tarde demais pra um buffer de 20–40ms: vira "picote"
//    (concealment). Com perda medida, sobe o alvo (RTT + folga) pra dar tempo
//    da retransmissão chegar; com a rede limpa por um tempo, devolve pro
//    automático (latência mínima de novo).
//  - matchInboundStats: UMA leitura de getStats() do transport de recepção
//    serve pra todos os consumers (antes era um getStats() por consumer a
//    cada 2s — com 20 pessoas, 20 relatórios completos).
//  - speakingChanges: só avisa quem MUDOU de "falando" (antes cada evento do
//    servidor chamava o callback pra todo mundo da sala).
//  - producerMaxLayer: camada máxima a enviar pelo aviso "producerLayers"
//    do servidor (dynacast).

export function jitteredDelay(baseMs, rand = Math.random, spread = 0.3) {
  const base = Number(baseMs);
  if (!Number.isFinite(base) || base <= 0) return 0;
  const s = Math.max(0, Math.min(0.9, Number(spread) || 0));
  let r = Number(typeof rand === 'function' ? rand() : rand);
  if (!Number.isFinite(r)) r = 0.5;
  r = Math.max(0, Math.min(1, r));
  return Math.round(base * (1 - s + 2 * s * r));
}

export const JITTER_ADAPT = Object.freeze({
  lossOnRatio: 0.03,      // ≥3% do áudio "inventado" (concealment) na janela → sobe o buffer
  lossOffRatio: 0.005,    // <0,5% → janela limpa
  cleanWindowsToRelax: 6, // janelas limpas seguidas pra voltar pro automático (~12s com 2s)
  minMs: 60,
  maxMs: 200,
  extraMs: 40,            // folga além do RTT (detecção da perda + ida da retransmissão)
  minSamples: 9600,       // < 0,2s de áudio na janela (silêncio/DTX): não dá pra medir
});

// { prevMs, concealedDelta, samplesDelta, rttMs, cleanStreak } →
// { targetMs: number|null (null = automático do navegador), cleanStreak, changed }
export function jitterTargetDecision({ prevMs = null, concealedDelta = 0, samplesDelta = 0, rttMs = null, cleanStreak = 0 } = {}, opts = JITTER_ADAPT) {
  const prev = Number.isFinite(prevMs) && prevMs > 0 ? prevMs : null;
  const streak = Number.isFinite(cleanStreak) && cleanStreak > 0 ? cleanStreak : 0;
  if (!Number.isFinite(samplesDelta) || samplesDelta < opts.minSamples) {
    return { targetMs: prev, cleanStreak: streak, changed: false };
  }
  const ratio = Math.max(0, Number(concealedDelta) || 0) / samplesDelta;
  if (ratio >= opts.lossOnRatio) {
    const rtt = Number.isFinite(rttMs) && rttMs > 0 ? rttMs : 50;
    const want = Math.round(Math.max(opts.minMs, Math.min(opts.maxMs, rtt + opts.extraMs)));
    const next = prev == null ? want : Math.max(prev, want);
    return { targetMs: next, cleanStreak: 0, changed: next !== prev };
  }
  if (ratio < opts.lossOffRatio) {
    const s = streak + 1;
    if (prev != null && s >= opts.cleanWindowsToRelax) return { targetMs: null, cleanStreak: 0, changed: true };
    return { targetMs: prev, cleanStreak: s, changed: false };
  }
  return { targetMs: prev, cleanStreak: 0, changed: false };
}

// `stats`: lista de entradas do RTCStatsReport (ou um Map/RTCStatsReport);
// `consumers`: [{ id, trackId, mid }]. Devolve Map(consumerId → inbound-rtp).
export function matchInboundStats(stats, consumers) {
  const out = new Map();
  const list = [];
  if (stats && typeof stats.forEach === 'function') stats.forEach((s) => { if (s && s.type === 'inbound-rtp') list.push(s); });
  if (!list.length) return out;
  const byTrack = new Map(); const byMid = new Map();
  for (const s of list) {
    if (s.trackIdentifier) byTrack.set(String(s.trackIdentifier), s);
    if (s.mid != null) byMid.set(String(s.mid), s);
  }
  for (const c of consumers || []) {
    if (!c || !c.id) continue;
    const hit = (c.mid != null && byMid.get(String(c.mid))) || (c.trackId && byTrack.get(String(c.trackId))) || null;
    if (hit) out.set(c.id, hit);
  }
  return out;
}

// Quem mudou de "falando": prev (Set de uid que estavam falando), ids (Set
// dos que estão agora), peers (uids conhecidos). Devolve { changes: [[uid,
// bool]], next: Set }.
export function speakingChanges(prev, ids, peers) {
  const before = prev instanceof Set ? prev : new Set(prev || []);
  const now = ids instanceof Set ? ids : new Set(ids || []);
  const next = new Set();
  const changes = [];
  for (const uid of peers || []) {
    const on = now.has(uid);
    if (on) next.add(uid);
    if (on !== before.has(uid)) changes.push([uid, on]);
  }
  return { changes, next };
}

// Aviso do servidor (dynacast) → camada máxima a enviar (0..encodings-1).
// -1 (ninguém assistindo) mantém a camada baixa no ar: barata, e quem
// abrir o vídeo vê a imagem na hora enquanto a cheia religa.
export function producerMaxLayer(maxSpatialLayer, encodings) {
  const top = Math.max(0, (Number(encodings) || 1) - 1);
  const n = Number(maxSpatialLayer);
  if (!Number.isFinite(n)) return top;
  return Math.max(0, Math.min(top, Math.floor(n)));
}
