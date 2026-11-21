import { api } from '../api/client';
import {
  fetchMe, getCommunity, listConversations, listFriends, getMyClan, listUsableEmojis, listServerStickers,
  listAssetCollections, listFavoriteGifs, listCommunities, getUserSettings, getUiLayout, getPlatformStatus,
  getActiveAnnouncement, listEvents, getChannelStates,
} from '../api/endpoints';

// "Pacote de abertura" (GET /api/bootstrap — ver server/src/controllers/
// bootstrapController.js): em vez de ~20 requisições separadas toda vez
// que o app abre (e a cada atualização ao vivo), uma só. Cada seção tem
// o MESMO formato da rota antiga, então quem usa não muda nada.
// - Cada seção vem com um hash; o cliente manda os hashes que já tem e o
//   servidor só reenvia o que mudou (atualização ao vivo quase de graça).
// - Cópia local (localStorage) por conta: na próxima abertura a tela já
//   aparece com os dados da última vez e atualiza em segundo plano.
// - Se o servidor não tiver /bootstrap (versão antiga) ou uma seção
//   falhar, busca aquela seção pela rota antiga — nada quebra.

const LEGACY = {
  me: fetchMe,
  community: getCommunity,
  conversations: listConversations,
  friends: listFriends,
  clan: getMyClan,
  usableEmojis: listUsableEmojis,
  stickers: listServerStickers,
  emojiCollections: () => listAssetCollections('EMOJI'),
  stickerCollections: () => listAssetCollections('STICKER'),
  favoriteGifs: listFavoriteGifs,
  clubs: listCommunities,
  settings: getUserSettings,
  uiLayout: getUiLayout,
  status: getPlatformStatus,
  announcement: getActiveAnnouncement,
  events: listEvents,
  // Não lidas / menções por canal (sobrevive a recarregar a página).
  channelStates: getChannelStates,
};

// Tudo que a abertura precisa (a conta já veio do /auth/refresh).
export const BOOT_SECTIONS = Object.keys(LEGACY).filter((k) => k !== 'me');
// O que vale guardar no aparelho pra abrir instantâneo. Anúncio fica de
// fora (pode já ter sido dispensado); a conta também (vem do login).
const PERSIST = new Set(BOOT_SECTIONS.filter((k) => k !== 'announcement'));
const CACHE_PREFIX = 'pc-boot-v1:';
const CACHE_MAX_AGE = 7 * 24 * 3600 * 1000;
const CACHE_MAX_CHARS = 2_500_000;

const latest = {}; // seção -> { hash, data } (o último valor aplicado)
const listeners = {}; // seção -> Set(fn)
let unsupported = false; // servidor sem /bootstrap → usa só as rotas antigas
let lastOkAt = 0;
let cacheUser = null;

export function bootstrapActive() { return !unsupported && lastOkAt > 0; }

// Avisa quem se inscreveu quando uma seção chega com conteúdo NOVO.
export function onBootSection(name, fn) {
  if (!listeners[name]) listeners[name] = new Set();
  listeners[name].add(fn);
  return () => listeners[name]?.delete(fn);
}
function emit(name, data) {
  listeners[name]?.forEach((fn) => { try { fn(data); } catch { /* um ouvinte com erro não derruba os outros */ } });
}

function legacyFetch(name) {
  return LEGACY[name]().then((data) => ({ name, data, ok: true }), () => ({ name, ok: false }));
}

// Busca as seções pedidas. `accept()` (opcional) é checado na chegada: se
// devolver false (ex.: houve uma escrita no meio), nada é gravado como
// "visto" — a próxima busca traz o conteúdo inteiro de novo.
// Devolve { data: {secao: corpo}, changed: Set } — `data` só tem as
// seções que temos (as que falharam ficam de fora, igual antes).
export async function fetchSections(names, { accept } = {}) {
  const wanted = names.filter((n) => LEGACY[n]);
  const out = { data: {}, changed: new Set() };
  if (!wanted.length) return out;
  const commit = (name, data, hash) => {
    const prev = latest[name];
    latest[name] = { hash: hash || null, data };
    out.data[name] = data;
    // Sem hash (rota antiga): compara pelo conteúdo.
    if (!prev || (hash ? prev.hash !== hash : JSON.stringify(prev.data) !== JSON.stringify(data))) out.changed.add(name);
  };
  const viaLegacy = async (list) => {
    const rs = await Promise.all(list.map(legacyFetch));
    if (accept && !accept()) return;
    rs.forEach((r) => { if (r.ok) commit(r.name, r.data, null); });
  };

  if (unsupported) {
    await viaLegacy(wanted);
  } else {
    let body = null;
    try {
      const have = wanted.filter((n) => latest[n]?.hash).map((n) => `${n}:${latest[n].hash}`).join(',');
      const res = await api.get('/bootstrap', { params: { only: wanted.join(','), ...(have ? { have } : {}) } });
      body = res.data;
      if (!body || typeof body !== 'object' || !body.hashes) throw new Error('resposta inesperada');
    } catch (err) {
      // 404 = servidor antigo sem essa rota: não tenta mais nesta sessão.
      if (err?.response?.status === 404) unsupported = true;
      body = null;
    }
    if (!body) {
      await viaLegacy(wanted);
    } else {
      if (accept && !accept()) return out;
      lastOkAt = Date.now();
      const missing = [];
      wanted.forEach((n) => {
        const h = body.hashes[n];
        if (body.data && Object.prototype.hasOwnProperty.call(body.data, n)) commit(n, body.data[n], h);
        else if (h && latest[n] && latest[n].hash === h) out.data[n] = latest[n].data; // não mudou
        else missing.push(n);
      });
      if (missing.length) await viaLegacy(missing);
    }
  }
  out.changed.forEach((n) => emit(n, out.data[n]));
  if (out.changed.size && cacheUser) schedulePersist();
  return out;
}

// ---------- cópia local (abrir instantâneo) ----------
let persistTimer = null;
function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, 1500);
}
function persistNow() {
  if (!cacheUser) return;
  const s = {};
  Object.keys(latest).forEach((k) => { if (PERSIST.has(k) && latest[k].hash) s[k] = latest[k]; });
  try {
    const raw = JSON.stringify({ v: 1, at: Date.now(), s });
    if (raw.length > CACHE_MAX_CHARS) { localStorage.removeItem(CACHE_PREFIX + cacheUser); return; }
    localStorage.setItem(CACHE_PREFIX + cacheUser, raw);
  } catch {
    try { localStorage.removeItem(CACHE_PREFIX + cacheUser); } catch { /* sem localStorage */ }
  }
}

// Lê a cópia local da conta (se existir e for recente) e já deixa os
// hashes prontos pra próxima busca. Devolve {secao: corpo} ou null.
function hydrate(userId) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 1 || !parsed.s || Date.now() - (parsed.at || 0) > CACHE_MAX_AGE) return null;
    const data = {};
    Object.entries(parsed.s).forEach(([k, entry]) => {
      if (!PERSIST.has(k) || !entry || typeof entry.hash !== 'string') return;
      if (!latest[k]) latest[k] = { hash: entry.hash, data: entry.data };
      data[k] = latest[k].data;
    });
    return Object.keys(data).length ? data : null;
  } catch {
    return null;
  }
}

// Apaga a cópia local (sair da conta).
export function clearBootCache() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX)).forEach((k) => localStorage.removeItem(k));
  } catch { /* sem localStorage */ }
  Object.keys(latest).forEach((k) => { delete latest[k]; });
  clearTimeout(persistTimer);
  cacheUser = null;
  bootPromise = null;
  bootUser = null;
  cached = null;
}

// ---------- abertura ----------
let bootPromise = null;
let bootUser = null;
let bootDoneAt = 0;
let cached = null;

// Começa (uma vez por conta) a busca de abertura. Chamado por App.jsx
// assim que o login resolve; MainApp e os outros reaproveitam a mesma.
export function startBoot(userId) {
  if (bootPromise && bootUser === userId) return bootPromise;
  if (bootUser && bootUser !== userId) clearBootCache();
  bootUser = userId;
  cacheUser = userId;
  cached = hydrate(userId);
  bootDoneAt = 0;
  bootPromise = fetchSections(BOOT_SECTIONS).then((r) => { bootDoneAt = Date.now(); return r; });
  return bootPromise;
}

// Dados da última vez (do aparelho), pra pintar a tela antes da rede.
export function cachedBoot() { return cached; }

// Seção vinda da busca de abertura, se ela ainda é recente (em andamento
// ou terminou há menos de 15s) — quem chamar não precisa buscar de novo.
// Devolve uma Promise do corpo da seção, ou null (aí busca normal).
export function bootSection(name) {
  if (!bootPromise) return null;
  if (bootDoneAt && Date.now() - bootDoneAt > 15000) return null;
  return bootPromise.then((r) => {
    if (r.data[name] === undefined) throw new Error('seção indisponível');
    return r.data[name];
  });
}
