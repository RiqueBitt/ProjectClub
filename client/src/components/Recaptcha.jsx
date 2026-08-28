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
const Recaptcha = forwardRef(function Recaptcha({ onChange }, ref) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const [, setReady] = useState(false);

  useImperativeHandle(ref, () => ({
    reset() {
      if (widgetIdRef.current !== null) window.grecaptcha?.reset(widgetIdRef.current);
    },
  }));

  useEffect(() => {
    if (!RECAPTCHA_SITE_KEY) return undefined;
    let cancelled = false;
    loadRecaptchaScript().then((loaded) => {
      if (cancelled || !loaded || !containerRef.current || widgetIdRef.current !== null) return;
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
  }, []);

  if (!RECAPTCHA_SITE_KEY) return null;
  return <div className="recaptcha-widget-wrap"><div ref={containerRef} /></div>;
});

export default Recaptcha;
