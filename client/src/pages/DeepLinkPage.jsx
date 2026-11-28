import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { getModpack } from '../api/endpoints';
import { requestOpenModpack } from './mods/modpackShared.js';
import { findMemberUser } from '../utils/prettyPaths';
import { resolveLinkRemote } from '../utils/prettyLinks';
import '../styles/socialx.css';

// O app fecha o perfil a cada troca de rota (MainApp.jsx). Depois do "voltar"
// ainda pode vir um redirecionamento (/ → canal inicial); em aparelho lento
// ele chegava depois de o perfil abrir (antes: espera fixa de 200 ms) e
// fechava o perfil na cara da pessoa. Agora espera a rota parar de mudar e,
// se mesmo assim uma troca de rota fechar o perfil logo em seguida, abre de
// novo (uma vez só).
function openProfileWhenSettled(id, linkPath) {
  const started = Date.now();
  let last = window.location.pathname;
  let since = started;
  const timer = setInterval(() => {
    const now = window.location.pathname;
    if (now !== last) { last = now; since = Date.now(); return; }
    const passing = now === linkPath || now === '/'; // ainda de passagem
    if ((passing || Date.now() - since < 250) && Date.now() - started < 4000) return;
    clearInterval(timer);
    useStore.getState().openProfile(id);
    let reopened = false;
    const stop = useStore.subscribe((st) => {
      if (reopened || st.viewingProfileUserId || window.location.pathname === now) return;
      reopened = true;
      setTimeout(() => useStore.getState().openProfile(id), 60);
    });
    setTimeout(stop, 2500);
  }, 80);
}

// Endereços curtos compartilháveis (/perfil/<@> — antigo /u/<id> —,
// /modpack/<id>, /mod/<jogo>/<mod>, /eventos/<id>) — só redirecionam pro
// lugar certo do app.
export default function DeepLinkPage({ kind }) {
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const back = () => {
      if (location.key !== 'default') navigate(-1);
      else navigate('/', { replace: true });
    };
    if (kind === 'user') {
      // O app fecha o perfil quando a rota muda — então volta primeiro e
      // abre o perfil logo depois. /perfil/<@usuário> (ou o id antigo).
      const ref = params.id;
      const open = (id) => { if (!alive) return; back(); openProfileWhenSettled(id, location.pathname); };
      const local = findMemberUser(useStore.getState(), ref);
      if (local) open(local.id);
      else resolveLinkRemote(location.pathname).then((link) => open(link?.kind === 'user' ? link.id : ref));
    } else if (kind === 'event') {
      // Endereço antigo (/eventos/<id>) → /evento/<id>, que troca pelo nome.
      navigate(`/evento/${encodeURIComponent(params.id)}${location.search}`, { replace: true });
    } else if (kind === 'mod') {
      navigate('/jogos/mods', { replace: true });
    } else if (kind === 'modpack') {
      getModpack(params.id)
        .then(({ modpack }) => {
          if (!alive) return;
          requestOpenModpack(modpack.steamAppId, modpack.id);
          navigate('/jogos/mods', { replace: true });
        })
        .catch(() => { if (alive) setError('Esse modpack não existe mais ou é privado.'); });
    }
    return () => { alive = false; };
  }, [kind, params.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="sx-deeplink">
      {error ? (
        <div className="sx-empty">
          <span className="sx-empty-icon" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
          </span>
          <h3>Link indisponível</h3>
          <p>{error}</p>
          <button type="button" className="sx-btn primary" onClick={() => navigate('/jogos/mods', { replace: true })}>Ir para os mods</button>
        </div>
      ) : (
        <div className="sx-deeplink-spin" aria-label="Abrindo..." />
      )}
    </div>
  );
}
