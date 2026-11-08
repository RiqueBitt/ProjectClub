// Atualização automática de mods (Fase 7) — regras puras do lado do site
// (testadas em test/mods-auto-update.test.mjs). Quem decide se o JOGO está
// aberto é o app de PC (desktop/modAutoUpdate.js, via
// electronAPI.mods.autoUpdate.check); aqui fica o resto: quando rodar,
// o que dá pra atualizar sozinho e o resumo do aviso final.

// Primeira rodada alguns minutos depois de abrir o app (não disputa a
// abertura com nada), depois a cada 30 min.
export const INITIAL_DELAY_MS = 3 * 60 * 1000;
export const INTERVAL_MS = 30 * 60 * 1000;
// Logo depois de ligar a opção: roda em 1 min (a pessoa quer ver funcionar).
export const AFTER_ENABLE_DELAY_MS = 60 * 1000;
export const SETTINGS_EVENT = 'pc:mods-auto-update-changed';

export function autoUpdateBridge() {
  if (typeof window === 'undefined') return null;
  const b = window.electronAPI?.mods?.autoUpdate;
  return b && typeof b.check === 'function' && typeof b.getSettings === 'function' ? b : null;
}

export function normalizeSettings(raw) {
  const games = {};
  for (const [k, v] of Object.entries(raw?.games || {})) if (typeof v === 'boolean') games[k] = v;
  return { enabled: raw?.enabled === true, games };
}

// Igual ao isGameEnabled do app de PC: global ligado e o jogo não desligado.
export function gameAutoEnabled(settings, steamAppId) {
  const s = normalizeSettings(settings);
  return s.enabled && s.games[String(steamAppId)] !== false;
}

// ---------- "A tela de Mods está aberta?" ----------
// Com a tela aberta a pessoa pode estar instalando/desativando mods na mão
// (ou clicando "Atualizar tudo") — a rodada automática espera.
let modsPageOpen = 0;
export function markModsPageOpen() {
  modsPageOpen += 1;
  let done = false;
  return () => { if (!done) { done = true; modsPageOpen = Math.max(0, modsPageOpen - 1); } };
}
export function isModsPageOpen() { return modsPageOpen > 0; }

// Pode começar uma rodada agora?
export function shouldStartRound({ settings, busy = false, pageOpen = false, online = true }) {
  if (!normalizeSettings(settings).enabled) return { ok: false, reason: 'disabled' };
  if (busy) return { ok: false, reason: 'busy' };
  if (pageOpen) return { ok: false, reason: 'mods-page-open' };
  if (!online) return { ok: false, reason: 'offline' };
  return { ok: true, reason: 'ok' };
}

// Das atualizações pendentes de um jogo, só as que dá pra aplicar sem a
// pessoa (as que pedem login no site do mod ficam pro botão manual).
export function autoUpdatableItems(pending) {
  return (pending || []).filter((row) => row && ['modio', 'thunderstore', 'nexus'].includes(row.source)
    && row.update?.updateAvailable && !row.update?.needsAccount);
}

// Nome amigável de um item pra mostrar no aviso.
export function itemDisplayName(row) {
  return String(row?.update?.name || row?.name || row?.key || 'Mod').slice(0, 80);
}

// Resumo final pro aviso nativo: { updated: [nomes], failed: n, skipped: n }.
export function summarizeRound(results) {
  const out = { updated: [], failed: 0, skipped: 0 };
  for (const r of results || []) {
    if (r?.status === 'updated') out.updated.push(r.name);
    else if (r?.status === 'failed') out.failed += 1;
    else out.skipped += 1;
  }
  return out;
}
