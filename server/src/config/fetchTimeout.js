// Tempo limite padrão pra todo `fetch` do servidor que não passa o seu.
//
// Várias buscas em sites de fora (YouTube, GitHub, mod.io, Thunderstore,
// GameBanana, Nexus, Steam…) eram feitas sem `signal`. Se o outro lado
// aceitava a conexão e não respondia, o pedido ficava pendurado até o
// limite interno do Node (5 minutos) — prendendo a requisição de quem
// estava esperando e acumulando conexões abertas.
//
// Aqui o limite vale até a RESPOSTA começar a chegar (cabeçalhos). Baixar o
// corpo depois disso não tem prazo, pra não cortar download grande
// (compêndio do BLACKOUT, atualização do app). Quem passa `signal` próprio
// continua com o dele.

const DEFAULT_TIMEOUT_MS = 20_000;

function withDefaultTimeout(fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (typeof fetchImpl !== 'function' || fetchImpl.__pcDefaultTimeout) return fetchImpl;
  const wrapped = function fetchWithDefaultTimeout(input, init) {
    // Request já tem o próprio signal; init com signal: respeita o de quem chamou.
    if ((init && init.signal) || (typeof Request !== 'undefined' && input instanceof Request)) {
      return fetchImpl(input, init);
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      const err = new Error(`fetch: sem resposta em ${Math.round(timeoutMs / 1000)}s`);
      err.name = 'TimeoutError';
      ctrl.abort(err);
    }, timeoutMs);
    return fetchImpl(input, { ...(init || {}), signal: ctrl.signal })
      .finally(() => clearTimeout(timer));
  };
  Object.defineProperty(wrapped, '__pcDefaultTimeout', { value: true });
  return wrapped;
}

function installDefaultFetchTimeout(timeoutMs = DEFAULT_TIMEOUT_MS) {
  globalThis.fetch = withDefaultTimeout(globalThis.fetch, timeoutMs);
}

module.exports = { withDefaultTimeout, installDefaultFetchTimeout, DEFAULT_TIMEOUT_MS };
