// Zoom da interface via CSS (`zoom` no <html>, ver global.css): posições
// medidas com getBoundingClientRect vêm em pixels da tela, mas top/left
// de um elemento fixo são multiplicados pelo zoom — divide pra compensar.
export function cssZoom() {
  if (typeof window === 'undefined') return 1;
  const z = parseFloat(getComputedStyle(document.documentElement).zoom);
  return Number.isFinite(z) && z > 0 ? z : 1;
}
