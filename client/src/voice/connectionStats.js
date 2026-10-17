// Painel "Qualidade da conexão" (CallBar → clique no sinal): transforma as
// estatísticas de cada provedor de voz numa leitura só, no mesmo formato:
//
//   { rttMs, lossPct, jitterMs, outKbps, inKbps, audioCodec, videoCodec,
//     screen: { width, height, fps } | null, server }
//
// Qualquer campo pode vir null (provedor não expõe, ainda medindo, etc.) —
// a UI mostra "—" nesses casos em vez de quebrar. Funções puras (sem DOM),
// testadas em client/test/connection-stats.test.js.

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

// Aceita RTCStatsReport (Map-like), array ou vários deles juntos.
function flattenStats(reports) {
  const out = [];
  const list = Array.isArray(reports) ? reports : [reports];
  for (const r of list) {
    if (!r) continue;
    if (typeof r.forEach === 'function' && !Array.isArray(r)) r.forEach((s) => { if (s && typeof s === 'object') out.push(s); });
    else if (Array.isArray(r)) r.forEach((s) => { if (s && typeof s === 'object') out.push(s); });
  }
  return out;
}

// "audio/opus" → "Opus", "video/VP8" → "VP8".
export function prettyCodec(mime) {
  if (!mime || typeof mime !== 'string') return null;
  const name = mime.includes('/') ? mime.split('/')[1] : mime;
  if (!name) return null;
  if (/^opus$/i.test(name)) return 'Opus';
  if (/^(pcmu|pcma|g722|aac)$/i.test(name)) return name.toUpperCase();
  return name.toUpperCase().replace('AV1X', 'AV1');
}

// kbps a partir de dois contadores de bytes.
export function bitrateKbps(bytesNow, bytesPrev, ms) {
  if (!Number.isFinite(bytesNow) || !Number.isFinite(bytesPrev) || !(ms > 0)) return null;
  const delta = bytesNow - bytesPrev;
  if (delta < 0) return null; // contador zerou (reconexão) — espera a próxima leitura
  return Math.round((delta * 8) / ms);
}

// Lê estatísticas WebRTC cruas (RTCPeerConnection.getStats de envio +
// recepção) e devolve { snapshot, counters }. `prev` são os contadores da
// leitura anterior (pra bitrate e perda RECENTES, não acumuladas).
// `screenStats`: stats do producer da tela (opcional) pra resolução/FPS.
export function summarizeWebRtcStats(reports, prev = null, now = Date.now(), screenStats = null) {
  const stats = flattenStats(reports);
  const byId = new Map(stats.filter((s) => s.id).map((s) => [s.id, s]));
  let rtt = null;
  let bytesSent = 0; let bytesReceived = 0;
  let lost = 0; let received = 0;
  let remoteLoss = null;
  let jitter = null;
  let audioCodec = null; let videoCodec = null;
  let audioCodecIn = null; let videoCodecIn = null;
  let sawOut = false; let sawIn = false;

  for (const s of stats) {
    switch (s.type) {
      case 'candidate-pair': {
        const r = num(s.currentRoundTripTime);
        if (r != null && (s.nominated || s.state === 'succeeded')) {
          const ms = r * 1000;
          rtt = rtt == null ? ms : Math.min(rtt, ms);
        }
        break;
      }
      case 'outbound-rtp': {
        sawOut = true;
        bytesSent += num(s.bytesSent) || 0;
        const codec = prettyCodec(byId.get(s.codecId)?.mimeType);
        if (codec && s.kind === 'audio' && !audioCodec) audioCodec = codec;
        if (codec && s.kind === 'video' && !videoCodec) videoCodec = codec;
        break;
      }
      case 'inbound-rtp': {
        sawIn = true;
        bytesReceived += num(s.bytesReceived) || 0;
        lost += Math.max(0, num(s.packetsLost) || 0);
        received += num(s.packetsReceived) || 0;
        const j = num(s.jitter);
        if (j != null && s.kind === 'audio') jitter = Math.max(jitter ?? 0, j * 1000);
        const codec = prettyCodec(byId.get(s.codecId)?.mimeType);
        if (codec && s.kind === 'audio' && !audioCodecIn) audioCodecIn = codec;
        if (codec && s.kind === 'video' && !videoCodecIn) videoCodecIn = codec;
        break;
      }
      case 'remote-inbound-rtp': {
        // O que o servidor diz ter recebido de MIM: perda e jitter do envio.
        const fl = num(s.fractionLost);
        if (fl != null) remoteLoss = Math.max(remoteLoss ?? 0, fl);
        const j = num(s.jitter);
        if (j != null && s.kind === 'audio' && jitter == null) jitter = j * 1000;
        const r = num(s.roundTripTime);
        if (r != null && rtt == null) rtt = r * 1000;
        break;
      }
      default: break;
    }
  }

  const counters = { at: now, bytesSent, bytesReceived, lost, received };
  const ms = prev ? now - prev.at : 0;
  let inboundLoss = null;
  if (prev) {
    const dl = Math.max(0, lost - prev.lost);
    const dr = Math.max(0, received - prev.received);
    inboundLoss = dl + dr > 0 ? dl / (dl + dr) : 0;
  }
  const lossFrac = inboundLoss == null && remoteLoss == null ? null : Math.max(inboundLoss ?? 0, remoteLoss ?? 0);

  return {
    snapshot: {
      rttMs: rtt == null ? null : Math.round(rtt),
      lossPct: lossFrac == null ? null : round1(lossFrac * 100),
      jitterMs: jitter == null ? null : round1(jitter),
      outKbps: sawOut && prev ? bitrateKbps(bytesSent, prev.bytesSent, ms) : null,
      inKbps: sawIn && prev ? bitrateKbps(bytesReceived, prev.bytesReceived, ms) : null,
      audioCodec: audioCodec || audioCodecIn,
      videoCodec: videoCodec || videoCodecIn,
      screen: screenFromStats(screenStats),
    },
    counters,
  };
}

// Resolução/FPS que a tela está SAINDO de verdade (outbound-rtp de vídeo).
export function screenFromStats(reports) {
  if (!reports) return null;
  let best = null;
  for (const s of flattenStats(reports)) {
    if (s.type !== 'outbound-rtp' || (s.kind && s.kind !== 'video')) continue;
    const w = num(s.frameWidth); const h = num(s.frameHeight);
    if (!w || !h) continue;
    if (!best || w * h > best.width * best.height) {
      best = { width: w, height: h, fps: num(s.framesPerSecond) == null ? null : Math.round(s.framesPerSecond) };
    }
  }
  return best;
}

// Agora: já entrega tudo mastigado (getRTCStats / getLocalAudioStats /
// getRemoteAudioStats / getLocalVideoStats). Perda vem em %.
export function summarizeAgoraStats({ rtc, localAudio, remoteAudio, localVideo, screenOn = false, cameraOn = false } = {}) {
  const rtt = num(rtc?.RTT);
  const send = num(rtc?.SendBitrate);
  const recv = num(rtc?.RecvBitrate);
  const losses = [num(localAudio?.currentPacketLossRate)];
  for (const r of Object.values(remoteAudio || {})) losses.push(num(r?.currentPacketLossRate ?? r?.packetLossRate));
  const known = losses.filter((v) => v != null);
  const loss = known.length ? Math.max(...known) : null;
  const jitter = num(localAudio?.sendJitterMs);
  // No Agora (modo rtc) só uma faixa de vídeo sai por vez: se a tela está
  // ligada e a câmera não, as stats de vídeo locais SÃO as da tela.
  let screen = null;
  if (screenOn && !cameraOn && localVideo) {
    const w = num(localVideo.sendResolutionWidth); const h = num(localVideo.sendResolutionHeight);
    if (w && h) screen = { width: w, height: h, fps: num(localVideo.sendFrameRate) == null ? null : Math.round(localVideo.sendFrameRate) };
  }
  return {
    rttMs: rtt == null || rtt <= 0 ? null : Math.round(rtt),
    lossPct: loss == null ? null : round1(loss),
    jitterMs: jitter == null ? null : round1(jitter),
    outKbps: send == null ? null : Math.round(send / 1000),
    inKbps: recv == null ? null : Math.round(recv / 1000),
    audioCodec: prettyCodec(localAudio?.codecType) || prettyCodec(Object.values(remoteAudio || {})[0]?.codecType),
    videoCodec: prettyCodec(localVideo?.codecType),
    screen,
  };
}

// ---------- Histórico do ping (sparkline) ----------
export const PING_WINDOW_MS = 60_000;

// Acrescenta uma amostra e descarta o que saiu da janela (últimos ~60s).
export function pushSample(history, value, now = Date.now(), windowMs = PING_WINDOW_MS) {
  const kept = (history || []).filter((p) => now - p.t <= windowMs);
  if (Number.isFinite(value)) kept.push({ t: now, v: value });
  return kept;
}

// Caminho SVG ("M x y L ...") da linha do ping, escalado pra w×h, com o
// eixo X fixo na janela de tempo (o gráfico "anda" da direita pra esquerda).
export function sparklinePath(history, w, h, now = Date.now(), windowMs = PING_WINDOW_MS, pad = 2) {
  const pts = (history || []).filter((p) => Number.isFinite(p.v) && now - p.t <= windowMs);
  if (pts.length === 0) return '';
  const max = Math.max(...pts.map((p) => p.v), 1);
  const min = Math.min(...pts.map((p) => p.v));
  const span = Math.max(max - min, max * 0.25, 10);
  const top = max + span * 0.15;
  const bottom = Math.max(0, top - span * 1.3);
  const x = (t) => pad + ((w - pad * 2) * (1 - (now - t) / windowMs));
  const y = (v) => pad + (h - pad * 2) * (1 - (v - bottom) / (top - bottom || 1));
  const f = (n) => Math.round(n * 10) / 10;
  if (pts.length === 1) return `M ${f(x(pts[0].t) - 1)} ${f(y(pts[0].v))} L ${f(x(pts[0].t))} ${f(y(pts[0].v))}`;
  return pts.map((p, i) => `${i ? 'L' : 'M'} ${f(x(p.t))} ${f(y(p.v))}`).join(' ');
}

// Hostname "bonito" de uma URL de sinalização (wss://voz.exemplo.com/ws → voz.exemplo.com).
export function serverHost(url) {
  if (!url || typeof url !== 'string') return null;
  try { return new URL(url).host || null; } catch { return null; }
}
