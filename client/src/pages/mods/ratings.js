// Avaliações de mods (Fase 7) — funções puras usadas pelos cartões e pela
// página do mod (testadas em test/mod-ratings.test.mjs).

export const REVIEW_MAX = 500;
export const STAR_LABELS = ['', 'Ruim', 'Fraco', 'Ok', 'Bom', 'Excelente'];

// "4,3" (vírgula, 1 casa) ou null sem avaliações.
export function formatAverage(average, count) {
  if (!count || average == null || !Number.isFinite(Number(average))) return null;
  return Number(average).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// "1 avaliação" / "12 avaliações" / "1,2 mil avaliações".
export function formatRatingCount(count) {
  const n = Math.max(0, Number(count) || 0);
  const label = n === 1 ? 'avaliação' : 'avaliações';
  if (n >= 1000) return `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil ${label}`;
  return `${n} ${label}`;
}

// Preenchimento de cada uma das 5 estrelas (0, 0.5 ou 1) pra uma média —
// arredonda pra meia estrela mais próxima.
export function starFills(average) {
  const v = Math.round(Math.min(5, Math.max(0, Number(average) || 0)) * 2) / 2;
  return [1, 2, 3, 4, 5].map((i) => (v >= i ? 1 : v >= i - 0.5 ? 0.5 : 0));
}

// Texto da estatística do cartão ("4,3 (12)") ou null pra não mostrar.
export function tileRatingLabel(summary) {
  const avg = formatAverage(summary?.average, summary?.count);
  if (!avg) return null;
  const n = summary.count >= 1000 ? `${Math.floor(summary.count / 1000)} mil` : summary.count;
  return `${avg} (${n})`;
}

// Mesmo limite do servidor (conta emoji como 1 caractere).
export function reviewLength(text) {
  return [...String(text || '').trim()].length;
}
export function reviewTooLong(text) {
  return reviewLength(text) > REVIEW_MAX;
}

// Barras de distribuição: porcentagem de cada nota (5 → 1).
export function distributionBars(distribution, count) {
  const total = Math.max(0, Number(count) || 0);
  return [5, 4, 3, 2, 1].map((stars) => {
    const n = Number(distribution?.[stars]) || 0;
    return { stars, count: n, percent: total ? Math.round((n / total) * 100) : 0 };
  });
}
