import { useEffect, useState } from 'react';
import { getOAuthProviders, oauthStartUrl } from '../../api/endpoints';

// Logos desenhados à mão, monocromáticos (herdam a cor do texto).
export function GoogleMark(props) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" {...props}>
      <path d="M17.7 6.4A8 8 0 1 0 20 12h-7.4" fill="none" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
export function DiscordMark(props) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" {...props}>
      <path
        fillRule="evenodd" fill="currentColor"
        d="M5 7.4C7 6 9 5.4 9.6 5.4l.5 1.1a13 13 0 0 1 3.8 0l.5-1.1c.6 0 2.6.6 4.6 2 1.6 2.5 2.4 5.6 2.1 9.1-1.5 1.2-3 1.9-4.5 2.3l-.9-1.5c.6-.2 1.1-.5 1.6-.8-3.5 1.5-7.1 1.5-10.6 0 .5.3 1 .6 1.6.8l-.9 1.5c-1.5-.4-3-1.1-4.5-2.3C2.6 13 3.4 9.9 5 7.4Zm2.7 5.6a1.5 1.7 0 1 0 3 0 1.5 1.7 0 1 0-3 0Zm5.6 0a1.5 1.7 0 1 0 3 0 1.5 1.7 0 1 0-3 0Z"
      />
    </svg>
  );
}
export function GitHubMark(props) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" {...props}>
      <path
        fillRule="evenodd" fill="currentColor"
        d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm-4 7.1.6-2.8 2 1.4a5 5 0 0 1 2.8 0l2-1.4.6 2.8c.8.9 1.1 2 1 3.3-.3 2.4-1.8 3.5-3.4 3.8v3.4h-3.2v-3.4c-1.6-.3-3.1-1.4-3.4-3.8-.1-1.3.2-2.4 1-3.3Z"
      />
    </svg>
  );
}

export const PROVIDER_META = {
  google: { label: 'Google', Mark: GoogleMark },
  discord: { label: 'Discord', Mark: DiscordMark },
  github: { label: 'GitHub', Mark: GitHubMark },
};

// App desktop (Electron): o Google bloqueia login em navegadores
// embutidos ("disallowed_useragent"), então o botão dele some lá —
// Discord e GitHub funcionam dentro da própria janela (ver docs/oauth.md).
export const isDesktopApp = () => typeof window !== 'undefined'
  && (/project-club-desktop/i.test(navigator.userAgent || '') || !!window.electronAPI);
// App Android (Capacitor): links pra fora do site abrem no navegador do
// sistema, e a sessão ficaria lá, não no app — por isso nada de OAuth nele.
export const isAndroidApp = () => typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();

export function usableProviders(list) {
  if (isAndroidApp()) return [];
  return (list || []).filter((p) => PROVIDER_META[p.id] && !(p.id === 'google' && isDesktopApp()));
}

let providersPromise = null;
export function loadOAuthProviders() {
  if (!providersPromise) {
    providersPromise = getOAuthProviders()
      .then((d) => d.providers || [])
      .catch(() => { providersPromise = null; return []; });
  }
  return providersPromise;
}

// Botões "Entrar com …" / "Inscrever-se com …". Some sozinho quando
// nenhum provedor está configurado no servidor.
// compact: botões lado a lado só com o nome do provedor (o rótulo
// completo continua no aria-label) e uma linha "verbo" em cima.
export default function OAuthButtons({ from = 'login', verb = 'Entrar com', disabled = false, position = 'top', compact = false }) {
  const [providers, setProviders] = useState([]);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let alive = true;
    loadOAuthProviders().then((list) => { if (alive) setProviders(usableProviders(list)); });
    // Voltar pelo botão "voltar" do navegador (bfcache) não pode deixar o
    // botão preso em "carregando".
    const onShow = () => setBusy(null);
    window.addEventListener('pageshow', onShow);
    return () => { alive = false; window.removeEventListener('pageshow', onShow); };
  }, []);

  if (!providers.length) return null;

  const go = (id) => {
    if (busy) return;
    setBusy(id);
    window.location.assign(oauthStartUrl(id, from));
  };

  return (
    <div className={`pc-oauth pc-oauth-${position}${compact ? ' pc-oauth-compact' : ''}`}>
      {position === 'bottom' && <div className="pc-oauth-divider" role="separator"><span>ou</span></div>}
      {compact && <p className="pc-oauth-lead">{verb}…</p>}
      <div className={`pc-oauth-list pc-oauth-n${providers.length}`}>
        {providers.map((p) => {
          const { label, Mark } = PROVIDER_META[p.id];
          const isBusy = busy === p.id;
          return (
            <button
              key={p.id} type="button" className={`pc-btn pc-oauth-btn pc-oauth-${p.id}`}
              onClick={() => go(p.id)} disabled={disabled || (!!busy && !isBusy)} aria-busy={isBusy || undefined}
              data-provider={p.id} aria-label={compact ? `${verb} ${label}` : undefined}
            >
              {isBusy ? <span className="pc-spinner" aria-hidden="true" /> : <Mark />}
              <span>{isBusy ? `Abrindo ${label}…` : compact ? label : `${verb} ${label}`}</span>
            </button>
          );
        })}
      </div>
      {position === 'top' && <div className="pc-oauth-divider" role="separator"><span>ou com e-mail</span></div>}
    </div>
  );
}

// Mensagens de ?oauth_error= (ver oauthController.callback).
export function oauthErrorMessage(code, provider) {
  const name = PROVIDER_META[provider]?.label || 'o provedor';
  switch (code) {
    case 'cancelado': return `Login com ${name} cancelado.`;
    case 'estado': return 'A tentativa de login expirou ou veio de outra aba. Tente de novo.';
    case 'falha': return `Não foi possível falar com ${name} agora. Tente de novo em instantes.`;
    case 'indisponivel': return `Entrar com ${name} não está disponível no momento.`;
    case 'banida': return 'Esta conta foi banida da plataforma.';
    case 'suspensa': return 'Esta conta está suspensa no momento.';
    case 'desativada': return 'Esta conta foi desativada. Fale com a equipe do Project Club para reativá-la.';
    case 'email_existente':
      return `Já existe uma conta do Project Club com o e-mail da sua conta ${name}. Entre com sua senha e conecte ${name} em Configurações → Segurança → Contas conectadas.`;
    case 'inscricao_pendente': return `Você já enviou uma inscrição com essa conta ${name}. Aguarde a análise da equipe — o resultado chega por e-mail.`;
    case 'ja-vinculada': return `Essa conta ${name} já está conectada a outro membro do Project Club.`;
    case 'provedor-ja-vinculado': return `Sua conta já tem uma conta ${name} conectada. Desconecte a atual antes de conectar outra.`;
    case 'conta': return 'Sua sessão expirou. Entre de novo e tente conectar outra vez.';
    default: return code ? `Não foi possível entrar com ${name}. Tente de novo.` : '';
  }
}
