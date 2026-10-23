import { useEffect, useRef } from 'react';

// Atualização em tempo real (item pedido: "quero que a página atualize a
// cada 11 segundos para ver sempre todas as alterações ao vivo sem
// precisar fechar o menu ou aba"). UM relógio global pra todo o app:
// cada tela/modal aberto se inscreve com useLiveRefresh() e refaz o
// fetch em silêncio (sem skeleton, sem fechar nada, sem perder scroll).
// - Só roda com a aba/janela visível e com internet.
// - Pausa quando a aba fica escondida e dispara uma vez na hora que ela
//   volta a ficar visível (pra quem volta ver tudo atualizado na hora).

export const LIVE_REFRESH_INTERVAL = 11000;

const subscribers = new Set();
let timer = null;
let lastTickAt = 0;

// Contador de escritas (POST/PUT/PATCH/DELETE) — ver api/client.js. Uma
// resposta de refresh que saiu ANTES de uma escrita pode trazer dado
// velho (ex: voto otimista piscando de volta); nesses casos o resultado
// é descartado e o próximo tick pega o valor certo.
let mutationEpoch = 0;
let mutationsInFlight = 0;
export function noteMutationStart() { mutationEpoch += 1; mutationsInFlight += 1; }
export function noteMutationEnd() { mutationEpoch += 1; mutationsInFlight = Math.max(0, mutationsInFlight - 1); }

function isActive() {
  if (typeof document === 'undefined') return false;
  if (document.visibilityState === 'hidden') return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  return true;
}

// ECONOMIA DE RECURSOS ("consome muita internet/CPU parado"): o ritmo
// de atualização depende de a pessoa estar usando o app. Mensagens,
// notificações e chamadas chegam por socket — o refresh periódico é só
// rede de segurança, então pode desacelerar bastante quando ninguém mexe.
//  - usando (mexeu nos últimos 2 min, janela em foco): ritmo normal
//  - janela aberta mas sem foco, ou parado há 2+ min: 4x mais lento
//  - parado há 10+ min: pausa (volta na hora ao mexer de novo)
let lastInputAt = Date.now();
const IDLE_SLOW_MS = 2 * 60 * 1000;
const IDLE_STOP_MS = 10 * 60 * 1000;
export function activityFactor() {
  const idle = Date.now() - lastInputAt;
  if (idle > IDLE_STOP_MS) return Infinity;
  const focused = typeof document !== 'undefined' && typeof document.hasFocus === 'function' ? document.hasFocus() : true;
  if (idle > IDLE_SLOW_MS || !focused) return 4;
  return 1;
}
function noteInput() {
  const wasStopped = Date.now() - lastInputAt > IDLE_STOP_MS;
  lastInputAt = Date.now();
  if (wasStopped) onWake();
  if (isAppIdle()) syncIdleClass();
}
if (typeof window !== 'undefined') {
  let throttle = 0;
  const handler = () => { const n = Date.now(); if (n - throttle < 1000) return; throttle = n; noteInput(); };
  ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'].forEach((ev) => window.addEventListener(ev, handler, { passive: true, capture: true }));
  window.addEventListener('focus', () => { lastInputAt = Date.now(); onWake(); syncIdleClass(); });
  window.addEventListener('blur', () => syncIdleClass());
  setTimeout(syncIdleClass, 0);
}

// Socket conectado = mensagens/presença/canais/amigos chegam na hora pelo
// tempo real; aí o refresh periódico é só rede de segurança e pode ir
// bem mais devagar (assinantes com `realtimeInterval`). Quando o socket
// cai, volta pro ritmo normal até reconectar. Quem informa é
// useGlobalLiveRefresh (via useSocket).
let realtimeUp = false;
let everConnected = false;
export function setRealtimeConnected(up) {
  const wasUp = realtimeUp;
  realtimeUp = !!up;
  // Reconectou depois de uma queda: pode ter perdido eventos no meio —
  // ressincroniza tudo de uma vez.
  if (realtimeUp && !wasUp && everConnected) refreshNow();
  if (realtimeUp) everConnected = true;
}
export function isRealtimeConnected() { return realtimeUp; }

// Classe "pc-idle" no <html> enquanto ninguém está usando (parado há 2+
// min, janela sem foco ou escondida): o CSS pausa animações decorativas
// infinitas (nomes animados, fundo animado...) — ver styles/perf.css.
// Indicadores de voz/carregamento continuam animando normalmente.
let idleTimer = null;
function syncIdleClass() {
  if (typeof document === 'undefined') return;
  const idle = document.visibilityState === 'hidden' || activityFactor() > 1;
  const html = document.documentElement;
  if (html.classList.contains('pc-idle') !== idle) {
    html.classList.toggle('pc-idle', idle);
    try { window.dispatchEvent(new CustomEvent('pc-idle-change', { detail: { idle } })); } catch { /* sem CustomEvent */ }
  }
  clearTimeout(idleTimer);
  // Só precisa reagendar enquanto está ativo: o próximo input/foco chama
  // de novo. Um único timeout, sem polling.
  if (!idle) idleTimer = setTimeout(syncIdleClass, Math.max(1000, IDLE_SLOW_MS - (Date.now() - lastInputAt) + 50));
}
export function isAppIdle() {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('pc-idle');
}

function runAll(force = false) {
  lastTickAt = Date.now();
  subscribers.forEach((sub) => {
    try { sub.run(force); } catch { /* um assinante com erro não derruba os outros */ }
  });
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

function start() {
  stop();
  if (!subscribers.size || !isActive()) return;
  timer = setInterval(() => { if (isActive()) runAll(); else stop(); }, LIVE_REFRESH_INTERVAL);
}

function onWake() {
  if (!isActive()) { stop(); return; }
  // Voltou a ficar visível/online: atualiza na hora (se o último tick
  // já ficou pra trás) e reinicia o relógio a partir de agora.
  if (Date.now() - lastTickAt > 20000) runAll(true);
  start();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', onWake);
  document.addEventListener('visibilitychange', syncIdleClass);
  window.addEventListener('online', onWake);
  window.addEventListener('offline', stop);
}

// Força uma rodada agora (ex: depois de uma ação que muda muita coisa).
export function refreshNow() {
  if (!isActive()) return;
  runAll(true);
  start();
}

function subscribe(sub) {
  subscribers.add(sub);
  if (!timer) start();
  return () => {
    subscribers.delete(sub);
    if (!subscribers.size) stop();
  };
}

// Compara dois valores "de API" (JSON puro). Usado pra não dar setState
// quando nada mudou — evita re-render à toa a cada 11s.
export function sameData(a, b) {
  if (a === b) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

// Junta a primeira página recém-buscada com a lista já carregada (que
// pode ter várias páginas por "carregar mais"), sem perder o que está
// abaixo: itens da janela da 1ª página são substituídos pela versão
// nova (os que sumiram dela foram apagados), o resto é mantido.
export function mergeFirstPage(prev, fresh, getId = (x) => x.id) {
  if (!Array.isArray(prev) || !prev.length) return fresh;
  if (!Array.isArray(fresh)) return prev;
  // 1ª página vazia = a lista toda ficou vazia
  if (!fresh.length) return fresh;
  const freshIds = new Set(fresh.map(getId));
  const anchorId = getId(fresh[fresh.length - 1]);
  const anchorIdx = prev.findIndex((x) => getId(x) === anchorId);
  const tail = anchorIdx >= 0
    ? prev.slice(anchorIdx + 1).filter((x) => !freshIds.has(getId(x)))
    : prev.filter((x) => !freshIds.has(getId(x)));
  const merged = [...fresh, ...tail];
  return sameData(merged, prev) ? prev : merged;
}

// Hook: chama `callback(ctx)` a cada tick global (11s) enquanto
// `enabled`. Sempre a versão mais nova do callback (sem reinscrever a
// cada render). Pula o tick se a chamada anterior ainda não terminou.
// `ctx.ok()` diz se ainda vale aplicar o resultado (componente montado,
// mesma "chave" e nenhuma escrita aconteceu no meio) — use antes do
// setState (ou ctx.put(setX)(valor), que já checa isso e só grava
// se mudou). Erros são engolidos: o dado antigo continua na tela.
// `interval` (opcional, >= 11000) deixa assinantes mais "lentos".
// `realtimeInterval` (opcional): ritmo usado enquanto o socket está
// conectado — pra dados que já chegam por evento em tempo real.
// `key` (opcional): quando muda (ex: outro perfil aberto), respostas
// antigas em voo são descartadas.
export function useLiveRefresh(callback, { enabled = true, interval = LIVE_REFRESH_INTERVAL, realtimeInterval, key } = {}) {
  const cbRef = useRef(callback);
  cbRef.current = callback;
  const intervalRef = useRef(interval);
  intervalRef.current = interval;
  const rtRef = useRef(realtimeInterval);
  rtRef.current = realtimeInterval;

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    let inFlight = false;
    // Conta como "rodou agora" no momento da inscrição: a tela acabou de
    // fazer o fetch inicial dela, não precisa repetir no primeiro tick.
    let lastRun = Date.now();
    const sub = {
      run(force) {
        if (!alive || inFlight) return;
        const now = Date.now();
        const base = realtimeUp && rtRef.current ? Math.max(intervalRef.current, rtRef.current) : intervalRef.current;
        if (!force && now - lastRun < base * activityFactor() - 1500) return;
        lastRun = now;
        const epoch = mutationEpoch;
        const busyAtStart = mutationsInFlight > 0;
        const ok = () => alive && !busyAtStart && mutationsInFlight === 0 && mutationEpoch === epoch;
        // ctx.put(setX)(valor): setState só se ainda vale e se mudou.
        const put = (setter) => (v) => {
          if (ok() && v !== undefined) setter((prev) => (sameData(prev, v) ? prev : v));
        };
        const ctx = { ok, put };
        let result;
        try { result = cbRef.current?.(ctx); } catch { return; }
        if (result && typeof result.then === 'function') {
          inFlight = true;
          result.catch(() => {}).finally(() => { inFlight = false; });
        }
      },
    };
    const unsubscribe = subscribe(sub);
    return () => { alive = false; unsubscribe(); };
  }, [enabled, key]);
}
