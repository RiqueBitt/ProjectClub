// Lógica PURA da "voz à prova de falhas" no cliente (sem React, sem DOM —
// testada em client/test/voice-resilience.test.js):
//   - classifyClose: o que fazer quando o servidor de mídia fecha o WebSocket
//     (contrato do media-server/src/signaling.js);
//   - failureCode: código curto do erro pra POST /api/voice/report;
//   - withTimeout: provedor que "trava" sem responder conta como falha;
//   - createFailureMemory: provedores que falharam NESTE aparelho ficam fora
//     da lista clientReady por um tempo (o poll de troca não volta pra eles);
//   - importWithRetry: import() de SDK que falhou (deploy novo trocou o nome
//     do arquivo) tenta de novo e, por fim, pede UM recarregamento.

// Fechamento do WebSocket do servidor de mídia → ação.
//   'replaced'      → entrou em outro aparelho (4409 / kicked replaced|flapping): NÃO reconecta
//   'refresh-token' → 4401 (token vencido/recusado): pede token novo e reconecta
//   'give-up'       → 1008 (abuso) ou expulso: não adianta tentar
//   'reconnect'     → todo o resto (1006 queda, 1012 servidor reiniciando, 4429, 4503…)
export function classifyClose({ code, detail, kicked } = {}) {
  const k = kicked == null ? '' : String(kicked);
  if (code === 4409 || k === 'replaced' || k === 'flapping') return 'replaced';
  if (k) return 'give-up';
  if (code === 4401) return 'refresh-token';
  if (code === 1008) return 'give-up';
  void detail;
  return 'reconnect';
}

// Código curto e seguro (o servidor aceita [\w:.-], até 60) pra /api/voice/report.
export function failureCode(err) {
  if (!err) return 'client';
  const raw = typeof err === 'string' ? err : '';
  const msg = String(err?.message || raw || '');
  const known = msg.match(/INVALID_TOKEN|TOKEN_EXPIRED|JOIN_TIMEOUT|ICE_FAILED|WS_ABORT|NETWORK_ERROR|OPERATION_ABORTED/);
  // DOMException tem `code` numérico (legado) — só vale código em texto.
  const own = err && typeof err === 'object' && typeof err.code === 'string' ? err.code : null;
  let code = own || (known && known[0]) || (err && typeof err === 'object' && err.name !== 'Error' ? err.name : null) || 'client';
  code = String(code).replace(/[^\w:.-]/g, '').slice(0, 60);
  return code || 'client';
}

// Rejeita com err.code='TIMEOUT' se a promise não resolver em `ms`.
export function withTimeout(promise, ms, code = 'TIMEOUT') {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error(`tempo esgotado (${Math.round(ms / 1000)}s)`);
      e.code = code;
      reject(e);
    }, ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

// Memória local de provedores que falharam neste aparelho.
export function createFailureMemory({ ttlMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
  const failedAt = new Map();
  const prune = () => { const t = now(); for (const [p, at] of failedAt) if (t - at >= ttlMs) failedAt.delete(p); };
  return {
    mark(provider) { if (provider) failedAt.set(String(provider), now()); },
    clear(provider) { if (provider) failedAt.delete(String(provider)); else failedAt.clear(); },
    has(provider) { prune(); return failedAt.has(String(provider)); },
    excluded() { prune(); return [...failedAt.keys()]; },
    // Lista "clientReady" sem os que falharam. Se TODOS falharam, devolve a
    // lista original (melhor tentar de novo do que não ter provedor nenhum).
    filter(list) {
      prune();
      const out = (list || []).filter((p) => !failedAt.has(p));
      return out.length ? out : [...(list || [])];
    },
  };
}

export const CHUNK_ERROR_RE = /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch dynamically|ChunkLoadError|Loading chunk [\w-]+ failed/i;
export function isChunkError(err) {
  return CHUNK_ERROR_RE.test(String(err?.message || err || ''));
}

// import() com novas tentativas. `factory` é () => import('x'). Se todas
// falharem com erro de pedaço (chunk) e `onChunkFailure` existir, chama-o
// (o app recarrega uma vez, com trava contra loop) e repassa o erro.
export async function importWithRetry(factory, { retries = 2, delayMs = 700, onChunkFailure = null, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let lastErr = null;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await factory();
    } catch (err) {
      lastErr = err;
      if (i < retries) await sleep(delayMs * (i + 1));
    }
  }
  if (onChunkFailure && isChunkError(lastErr)) {
    try { onChunkFailure(lastErr); } catch { /* recarregar nunca derruba o fluxo */ }
  }
  throw lastErr;
}

// Recarregamento ÚNICO e protegido depois de falha de chunk: nunca no meio de
// uma call (window.__pcInCall) e no máximo 1x a cada 60s (sessionStorage).
export function guardedReload({ storage, inCall = false, now = Date.now(), reload, key = 'pc-voice-chunk-reload', minGapMs = 60000 } = {}) {
  if (inCall || typeof reload !== 'function') return false;
  try {
    const last = Number(storage?.getItem(key) || 0);
    if (now - last < minGapMs) return false;
    storage?.setItem(key, String(now));
  } catch { /* sem storage: ainda recarrega uma vez */ }
  reload();
  return true;
}

// Versão do navegador (usa window/sessionStorage). Seguro em Node (no-op).
export function browserGuardedReload() {
  if (typeof window === 'undefined') return false;
  let storage = null;
  try { storage = window.sessionStorage; } catch { storage = null; }
  return guardedReload({ storage, inCall: !!window.__pcInCall, reload: () => window.location.reload() });
}

// Erro do getUserMedia → motivo pra UI ('denied' | 'busy' | 'missing').
// null = não é erro de microfone (ex.: o servidor recusou o produce).
export function micErrorReason(err) {
  const n = err?.name || '';
  if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') return 'denied';
  if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') return 'busy';
  if (n === 'NotFoundError' || n === 'OverconstrainedError' || n === 'DevicesNotFoundError' || n === 'ConstraintNotSatisfiedError') return 'missing';
  return null;
}

// ICE do servidor de mídia: o que fazer com um estado do transport.
//   'connected'   → limpa timers
//   'grace'       → disconnected: espera um pouco (costuma voltar sozinho)
//   'restart-ice' → failed (ou disconnected que não voltou): restartIce
//   'reconnect'   → closed, ou já reiniciou ICE demais: refaz a sessão
export function iceAction(state, { iceRestarts = 0, maxIceRestarts = 2 } = {}) {
  if (state === 'connected' || state === 'completed') return 'connected';
  if (state === 'closed') return 'reconnect';
  if (state === 'disconnected') return 'grace';
  if (state === 'failed') return iceRestarts >= maxIceRestarts ? 'reconnect' : 'restart-ice';
  return 'none';
}
