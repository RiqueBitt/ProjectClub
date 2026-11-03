// Boas-vindas automáticas: quando uma inscrição é aprovada (ou o dono da
// plataforma entra pela auto-aprovação), o Pingu posta uma mensagem amigável
// num canal escolhido no painel (padrão: o primeiro canal de texto público
// com nome tipo "boas-vindas"/"geral"), mencionando a pessoa e apontando a
// wiki e os canais em destaque.
//
// Funciona SEM IA (modelo de texto com {usuario}, {nome}, {canais}, {ia}).
// Com "personalizar com IA" ligado e a IA online, uma frase extra entra no
// lugar de {ia} (fila de fundo; se demorar ou falhar, vai só o modelo).
const { normalize, clip } = require('./text');

const db = () => require('../../config/prisma');
const bot = () => require('../pinguBot');

const AI_TIMEOUT_MS = 45_000;
const WELCOME_NAME_RE = /(boas?[\s-]*vindas|bem[\s-]*vindo|welcome|entrada|chegada)/;
const GENERAL_NAME_RE = /(geral|general|chat|conversa|bate[\s-]*papo|lobby)/;
const FEATURED_NAME_RE = /(regra|anuncio|aviso|apresenta|novidade|evento|ajuda|suporte|duvida)/;
const TEXT_TYPES = new Set(['TEXT', null, undefined, '']);

/** Troca {chave} pelos valores; linhas que ficaram vazias por causa disso somem. */
function renderTemplate(template, vars) {
  const fill = (line) => line.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : ''));
  return String(template || '').replace(/\r/g, '').split('\n')
    .map((line) => ({ had: /\{\w+\}/.test(line), out: fill(line).trimEnd() }))
    .filter((l) => !(l.had && !l.out.trim()))
    .map((l) => l.out)
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const isPublicText = (c) => c && TEXT_TYPES.has(c.type) && !c.isPrivate && !c.ticket && !c.tempOwnerId;

/**
 * Canal das boas-vindas: o configurado (se ainda existir e for de texto);
 * senão o primeiro "boas-vindas", depois o primeiro "geral", depois o
 * primeiro canal de texto público. `channels` já em ordem (position).
 */
function pickWelcomeChannel(channels, configuredId) {
  const list = (channels || []).filter(isPublicText);
  if (configuredId) {
    const c = (channels || []).find((x) => x.id === configuredId && TEXT_TYPES.has(x.type));
    if (c) return c;
  }
  return list.find((c) => WELCOME_NAME_RE.test(normalize(c.name)))
    || list.find((c) => GENERAL_NAME_RE.test(normalize(c.name)))
    || list[0] || null;
}

/** Até 3 canais em destaque (regras, anúncios, apresentações…), fora o das boas-vindas. */
function pickFeaturedChannels(channels, welcomeId, max = 3) {
  const list = (channels || []).filter((c) => isPublicText(c) && c.id !== welcomeId);
  const featured = list.filter((c) => FEATURED_NAME_RE.test(normalize(c.name)));
  const rest = list.filter((c) => !featured.includes(c));
  return [...featured, ...rest].slice(0, max);
}

async function loadChannels() {
  const rows = await db().channel.findMany({
    orderBy: [{ position: 'asc' }],
    select: { id: true, name: true, type: true, isPrivate: true, position: true, categoryId: true, tempOwnerId: true, category: { select: { position: true } } },
  }).catch(() => db().channel.findMany({ orderBy: [{ position: 'asc' }], select: { id: true, name: true, type: true, isPrivate: true, position: true } }));
  // Ordem igual à da barra lateral: categoria, depois posição no canal.
  return rows.sort((a, b) => ((a.category?.position ?? -1) - (b.category?.position ?? -1)) || (a.position - b.position));
}

async function aiLine(displayName) {
  const p = bot().askModel([
    { role: 'system', content: 'Você é o Pingu, mascote pinguim do Project Club (comunidade brasileira). Escreva UMA frase curta, calorosa e divertida de boas-vindas, em português do Brasil, sem emojis demais, sem pedir dados pessoais.' },
    { role: 'user', content: `A pessoa nova se chama ${clip(displayName, 32)}.` },
  ], { priority: bot().PRIORITY.BACKGROUND, numPredict: 50, temperature: 0.8, timeoutMs: AI_TIMEOUT_MS });
  const timeout = new Promise((resolve) => { const t = setTimeout(() => resolve(null), AI_TIMEOUT_MS); t.unref?.(); });
  const res = await Promise.race([p.catch(() => null), timeout]);
  if (!res?.text) return null;
  const line = bot().cleanAnswer(res.text).split('\n')[0];
  return line ? clip(line, 200) : null;
}

/**
 * Dá as boas-vindas a uma conta nova. Nunca lança (quem chama não pode
 * falhar por isso). user: { id, username, displayName }.
 */
async function welcomeUser(io, user) {
  try {
    const cfg = require('./config').getConfig();
    if (!cfg.welcomeEnabled || !user?.id) return null;
    const channels = await loadChannels();
    const channel = pickWelcomeChannel(channels, cfg.welcomeChannelId);
    if (!channel) return null;
    const featured = pickFeaturedChannels(channels, channel.id);
    const name = user.displayName || user.username || 'pessoa nova';
    const ia = cfg.welcomeAi && bot().isOnline() ? await aiLine(name) : null;
    const { DEFAULT_WELCOME } = require('./config');
    const content = renderTemplate(cfg.welcomeTemplate || DEFAULT_WELCOME, {
      usuario: user.username ? `@${user.username}` : name,
      nome: name,
      canais: featured.length ? featured.map((c) => `<#${c.id}>`).join(', ') : 'dá uma volta pela barra lateral',
      ia,
    });
    if (!content) return null;
    return await bot().postAsPingu(channel.id, clip(content, 1500), { mentions: [{ targetType: 'USER', targetId: user.id }] });
  } catch (err) {
    console.warn('[pingu] boas-vindas:', err?.message || err);
    return null;
  }
}

module.exports = { welcomeUser, renderTemplate, pickWelcomeChannel, pickFeaturedChannels };
