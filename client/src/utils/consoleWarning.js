// Aviso de segurança no console do navegador.
//
// Golpe comum: alguém convence a pessoa a abrir o console (F12) e colar um
// código "pra ganhar moedas / liberar um recurso". Esse código roda com a
// sessão dela e pode roubar a conta.
//
// Como aparece (visual Clássico do Project Club: cartões grafite de canto
// arredondado, azul da marca, vermelho de alerta e amarelo de aviso):
// - ao abrir a página: o aviso completo, num bloco só (selo do Project Club,
//   "PARE!" gigante, o que pode acontecer, o aviso de golpe e o que fazer);
// - a cada 5 s: só um lembrete curto (uma linha), pra continuar à vista no
//   fim do console sem encher a tela com o aviso inteiro;
// - com a aba escondida (outra aba aberta) o lembrete não é escrito.
//
// Cada navegador desenha o texto estilizado do console (%c) de um jeito:
// - o Chrome transforma cada trecho numa caixinha e só aceita as propriedades
//   background, border, color, font, line-height, margin, padding e text-*;
// - o Firefox deixa o trecho "em linha": com padding e texto em mais de uma
//   linha, o fundo de uma linha cobria a de cima e o texto saía CORTADO. Por
//   isso todo trecho leva `display:inline-block`, que o Firefox aceita (o
//   Chrome ignora, porque já faz isso sozinho).
// Um trecho sem estilo com uma quebra de linha (`%c\n`) separa os blocos nos
// dois. Pra conferir de verdade: abrir o console no Chrome E no Firefox, com
// a janela larga e estreita, nos temas claro e escuro.
//
// Um intervalo só por página: o início fica guardado em `window`, então
// chamar de novo (troca de rota, recarga a quente no desenvolvimento) não
// cria outro. Trocar de página dentro do site não recarrega este arquivo.

const KEY = '__pcConsoleWarning';
export const CONSOLE_WARNING_INTERVAL_MS = 5000;
export const CONSOLE_WARNING_TITLE = 'PARE! NÃO COLE NADA AQUI!';
export const CONSOLE_WARNING_TEXT = 'Colar códigos desconhecidos no console pode comprometer sua conta, seus dados e sua segurança. '
  + 'A execução de scripts maliciosos pode resultar em medidas de segurança, incluindo banimento por IP ou e-mail.';
export const CONSOLE_WARNING_SCAM = 'Alguém pediu pra você colar algo aqui pra ganhar moedas, gemas, itens ou "liberar" alguma coisa? É golpe. Sempre.';
export const CONSOLE_WARNING_REMINDER = 'Este espaço é para desenvolvedores. Se você não sabe o que está fazendo, feche esta janela (F12).';
export const CONSOLE_WARNING_REPO = 'https://github.com/RiqueBitt/ProjectClub';
// Lembrete dos 5 s: curto, pra caber numa linha mesmo com o console estreito.
export const CONSOLE_WARNING_SHORT = 'Pediram pra você colar algo aqui? É golpe. Feche esta janela (F12).';

const FONT = 'font-family:Roboto,"Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif';
const block = (...parts) => ['display:inline-block', ...parts, FONT].join(';');
const BREAK = ''; // estilo vazio: o trecho seguinte ("\n") vira só uma quebra de linha

// Selo "PROJECT CLUB | Aviso de segurança": pílula em duas metades.
const BADGE_STYLE = block('color:#FFFFFF', 'background:#4C9FFF', 'font-size:11px', 'font-weight:800', 'line-height:16px', 'padding:4px 9px 4px 12px', 'border-radius:999px 0 0 999px', 'margin:6px 0 0 0');
const BADGE_TAIL_STYLE = block('color:#DBDEE1', 'background:#2B2D31', 'font-size:11px', 'font-weight:600', 'line-height:16px', 'padding:4px 12px 4px 9px', 'border-radius:0 999px 999px 0', 'margin:6px 0 0 0');
// Título: vermelho de alerta do app, com sombra dura (cara de adesivo) pra
// ler no console claro e no escuro. O padding guarda espaço pra sombra e
// pro til do "NÃO", que o Firefox cortaria na borda da caixinha.
const TITLE_STYLE = block(
  'color:#F23F43', 'font-size:46px', 'font-weight:900', 'line-height:1.12',
  'text-shadow:2px 2px 0 #1E1F22,5px 5px 0 rgba(242,63,67,.28)', 'padding:10px 8px 10px 0', 'margin:2px 0 0 0',
);
// Cartão grafite com a faixa vermelha à esquerda (o que pode acontecer).
const TEXT_STYLE = block(
  'color:#DBDEE1', 'background:#2B2D31', 'font-size:14px', 'font-weight:500', 'line-height:1.6',
  'padding:12px 16px', 'border-left:4px solid #F23F43', 'border-radius:10px', 'margin:0 0 8px 0',
);
// Aviso de golpe: amarelo de alerta do app.
const SCAM_STYLE = block(
  'color:#1E1F22', 'background:#F0B232', 'font-size:13px', 'font-weight:800', 'line-height:1.55',
  'padding:9px 16px', 'border-radius:10px', 'margin:0 0 8px 0',
);
// Rodapé: cinza que dá pra ler no console claro e no escuro.
const TIP_STYLE = block('color:#80848E', 'font-size:12px', 'font-weight:500', 'line-height:1.6', 'padding:0 2px', 'margin:0 0 6px 0');
// Lembrete dos 5 s: pílula vermelha com o título e, do lado, a dica curta
// (sem fundo: se o console for estreito ela só passa pra linha de baixo).
const REMINDER_TITLE_STYLE = block('color:#FFFFFF', 'background:#DA373C', 'font-size:12px', 'font-weight:800', 'line-height:16px', 'padding:4px 12px', 'border-radius:999px', 'margin:2px 8px 2px 0');
const REMINDER_TEXT_STYLE = block('color:#80848E', 'font-size:12px', 'font-weight:600', 'line-height:16px', 'padding:4px 0', 'margin:2px 0');

function printFull(out) {
  try {
    out.log(
      [
        '%c PROJECT CLUB %c Aviso de segurança ',
        `%c${CONSOLE_WARNING_TITLE}`,
        `%c${CONSOLE_WARNING_TEXT}`,
        `%c⚠ ${CONSOLE_WARNING_SCAM}`,
        `%c${CONSOLE_WARNING_REMINDER} Quer programar com a gente? ${CONSOLE_WARNING_REPO}`,
      ].join('%c\n'),
      BADGE_STYLE, BADGE_TAIL_STYLE, BREAK,
      TITLE_STYLE, BREAK,
      TEXT_STYLE, BREAK,
      SCAM_STYLE, BREAK,
      TIP_STYLE,
    );
  } catch { /* console indisponível: o aviso é só um extra */ }
}

function printReminder(out) {
  try {
    out.log(`%c${CONSOLE_WARNING_TITLE}%c${CONSOLE_WARNING_SHORT}`, REMINDER_TITLE_STYLE, REMINDER_TEXT_STYLE);
  } catch { /* idem */ }
}

// Dentro do app Android (WebView) não existe console pra pessoa abrir, e
// cada linha iria pro log do aparelho.
function isAndroidWebView(win) {
  return /; wv\)/.test(win?.navigator?.userAgent || '');
}

/**
 * Liga o aviso (uma vez por página). Devolve a função que desliga.
 * `win` e `out` existem pra dar pra testar sem navegador.
 */
export function startConsoleWarning({ win = typeof window !== 'undefined' ? window : null, out = console, intervalMs = CONSOLE_WARNING_INTERVAL_MS } = {}) {
  if (!win || isAndroidWebView(win)) return () => {};
  if (win[KEY]) return win[KEY].stop; // já ligado: não cria outro intervalo
  printFull(out);
  const timer = win.setInterval(() => {
    if (win.document?.hidden) return; // aba escondida: ninguém está olhando
    printReminder(out);
  }, intervalMs);
  const stop = () => {
    win.clearInterval(timer);
    if (win[KEY] && win[KEY].timer === timer) delete win[KEY];
  };
  Object.defineProperty(win, KEY, { value: { timer, stop }, configurable: true, enumerable: false, writable: false });
  return stop;
}
