// Geração de imagens do Pingu ("@pingu desenhe …").
//
// A VPS da IA (2 vCPU, 4 GB) não aguenta um modelo de imagem, então a
// imagem vem de um PROVEDOR plugável (PINGU_IMAGE_PROVIDER):
//   pollinations (padrão) — https://image.pollinations.ai, grátis, sem chave;
//   local                — um stable-diffusion.cpp próprio no futuro
//                          (PINGU_IMAGE_URL + PINGU_IMAGE_KEY, POST JSON →
//                          bytes da imagem);
//   off                  — desligado.
// A equipe ainda pode desligar no Painel → Pingu (imageEnabled).
//
// Fluxo: filtro de segurança → limites (30 s entre pedidos, N por dia;
// apoiadores têm mais) → mensagem "🎨 Criando sua imagem…" (com a posição
// na fila) → prompt melhorado (tradução PT→EN local, IA só se precisar) →
// provedor com tempo limite → confere a imagem (bytes mágicos, ≤ 4 MB) →
// guarda no armazenamento do site (B2) → a mensagem vira a imagem com a
// descrição. Tudo fica registrado (PinguImage) pro painel da equipe.
const crypto = require('crypto');
const { checkImagePrompt } = require('./safety');
const { normalize, clip } = require('./text');

const MAX_BYTES = 4 * 1024 * 1024;
const PROVIDER_TIMEOUT_MS = 60_000;
const QUEUE_MAX = 8;
const REROLL_TTL_MS = 30 * 60 * 1000;
const SIZES = {
  quadrada: { width: 768, height: 768 },
  paisagem: { width: 1024, height: 576 },
  retrato: { width: 576, height: 1024 },
};
const TIER_MULT = { NONE: 1, SUBSCRIBER: 2, SUPER: 3 };
const NEGATIVE = 'nsfw, nude, gore, blood, text, watermark, signature, low quality, blurry, deformed, extra limbs';
const QUALITY_TAGS = 'high quality, detailed, vibrant colors';

// ---------------- puro: provedor, validação, prompt ----------------

/** Provedor escolhido pelo ambiente ('pollinations' | 'local' | 'off'). */
function providerName(env = process.env) {
  const p = String(env.PINGU_IMAGE_PROVIDER || 'pollinations').trim().toLowerCase();
  if (p === 'off' || p === 'none' || p === 'desligado') return 'off';
  if (p === 'local') return env.PINGU_IMAGE_URL ? 'local' : 'off';
  return 'pollinations';
}

/** Tipo da imagem pelos bytes mágicos (nunca confia no Content-Type). */
function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return { mime: 'image/png', ext: '.png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: '.webp' };
  if (/^GIF8[79]a$/.test(buf.toString('ascii', 0, 6))) return { mime: 'image/gif', ext: '.gif' };
  return null;
}

/** Confere tamanho e tipo. Devolve { mime, ext } ou lança Error com .code. */
function validateImage(buf, { maxBytes = MAX_BYTES } = {}) {
  if (!buf?.length) throw Object.assign(new Error('O provedor não devolveu nenhuma imagem.'), { code: 'EMPTY' });
  if (buf.length > maxBytes) throw Object.assign(new Error('A imagem veio grande demais.'), { code: 'TOO_BIG' });
  const kind = sniffImage(buf);
  if (!kind) throw Object.assign(new Error('O provedor devolveu algo que não é imagem.'), { code: 'NOT_IMAGE' });
  return kind;
}

/** Lê o corpo da resposta até `max` bytes (passou disso = erro, sem baixar o resto). */
async function readCapped(res, max = MAX_BYTES) {
  const len = Number(res.headers?.get?.('content-length') || 0);
  if (len && len > max) throw Object.assign(new Error('A imagem veio grande demais.'), { code: 'TOO_BIG' });
  if (res.body && typeof res.body[Symbol.asyncIterator] === 'function') {
    const parts = [];
    let total = 0;
    for await (const chunk of res.body) {
      const b = Buffer.from(chunk);
      total += b.length;
      if (total > max) throw Object.assign(new Error('A imagem veio grande demais.'), { code: 'TOO_BIG' });
      parts.push(b);
    }
    return Buffer.concat(parts);
  }
  const b = Buffer.from(await res.arrayBuffer());
  if (b.length > max) throw Object.assign(new Error('A imagem veio grande demais.'), { code: 'TOO_BIG' });
  return b;
}

/** Junta um sinal de cancelamento com um tempo limite. */
function withTimeout(signal, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(Object.assign(new Error('tempo esgotado'), { code: 'TIMEOUT' })), ms);
  t.unref?.();
  const onAbort = () => ctrl.abort(signal.reason || new Error('cancelado'));
  if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  return { signal: ctrl.signal, done: () => { clearTimeout(t); signal?.removeEventListener?.('abort', onAbort); } };
}

/** URL do Pollinations pra um pedido. */
function pollinationsUrl({ prompt, width, height, seed }, env = process.env) {
  const base = String(env.PINGU_POLLINATIONS_URL || 'https://image.pollinations.ai/prompt/').replace(/\/?$/, '/');
  const params = new URLSearchParams({
    width: String(width), height: String(height), seed: String(seed),
    model: String(env.PINGU_IMAGE_MODEL || 'flux'), nologo: 'true', safe: 'true', private: 'true',
  });
  if (env.PINGU_POLLINATIONS_REFERRER) params.set('referrer', String(env.PINGU_POLLINATIONS_REFERRER));
  return `${base}${encodeURIComponent(prompt)}?${params.toString()}`;
}

/**
 * Busca a imagem no provedor. Devolve { buffer, mime, ext }.
 * opts: { provider, fetchImpl, env, signal, timeoutMs }
 */
async function fetchImage(req, { provider, fetchImpl = fetch, env = process.env, signal, timeoutMs = PROVIDER_TIMEOUT_MS } = {}) {
  const t = withTimeout(signal, timeoutMs);
  try {
    let res;
    if (provider === 'local') {
      const key = String(env.PINGU_IMAGE_KEY || '').trim();
      res = await fetchImpl(String(env.PINGU_IMAGE_URL).trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'image/*', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ prompt: req.prompt, negative_prompt: NEGATIVE, width: req.width, height: req.height, steps: Number(env.PINGU_IMAGE_STEPS || 20), seed: req.seed }),
        signal: t.signal,
      });
    } else if (provider === 'pollinations') {
      const token = String(env.PINGU_POLLINATIONS_TOKEN || '').trim();
      res = await fetchImpl(pollinationsUrl(req, env), { headers: { Accept: 'image/*', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: t.signal });
    } else throw Object.assign(new Error('Geração de imagens desligada.'), { code: 'OFF' });
    if (!res.ok) throw Object.assign(new Error(`O provedor respondeu HTTP ${res.status}.`), { code: 'HTTP', status: res.status });
    const type = String(res.headers?.get?.('content-type') || '').toLowerCase();
    let buffer;
    if (provider === 'local' && type.includes('json')) {
      // stable-diffusion.cpp/servidores tipo A1111 podem devolver base64 em JSON.
      const j = await res.json();
      const b64 = j?.image || j?.images?.[0] || j?.data?.[0]?.b64_json;
      buffer = b64 ? Buffer.from(String(b64).replace(/^data:[^,]+,/, ''), 'base64') : null;
      if (buffer && buffer.length > MAX_BYTES) throw Object.assign(new Error('A imagem veio grande demais.'), { code: 'TOO_BIG' });
    } else {
      if (type && !type.startsWith('image/')) throw Object.assign(new Error('O provedor devolveu algo que não é imagem.'), { code: 'NOT_IMAGE' });
      buffer = await readCapped(res, MAX_BYTES);
    }
    const kind = validateImage(buffer);
    return { buffer, ...kind };
  } catch (err) {
    if (t.signal.aborted && t.signal.reason?.code === 'TIMEOUT') throw Object.assign(new Error('O provedor demorou demais.'), { code: 'TIMEOUT' });
    throw err;
  } finally { t.done(); }
}

// Dicionário curtinho PT→EN pros pedidos mais comuns (o Flux entende inglês
// muito melhor). Palavra desconhecida fica como está.
const DICT = {
  um: 'a', uma: 'a', o: 'the', a: 'the', os: 'the', as: 'the', de: 'of', do: 'of the', da: 'of the', dos: 'of the', das: 'of the',
  com: 'with', sem: 'without', no: 'in the', na: 'in the', nos: 'in the', nas: 'in the', em: 'in', e: 'and', ao: 'at the', sobre: 'on', entre: 'between',
  pinguim: 'penguin', pinguins: 'penguins', gato: 'cat', gatos: 'cats', gatinho: 'kitten', cachorro: 'dog', cachorros: 'dogs', cachorrinho: 'puppy',
  dragao: 'dragon', dragoes: 'dragons', robo: 'robot', robos: 'robots', astronauta: 'astronaut', espaco: 'space', planeta: 'planet', lua: 'moon',
  sol: 'sun', estrela: 'star', estrelas: 'stars', ceu: 'sky', mar: 'sea', oceano: 'ocean', praia: 'beach', floresta: 'forest', montanha: 'mountain',
  montanhas: 'mountains', cidade: 'city', castelo: 'castle', casa: 'house', rio: 'river', lago: 'lake', neve: 'snow', chuva: 'rain', noite: 'night',
  dia: 'day', por: 'at', tarde: 'afternoon', manha: 'morning', fogo: 'fire', agua: 'water', arvore: 'tree', arvores: 'trees', flor: 'flower',
  flores: 'flowers', jardim: 'garden', carro: 'car', nave: 'spaceship', navio: 'ship', aviao: 'airplane', trem: 'train', cavaleiro: 'knight',
  princesa: 'princess', rei: 'king', rainha: 'queen', mago: 'wizard', bruxa: 'witch', guerreiro: 'warrior', ninja: 'ninja', pirata: 'pirate',
  monstro: 'monster', fantasma: 'ghost', zumbi: 'zombie', unicornio: 'unicorn', leao: 'lion', tigre: 'tiger', urso: 'bear', lobo: 'wolf', raposa: 'fox',
  coelho: 'rabbit', passaro: 'bird', coruja: 'owl', peixe: 'fish', tubarao: 'shark', baleia: 'whale', cavalo: 'horse', vaca: 'cow', porco: 'pig',
  bonito: 'beautiful', bonita: 'beautiful', fofo: 'cute', fofa: 'cute', fofinho: 'cute', grande: 'big', gigante: 'giant', pequeno: 'small', pequena: 'small',
  azul: 'blue', vermelho: 'red', vermelha: 'red', verde: 'green', amarelo: 'yellow', amarela: 'yellow', roxo: 'purple', roxa: 'purple', rosa: 'pink',
  preto: 'black', preta: 'black', branco: 'white', branca: 'white', laranja: 'orange', dourado: 'golden', dourada: 'golden', prateado: 'silver',
  colorido: 'colorful', colorida: 'colorful', escuro: 'dark', escura: 'dark', brilhante: 'shiny', magico: 'magical', magica: 'magical',
  futurista: 'futuristic', medieval: 'medieval', antigo: 'ancient', antiga: 'ancient', moderno: 'modern', moderna: 'modern', voando: 'flying',
  correndo: 'running', dormindo: 'sleeping', comendo: 'eating', jogando: 'playing', segurando: 'holding', usando: 'wearing', chapeu: 'hat',
  oculos: 'glasses', capacete: 'helmet', espada: 'sword', escudo: 'shield', coroa: 'crown', livro: 'book', computador: 'computer', jogo: 'game',
  videogame: 'video game', estilo: 'style', pixel: 'pixel', anime: 'anime', desenho: 'drawing', aquarela: 'watercolor', pintura: 'painting',
  realista: 'realistic', fotorrealista: 'photorealistic', cartoon: 'cartoon', fundo: 'background', paisagem: 'landscape',
  retrato: 'portrait', minecraft: 'minecraft', sorvete: 'ice cream', pizza: 'pizza', bolo: 'cake', comida: 'food', cafe: 'coffee', festa: 'party',
  natal: 'christmas', inverno: 'winter', verao: 'summer', outono: 'autumn', primavera: 'spring',
};
const PHRASES = [
  [/\bpor do sol\b/g, 'sunset'], [/\bnascer do sol\b/g, 'sunrise'], [/\barco[\s-]iris\b/g, 'rainbow'], [/\bdesenho animado\b/g, 'cartoon'],
  [/\bpixel art\b/g, 'pixel art'], [/\bfundo branco\b/g, 'white background'], [/\bestilo anime\b/g, 'anime style'], [/\bem cima de\b/g, 'on top of'],
  [/\bao lado de\b/g, 'next to'], [/\bdentro de\b/g, 'inside'], [/\bna frente de\b/g, 'in front of'],
];

/**
 * Tradução local PT→EN + etiquetas de qualidade. Devolve
 * { prompt, unknownRatio } (unknownRatio = parte das palavras que ficou
 * sem tradução; alta = vale pedir pra IA).
 */
function localEnhance(prompt) {
  let t = normalize(prompt);
  for (const [re, en] of PHRASES) t = t.replace(re, en);
  const words = t.split(' ').filter(Boolean);
  let unknown = 0;
  let content = 0;
  const out = words.map((w) => {
    if (DICT[w] !== undefined) { if (w.length > 3) content += 1; return DICT[w]; }
    if (/^[a-z]+$/.test(w) && w.length > 3 && !/(ing|tion|ed|ly)$/.test(w)) { unknown += 1; content += 1; }
    return w;
  });
  const en = out.join(' ').replace(/\b(a|the) (a|the)\b/g, '$2').replace(/\s+/g, ' ').trim();
  return { prompt: clip(`${en}, ${QUALITY_TAGS}`, 400), unknownRatio: content ? unknown / content : 0 };
}

// ---------------- motor (com dependências injetadas) ----------------

/**
 * deps: {
 *   getConfig() → { imageEnabled, imageDailyLimit, imageCooldownSec, imageConcurrency },
 *   provider() → 'pollinations'|'local'|'off',
 *   fetchImage(req, { provider, signal }) → { buffer, mime, ext },
 *   enhance(prompt, { signal }) → string (prompt em inglês),
 *   tierOf(userId) → 'NONE'|'SUBSCRIBER'|'SUPER', countToday(userId) → número,
 *   store({ buffer, mime, ext, name }) → { url, storageKey },
 *   createLog(data) → { id }, updateLog(id, data),
 *   ui: { placeholder(target, text) → msg, update(msg, text), finish(msg, { url, mime, size, filename, caption }), fail(msg, text), reply(target, text), remove(msg) },
 *   now(), rng()
 * }
 */
function createImageService(deps) {
  const lastAt = new Map(); // userId → hora do último pedido aceito
  const lastReq = new Map(); // userId → { prompt, size, at }
  const pending = []; // jobs esperando
  const running = new Set();
  const bySource = new Map(); // id da mensagem que pediu → job
  const stats = { ok: 0, failed: 0, lastError: null, lastOkAt: null, lastMs: null };

  const concurrency = () => Math.min(2, Math.max(1, Number(deps.getConfig().imageConcurrency) || 1));

  function dailyLimitFor(tier) {
    const base = Math.max(0, Number(deps.getConfig().imageDailyLimit ?? 10));
    return base * (TIER_MULT[tier] || 1);
  }

  async function refreshPositions() {
    await Promise.all(pending.map((job, i) => (job.msg ? deps.ui.update(job.msg, `🎨 Sua imagem está na fila (posição ${i + 1})…`).catch(() => {}) : null)));
  }

  function pump() {
    while (running.size < concurrency() && pending.length) {
      const job = pending.shift();
      running.add(job);
      run(job).catch(() => {}).finally(() => {
        running.delete(job);
        bySource.delete(job.sourceMessageId);
        pump();
        refreshPositions().catch(() => {});
      });
    }
  }

  async function run(job) {
    const started = deps.now();
    try {
      if (job.cancelled) return;
      if (job.msg) await deps.ui.update(job.msg, '🎨 Criando sua imagem…').catch(() => {});
      let finalPrompt = await deps.enhance(job.prompt, { signal: job.ctrl.signal }).catch(() => localEnhance(job.prompt).prompt);
      // A tradução também passa pelo filtro (a IA podia "melhorar" demais).
      if (!checkImagePrompt(finalPrompt).ok) finalPrompt = localEnhance(job.prompt).prompt;
      if (job.cancelled) return;
      const dims = SIZES[job.size] || SIZES.quadrada;
      const img = await deps.fetchImage({ prompt: finalPrompt, width: dims.width, height: dims.height, seed: job.seed }, { provider: job.provider, signal: job.ctrl.signal });
      if (job.cancelled) return;
      const name = `pingu-${job.logId || crypto.randomUUID()}${img.ext}`;
      const stored = await deps.store({ buffer: img.buffer, mime: img.mime, ext: img.ext, name });
      if (job.cancelled) return;
      const caption = `🎨 "${clip(job.prompt, 300)}"`;
      await deps.ui.finish(job.msg, { url: stored.url, mime: img.mime, size: img.buffer.length, filename: name, caption });
      stats.ok += 1;
      stats.lastOkAt = new Date(deps.now()).toISOString();
      stats.lastMs = deps.now() - started;
      if (job.logId) {
        await deps.updateLog(job.logId, {
          status: 'DONE', url: stored.url, storageKey: stored.storageKey || null, finalPrompt: clip(finalPrompt, 1000),
          messageId: job.msg?.id || null, finishedAt: new Date(deps.now()),
        }).catch(() => {});
      }
    } catch (err) {
      if (job.cancelled) return;
      stats.failed += 1;
      stats.lastError = `${err?.code || 'ERRO'}: ${err?.message || err}`;
      const text = err?.code === 'TIMEOUT'
        ? '😕 O serviço de imagens demorou demais. Tenta de novo daqui a pouco!'
        : '😕 Não consegui criar essa imagem agora. Tenta de novo daqui a pouco!';
      if (job.msg) await deps.ui.fail(job.msg, text).catch(() => {});
      if (job.logId) await deps.updateLog(job.logId, { status: 'FAILED', error: clip(String(err?.message || err), 300), messageId: job.msg?.id || null, finishedAt: new Date(deps.now()) }).catch(() => {});
    }
  }

  /**
   * Pedido de imagem. req: { userId, target, prompt, size, sourceMessageId, reroll }
   * target: onde postar (o pinguBot sabe). Devolve { status, text? }.
   */
  async function request(req) {
    const cfg = deps.getConfig();
    const provider = deps.provider();
    const reply = async (text, status) => { await deps.ui.reply(req.target, text).catch(() => {}); return { status, text }; };
    if (!cfg.imageEnabled || provider === 'off') return reply('🎨 A criação de imagens do Pingu está desligada agora. 🐧', 'off');

    let { prompt, size } = req;
    if (req.reroll) {
      const last = lastReq.get(req.userId);
      const fromReply = req.rerollFrom || null;
      const base = fromReply || (last && deps.now() - last.at < REROLL_TTL_MS ? last : null);
      if (!base) return reply('Não achei uma imagem sua recente pra refazer. Me diz o que desenhar! Ex.: "@pingu desenhe um pinguim pirata". 🐧', 'noprev');
      prompt = base.prompt;
      size = size || base.size;
    }
    prompt = clip(String(prompt || '').replace(/\s+/g, ' ').trim(), 500);
    const safe = checkImagePrompt(prompt);
    if (!safe.ok) {
      if (safe.category !== 'empty') {
        await deps.createLog({ userId: req.userId, channelId: req.target?.channelId || null, sourceMessageId: req.sourceMessageId || null, prompt, provider, status: 'BLOCKED', error: `${safe.category}: ${safe.term}`.slice(0, 300) }).catch(() => null);
      }
      return reply(safe.message, 'blocked');
    }

    const t = deps.now();
    const cooldownMs = Math.max(0, Number(cfg.imageCooldownSec ?? 30)) * 1000;
    const since = t - (lastAt.get(req.userId) || 0);
    if (since < cooldownMs) return reply(`⏳ Calma! Você pode pedir outra imagem em ${Math.ceil((cooldownMs - since) / 1000)} s.`, 'cooldown');
    const tier = await deps.tierOf(req.userId).catch(() => 'NONE');
    const limit = dailyLimitFor(tier);
    const used = await deps.countToday(req.userId).catch(() => 0);
    if (used >= limit) {
      return reply(`🎨 Você já criou ${used} imagens hoje (limite de ${limit}${tier !== 'NONE' ? ', com o bônus de apoiador' : ''}). Amanhã tem mais! 🐧`, 'daily');
    }
    if (pending.length >= QUEUE_MAX) return reply('🎨 Tem muita imagem na fila agora. Tenta de novo em um minutinho! 🐧', 'busy');

    lastAt.set(req.userId, t);
    lastReq.set(req.userId, { prompt, size, at: t });
    if (lastReq.size > 5000) lastReq.delete(lastReq.keys().next().value);

    const seed = Math.floor(deps.rng() * 2_147_483_647);
    const position = pending.length + (running.size >= concurrency() ? 1 : 0);
    const msg = await deps.ui.placeholder(req.target, position > 0 ? `🎨 Sua imagem está na fila (posição ${position})…` : '🎨 Criando sua imagem…');
    const log = await deps.createLog({
      userId: req.userId, channelId: req.target?.channelId || null, sourceMessageId: req.sourceMessageId || null, messageId: msg?.id || null,
      prompt, provider, seed, width: (SIZES[size] || SIZES.quadrada).width, height: (SIZES[size] || SIZES.quadrada).height, status: 'PENDING',
    }).catch(() => null);
    const job = {
      userId: req.userId, prompt, size: size || 'quadrada', seed, provider, msg, logId: log?.id || null,
      sourceMessageId: req.sourceMessageId || null, ctrl: new AbortController(), cancelled: false,
    };
    if (job.sourceMessageId) bySource.set(job.sourceMessageId, job);
    pending.push(job);
    pump();
    return { status: 'queued', position, logId: job.logId };
  }

  /** A mensagem que pediu foi apagada: cancela (na fila ou rodando). */
  async function cancelBySource(sourceMessageId) {
    const job = bySource.get(sourceMessageId);
    if (!job) return false;
    job.cancelled = true;
    job.ctrl.abort(new Error('cancelado'));
    bySource.delete(sourceMessageId);
    const i = pending.indexOf(job);
    if (i >= 0) pending.splice(i, 1);
    if (job.msg) await deps.ui.remove(job.msg).catch(() => {});
    if (job.logId) await deps.updateLog(job.logId, { status: 'CANCELLED', finishedAt: new Date(deps.now()) }).catch(() => {});
    refreshPositions().catch(() => {});
    return true;
  }

  /** Pediu imagem há pouco (dá pra usar "de novo")? */
  const hasRecent = (userId) => {
    const last = lastReq.get(userId);
    return !!last && deps.now() - last.at < REROLL_TTL_MS;
  };

  return {
    request,
    cancelBySource,
    hasRecent,
    status: () => ({
      provider: deps.provider(), enabled: !!deps.getConfig().imageEnabled, running: running.size, pending: pending.length,
      concurrency: concurrency(), ...stats,
    }),
    dailyLimitFor,
    _state: { pending, running, lastAt, lastReq },
  };
}

module.exports = {
  createImageService, providerName, sniffImage, validateImage, readCapped, fetchImage, pollinationsUrl, localEnhance,
  SIZES, MAX_BYTES, TIER_MULT, NEGATIVE, QUALITY_TAGS,
};
