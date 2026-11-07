// Notificações por canal/categoria + "Não perturbe" (lado do cliente):
// carrega/sincroniza as configurações da conta, decide se um aviso pode
// tocar som/aparecer no desktop e monta os itens do menu de contexto
// ("Silenciar canal ▸" / "Configurações de notificação ▸").
// Regras puras em ./notificationLevels.js (iguais às do servidor).
import { useStore, channelNotifyPrefs } from '../store/useStore';
import { listNotificationOverrides, updateNotificationOverride } from '../api/endpoints';
import {
  channelKey, categoryKey, isOverrideMuted, normalizeLevel, isQuietHoursActive, shouldNotify,
  muteRemainingLabel, LEVEL_LABELS, MUTE_OPTIONS, DEFAULT_LEVEL,
} from './notificationLevels';

// ---------- Estado ----------
let expiryTimer = null;
// Quando o silêncio mais próximo acabar, avisa a tela (o canal sai do cinza).
function scheduleExpiry(map) {
  clearTimeout(expiryTimer);
  const now = Date.now();
  const next = Object.values(map)
    .filter((o) => !o.muteForever && o.mutedUntil && new Date(o.mutedUntil).getTime() > now)
    .map((o) => new Date(o.mutedUntil).getTime())
    .sort((a, b) => a - b)[0];
  if (!next) return;
  // setTimeout aceita no máximo ~24,8 dias; acima disso reagenda depois.
  const wait = Math.min(next - now + 250, 2 ** 31 - 1);
  expiryTimer = setTimeout(() => {
    useStore.setState((s) => ({ notifTick: (s.notifTick || 0) + 1 }));
    scheduleExpiry(useStore.getState().notificationOverrides || {});
  }, wait);
}

function setOverrides(map) {
  useStore.setState({ notificationOverrides: map });
  scheduleExpiry(map);
}

export async function loadNotificationOverrides() {
  try {
    const { overrides } = await listNotificationOverrides();
    const map = {};
    (overrides || []).forEach((o) => { map[o.targetKey] = o; });
    setOverrides(map);
  } catch { /* sem rede: fica com o que já tinha */ }
}

// Resposta do PUT ou evento 'notification-override:update' (outro aparelho).
export function applyOverrideUpdate({ targetKey, override } = {}) {
  if (!targetKey) return;
  const next = { ...(useStore.getState().notificationOverrides || {}) };
  if (override) next[targetKey] = override; else delete next[targetKey];
  setOverrides(next);
}

async function save(type, id, body) {
  const key = type === 'channel' ? channelKey(id) : categoryKey(id);
  const prev = useStore.getState().notificationOverrides?.[key] || null;
  // Otimista: aplica na hora e desfaz se o servidor recusar.
  const optimistic = { ...(prev || { targetKey: key, level: null, mutedUntil: null, muteForever: false }) };
  if ('level' in body) optimistic.level = body.level;
  if ('mute' in body) {
    optimistic.muteForever = !!body.mute?.forever;
    optimistic.mutedUntil = body.mute?.minutes ? new Date(Date.now() + body.mute.minutes * 60000).toISOString() : null;
  }
  applyOverrideUpdate({ targetKey: key, override: optimistic });
  try {
    applyOverrideUpdate(await updateNotificationOverride(type, id, body));
  } catch {
    applyOverrideUpdate({ targetKey: key, override: prev });
    useStore.getState().pushNotice?.('Não foi possível salvar a configuração de notificação. Tente de novo.');
  }
}

export const muteTarget = (type, id, option) => save(type, id, { mute: option.forever ? { forever: true } : { minutes: option.minutes } });
export const unmuteTarget = (type, id) => save(type, id, { mute: null });
export const setTargetLevel = (type, id, level) => save(type, id, { level: level || null });

// ---------- Decisões ----------
export function quietHoursActive(now = Date.now()) {
  return isQuietHoursActive(useStore.getState().userSettings?.extraPrefs?.quietHours, now);
}

function findChannel(channelId) {
  const st = useStore.getState();
  return st.channels.find((c) => c.id === channelId)
    || st.categories.flatMap((cat) => cat.channels || []).find((c) => c.id === channelId)
    || { id: channelId, categoryId: null };
}

// Pode tocar som / mostrar notificação de desktop pra isso agora?
// kind: 'message' | 'mention' | 'dm'
export function canNotify({ kind, channelId = null } = {}) {
  const quiet = quietHoursActive();
  if (!channelId || kind === 'dm') return shouldNotify({ kind: 'dm', quiet });
  const prefs = channelNotifyPrefs(findChannel(channelId));
  return shouldNotify({ kind, level: prefs.level, muted: prefs.muted, quiet });
}

// ---------- Menu de contexto ----------
const globalLevelLabel = () => LEVEL_LABELS[normalizeLevel(useStore.getState().userSettings?.extraPrefs?.notifyLevel) || DEFAULT_LEVEL];

// Itens "Silenciar ▸" + "Configurações de notificação ▸" de um canal ou categoria.
export function notificationMenuItems(type, target) {
  const st = useStore.getState();
  const key = type === 'channel' ? channelKey(target.id) : categoryKey(target.id);
  const own = st.notificationOverrides?.[key] || null;
  const noun = type === 'channel' ? 'canal' : 'categoria';
  const items = [];

  if (isOverrideMuted(own)) {
    items.push({
      label: `Reativar ${noun}`, icon: 'volume',
      hint: muteRemainingLabel(own.mutedUntil, { forever: own.muteForever }),
      onClick: () => unmuteTarget(type, target.id),
    });
  } else {
    const viaCategory = type === 'channel' && channelNotifyPrefs(target).mutedBy === 'category';
    items.push({
      label: `Silenciar ${noun}`, icon: 'mute',
      hint: viaCategory ? 'A categoria já está silenciada' : undefined,
      submenu: MUTE_OPTIONS.map((opt) => ({ label: opt.label, icon: opt.forever ? 'mute' : 'clock', onClick: () => muteTarget(type, target.id, opt) })),
    });
  }

  const ownLevel = normalizeLevel(own?.level);
  let inheritLabel;
  if (type === 'channel') {
    const catLevel = target.categoryId ? normalizeLevel(st.notificationOverrides?.[categoryKey(target.categoryId)]?.level) : null;
    inheritLabel = catLevel ? `Padrão da categoria (${LEVEL_LABELS[catLevel]})` : `Padrão (${globalLevelLabel()})`;
  } else {
    inheritLabel = `Padrão (${globalLevelLabel()})`;
  }
  items.push({
    label: 'Configurações de notificação', icon: 'bell',
    hint: ownLevel ? LEVEL_LABELS[ownLevel] : undefined,
    submenu: [
      { label: inheritLabel, checked: !ownLevel, onClick: () => setTargetLevel(type, target.id, null) },
      { divider: true },
      ...['ALL', 'MENTIONS', 'NONE'].map((lv) => ({
        label: LEVEL_LABELS[lv], checked: ownLevel === lv, onClick: () => setTargetLevel(type, target.id, lv),
      })),
    ],
  });
  return items;
}
