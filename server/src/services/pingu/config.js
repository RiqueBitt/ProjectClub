// Configurações das funções do Pingu (Painel da Equipe → Pingu): boas-vindas,
// moderação assistida, quiz, resumo, tradução e imagens. Uma linha só (PinguConfig
// "singleton"), com cache em memória — as funções leem daqui a cada
// mensagem, então ler precisa ser instantâneo (getConfig é síncrono).
const db = () => require('../../config/prisma');

const DEFAULT_WELCOME = [
  'Seja bem-vindo(a) ao Project Club, {usuario}! 🐧',
  '{ia}',
  'Pra começar: dá uma olhada nas regras em /wiki/regras e em como ganhar moedas em /wiki/economia.',
  'Canais em destaque: {canais}.',
  'Qualquer dúvida, é só me chamar com @pingu!',
].join('\n');

const DEFAULTS = {
  welcomeEnabled: true,
  welcomeChannelId: null,
  welcomeTemplate: null, // null = DEFAULT_WELCOME
  welcomeAi: false,
  modAssistEnabled: true,
  modAssistAi: true,
  modExtraWords: null,
  summaryEnabled: true,
  translateEnabled: true,
  quizDailyEnabled: false,
  quizChannelId: null,
  quizHour: 20,
  quizWindowSec: 60,
  quizCoins: 20,
  quizXp: 30,
  // Pingu Turbo: imagens.
  imageEnabled: true,
  imageDailyLimit: 10,
  imageCooldownSec: 30,
  imageConcurrency: 1,
};

let current = { ...DEFAULTS };

const getConfig = () => current;

async function loadConfig() {
  const row = await db().pinguConfig.findUnique({ where: { id: 'singleton' } }).catch(() => null);
  current = { ...DEFAULTS, ...(row ? pick(row) : {}) };
  return current;
}

function pick(row) {
  const out = {};
  for (const k of Object.keys(DEFAULTS)) if (row[k] !== undefined) out[k] = row[k];
  return out;
}

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

/** Valida o que veio do painel. Só os campos enviados mudam. */
function sanitize(body = {}) {
  const data = {};
  for (const k of ['welcomeEnabled', 'welcomeAi', 'modAssistEnabled', 'modAssistAi', 'summaryEnabled', 'translateEnabled', 'quizDailyEnabled', 'imageEnabled']) {
    if (body[k] !== undefined) data[k] = !!body[k];
  }
  for (const k of ['welcomeChannelId', 'quizChannelId']) {
    if (body[k] !== undefined) data[k] = body[k] ? String(body[k]).slice(0, 64) : null;
  }
  if (body.welcomeTemplate !== undefined) {
    const t = String(body.welcomeTemplate || '').replace(/\r/g, '').trim();
    if (t.length > 1000) throw bad('A mensagem de boas-vindas pode ter até 1000 caracteres.');
    data.welcomeTemplate = t || null;
  }
  if (body.modExtraWords !== undefined) {
    const t = String(body.modExtraWords || '').replace(/\r/g, '').trim();
    if (t.length > 2000) throw bad('A lista de palavras pode ter até 2000 caracteres.');
    data.modExtraWords = t || null;
  }
  const int = (k, min, max, label) => {
    if (body[k] === undefined) return;
    const n = Number(body[k]);
    if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label} precisa ser um número de ${min} a ${max}.`);
    data[k] = n;
  };
  int('quizHour', 0, 23, 'A hora do quiz');
  int('quizWindowSec', 15, 600, 'O tempo para responder');
  int('quizCoins', 0, 1000, 'As moedas do quiz');
  int('quizXp', 0, 2000, 'O XP do quiz');
  int('imageDailyLimit', 0, 200, 'O limite de imagens por dia');
  int('imageCooldownSec', 0, 3600, 'O intervalo entre imagens');
  int('imageConcurrency', 1, 2, 'Imagens ao mesmo tempo');
  return data;
}

async function updateConfig(body) {
  const data = sanitize(body);
  if (data.quizDailyEnabled && !(data.quizChannelId ?? current.quizChannelId)) throw bad('Escolha o canal do quiz diário.');
  await db().pinguConfig.upsert({ where: { id: 'singleton' }, update: data, create: { id: 'singleton', ...data } });
  return loadConfig();
}

/** Palavras extras de moderação (uma por linha ou separadas por vírgula). */
function extraWords(cfg = current) {
  return String(cfg.modExtraWords || '').split(/[\n,;]+/).map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 2).slice(0, 200);
}

module.exports = {
  getConfig, loadConfig, updateConfig, sanitize, extraWords, DEFAULTS, DEFAULT_WELCOME,
  _test: { set: (v) => { current = { ...DEFAULTS, ...v }; } },
};
