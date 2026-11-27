// Aviso de segurança no console do navegador.
//
// Golpe comum: alguém convence a pessoa a abrir o console (F12) e colar um
// código "pra ganhar moedas / liberar um recurso". Esse código roda com a
// sessão dela e pode roubar a conta. O aviso aparece ao abrir a página e de
// novo a cada 5 segundos, pra estar sempre à vista de quem abrir o console.
//
// Um intervalo só por página: o início fica guardado em `window`, então
// chamar de novo (troca de rota, recarga a quente no desenvolvimento) não
// cria outro. Trocar de página dentro do site não recarrega este arquivo.

const KEY = '__pcConsoleWarning';
export const CONSOLE_WARNING_INTERVAL_MS = 5000;
export const CONSOLE_WARNING_TITLE = 'NÃO COLE NADA AQUI!';
export const CONSOLE_WARNING_TEXT = 'Colar códigos desconhecidos no console pode comprometer sua conta, seus dados e sua segurança. '
  + 'A execução de scripts maliciosos pode resultar em medidas de segurança, incluindo banimento por IP ou e-mail.';

// Cores próprias (texto + fundo) pra ler bem no console claro e no escuro.
const TITLE_STYLE = [
  'color:#ff1a1a', 'font-size:56px', 'font-weight:900', 'line-height:1.15',
  'font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif',
  'text-shadow:0 0 1px #000,2px 2px 0 #000', 'padding:6px 0',
].join(';');
const TEXT_STYLE = [
  'color:#fff', 'background:#1a1a1a', 'font-size:15px', 'font-weight:600', 'line-height:1.5',
  'font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif',
  'padding:8px 12px', 'border-left:5px solid #ff1a1a', 'border-radius:4px',
].join(';');

function print(out) {
  try {
    out.log(`%c${CONSOLE_WARNING_TITLE}`, TITLE_STYLE);
    out.log(`%c${CONSOLE_WARNING_TEXT}`, TEXT_STYLE);
  } catch { /* console indisponível: o aviso é só um extra */ }
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
  print(out);
  const timer = win.setInterval(() => print(out), intervalMs);
  const stop = () => {
    win.clearInterval(timer);
    if (win[KEY] && win[KEY].timer === timer) delete win[KEY];
  };
  Object.defineProperty(win, KEY, { value: { timer, stop }, configurable: true, enumerable: false, writable: false });
  return stop;
}
