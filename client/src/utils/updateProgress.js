// Helpers puros pro botão verde de atualização (TitleBar.jsx) decidir o
// que mostrar a partir do estado que o app (Electron) manda.
//
// BUG CORRIGIDO ("barra de atualização presa em 0% pra sempre"): o
// electron-updater baixa em segundo plano (autoDownload) e nem sempre
// emite eventos 'download-progress' — em downloads muito rápidos, vindos
// de cache, ou quando o servidor não manda o tamanho do arquivo. Sem
// esses eventos, a porcentagem nunca saía de 0 e a barra ficava congelada
// mesmo com o download acontecendo de verdade. A regra abaixo nunca
// mostra um 0% parado: enquanto não há progresso real (ou ele travou por
// alguns segundos), mostra uma barra indeterminada (animada); quando
// chega progresso de verdade, mostra a porcentagem; se o app reportar
// erro, mostra o estado de erro (e o clique seguinte tenta de novo).

// Normaliza a porcentagem (0–100, inteiro) vinda do evento do updater.
export function normalizePercent(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// Decide o que a barra deve mostrar.
//  - status: { available, downloaded, downloading, percent, error } (ou null)
//  - working: a pessoa clicou em instalar/baixar
//  - lastProgressAt: timestamp (ms) da última vez que a porcentagem mudou
//    (0 = nenhum progresso ainda)
//  - now: timestamp atual (ms)
//  - stallMs: quanto tempo sem progresso antes de cair pra indeterminado
// Retorna { mode, percent, indeterminate, error }.
//   mode: 'idle' | 'downloading' | 'ready' | 'error'
export function updateDisplay({ status, working, lastProgressAt = 0, now = 0, stallMs = 4000 } = {}) {
  const percent = normalizePercent(status?.percent);
  if (status?.downloaded) return { mode: 'ready', percent: 100, indeterminate: false, error: null };
  const error = status?.error || null;
  if (error && working) return { mode: 'error', percent, indeterminate: false, error };
  if (!working) return { mode: 'idle', percent, indeterminate: false, error: null };
  // Baixando: nunca um 0% congelado. Indeterminado quando ainda não há
  // progresso real, ou quando ele travou (nenhuma mudança por stallMs).
  const stalled = lastProgressAt > 0 && now - lastProgressAt >= stallMs;
  const indeterminate = percent <= 0 || stalled;
  return { mode: 'downloading', percent, indeterminate, error: null };
}
