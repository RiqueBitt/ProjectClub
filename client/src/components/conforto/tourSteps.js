// Passos do tour de boas-vindas. `target` = lista de seletores (o primeiro
// visível na tela vence); sem alvo visível (ex.: celular com a gaveta
// fechada) o passo aparece centralizado, sem destaque.
export const TOUR_STEPS = [
  {
    id: 'welcome',
    title: 'Boas-vindas ao Project Club!',
    body: 'Em menos de um minuto, um passeio rápido pelas partes principais. Dá pra pular quando quiser e rever depois em Configurações → Sistema.',
    target: [],
  },
  {
    id: 'sidebar',
    title: 'Menu principal',
    body: 'Daqui você vai para Início, Feeds, Amigos e mensagens, Economia, Progresso e Suporte.',
    target: ['.n2-nav-list', '.main-sidebar-nav', '.main-sidebar'],
  },
  {
    id: 'channels',
    title: 'Canais da comunidade',
    body: 'Os canais de texto ficam organizados em categorias. Os que têm novidade aparecem em destaque.',
    target: ['.sidebar-list', '.sidebar'],
  },
  {
    id: 'voice',
    title: 'Canais de voz',
    body: 'Clique em um canal de voz para entrar na call. Você vê quem está falando e pode compartilhar a tela.',
    target: ['.channel-item[data-channel-type="VOICE"]', '.channel-item[data-channel-type="STAGE"]', '.sidebar-list'],
  },
  {
    id: 'profile',
    title: 'Você',
    body: 'Sua foto e seu status. Clique para mudar o status, ver seu perfil e sua carteira. Ao lado: microfone, fone e configurações.',
    target: ['.user-status-bar', '.mobile-tab-bar'],
  },
  {
    id: 'shop',
    title: 'Moedas, Loja e missões',
    body: 'Ganhe moedas com missões e com os Primeiros passos, e troque na Loja por molduras, efeitos e temas de perfil.',
    target: ['a[href="/economia"]', 'a[href="/loja"]'],
  },
  {
    id: 'settings',
    title: 'Configurações',
    body: 'Tema, notificações, voz e acessibilidade. Dica: aperte Ctrl + / a qualquer momento para ver os atalhos de teclado.',
    target: ['.usb-btn[aria-label="Configurações"]', '.top-search-bar-icon-btn[aria-label="Configurações"]', '.top-search-bar-icon-btn[title="Configurações"]'],
  },
];

// Posição do balão ao lado do alvo, sempre dentro da tela.
// rect/pop/viewport: { top, left, width, height } / { width, height } / { width, height }.
export function placePopover(rect, pop, viewport, gap = 14, margin = 12) {
  const vw = viewport.width;
  const vh = viewport.height;
  const clampX = (x) => Math.max(margin, Math.min(x, vw - pop.width - margin));
  const clampY = (y) => Math.max(margin, Math.min(y, vh - pop.height - margin));
  if (!rect) return { top: clampY((vh - pop.height) / 2), left: clampX((vw - pop.width) / 2), side: 'center' };
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  const fits = {
    right: vw - right - gap >= pop.width + margin,
    left: rect.left - gap >= pop.width + margin,
    bottom: vh - bottom - gap >= pop.height + margin,
    top: rect.top - gap >= pop.height + margin,
  };
  const midY = rect.top + rect.height / 2 - pop.height / 2;
  const midX = rect.left + rect.width / 2 - pop.width / 2;
  if (fits.right) return { top: clampY(midY), left: right + gap, side: 'right' };
  if (fits.bottom) return { top: bottom + gap, left: clampX(midX), side: 'bottom' };
  if (fits.left) return { top: clampY(midY), left: rect.left - gap - pop.width, side: 'left' };
  if (fits.top) return { top: rect.top - gap - pop.height, left: clampX(midX), side: 'top' };
  return { top: clampY(vh - pop.height - margin), left: clampX(midX), side: 'over' };
}
