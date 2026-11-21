const prisma = require('../config/prisma');
const { safeUpsert } = require('../utils/prismaSafe');
const { logSecurityEvent } = require('../services/securityLog');
const { parseHHMM, isValidTimeZone } = require('../services/notificationPrefs');
const {
  sanitizeVoiceVolumes, sanitizeVoiceVolumesPatch, mergeVoiceVolumes, parseVoiceVolumes,
} = require('../utils/voiceVolumes');

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
  showReadReceipts: (v) => typeof v === 'boolean',

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
  // Quem vê a biblioteca de jogos (tempo de jogo) — ver gameLibraryController.js.
  gamesVisibility: (v) => ['everyone', 'friends', 'nobody'].includes(v),

  overlayEnabled: (v) => typeof v === 'boolean',
  overlayNotifications: (v) => typeof v === 'boolean',

  startWithSystem: (v) => typeof v === 'boolean',
  minimizeToTray: (v) => typeof v === 'boolean',
  openLinksInApp: (v) => typeof v === 'boolean',
  confirmOnExit: (v) => typeof v === 'boolean',

  developerMode: (v) => typeof v === 'boolean',

  // Personalizar layout — objeto pequeno; vira texto JSON no banco
  // (ver sanitizeLayoutPrefs abaixo). null volta pro padrão.
  layoutPrefs: (v) => v === null || sanitizeLayoutPrefs(v) !== undefined,
  // Preferências extras (ver EXTRA_PREF_RULES) — também vira texto JSON.
  extraPrefs: (v) => v === null || sanitizeExtraPrefs(v) !== undefined,
  // Volume por pessoa nas chamadas (ver utils/voiceVolumes.js). Mapa
  // completo (substitui) ou null pra zerar tudo.
  voiceVolumes: (v) => v === null || sanitizeVoiceVolumes(v) !== undefined,
  // Patch parcial { userId: volume | null } — mesclado com o que já está
  // salvo, pra dois aparelhos mudando volumes ao mesmo tempo não se apagarem.
  voiceVolumesPatch: (v) => sanitizeVoiceVolumesPatch(v) !== undefined,
};

const isBool = (v) => typeof v === 'boolean';
const oneOf = (...vals) => (v) => vals.includes(v);
const intIn = (min, max) => (v) => Number.isInteger(v) && v >= min && v <= max;
const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const isKey = (max = 32) => (v) => typeof v === 'string' && v.length <= max && /^[a-z0-9_-]+$/i.test(v);
const keyList = (max = 40) => (v) => Array.isArray(v) && v.length <= max && v.every(isKey(32));
// Sons que dá pra desligar um por um (Notificações / Voz e vídeo).
const SOUND_KEYS = ['message', 'messageActive', 'mention', 'incomingCall', 'outgoingCall', 'mute', 'unmute', 'deafen', 'undeafen',
  'join', 'leave', 'userJoin', 'userLeave', 'userMoved', 'camOn', 'camOff', 'streamStart', 'streamStop', 'streamUserJoin',
  'streamUserLeave', 'pttActivate', 'pttDeactivate', 'disconnect', 'reconnect', 'friendRequest', 'notice'];

// Cada chave conferida; o que não bate é descartado (nunca grava lixo).
const EXTRA_PREF_RULES = {
  // Aparência
  colorTheme: (v) => v === 'none' || isKey(24)(v),
  customTheme: (v) => v && typeof v === 'object' && !Array.isArray(v)
    && Array.isArray(v.colors) && v.colors.length >= 1 && v.colors.length <= 5 && v.colors.every(isHex)
    && intIn(0, 360)(v.angle) && isHex(v.accent) && intIn(0, 100)(v.mix),
  themeSync: isBool,
  // Guardar as mensagens recentes no aparelho (abrir canal na hora).
  cacheMessages: isBool,
  themeOnProfiles: isBool,
  appIcon: isKey(24),
  weeklyDigest: isBool,
  streamerMode: isBool,
  streamerHidePersonal: isBool,
  streamerHideLinks: isBool,
  streamerMuteSounds: isBool,
  streamerMuteNotifs: isBool,
  groupSpacing: oneOf(0, 4, 8, 16, 24),
  spoilers: oneOf('click', 'always'),
  showReactions: isBool,
  emoticonsToEmoji: isBool,
  showSendButton: isBool,
  searchScope: oneOf('current', 'all'),
  stickerSuggestions: isBool,
  // Acessibilidade
  underlineLinks: isBool,
  minToastSec: oneOf(0, 3, 5, 10, 15, 20),
  stickerAnim: oneOf('always', 'hover', 'never'),
  gifFocusOnly: isBool,
  animatedEmoji: isBool,
  ttsRate: (v) => typeof v === 'number' && v >= 0.5 && v <= 2,
  showAltText: isBool,
  toggleIcons: isBool,
  // Notificações
  notifyFriendOnline: isBool,
  notifyFriendAnniversary: isBool,
  notifyFriendProfile: isBool,
  shareProfileUpdates: isBool,
  notifyReactions: oneOf('all', 'dm', 'none'),
  soundPack: oneOf('auto', 'classic', 'halloween', 'natal', 'retro', 'suave'),
  soundsOff: (v) => keyList(40)(v) && v.every((k) => SOUND_KEYS.includes(k)),
  unreadBadge: isBool,
  // Avisar (push/PC) quando sair anúncio ou evento novo (services/broadcastNotify.js).
  notifyAnnouncements: isBool,
  notifyEvents: isBool,
  // Padrão de notificação dos canais (canal/categoria podem sobrescrever —
  // ver services/notificationPrefs.js).
  notifyLevel: oneOf('all', 'mentions', 'none'),
  // "Não perturbe" agendado: { enabled, start, end, days, timezone }.
  quietHours: (v) => sanitizeQuietHours(v) !== undefined,
  emailComms: isBool,
  emailSocial: isBool,
  emailUpdates: isBool,
  emailTips: isBool,
  // Voz e vídeo
  // "Testar antes de entrar" (painel de pré-entrada da chamada).
  preJoinCheck: isBool,
  inputProfile: oneOf('isolation', 'studio', 'custom'),
  sensitivityAuto: isBool,
  sensitivityDb: intIn(-100, 0),
  // Volume de entrada do microfone (0–200%).
  inputVolume: intIn(0, 200),
  joinSoundId: (v) => v === null || (typeof v === 'string' && v.length <= 64),
  sfxVolume: intIn(0, 100),
  streamPreview: isBool,
  // Privacidade
  spamFilter: oneOf('all', 'strangers', 'off'),
  messageRequests: isBool,
  friendReqMessages: isBool,
  clipVoice: isBool,
  gameJoinFriends: isBool,
  gameJoinVoice: isBool,
};
// Horário "HH:MM", dias 0 (domingo) a 6 sem repetir e fuso IANA válido
// (o cliente manda o do Intl). Devolve uma cópia limpa ou undefined.
function sanitizeQuietHours(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  if (typeof v.enabled !== 'boolean') return undefined;
  if (parseHHMM(v.start) === null || parseHHMM(v.end) === null) return undefined;
  if (!Array.isArray(v.days) || v.days.length > 7 || !v.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return undefined;
  if (!isValidTimeZone(v.timezone)) return undefined;
  return { enabled: v.enabled, start: v.start, end: v.end, days: [...new Set(v.days)].sort(), timezone: v.timezone };
}
function sanitizeExtraPrefs(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out = {};
  for (const [key, rule] of Object.entries(EXTRA_PREF_RULES)) {
    if (key in v && rule(v[key])) {
      if (key === 'customTheme') {
        out[key] = { colors: v.customTheme.colors, angle: v.customTheme.angle, accent: v.customTheme.accent, mix: v.customTheme.mix };
      } else if (key === 'quietHours') out[key] = sanitizeQuietHours(v.quietHours);
      else out[key] = v[key];
    }
  }
  return out;
}
const parseExtra = (raw) => { try { return raw ? JSON.parse(raw) || {} : {}; } catch { return {}; } };

// Lê as preferências extras de alguém (usado no servidor pra avisos,
// e-mails, filtro de spam...). Padrões ficam no chamador.
async function getExtraPrefs(userId) {
  const row = await prisma.userSettings.findUnique({ where: { userId }, select: { extraPrefs: true } }).catch(() => null);
  return parseExtra(row?.extraPrefs);
}
async function getExtraPrefsMany(userIds) {
  if (!userIds.length) return {};
  const rows = await prisma.userSettings.findMany({ where: { userId: { in: userIds } }, select: { userId: true, extraPrefs: true } }).catch(() => []);
  const out = {};
  for (const r of rows) out[r.userId] = parseExtra(r.extraPrefs);
  return out;
}

// Só as chaves conhecidas, cada uma conferida — nunca grava um objeto
// cru vindo do frontend. Retorna undefined se não for um objeto.
const LAYOUT_PREF_RULES = {
  density: (v) => ['compact', 'normal', 'spacious'].includes(v),
  corners: (v) => ['round', 'square'].includes(v),
  sidebarWidth: (v) => Number.isInteger(v) && v >= 200 && v <= 420,
  fontSize: (v) => Number.isInteger(v) && v >= 12 && v <= 20,
  showMembers: (v) => typeof v === 'boolean',
  animatedBg: (v) => ['off', 'gradient', 'particles'].includes(v),
  seasonal: (v) => typeof v === 'boolean',
  legibleFont: (v) => typeof v === 'boolean',
  resumeLastPage: (v) => typeof v === 'boolean',
  // Acessibilidade → daltonismo (ver client/src/utils/appearance.js).
  colorblind: (v) => ['none', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'].includes(v),
  colorblindStrength: (v) => Number.isInteger(v) && v >= 0 && v <= 100,
  colorblindFilter: (v) => typeof v === 'boolean',
  statusShapes: (v) => typeof v === 'boolean',
};
function sanitizeLayoutPrefs(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out = {};
  for (const [key, rule] of Object.entries(LAYOUT_PREF_RULES)) {
    if (key in v && rule(v[key])) out[key] = v[key];
  }
  return out;
}

// Banco guarda texto; o frontend sempre recebe objeto (ou null).
function serializeSettings(settings) {
  if (!settings) return settings;
  let layoutPrefs = null;
  if (settings.layoutPrefs) {
    try { layoutPrefs = JSON.parse(settings.layoutPrefs); } catch { layoutPrefs = null; }
  }
  return { ...settings, layoutPrefs, extraPrefs: parseExtra(settings.extraPrefs), voiceVolumes: parseVoiceVolumes(settings.voiceVolumes) };
}

async function getOrCreateSettings(userId) {
  // upsert com update: {} — cria na primeira vez que alguém pede,
  // sem sobrescrever nada se já existir (comportamento idempotente,
  // seguro de chamar toda vez).
  return safeUpsert(prisma.userSettings, {
    where: { userId }, update: {}, create: { userId },
  });
}

async function getSettings(req, res, next) {
  try {
    const settings = await getOrCreateSettings(req.user.id);
    res.json({ settings: serializeSettings(settings) });
  } catch (err) { next(err); }
}

async function updateSettings(req, res, next) {
  try {
    const data = {};
    const rejected = [];
    let volumesPatch = null;
    for (const [key, value] of Object.entries(req.body || {})) {
      const validator = FIELD_VALIDATORS[key];
      if (!validator) { rejected.push(key); continue; } // campo desconhecido — nunca vira coluna nova sozinho
      if (!validator(value)) { rejected.push(key); continue; }
      if (key === 'layoutPrefs' && value !== null) data[key] = JSON.stringify(sanitizeLayoutPrefs(value));
      else if (key === 'extraPrefs' && value !== null) data[key] = JSON.stringify(sanitizeExtraPrefs(value));
      else if (key === 'voiceVolumes') data[key] = value === null ? null : JSON.stringify(sanitizeVoiceVolumes(value));
      else if (key === 'voiceVolumesPatch') volumesPatch = sanitizeVoiceVolumesPatch(value);
      else data[key] = value;
    }
    if (Object.keys(data).length === 0 && !volumesPatch) {
      return res.status(400).json({ error: 'Nenhuma configuração válida foi enviada.', rejected });
    }
    const current = await getOrCreateSettings(req.user.id);
    // Mapa completo no mesmo PATCH tem prioridade; o patch mescla por cima.
    if (volumesPatch) {
      const base = 'voiceVolumes' in data ? parseVoiceVolumes(data.voiceVolumes) : parseVoiceVolumes(current?.voiceVolumes);
      data.voiceVolumes = JSON.stringify(mergeVoiceVolumes(base, volumesPatch));
    }
    const settings = await prisma.userSettings.update({ where: { userId: req.user.id }, data });
    res.json({ settings: serializeSettings(settings), rejected: rejected.length ? rejected : undefined });
  } catch (err) { next(err); }
}

async function resetSettings(req, res, next) {
  try {
    await prisma.userSettings.deleteMany({ where: { userId: req.user.id } });
    const settings = await getOrCreateSettings(req.user.id);
    await logSecurityEvent(req, 'SETTINGS_RESET');
    res.json({ settings: serializeSettings(settings) });
  } catch (err) { next(err); }
}

module.exports = { getSettings, updateSettings, resetSettings, getExtraPrefs, getExtraPrefsMany, sanitizeExtraPrefs, SOUND_KEYS };
