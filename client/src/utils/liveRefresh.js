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
  if (Date.now() - lastTickAt > 1500) runAll(true);
  start();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', onWake);
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
// `key` (opcional): quando muda (ex: outro perfil aberto), respostas
// antigas em voo são descartadas.
export function useLiveRefresh(callback, { enabled = true, interval = LIVE_REFRESH_INTERVAL, key } = {}) {
  const cbRef = useRef(callback);
  cbRef.current = callback;
  const intervalRef = useRef(interval);
  intervalRef.current = interval;

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
        if (!force && now - lastRun < intervalRef.current - 1500) return;
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
