import { registerPlugin } from '@capacitor/core';

// Ponte com o plugin nativo Android (ver client/android/app/src/main/
// java/com/projectclub/app/ScreenSharePlugin.java + ScreenCaptureService.
// java) — ele entrega os pixels da tela como imagens JPEG (uma a cada
// intervalo curto), não um vídeo pronto. Esse arquivo é quem transforma
// essas imagens numa faixa de vídeo de verdade: desenha cada uma num
// <canvas> oculto e usa canvas.captureStream() — uma função padrão do
// navegador, documentada oficialmente pelo Agora como jeito válido de
// alimentar uma chamada com uma fonte de vídeo customizada (ver
// AgoraRTC.createCustomVideoTrack em VoiceContext.jsx).
const ScreenShare = registerPlugin('ScreenShare');

let canvas = null;
let ctx = null;
let frameListenerHandle = null;

function ensureCanvas(width, height) {
  if (!canvas) {
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d');
  }
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return canvas;
}

// Item pedido: "o jeito mais fácil de fazer o celular compartilhar a
// tela" — pede a permissão do sistema (mostra o aviso nativo do
// Android), e se concedida, começa a receber frames e desenhá-los no
// canvas continuamente. Devolve a MediaStreamTrack pronta pra publicar
// no Agora, ou null se a pessoa negou a permissão.
//
// Item pedido depois: "faça se possível como o Stoat ou o Discord" —
// os padrões de fps/qualidade abaixo batem com os do lado nativo
// (ScreenCaptureService.java), pesquisados a partir de como Agora/
// Discord/Stoat costumam configurar compartilhamento de tela mobile
// (~720p, entre 12-15fps é um bom equilíbrio pra essa arquitetura
// específica).
export async function startAndroidScreenShare({ fps = 12, quality = 65 } = {}) {
  const { granted } = await ScreenShare.requestPermission();
  if (!granted) return null;

  // Tamanho inicial só pra não começar com um canvas de 0x0 — ajustado
  // de verdade assim que o primeiro frame de verdade chegar (ver
  // abaixo), caso a resolução real da tela seja diferente disso.
  ensureCanvas(window.screen.width || 1080, window.screen.height || 2400);

  frameListenerHandle = await ScreenShare.addListener('frame', ({ data }) => {
    const img = new Image();
    img.onload = () => {
      if (canvas.width !== img.width || canvas.height !== img.height) {
        ensureCanvas(img.width, img.height);
      }
      ctx.drawImage(img, 0, 0);
    };
    img.src = `data:image/jpeg;base64,${data}`;
  });

  await ScreenShare.startCapture({ fps, quality });

  const stream = canvas.captureStream(fps);
  const track = stream.getVideoTracks()[0];
  return track;
}

export async function stopAndroidScreenShare() {
  try {
    await ScreenShare.stopCapture();
  } catch { /* já pode ter parado sozinho, sem problema */ }
  if (frameListenerHandle) {
    frameListenerHandle.remove();
    frameListenerHandle = null;
  }
}
