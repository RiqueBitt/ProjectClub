// "Traduzir com o Pingu" (menu da mensagem): tradução só pra quem pediu.
// - Destino: português do Brasil; se a mensagem já está em português, vai
//   pro idioma escolhido pela pessoa no app (ou inglês).
// - Só mensagens de CANAL (DM nunca vai pra IA).
// - Cache por mensagem + idioma + conteúdo (edição muda a chave).
const crypto = require('crypto');
const { normalize, clip, createLimiter } = require('./text');

const db = () => require('../../config/prisma');
const bot = () => require('../pinguBot');

const MAX_INPUT = 800;
const CACHE_MAX = 500;
const limiter = createLimiter({ windowMs: 60 * 1000, max: 6 });

const LANGS = {
  'pt-BR': 'português do Brasil',
  en: 'inglês',
  es: 'espanhol',
  fr: 'francês',
  de: 'alemão',
  it: 'italiano',
  ja: 'japonês',
};

/** "pt", "pt-br", "en-US"… → chave de LANGS (ou null). */
function normalizeLang(lang) {
  const l = String(lang || '').trim().toLowerCase();
  if (!l) return null;
  if (l.startsWith('pt')) return 'pt-BR';
  const base = l.split(/[-_]/)[0];
  return LANGS[base] ? base : null;
}

// Palavras bem comuns do português (sem acento) pra adivinhar o idioma.
const PT_WORDS = new Set('que nao voce eu ele ela de do da em um uma para pra com por mais mas como esta isso tem ser muito tudo bem tambem aqui agora ja vou vai sim obrigado oi gente entao quando porque onde qual meu minha seu sua nos eles foi era tava ta'.split(' '));
const EN_WORDS = new Set('the and you is are what this that with for have not but they was will your just like can how about from yes thanks hello'.split(' '));

/** Chute barato: a mensagem parece português? */
function looksPortuguese(text) {
  const raw = String(text || '');
  if (/[ãõçâêô]/i.test(raw)) return true;
  const words = normalize(raw).split(' ').filter(Boolean);
  if (!words.length) return false;
  const pt = words.filter((w) => PT_WORDS.has(w)).length;
  const en = words.filter((w) => EN_WORDS.has(w)).length;
  return pt > en && pt / words.length >= 0.15;
}

/** Idioma de destino (ver regra no topo). */
function pickTarget(text, userLang) {
  if (!looksPortuguese(text)) return 'pt-BR';
  const mine = normalizeLang(userLang);
  return mine && mine !== 'pt-BR' ? mine : 'en';
}

// Cache LRU simples (Map mantém a ordem de inserção).
const cache = new Map();
const keyFor = (messageId, target, content) => `${messageId}:${target}:${crypto.createHash('sha1').update(String(content || '')).digest('hex').slice(0, 12)}`;
function cacheGet(key) {
  if (!cache.has(key)) return null;
  const v = cache.get(key);
  cache.delete(key);
  cache.set(key, v);
  return v;
}
function cacheSet(key, value) {
  cache.set(key, value);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

function cleanTranslation(text) {
  return clip(String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*(tradução|translation)\s*:\s*/i, '')
    .replace(/^["“](.*)["”]$/s, '$1')
    .replace(/@(everyone|here|todos|aqui)\b/gi, '@​$1')
    .trim(), 1200);
}

/** Carrega a mensagem e confere se pode traduzir. Lança Error com .status. */
async function loadMessage(messageId) {
  const m = await db().message.findUnique({ where: { id: String(messageId || '') }, select: { id: true, content: true, channelId: true, deleted: true } });
  if (!m || m.deleted) throw Object.assign(new Error('Mensagem não encontrada.'), { status: 404 });
  if (!m.channelId) throw Object.assign(new Error('A tradução só funciona em mensagens de canais.'), { status: 400 });
  if (!String(m.content || '').trim()) throw Object.assign(new Error('Essa mensagem não tem texto pra traduzir.'), { status: 400 });
  return m;
}

/** Tradução que já está no cache (ou null). */
function cached(message, target) {
  return cacheGet(keyFor(message.id, target, message.content));
}

/**
 * Traduz (pela fila da IA). Devolve { text, target } ou { error }.
 */
async function translate({ userId, message, target }) {
  const cfg = require('./config').getConfig();
  if (!cfg.translateEnabled) return { error: 'A tradução do Pingu está desligada pela equipe.' };
  const hit = cached(message, target);
  if (hit) return { text: hit, target, cached: true };
  if (!bot().isOnline()) return { error: bot().OFFLINE_TEXT };
  const lim = limiter.take(userId);
  if (!lim.ok) return { error: `Calma! Tenta traduzir de novo em ${Math.ceil(lim.retryInMs / 1000)} s.` };
  try {
    const input = clip(String(message.content).replace(/https?:\/\/\S+/g, '[link]'), MAX_INPUT);
    const res = await bot().askModel([
      { role: 'system', content: `Traduza o texto do usuário para ${LANGS[target] || 'português do Brasil'}. Responda só com a tradução, sem comentários.` },
      { role: 'user', content: input },
    ], { priority: bot().PRIORITY.USER, numPredict: Math.min(320, Math.ceil(input.length / 2.5) + 20), temperature: 0.1 });
    const text = cleanTranslation(res.text);
    if (!text) return { error: 'Não consegui traduzir essa mensagem. 🐧' };
    cacheSet(keyFor(message.id, target, message.content), text);
    return { text, target };
  } catch (err) {
    if (err?.code) limiter.refund(userId);
    return { error: err?.code ? err.message : 'Não deu pra traduzir agora. Tenta de novo daqui a pouco.' };
  }
}

module.exports = {
  translate, loadMessage, cached, pickTarget, looksPortuguese, normalizeLang, LANGS,
  _test: { keyFor, cacheGet, cacheSet, cleanTranslation, clear: () => cache.clear() },
};
