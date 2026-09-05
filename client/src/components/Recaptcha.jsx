import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { RECAPTCHA_SITE_KEY, loadRecaptchaScript } from '../utils/recaptcha';

// The actual "Nao sou um robo" checkbox, shown on the login and register
// forms. Renders nothing at all if VITE_RECAPTCHA_SITE_KEY isn't set (see
// client/.env.example) - reCAPTCHA stays fully opt-in, same as the server
// side skipping verification with no secret key configured.
//
// Exposes a reset() method via ref - call it after a failed submit so the
// checkbox doesn't stay in an already-used, no-longer-valid state for a
// retry (Google's own widgets need an explicit reset, they don't do this
// on their own).
//
// BUG CORRIGIDO ("painel de cadastro não mostra a caixinha pra ver se
// você é um robô"): se a chave estivesse configurada mas o script do
// Google falhasse ao carregar (rede bloqueando, ad-blocker, instabilidade
// momentânea do próprio Google), o componente simplesmente ficava
// "mudo" — nada aparecia, nenhum erro, e como o botão "Prosseguir" do
// modal exige um token que nunca chegaria a existir, a pessoa ficava
// completamente travada no cadastro, sem entender o motivo nem ter
// como tentar de novo. Agora mostra uma mensagem clara com um botão
// "Tentar novamente" nesse caso.
const Recaptcha = forwardRef(function Recaptcha({ onChange }, ref) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const [, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useImperativeHandle(ref, () => ({
    reset() {
      if (widgetIdRef.current !== null) window.grecaptcha?.reset(widgetIdRef.current);
    },
  }));

  useEffect(() => {
    if (!RECAPTCHA_SITE_KEY) return undefined;
    let cancelled = false;
    setFailed(false);
    loadRecaptchaScript().then((loaded) => {
      if (cancelled) return;
      if (!loaded) { setFailed(true); return; }
      if (!containerRef.current || widgetIdRef.current !== null) return;
      widgetIdRef.current = window.grecaptcha.render(containerRef.current, {
        sitekey: RECAPTCHA_SITE_KEY,
        callback: (token) => onChange(token),
        'expired-callback': () => onChange(null),
        'error-callback': () => onChange(null),
      });
      setReady(true);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  if (!RECAPTCHA_SITE_KEY) return null;
  if (failed) {
    return (
      <div className="recaptcha-widget-wrap recaptcha-failed">
        <p className="dim">Não foi possível carregar a verificação. Verifique sua conexão com a internet.</p>
        <button type="button" className="btn-secondary" onClick={() => { widgetIdRef.current = null; setAttempt((a) => a + 1); }}>
          Tentar novamente
        </button>
      </div>
    );
  }
  return <div className="recaptcha-widget-wrap"><div ref={containerRef} /></div>;
});

export default Recaptcha;
