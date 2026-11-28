// Web Push no navegador/PWA (Chrome, Edge, Firefox, Safari 16+ instalado).
//
// Complementa o FCM do app Android (pushNotifications.js): quem usa o site
// no celular/notebook passa a receber aviso de DM, menção e notificações
// MESMO com o site fechado. O servidor assina com VAPID (services/webPush.js)
// e o service worker (public/sw.js) mostra a notificação só se nenhuma aba
// do app estiver visível.
//
//   setupWebPush()      — no login: se já tem permissão, (re)assina em silêncio
//   enableWebPush()     — pelo toggle das configurações: pede permissão e assina
//   disableWebPush()    — cancela a assinatura deste navegador
//   getWebPushState()   — 'unsupported' | 'denied' | 'off' | 'on'
import { api } from '../api/client';

const SW_URL = '/sw.js';

function isElectronOrNative() {
  if (typeof window === 'undefined') return true;
  if (window.electronAPI) return true; // desktop: tem notificação nativa própria
  try {
    // Capacitor (Android/iOS): o Android usa FCM; o WebView não tem PushManager.
    // eslint-disable-next-line no-underscore-dangle
    if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) return true;
  } catch { /* ok */ }
  return false;
}

export function isWebPushSupported() {
  return !isElectronOrNative()
    && typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
    && window.isSecureContext;
}

// Registra o service worker de push (idempotente). Remove qualquer worker
// antigo com outra URL (resquício de versões anteriores que faziam cache).
export async function ensureServiceWorker() {
  if (!('serviceWorker' in navigator) || isElectronOrNative()) return null;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => {
      const url = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || '';
      return url.endsWith(SW_URL) ? null : r.unregister().catch(() => {});
    }));
    const reg = await navigator.serviceWorker.register(SW_URL, { scope: '/', updateViaCache: 'none' });
    try { await reg.update(); } catch { /* ok */ }
    return reg;
  } catch (err) {
    console.warn('[push] service worker indisponível:', err?.message || err);
    return null;
  }
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function fetchPublicKey() {
  const { data } = await api.get('/push/web/public-key');
  return data && data.enabled ? data.publicKey : null;
}

async function subscribeAndSave(reg) {
  const publicKey = await fetchPublicKey();
  if (!publicKey) return null;
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    // Chave do servidor mudou? Reassina.
    const current = sub.options?.applicationServerKey ? btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : null;
    if (current && current !== publicKey) { try { await sub.unsubscribe(); } catch { /* ok */ } sub = null; }
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  }
  await api.post('/push/web/subscribe', { subscription: sub.toJSON() });
  return sub;
}

export function getWebPushState() {
  if (!isWebPushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try { if (localStorage.getItem('pc:webpush') === 'on' && Notification.permission === 'granted') return 'on'; } catch { /* ok */ }
  return 'off';
}

// No login: só reassina quem já ligou antes (nunca pede permissão sozinho).
export async function setupWebPush() {
  if (!isWebPushSupported()) return false;
  let wanted = false;
  try { wanted = localStorage.getItem('pc:webpush') === 'on'; } catch { /* ok */ }
  if (!wanted || Notification.permission !== 'granted') return false;
  const reg = await ensureServiceWorker();
  if (!reg) return false;
  try { await subscribeAndSave(reg); return true; } catch (err) { console.warn('[push] não foi possível reassinar:', err?.message || err); return false; }
}

export async function enableWebPush() {
  if (!isWebPushSupported()) return { ok: false, reason: 'unsupported' };
  let perm = Notification.permission;
  if (perm !== 'granted') perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: perm === 'denied' ? 'denied' : 'dismissed' };
  const reg = await ensureServiceWorker();
  if (!reg) return { ok: false, reason: 'sw' };
  try {
    const sub = await subscribeAndSave(reg);
    if (!sub) return { ok: false, reason: 'server' };
    try { localStorage.setItem('pc:webpush', 'on'); } catch { /* ok */ }
    return { ok: true };
  } catch (err) {
    console.warn('[push] não foi possível assinar:', err?.message || err);
    return { ok: false, reason: 'error' };
  }
}

export async function disableWebPush() {
  try { localStorage.setItem('pc:webpush', 'off'); } catch { /* ok */ }
  if (!isWebPushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) {
      await api.post('/push/web/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
  } catch { /* ok */ }
}

// Logout: cancela a assinatura deste navegador no servidor E no navegador,
// sem mexer na preferência (no próximo login, setupWebPush reassina).
export async function forgetWebPushForLogout() {
  if (!isWebPushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = reg && await reg.pushManager.getSubscription();
    if (!sub) return;
    await api.post('/push/web/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  } catch { /* ok */ }
}

// Mensagens do service worker (clique na notificação → navegar na aba
// aberta; assinatura renovada → reassinar).
export function listenServiceWorkerMessages(navigate) {
  if (!('serviceWorker' in navigator) || isElectronOrNative()) return () => {};
  const onMsg = (ev) => {
    const d = ev.data || {};
    if (d.type === 'pc:navigate' && typeof d.link === 'string' && d.link.startsWith('/')) navigate(d.link);
    if (d.type === 'pc:push-resubscribe') setupWebPush();
  };
  navigator.serviceWorker.addEventListener('message', onMsg);
  return () => navigator.serviceWorker.removeEventListener('message', onMsg);
}
