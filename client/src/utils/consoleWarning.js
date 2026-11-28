// Aviso de segurança no console do navegador.
//
// Golpe comum: alguém convence a pessoa a abrir o console (F12) e colar um
// código "pra ganhar moedas / liberar um recurso". Esse código roda com a
// sessão dela e pode roubar a conta.
//
// Como aparece (visual Clássico do Project Club: grafite, azul e o vermelho
// de alerta):
// - ao abrir a página: o aviso completo, em cartão (selo do Project Club,
//   "PARE!" gigante, o que pode acontecer e o que fazer);
// - a cada 5 s: só um lembrete curto (título + uma linha), pra continuar à
//   vista no fim do console sem encher a tela com o cartão inteiro;
// - com a aba escondida (outra aba aberta) o lembrete não é escrito.
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

const FONT = 'font-family:"gg sans","Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif';
const css = (...parts) => [...parts, FONT].join(';');

// Selo "PROJECT CLUB · Aviso de segurança" (azul da marca + grafite).
const BADGE_STYLE = css('color:#fff', 'background:#4C9FFF', 'font-size:12px', 'font-weight:800', 'letter-spacing:2px', 'padding:4px 10px', 'border-radius:6px 0 0 6px');
const BADGE_TAIL_STYLE = css('color:#DBDEE1', 'background:#2B2D31', 'font-size:12px', 'font-weight:600', 'padding:4px 10px', 'border-radius:0 6px 6px 0');
// Título: vermelho de alerta do app, com contorno escuro pra ler no
// console claro e no escuro.
const TITLE_STYLE = css(
  'color:#F23F43', 'font-size:56px', 'font-weight:900', 'line-height:1.15', 'letter-spacing:-1px',
  'text-shadow:0 0 1px #000,2px 2px 0 #1E1F22,4px 4px 0 rgba(242,63,67,.25)', 'padding:6px 0',
);
const REMINDER_TITLE_STYLE = css('color:#F23F43', 'font-size:22px', 'font-weight:900', 'text-shadow:1px 1px 0 #1E1F22');
// Cartão grafite com a faixa vermelha à esquerda.
const TEXT_STYLE = css(
  'color:#F2F3F5', 'background:#2B2D31', 'font-size:15px', 'font-weight:600', 'line-height:1.6',
  'padding:10px 14px', 'border-left:5px solid #F23F43', 'border-radius:6px',
);
const SCAM_STYLE = css(
  'color:#1E1F22', 'background:#F0B232', 'font-size:14px', 'font-weight:800', 'line-height:1.6',
  'padding:8px 14px', 'border-radius:6px',
);
const TIP_STYLE = css('color:#949BA4', 'font-size:13px', 'font-weight:500', 'line-height:1.6', 'padding:2px 0');
const TIP_STRONG_STYLE = css('color:#6FB4FF', 'font-size:13px', 'font-weight:700');

function printFull(out) {
  try {
    out.log('%c PROJECT CLUB %c Aviso de segurança ', BADGE_STYLE, BADGE_TAIL_STYLE);
    out.log(`%c${CONSOLE_WARNING_TITLE}`, TITLE_STYLE);
    out.log(`%c${CONSOLE_WARNING_TEXT}`, TEXT_STYLE);
    out.log(`%c⚠ ${CONSOLE_WARNING_SCAM}`, SCAM_STYLE);
    out.log(
      `%c${CONSOLE_WARNING_REMINDER} Quer programar com a gente? %cgithub.com/RiqueBitt/ProjectClub`,
      TIP_STYLE, TIP_STRONG_STYLE,
    );
  } catch { /* console indisponível: o aviso é só um extra */ }
}

function printReminder(out) {
  try {
    out.log(`%c${CONSOLE_WARNING_TITLE}%c  ${CONSOLE_WARNING_REMINDER}`, REMINDER_TITLE_STYLE, TIP_STYLE);
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
