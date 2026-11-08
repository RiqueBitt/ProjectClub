// Idempotência do envio de mensagens pelo `nonce` do cliente.
//
// Por quê: o cliente agora reenvia sozinho as mensagens que falharam por
// queda de rede/deploy (fila offline — ver client/src/utils/sendQueue.js),
// SEMPRE com o mesmo nonce. Se o primeiro POST chegou a criar a mensagem
// mas a resposta se perdeu (conexão caiu no meio, container reiniciando),
// o reenvio criaria uma mensagem duplicada. Aqui o servidor lembra, por
// alguns minutos, qual mensagem cada (pessoa, nonce) já criou e devolve
// a mesma em vez de criar outra.
//
// - Escopo por usuário: o nonce de uma pessoa nunca colide com o de outra.
// - Duas requisições iguais AO MESMO TEMPO: a segunda espera a primeira
//   terminar e devolve o mesmo resultado (sem corrida).
// - Memória do processo (rápida, sem banco) + Redis opcional (sobrevive a
//   um restart do container no meio do envio). Sem Redis, segue só com a
//   memória — nada quebra.

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 5000;
const NONCE_RE = /^[A-Za-z0-9_.:-]{8,80}$/;

function validNonce(nonce) {
  return typeof nonce === 'string' && NONCE_RE.test(nonce);
}

function keyOf(userId, nonce) {
  return `${userId}:${nonce}`;
}

// Fábrica (testável sem rede): `remote` é { get(key), set(key, value, ttlSec) }
// opcional — normalmente o Redis.
function createIdempotencyStore({ windowMs = WINDOW_MS, maxEntries = MAX_ENTRIES, now = () => Date.now(), remote = null } = {}) {
  // chave -> { at, messageId?, promise? }
  const entries = new Map();

  function prune() {
    // O Map mantém a ordem de inserção (cada atualização reinsere no fim),
    // então os mais velhos vêm primeiro: apaga os vencidos e, se ainda
    // passar do teto, os mais antigos já concluídos.
    const limit = now() - windowMs;
    for (const [k, e] of entries) {
      if (e.at >= limit && entries.size <= maxEntries) break;
      if (e.at < limit || !e.promise) entries.delete(k);
    }
  }

  // Já existe mensagem criada pra esse (usuário, nonce)? Devolve o id,
  // esperando uma requisição igual que ainda esteja em andamento.
  async function lookup(userId, nonce) {
    if (!validNonce(nonce) || !userId) return null;
    const key = keyOf(userId, nonce);
    const e = entries.get(key);
    if (e && now() - e.at <= windowMs) {
      if (e.messageId) return e.messageId;
      if (e.promise) return e.promise;
    }
    if (remote) {
      try {
        const id = await remote.get(`idem:msg:${key}`);
        if (id) return String(id);
      } catch { /* Redis fora — só memória */ }
    }
    return null;
  }

  // Marca o início de um envio. Devolve { commit(messageId), release() }
  // ou null se o nonce for inválido (envio segue normal, sem dedupe).
  function begin(userId, nonce) {
    if (!validNonce(nonce) || !userId) return null;
    const key = keyOf(userId, nonce);
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    entries.delete(key);
    entries.set(key, { at: now(), promise });
    prune();
    let done = false;
    return {
      commit(messageId) {
        if (done) return;
        done = true;
        entries.delete(key);
        entries.set(key, { at: now(), messageId: String(messageId) });
        resolve(String(messageId));
        if (remote) {
          Promise.resolve()
            .then(() => remote.set(`idem:msg:${key}`, String(messageId), Math.ceil(windowMs / 1000)))
            .catch(() => {});
        }
      },
      // Falhou (validação, erro): libera o nonce pra uma nova tentativa.
      release() {
        if (done) return;
        done = true;
        if (entries.get(key)?.promise === promise) entries.delete(key);
        resolve(null);
      },
    };
  }

  // Usado na criação: na MESMA volta do event loop confere a memória e já
  // reserva o nonce (sem janela pra duas requisições iguais passarem
  // juntas). Devolve { existingId } (já criada — devolva ela) ou
  // { claim } (siga criando e chame commit/release). Sem nonce válido:
  // { claim: null } (envio normal, sem dedupe).
  async function acquire(userId, nonce, depth = 0) {
    if (!validNonce(nonce) || !userId) return { claim: null };
    const key = keyOf(userId, nonce);
    const e = entries.get(key);
    if (e && now() - e.at <= windowMs) {
      if (e.messageId) return { existingId: e.messageId };
      if (e.promise) {
        const id = await e.promise;
        if (id) return { existingId: id };
        // A outra tentativa falhou: esta pode tentar de novo.
        if (depth < 2) return acquire(userId, nonce, depth + 1);
        return { claim: null };
      }
    }
    const claim = begin(userId, nonce);
    if (remote) {
      try {
        const id = await remote.get(`idem:msg:${key}`);
        if (id) { claim.commit(String(id)); return { existingId: String(id) }; }
      } catch { /* Redis fora — só memória */ }
    }
    return { claim };
  }

  return { lookup, begin, acquire, size: () => entries.size, validNonce };
}

// Instância do processo, com o Redis como reforço (carregado sob demanda —
// os testes usam a fábrica acima sem abrir conexão nenhuma).
let shared = null;
function sharedIdempotency() {
  if (shared) return shared;
  let remote = null;
  try {
    const { redis } = require('../config/redis');
    if (redis) {
      remote = {
        get: (k) => (redis.status === 'ready' ? redis.get(k) : null),
        set: (k, v, ttl) => (redis.status === 'ready' ? redis.set(k, v, 'EX', ttl) : null),
      };
    }
  } catch { remote = null; }
  shared = createIdempotencyStore({ remote });
  return shared;
}

module.exports = { createIdempotencyStore, sharedIdempotency, validNonce, WINDOW_MS };
