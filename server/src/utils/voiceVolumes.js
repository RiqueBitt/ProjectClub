// Volume individual por pessoa nas chamadas de voz, salvo NA CONTA (segue a
// pessoa entre PC, site e celular). Fica em UserSettings.voiceVolumes como
// texto JSON: { [userId]: volume 0..200 } (100 = normal, não é guardado).
//
// Tudo puro (sem banco) pra dar pra testar: o controller de configurações
// usa estas funções pra validar e mesclar o que o frontend manda.

// Limite de pessoas lembradas por conta — evita que o JSON cresça sem fim.
// Quando passa, as entradas mais antigas (as primeiras do objeto) saem.
const VOICE_VOLUMES_MAX = 500;
const VOLUME_MIN = 0;
const VOLUME_MAX = 200;
const DEFAULT_VOLUME = 100;
// Id de usuário (uuid ou id numérico/curto) — nunca aceita chave arbitrária.
const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isValidVolume = (v) => Number.isInteger(v) && v >= VOLUME_MIN && v <= VOLUME_MAX;

// Mantém só as últimas `max` entradas (ordem de inserção do objeto).
function capEntries(map, max = VOICE_VOLUMES_MAX) {
  const keys = Object.keys(map);
  if (keys.length <= max) return map;
  const out = {};
  for (const k of keys.slice(keys.length - max)) out[k] = map[k];
  return out;
}

// Limpa um mapa completo vindo de fora (ou do banco). Chaves/valores
// inválidos são descartados; 100% (padrão) não precisa ser guardado.
// Devolve undefined se nem for um objeto.
function sanitizeVoiceVolumes(v, max = VOICE_VOLUMES_MAX) {
  if (!isPlainObject(v)) return undefined;
  const out = {};
  for (const [k, vol] of Object.entries(v)) {
    if (!USER_ID_RE.test(k) || !isValidVolume(vol) || vol === DEFAULT_VOLUME) continue;
    out[k] = vol;
  }
  return capEntries(out, max);
}

// Patch parcial: { userId: volume | null }. null (ou 100) volta ao padrão e
// remove a entrada. Devolve undefined se o patch inteiro for inválido
// (não é objeto, vazio, ou grande demais pra um único envio).
function sanitizeVoiceVolumesPatch(v, max = VOICE_VOLUMES_MAX) {
  if (!isPlainObject(v)) return undefined;
  const entries = Object.entries(v);
  if (entries.length === 0 || entries.length > max) return undefined;
  const out = {};
  for (const [k, vol] of entries) {
    if (!USER_ID_RE.test(k)) continue;
    if (vol === null) out[k] = null;
    else if (isValidVolume(vol)) out[k] = vol;
  }
  return Object.keys(out).length ? out : undefined;
}

// Aplica o patch em cima do que já está salvo. Quem mudou agora vai pro
// FIM do objeto (mais recente), então o corte por tamanho tira sempre quem
// não é ajustado há mais tempo.
function mergeVoiceVolumes(current, patch, max = VOICE_VOLUMES_MAX) {
  const base = sanitizeVoiceVolumes(current, Infinity) || {};
  for (const [k, vol] of Object.entries(patch || {})) {
    delete base[k];
    if (vol !== null && vol !== DEFAULT_VOLUME && isValidVolume(vol) && USER_ID_RE.test(k)) base[k] = vol;
  }
  return capEntries(base, max);
}

function parseVoiceVolumes(raw) {
  if (!raw) return {};
  try { return sanitizeVoiceVolumes(JSON.parse(raw), Infinity) || {}; } catch { return {}; }
}

module.exports = {
  VOICE_VOLUMES_MAX, DEFAULT_VOLUME,
  sanitizeVoiceVolumes, sanitizeVoiceVolumesPatch, mergeVoiceVolumes, parseVoiceVolumes,
};
