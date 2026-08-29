// reCAPTCHA v2 (checkbox challenge) — see components/Recaptcha.jsx for the
// actual widget. This file just knows how to load Google's script once
// (lazily, only if a site key is configured — see client/.env.example) and
// exposes the site key itself.
export const RECAPTCHA_SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY || '';

let scriptPromise = null;

// `render=explicit` (instead of v3's `render=SITEKEY`) is what lets
// multiple/any-time-later calls to `grecaptcha.render(...)` actually work —
// v3's own loading style auto-renders on `data-sitekey` divs it finds at
// load time, which doesn't fit a React component mounting/unmounting the
// widget's container on its own schedule.
export function loadRecaptchaScript() {
  if (!RECAPTCHA_SITE_KEY) return Promise.resolve(false);
  if (window.grecaptcha?.render) return Promise.resolve(true);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve) => {
    window.__onRecaptchaLoad = () => resolve(true);
    const script = document.createElement('script');
    // BUG CORRIGIDO ("hash do CSP muda toda hora"): sem "hl=" fixo, o
    // Google detecta o idioma do NAVEGADOR de cada visitante e serve um
    // pacote de script DIFERENTE por idioma — cada um com um conteúdo
    // inline (e portanto um hash SHA-256) diferente, então o hash que
    // funcionava pra um visitante bloqueava outro com o navegador em
    // outro idioma. Fixando "hl=pt-BR" (o idioma real do site), todo
    // visitante recebe sempre o MESMO pacote — hash sempre igual, sem
    // precisar caçar hash novo a cada relatório de bloqueio.
    script.src = 'https://www.google.com/recaptcha/api.js?onload=__onRecaptchaLoad&render=explicit&hl=pt-BR';
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      // eslint-disable-next-line no-console
      console.warn('[recaptcha] O script do Google não carregou (bloqueado pelo navegador/rede, ou CSP). Login/registro vão seguir sem verificação.');
      resolve(false);
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}
