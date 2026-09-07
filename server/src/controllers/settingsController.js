const prisma = require('../config/prisma');
const { logSecurityEvent } = require('../services/securityLog');

// Item pedido: "Nunca aceitar userId do frontend pra decidir qual
// usuário será alterado. O backend deve obter o usuário diretamente
// da sessão/token autenticado." — req.user.id (do middleware de auth,
// nunca do corpo da requisição) é a única fonte usada em toda rota
// aqui.
//
// Cada campo tem seu próprio validador — nunca aceita um valor cru
// vindo do frontend sem conferir se ele é um dos valores realmente
// permitidos (ou, pra número, se está dentro da faixa aceitável).
// Um valor rejeitado é simplesmente ignorado (fica com o que já
// estava salvo) — nunca quebra o PATCH inteiro por causa de UM campo
// ruim, mas também nunca salva algo inválido.
const FIELD_VALIDATORS = {
  language: (v) => ['pt-BR', 'en-US', 'es-ES'].includes(v),
  timezone: (v) => v === null || (typeof v === 'string' && v.length < 64),
  timeFormat: (v) => ['12h', '24h', 'auto'].includes(v),

  messageDensity: (v) => ['compact', 'standard', 'comfortable'].includes(v),
  messageDisplay: (v) => ['cozy', 'compact'].includes(v),
  showTimestamps: (v) => typeof v === 'boolean',
  showAvatars: (v) => typeof v === 'boolean',
  groupMessages: (v) => typeof v === 'boolean',
  showLinkPreviews: (v) => typeof v === 'boolean',
  autoPlayMedia: (v) => typeof v === 'boolean',

  enterSends: (v) => typeof v === 'boolean',

  profilePrivacy: (v) => ['everyone', 'friends_groups', 'friends'].includes(v),
  dmPrivacy: (v) => ['everyone', 'friends', 'friends_groups', 'none'].includes(v),
  friendRequestPrivacy: (v) => ['everyone', 'friends_of_friends', 'none'].includes(v),
  contentFilterLevel: (v) => ['off', 'moderate', 'high'].includes(v),
  spamFilterEnabled: (v) => typeof v === 'boolean',

  desktopNotifications: (v) => typeof v === 'boolean',
  emailNotifications: (v) => typeof v === 'boolean',
  notificationSounds: (v) => typeof v === 'boolean',

  reducedMotion: (v) => typeof v === 'boolean',
  highContrast: (v) => typeof v === 'boolean',
  textScale: (v) => typeof v === 'number' && v >= 0.8 && v <= 1.5,
  saturation: (v) => [0, 50, 75, 100].includes(v),

  inputDeviceId: (v) => v === null || typeof v === 'string',
  outputDeviceId: (v) => v === null || typeof v === 'string',
  inputMode: (v) => ['voice_activity', 'push_to_talk'].includes(v),
  pushToTalkKey: (v) => v === null || (typeof v === 'string' && v.length < 32),
  inputVolume: (v) => Number.isInteger(v) && v >= 0 && v <= 100,
  outputVolume: (v) => Number.isInteger(v) && v >= 0 && v <= 100,
  noiseSuppression: (v) => typeof v === 'boolean',
  echoCancellation: (v) => typeof v === 'boolean',
  automaticGain: (v) => typeof v === 'boolean',
  streamQuality: (v) => ['720p', '1080p'].includes(v),
  streamFPS: (v) => [30, 60].includes(v),
  streamAudioEnabled: (v) => typeof v === 'boolean',

  activitySharing: (v) => typeof v === 'boolean',
  activityVisibility: (v) => ['everyone', 'friends', 'friends_groups', 'none'].includes(v),
  gameJoinPrivacy: (v) => ['none', 'friends', 'friends_groups', 'everyone'].includes(v),
  gameDetectionEnabled: (v) => typeof v === 'boolean',

  overlayEnabled: (v) => typeof v === 'boolean',
  overlayNotifications: (v) => typeof v === 'boolean',

  startWithSystem: (v) => typeof v === 'boolean',
  minimizeToTray: (v) => typeof v === 'boolean',
  openLinksInApp: (v) => typeof v === 'boolean',
  confirmOnExit: (v) => typeof v === 'boolean',

  developerMode: (v) => typeof v === 'boolean',
};

async function getOrCreateSettings(userId) {
  // upsert com update: {} — cria na primeira vez que alguém pede,
  // sem sobrescrever nada se já existir (comportamento idempotente,
  // seguro de chamar toda vez).
  return prisma.userSettings.upsert({
    where: { userId }, update: {}, create: { userId },
  });
}

async function getSettings(req, res, next) {
  try {
    const settings = await getOrCreateSettings(req.user.id);
    res.json({ settings });
  } catch (err) { next(err); }
}

async function updateSettings(req, res, next) {
  try {
    const data = {};
    const rejected = [];
    for (const [key, value] of Object.entries(req.body || {})) {
      const validator = FIELD_VALIDATORS[key];
      if (!validator) { rejected.push(key); continue; } // campo desconhecido — nunca vira coluna nova sozinho
      if (!validator(value)) { rejected.push(key); continue; }
      data[key] = value;
    }
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Nenhuma configuração válida foi enviada.', rejected });
    }
    await getOrCreateSettings(req.user.id);
    const settings = await prisma.userSettings.update({ where: { userId: req.user.id }, data });
    res.json({ settings, rejected: rejected.length ? rejected : undefined });
  } catch (err) { next(err); }
}

async function resetSettings(req, res, next) {
  try {
    await prisma.userSettings.deleteMany({ where: { userId: req.user.id } });
    const settings = await getOrCreateSettings(req.user.id);
    await logSecurityEvent(req, 'SETTINGS_RESET');
    res.json({ settings });
  } catch (err) { next(err); }
}

module.exports = { getSettings, updateSettings, resetSettings };
