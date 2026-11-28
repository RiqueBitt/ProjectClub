// Volume individual por pessoa nas chamadas — conversão e mescla entre o
// cache local (0..2, usado direto no GainNode do AudioSink) e o que fica
// salvo NA CONTA (UserSettings.voiceVolumes: inteiros 0..200, 100 = padrão
// e não é guardado). Funções puras, testadas em client/test/voice-volumes.test.js.

export const VOICE_VOLUMES_MAX = 500;
const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// 0..2 (ganho) → 0..200 (porcentagem inteira).
export function gainToPercent(gain) {
  const n = Number(gain);
  if (!Number.isFinite(n)) return 100;
  return Math.min(200, Math.max(0, Math.round(n * 100)));
}

// 0..200 → 0..2.
export function percentToGain(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return 1;
  return Math.min(2, Math.max(0, n / 100));
}

// Mapa local limpo: só ids válidos e ganhos numéricos dentro da faixa.
export function cleanLocalVolumes(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return {};
  const out = {};
  for (const [k, v] of Object.entries(map)) {
    if (!USER_ID_RE.test(k)) continue;
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = Math.min(2, Math.max(0, n));
  }
  return out;
}

// Mescla ao entrar na conta: o que está na conta vence (segue a pessoa
// entre aparelhos); o que só existe neste aparelho é mantido e devolvido
// em `patch` pra subir pra conta. Volumes em 100% não precisam subir.
export function mergeVolumesOnLogin(local, server) {
  const loc = cleanLocalVolumes(local);
  const merged = { ...loc };
  const patch = {};
  const srv = server && typeof server === 'object' && !Array.isArray(server) ? server : {};
  for (const [k, pct] of Object.entries(srv)) {
    if (!USER_ID_RE.test(k) || !Number.isInteger(pct)) continue;
    merged[k] = percentToGain(pct);
  }
  for (const [k, gain] of Object.entries(loc)) {
    if (k in srv) continue;
    const pct = gainToPercent(gain);
    if (pct !== 100) patch[k] = pct;
  }
  return { merged: capLocal(merged), patch };
}

// Mantém só as últimas N entradas (mesma regra do servidor).
export function capLocal(map, max = VOICE_VOLUMES_MAX) {
  const keys = Object.keys(map);
  if (keys.length <= max) return map;
  const out = {};
  for (const k of keys.slice(keys.length - max)) out[k] = map[k];
  return out;
}

// Junta mudanças pendentes num único patch pro servidor ({ id: pct | null }).
export function toServerPatch(pending) {
  const out = {};
  for (const [k, gain] of Object.entries(pending || {})) {
    if (!USER_ID_RE.test(k)) continue;
    const pct = gainToPercent(gain);
    out[k] = pct === 100 ? null : pct;
  }
  return out;
}
