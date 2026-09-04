// Item pedido: "GIFa Move" — a staff pode definir uma posição/tamanho
// FIXOS pro menu de GIFs (Painel da Staff -> GIFa Move), independente
// pra desktop e mobile. Essa função decide, na hora de abrir o menu,
// se usa essa config customizada ou o cálculo automático que já
// existia (perto do botão que abriu). Não é usada no MOBILE por
// enquanto — lá o layout é resolvido via CSS (bottom sheet + variável
// --composer-height), não por esse cálculo de pixel exato; ver
// resolveMobileGifMenuStyle abaixo.
//
// Os valores salvos são em PORCENTAGEM da tela (0-100), não pixels —
// convertidos aqui pra pixels reais usando o tamanho da JANELA de
// quem está vendo (garante que a posição escolhida pela staff numa
// tela fica proporcionalmente igual em qualquer resolução real, não
// só na exata tela onde foi configurada).
export function hasCustomGifMenuLayout(layout) {
  return !!layout && typeof layout.left === 'number' && typeof layout.width === 'number';
}

export function resolveDesktopGifMenuStyle(gifMenuLayout) {
  if (!hasCustomGifMenuLayout(gifMenuLayout)) return null; // sinal pro caller usar o cálculo automático de sempre
  const left = (gifMenuLayout.left / 100) * window.innerWidth;
  const top = (gifMenuLayout.top / 100) * window.innerHeight;
  const width = (gifMenuLayout.width / 100) * window.innerWidth;
  const height = (gifMenuLayout.height / 100) * window.innerHeight;
  return {
    position: 'fixed', left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto', transform: 'none',
    width: `${width}px`, maxWidth: `${width}px`, height: `${height}px`, maxHeight: `${height}px`,
  };
}

// Mesma ideia, pro mobile — o comportamento PADRÃO no mobile é um
// "bottom sheet" controlado inteiramente por CSS (bottom/height via
// variáveis --composer-height/--sheet-height, sempre 100% de largura
// — ver a media query max-width:600px em global.css). Uma config
// customizada aqui sobrescreve isso via style inline (que tem
// prioridade sobre qualquer CSS de classe), virando um popover de
// posição/tamanho livres em vez do sheet de largura total.
export function resolveMobileGifMenuStyle(gifMenuLayout) {
  if (!hasCustomGifMenuLayout(gifMenuLayout)) return null;
  const left = (gifMenuLayout.left / 100) * window.innerWidth;
  const top = (gifMenuLayout.top / 100) * window.innerHeight;
  const width = (gifMenuLayout.width / 100) * window.innerWidth;
  const height = (gifMenuLayout.height / 100) * window.innerHeight;
  return {
    position: 'fixed', left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto', transform: 'none',
    width: `${width}px`, maxWidth: `${width}px`, height: `${height}px`, maxHeight: `${height}px`,
    borderRadius: '10px', // o sheet padrão só arredonda o topo (bottom:0 encosta na borda) — livre no meio da tela, arredonda tudo
  };
}
