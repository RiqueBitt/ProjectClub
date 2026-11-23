// Cache de perfis no cliente (miniperfil e perfil completo).
//
// Por que existe: o servidor fica em Ashburn (EUA) e cada pedido de quem
// está no Brasil leva ~150–300 ms de ida e volta, mesmo com o servidor
// respondendo em poucos ms. Antes, TODA abertura de miniperfil/perfil
// apagava tudo e mostrava "carregando" até a resposta chegar — inclusive
// pra quem tinha acabado de ser aberto.
//
// Agora (stale-while-revalidate):
//  - o que já foi buscado aparece NA HORA e é atualizado por trás;
//  - passar o mouse/dedo num avatar já busca o perfil antes do clique
//    (prefetchProfile), então até a primeira abertura costuma ser instantânea;
//  - mudanças ao vivo (socket 'user:update') entram no cache, pra nunca
//    mostrar nome/foto antigos.
// Limite de 150 perfis (LRU) e validade de 10 min sem nova busca.
import { getUserProfile } from './endpoints';

const MAX = 150;
const TTL_MS = 10 * 60 * 1000;
const PREFETCH_FRESH_MS = 60 * 1000;
const cache = new Map(); // id -> { profile, summary?, at }

function touch(id, entry) {
  cache.delete(id);
  cache.set(id, entry);
  while (cache.size > MAX) cache.delete(cache.keys().next().value);
}

function fresh(entry, maxAge = TTL_MS) {
  return entry && Date.now() - entry.at < maxAge;
}

/** Perfil (corpo de GET /users/:id) guardado, ou null. */
export function peekProfile(id) {
  const e = cache.get(id);
  return fresh(e) ? e.profile : null;
}

/** Resumo do perfil completo (GET /users/:id/summary) guardado, ou null. */
export function peekSummary(id) {
  const e = cache.get(id);
  return fresh(e) && e.summary ? e.summary : null;
}

export function rememberProfile(id, profile) {
  if (!id || !profile) return;
  const prev = cache.get(id);
  // O perfil novo substitui o do resumo também (é o mesmo corpo).
  touch(id, { profile, summary: prev?.summary ? { ...prev.summary, profile } : undefined, at: Date.now() });
}

export function rememberSummary(id, summary) {
  if (!id || !summary?.profile) return;
  touch(id, { profile: summary.profile, summary, at: Date.now() });
}

/** Busca (deduplicada) e guarda. */
export function fetchProfile(id) {
  return getUserProfile(id).then((d) => { rememberProfile(id, d); return d; });
}

const prefetchTimers = new Map();
/** Busca antecipada (hover/toque num avatar). Não refaz se é recente. */
export function prefetchProfile(id) {
  if (!id || prefetchTimers.has(id)) return;
  const e = cache.get(id);
  if (fresh(e, PREFETCH_FRESH_MS)) return;
  // Pequena espera: passar o mouse rápido por uma lista não dispara 20 pedidos.
  prefetchTimers.set(id, setTimeout(() => {
    prefetchTimers.delete(id);
    fetchProfile(id).catch(() => {});
  }, 90));
}
export function cancelPrefetch(id) {
  const t = prefetchTimers.get(id);
  if (t) { clearTimeout(t); prefetchTimers.delete(id); }
}

/** Mudança ao vivo de um usuário (socket): atualiza o que estiver guardado. */
export function patchCachedUser(user) {
  if (!user?.id) return;
  const e = cache.get(user.id);
  if (!e?.profile?.user) return;
  const profile = { ...e.profile, user: { ...e.profile.user, ...user } };
  cache.set(user.id, { ...e, profile, summary: e.summary ? { ...e.summary, profile } : undefined });
}

export function forgetProfile(id) { cache.delete(id); }

let installed = false;
/**
 * Um ouvinte só no documento: mouse parado ou dedo encostando em algo com
 * data-profile-id (avatar da mensagem, linha da lista de membros, amigo)
 * já busca o perfil, antes do clique. Chamado uma vez no main.jsx.
 */
export function installProfilePrefetch() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const idFrom = (e) => e.target?.closest?.('[data-profile-id]')?.getAttribute('data-profile-id');
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    const id = idFrom(e);
    if (id) prefetchProfile(id);
  }, { passive: true });
  document.addEventListener('pointerout', (e) => {
    const id = idFrom(e);
    if (id && !e.relatedTarget?.closest?.(`[data-profile-id="${CSS.escape(id)}"]`)) cancelPrefetch(id);
  }, { passive: true });
  // Toque: busca já no começo do toque (o clique vem ~100 ms depois).
  document.addEventListener('touchstart', (e) => {
    const id = idFrom(e);
    if (id && !fresh(cache.get(id), PREFETCH_FRESH_MS)) fetchProfile(id).catch(() => {});
  }, { passive: true });
}

// Só pra testes.
export function _resetProfileCache() { cache.clear(); prefetchTimers.forEach(clearTimeout); prefetchTimers.clear(); }
