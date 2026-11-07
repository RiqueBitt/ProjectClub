export const STATUS_LABEL = {
  ONLINE: 'Online',
  IDLE: 'Ausente',
  DND: 'Não perturbe',
  INVISIBLE: 'Invisível',
  OFFLINE: 'Offline',
};

// Valores CSS: a variável só existe com um modo de daltonismo ligado
// (Acessibilidade, ver utils/appearance.js); sem ele vale a cor de sempre.
export const STATUS_COLOR = {
  ONLINE: 'var(--pc-st-online, #23a55a)',
  IDLE: 'var(--pc-st-idle, #f0b232)',
  DND: 'var(--pc-st-dnd, #f23f43)',
  INVISIBLE: 'var(--pc-st-offline, #80848e)',
  OFFLINE: 'var(--pc-st-offline, #80848e)',
};
