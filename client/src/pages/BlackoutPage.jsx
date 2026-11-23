import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { openBlackoutSession } from '../api/endpoints';
import '../styles/blackout-page.css';

// Compêndio do RPG BLACKOUT dentro do Project Club. O site fica protegido
// no servidor (routes/blackoutSite.js): primeiro pede o "passe" do site
// (cookie só de /blackout), depois abre em tela cheia aqui dentro.
export default function BlackoutPage() {
  const navigate = useNavigate();
  const instance = useStore((s) => s.community?.instance) || 'publica';
  const [state, setState] = useState({ status: 'loading', error: '' });

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', error: '' });
    openBlackoutSession()
      .then(() => { if (alive) setState({ status: 'ready', error: '' }); })
      .catch((err) => { if (alive) setState({ status: 'denied', error: err.response?.data?.error || 'Não foi possível abrir o BLACKOUT.' }); });
    return () => { alive = false; };
  }, []);

  // Saiu da instância BLACKOUT: o botão some da lista; a página volta pro início.
  useEffect(() => { if (instance !== 'blackout' && state.status !== 'loading') navigate('/inicio', { replace: true }); }, [instance]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.status !== 'ready') {
    return (
      <div className="blackout-page is-msg">
        <div className="blackout-msg">
          <b>BLACKOUT</b>
          {state.status === 'loading' ? <span className="blackout-spin" aria-label="Abrindo" /> : <p role="alert">{state.error}</p>}
        </div>
      </div>
    );
  }
  return (
    <div className="blackout-page">
      <iframe className="blackout-frame" src="/blackout/" title="Compêndio BLACKOUT" allow="fullscreen; clipboard-write" />
      <a className="blackout-newtab" href="/blackout/" target="_blank" rel="noopener" title="Abrir o compêndio numa aba só pra ele">Abrir em nova aba ↗</a>
    </div>
  );
}
