// "O servidor está reiniciando" (deploy) — tratado com calma no site.
//
// Num deploy o servidor fica ~1 min fora: o proxy da hospedagem responde
// 502/503/504 (HTML, não o JSON da API) ou a conexão cai. Antes cada tela
// mostrava "Erro ao carregar" na hora. Agora as LEITURAS (GET) tentam de
// novo sozinhas com espera crescente (backoff), e quando o servidor volta
// avisamos o resto do app — o aviso "Nova versão disponível"
// (UpdateAvailableBanner) confere a versão publicada na mesma hora.
//
// 503 que É da própria API (manutenção, sistema desligado, recurso
// desativado) vem em JSON com um campo próprio e NÃO é repetido: é uma
// resposta de verdade, não o servidor fora do ar.

export const RESTART_EVENT = 'pc:server-restarting';
export const BACK_EVENT = 'pc:server-back';

const GATEWAY_STATUSES = new Set([502, 503, 504]);
const MAX_RETRIES = 5;

function isJsonApiAnswer(response) {
  const ct = String(response?.headers?.['content-type'] || response?.headers?.get?.('content-type') || '');
  if (!ct.includes('application/json')) return false;
  const data = response?.data;
  // O placeholder do deploy (scripts/warmupServer.js) responde JSON com
  // `restarting: true` — esse continua sendo "servidor reiniciando".
  if (data && typeof data === 'object' && data.restarting) return false;
  return true;
}

// O erro do axios parece o servidor fora do ar por reinício/deploy?
export function isServerRestartError(error) {
  if (!error || error.__CANCEL__ || error.code === 'ERR_CANCELED' || error.name === 'CanceledError') return false;
  const res = error.response;
  if (!res) {
    // Sem resposta nenhuma: rede caiu ou o servidor fechou a conexão.
    // Sem internet de verdade quem cuida é o aviso de "sem conexão".
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    return error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED' || error.message === 'Network Error';
  }
  return GATEWAY_STATUSES.has(res.status) && !isJsonApiAnswer(res);
}

// Só leituras: repetir um POST/PATCH poderia gravar duas vezes.
export function isRetryableRequest(config) {
  if (!config || config._noRestartRetry) return false;
  const method = String(config.method || 'get').toLowerCase();
  return method === 'get' || method === 'head';
}

// Espera antes da tentativa `attempt` (1, 2, 3...): 1s, 2s, 4s, 8s, 10s
// com uma pitada de aleatório pra todo mundo não voltar no mesmo instante.
// Respeita o Retry-After do servidor quando vier (em segundos, até 15s).
export function retryDelayMs(attempt, retryAfterHeader, random = Math.random) {
  const ra = Number(retryAfterHeader);
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra, 15) * 1000;
  const base = Math.min(1000 * 2 ** Math.max(0, attempt - 1), 10000);
  return Math.round(base * (0.8 + random() * 0.4));
}

export function shouldRetry(error) {
  const config = error?.config;
  if (!isRetryableRequest(config) || !isServerRestartError(error)) return false;
  return (config._restartAttempt || 0) < MAX_RETRIES;
}

let restarting = false;
function emit(name) {
  try { window.dispatchEvent(new CustomEvent(name)); } catch { /* fora do navegador (testes) */ }
}
export function noteServerRestarting() {
  if (restarting) return;
  restarting = true;
  emit(RESTART_EVENT);
}
export function noteServerBack() {
  if (!restarting) return;
  restarting = false;
  emit(BACK_EVENT);
}
export function isServerRestarting() { return restarting; }
export function _resetServerRestart() { restarting = false; }

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Interceptor de erro do axios: repete a leitura com backoff enquanto o
// servidor estiver reiniciando. `request` é a própria instância (api).
export async function retryDuringRestart(error, request, wait = sleep) {
  if (!shouldRetry(error)) return Promise.reject(error);
  const config = error.config;
  config._restartAttempt = (config._restartAttempt || 0) + 1;
  noteServerRestarting();
  await wait(retryDelayMs(config._restartAttempt, error.response?.headers?.['retry-after']));
  const res = await request(config);
  noteServerBack();
  return res;
}
