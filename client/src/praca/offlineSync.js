// Modo offline do app de computador: enquanto a pessoa está na Praça, o
// site pede ao servidor uma cópia do pinguim da conta (todos os itens por
// id, roupas, iglu, puffles, carimbos e o saldo de moedas) e entrega ao app
// de PC, que guarda num arquivo. Sem internet ou sem o servidor, o Club
// Penguin embutido no app abre com esse pinguim (desktop/pracaOffline.js).
//
// Cadência: uma vez ao entrar no mundo e depois a cada 5 minutos. No
// navegador comum (sem o app) não faz nada.
import { api } from '../api/client.js';

export const SYNC_EVERY_MS = 5 * 60 * 1000;

function bridge() {
  const b = typeof window !== 'undefined' ? window.electronAPI?.offline : null;
  return b && typeof b.savePraca === 'function' ? b : null;
}

/** O app de PC está presente e sabe guardar a cópia offline? */
export function offlineSyncAvailable() {
  return !!bridge();
}

/** Pede a cópia ao servidor e entrega ao app. Devolve o resultado do app (ou null). */
export async function syncOfflineNow() {
  const b = bridge();
  if (!b) return null;
  const { data } = await api.get('/plaza/offline-snapshot');
  return b.savePraca(data);
}

/**
 * Liga o sync periódico. `active()` diz se a pessoa ainda está no jogo —
 * fora dele nada é pedido. Devolve a função que desliga.
 */
export function startOfflineSync({ active = () => true, onSaved = () => {}, every = SYNC_EVERY_MS } = {}) {
  if (!bridge()) return () => {};
  let stopped = false;
  const run = async () => {
    if (stopped || !active()) return;
    try {
      const r = await syncOfflineNow();
      if (!stopped && r) onSaved(r);
    } catch (err) {
      console.warn('[praça] cópia offline não salvou:', err?.message || err);
    }
  };
  run();
  const timer = setInterval(run, every);
  return () => { stopped = true; clearInterval(timer); };
}
