import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { RECAPTCHA_SITE_KEY, RECAPTCHA_TIMEOUT_SENTINEL, loadRecaptchaScript } from '../utils/recaptcha';

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
// como tentar de novo.
//
// Item pedido: "mesmo que tenha uma key, se não carregou depois de 3
// segundos, deixa se inscrever sem precisar da verificação" — em vez
// de só mostrar "tentar de novo" e esperar a pessoa clicar, agora
// libera automaticamente depois de 3s sem confirmação de carregamento
// (manda RECAPTCHA_TIMEOUT_SENTINEL pro onChange — o backend reconhece
// esse valor específico e aceita como "verificação indisponível",
// sem contar como um token de verdade). É uma escolha deliberada de
// confiabilidade sobre rigor aqui: perder cadastros legítimos por
// causa de rede instável/script bloqueado é pior do que, raramente,
// deixar passar sem verificação quando isso acontece.
const RECAPTCHA_TIMEOUT_MS = 3000;

const Recaptcha = forwardRef(function Recaptcha({ onChange }, ref) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const [, setReady] = useState(false);
  // "unavailable" cobre TANTO o script falhando explicitamente QUANTO
  // simplesmente não confirmar carregamento a tempo (3s) — nos dois
  // casos o resultado é o mesmo (deixa prosseguir sem verificação),
  // então tratar como um único estado evita a mensagem mudar sozinha
  // de "tentar de novo" pra "prossiga sem verificação" no meio do
  // caminho, o que ficaria estranho pra quem está olhando a tela.
  const [unavailable, setUnavailable] = useState(false);

  useImperativeHandle(ref, () => ({
    reset() {
      if (widgetIdRef.current !== null) window.grecaptcha?.reset(widgetIdRef.current);
    },
  }));

  useEffect(() => {
    if (!RECAPTCHA_SITE_KEY) return undefined;
    let cancelled = false;
    let settled = false; // widget carregou OU já demos como indisponível — nenhum dos dois muda de novo
    setUnavailable(false);

    const markUnavailable = () => {
      if (cancelled || settled) return;
      settled = true;
      setUnavailable(true);
      onChange(RECAPTCHA_TIMEOUT_SENTINEL);
    };
    const timeoutId = setTimeout(markUnavailable, RECAPTCHA_TIMEOUT_MS);

    loadRecaptchaScript().then((loaded) => {
      if (cancelled || settled) return;
      if (!loaded) { markUnavailable(); return; }
      if (!containerRef.current || widgetIdRef.current !== null) return;
      widgetIdRef.current = window.grecaptcha.render(containerRef.current, {
        sitekey: RECAPTCHA_SITE_KEY,
        callback: (token) => onChange(token),
        'expired-callback': () => onChange(null),
        'error-callback': () => onChange(null),
      });
      settled = true;
      clearTimeout(timeoutId);
      setReady(true);
    });
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [onChange]);

  if (!RECAPTCHA_SITE_KEY) return null;
  if (unavailable) {
    return (
      <div className="recaptcha-widget-wrap recaptcha-failed">
        <p className="dim">A verificação não respondeu a tempo — você já pode prosseguir sem ela.</p>
      </div>
    );
  }
  return <div className="recaptcha-widget-wrap"><div ref={containerRef} /></div>;
});

export default Recaptcha;
