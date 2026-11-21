// Esquema de toque de cada mini-jogo (ver TouchControls.jsx):
//  left    — o que fica no canto esquerdo:
//            'dpad4' | 'dpad8' (direcional), 'joystick' (analógico flutuante),
//            'lr' (◀ ▶ juntos), 'lr-split' (◀ na borda esquerda, ▶ na direita),
//            'dance' (← ↓ na esquerda, ↑ → na direita), null (nada)
//  actions — botões redondos do canto direito: { key, label, icon }
//  repeat  — repete a tecla enquanto segura (jogos que andam 1 passo por tecla)
//  aspect  — proporção da tela do jogo (largura/altura), pra encaixar os
//            controles nas faixas pretas em volta dele
//  direct  — o próprio jogo responde ao toque (tocar/arrastar = mouse)
// Jogos só de mouse ficam com left null e sem ações: o toque vai direto no
// jogo (o Ruffle e o sbd.js convertem toque em mouse com a escala certa).

const HTML5 = 1000 / 610;
const FLASH = 760 / 480;

export const TOUCH_SCHEMES = {
  beancounters: { left: null, actions: [{ key: 'space', label: 'Soltar', icon: 'drop' }], aspect: HTML5, direct: true },
  pizzatron: { left: null, actions: [], aspect: HTML5, direct: true },
  sledracing: { left: 'lr-split', actions: [], aspect: HTML5, repeat: { delay: 240, interval: 140 } },

  thinice: { left: 'dpad4', actions: [], aspect: FLASH },
  astrobarrier: { left: 'lr', actions: [{ key: 'space', label: 'Atirar', icon: 'fire' }, { key: 'enter', label: 'OK', icon: 'ok' }], aspect: FLASH },
  cartsurfer: { left: 'dpad4', actions: [{ key: 'space', label: 'Pular', icon: 'jump' }, { key: 'enter', label: 'OK', icon: 'ok' }], aspect: FLASH },
  aquagrabber: { left: 'joystick', actions: [{ key: 'space', label: 'Garra', icon: 'grab' }, { key: 'enter', label: 'OK', icon: 'ok' }], aspect: FLASH },
  pufflesoaker: { left: 'dpad4', actions: [{ key: 'space', label: 'Atirar', icon: 'fire' }, { key: 'enter', label: 'OK', icon: 'ok' }], aspect: FLASH },
  dance: { left: 'dance', actions: [], aspect: FLASH },

  icefishing: { left: null, actions: [], aspect: FLASH, direct: true },
  catchinwaves: { left: null, actions: [], aspect: FLASH, direct: true },
  systemdefender: { left: null, actions: [], aspect: FLASH, direct: true },
  hydrohopper: { left: null, actions: [], aspect: FLASH, direct: true },
  balloonpop: { left: null, actions: [], aspect: FLASH, direct: true },
  feedapuffle: { left: null, actions: [], aspect: FLASH, direct: true },
  pufflepaddle: { left: null, actions: [], aspect: FLASH, direct: true },
  puffleroundup: { left: null, actions: [], aspect: FLASH, direct: true },
  fluffy: { left: null, actions: [], aspect: FLASH, direct: true },
};

export function touchSchemeFor(game) {
  const s = TOUCH_SCHEMES[game?.slug];
  if (s) return s;
  return { left: null, actions: [], aspect: game?.flash ? FLASH : HTML5, direct: true };
}

export const hasOnScreenControls = (scheme) => !!(scheme.left || scheme.actions?.length);
