// Item pedido: "sistema... você pode escolher as cores de tudo" —
// conta-gotas de verdade (pega qualquer cor da TELA, não só de dentro
// do app), usando a API nativa EyeDropper do navegador.
//
// Suporte real (confirmado via pesquisa): só Chrome/Edge desktop
// (versão 96+). Firefox, Safari e QUALQUER navegador mobile (incluindo
// Chrome Android) não suportam — nem o WebView do app Android
// (Capacitor) tem essa API. isEyeDropperSupported() detecta isso, pra
// quem chama esconder o botão inteiro quando não funciona, em vez de
// mostrar um botão que dá erro ao clicar.
export function isEyeDropperSupported() {
  return typeof window !== 'undefined' && 'EyeDropper' in window;
}

// Devolve a cor escolhida (formato "#rrggbb") ou null se a pessoa
// cancelou (tecla Esc, por exemplo) — nunca lança erro pro chamador
// nesse caso, só nos outros (navegador sem suporte, etc), que já não
// deveria acontecer se isEyeDropperSupported() for checado antes.
export async function pickColorFromScreen() {
  const eyeDropper = new window.EyeDropper();
  try {
    const result = await eyeDropper.open();
    return result.sRGBHex;
  } catch (err) {
    if (err?.name === 'AbortError') return null; // cancelado, não é erro de verdade
    throw err;
  }
}
