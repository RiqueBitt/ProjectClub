// Chaves do servidor de voz PRÓPRIO (media-server/) configuráveis pelo
// PAINEL DA STAFF ("Servidor de voz"), sem precisar mexer nas variáveis da
// hospedagem e reiniciar.
//
// - Ficam no Redis CRIPTOGRAFADAS (AES-256-GCM, chave derivada do segredo
//   do servidor) — nunca em texto puro, nunca devolvidas ao navegador
//   (o painel só vê "definido" + os 4 últimos caracteres dos segredos).
// - Valem por cima das variáveis de ambiente: o que a equipe salvar no
//   painel é aplicado em process.env, que é de onde o minter de token
//   (voiceTokens.js) já lê.
// - Campo apagado no painel volta pro valor original da hospedagem.
// - Chaves antigas de provedores removidos (LiveKit/Daily/TRTC/Jitsi) que
//   ainda estejam no Redis são ignoradas na leitura.
const crypto = require('crypto');
const { redis } = require('../config/redis');

const KEY = 'voice:credentials';

// Campos editáveis. secret=true → nunca volta pro navegador. (A chave
// "projectclub" é mantida por compatibilidade com o formato antigo.)
const FIELDS = {
  projectclub: [
    { env: 'MEDIA_SERVER_URL', label: 'URL do servidor de mídia (wss://…)' },
    { env: 'MEDIA_SERVER_SECRET', label: 'Segredo do servidor de mídia', secret: true },
    { env: 'TURN_URLS', label: 'Servidores TURN (opcional, separados por vírgula)' },
    { env: 'TURN_SECRET', label: 'Segredo do TURN (opcional)', secret: true },
  ],
};

const ALL_ENV = new Set(Object.values(FIELDS).flat().map((f) => f.env));
// Valores originais da hospedagem (pra restaurar quando o campo é apagado).
const ORIGINAL = {};
for (const name of ALL_ENV) ORIGINAL[name] = process.env[name];

function cipherKey() {
  const secret = process.env.VOICE_CREDENTIALS_SECRET || process.env.JWT_ACCESS_SECRET || 'projectclub-dev';
  return crypto.createHash('sha256').update(`voice-credentials:${secret}`).digest();
}
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cipherKey(), iv);
  const data = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${data.toString('base64')}`;
}
function decrypt(blob) {
  const [iv, tag, data] = String(blob).split('.');
  const d = crypto.createDecipheriv('aes-256-gcm', cipherKey(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

let saved = {}; // { ENV_NAME: valor } salvo pelo painel (em memória, já decifrado)

function apply() {
  for (const name of ALL_ENV) {
    const v = saved[name];
    if (v != null && String(v).trim() !== '') process.env[name] = String(v).trim();
    else if (ORIGINAL[name] != null) process.env[name] = ORIGINAL[name];
    else delete process.env[name];
  }
}

// Carrega do Redis e aplica (chamado na subida do servidor).
async function load() {
  try {
    const raw = await redis.hgetall(KEY);
    const out = {};
    for (const [name, blob] of Object.entries(raw || {})) {
      if (!ALL_ENV.has(name)) continue;
      try { out[name] = decrypt(blob); } catch { /* segredo do servidor mudou: ignora */ }
    }
    saved = out;
    apply();
    const n = Object.keys(out).length;
    if (n) console.log(`[voz] ${n} chave(s) do servidor de voz carregadas do painel da staff.`);
  } catch (err) {
    console.warn('[voz] não deu pra carregar as chaves do painel:', err?.message || err);
  }
}

function mask(v) {
  const s = String(v || '');
  if (!s) return '';
  return s.length <= 4 ? '••••' : `••••${s.slice(-4)}`;
}

// O que o painel mostra (sem nunca expor segredos).
function describe(provider = 'projectclub') {
  return (FIELDS[provider] || []).map((f) => {
    const current = process.env[f.env];
    const fromPanel = saved[f.env] != null && String(saved[f.env]).trim() !== '';
    return {
      env: f.env,
      label: f.label,
      secret: !!f.secret,
      set: !!String(current || '').trim(),
      source: fromPanel ? 'painel' : (String(ORIGINAL[f.env] || '').trim() ? 'hospedagem' : null),
      value: f.secret ? mask(current) : (current || ''),
    };
  });
}

// values: { ENV_NAME: 'novo valor' | '' (apaga = volta pro da hospedagem) }.
// Campos ausentes não mudam.
async function save(provider = 'projectclub', values = {}) {
  const fields = FIELDS[provider];
  if (!fields) { const e = new Error('Configuração inválida.'); e.status = 400; throw e; }
  const allowed = new Set(fields.map((f) => f.env));
  const next = { ...saved };
  for (const [name, raw] of Object.entries(values || {})) {
    if (!allowed.has(name)) continue;
    const v = String(raw ?? '').trim();
    if (v.length > 2000) { const e = new Error(`Valor grande demais em ${name}.`); e.status = 400; throw e; }
    if (v === '') delete next[name]; else next[name] = v;
  }
  const multi = redis.multi();
  for (const f of fields) {
    if (next[f.env] != null) multi.hset(KEY, f.env, encrypt(next[f.env]));
    else multi.hdel(KEY, f.env);
  }
  await multi.exec();
  saved = next;
  apply();
  return describe(provider);
}

module.exports = { FIELDS, load, save, describe, _encrypt: encrypt, _decrypt: decrypt };
