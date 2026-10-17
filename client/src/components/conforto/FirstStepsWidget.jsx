import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { useSocket } from '../../context/SocketContext.jsx';
import { getOnboarding, claimOnboardingStep, setOnboardingMeta } from '../../api/conforto';
import { enableWebPush } from '../../utils/webPush';
import { CoinIcon } from '../CurrencyIcon.jsx';
import { channelPath } from '../../utils/prettyLinks';

// "Primeiros passos": cartão flutuante (recolhível) com os passos de quem
// acabou de chegar. Quem confere se o passo foi feito e paga as moedas é o
// servidor (services/onboarding.js) — aqui é só a interface.
const COLLAPSE_KEY = 'pc-firststeps-collapsed';
const readCollapsed = () => {
  try {
    const v = localStorage.getItem(COLLAPSE_KEY);
    if (v !== null) return v === '1';
  } catch { /* sem storage */ }
  return typeof window !== 'undefined' && window.innerWidth < 760;
};

const CONFETTI = Array.from({ length: 14 }, (_, i) => i);

function Ring({ done, total }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  return (
    <svg className="pc-fs-ring" width="38" height="38" viewBox="0 0 38 38" aria-hidden="true">
      <circle cx="19" cy="19" r={r} className="pc-fs-ring-bg" />
      <circle cx="19" cy="19" r={r} className="pc-fs-ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      <text x="19" y="23" textAnchor="middle">{done}/{total}</text>
    </svg>
  );
}

export default function FirstStepsWidget({ data, setData, hidden }) {
  const navigate = useNavigate();
  const { socket } = useSocket() || {};
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [busy, setBusy] = useState(null);
  const [burst, setBurst] = useState(null); // { key, coins }
  const [announce, setAnnounce] = useState('');
  const [finished, setFinished] = useState(false);
  const burstTimer = useRef(null);

  const refresh = useCallback(() => getOnboarding().then(setData).catch(() => {}), [setData]);

  // Atualiza quando o servidor avisa, ao voltar pra aba e ao fechar as
  // Configurações (onde se troca foto/tema/notificações).
  useEffect(() => {
    if (!socket) return undefined;
    const on = () => refresh();
    socket.on('onboarding:update', on);
    return () => socket.off('onboarding:update', on);
  }, [socket, refresh]);
  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);
  const settingsOpen = useStore((s) => s.settingsModalOpen);
  const profileOpen = useStore((s) => s.viewingProfileUserId);
  const wasOpen = useRef(false);
  useEffect(() => {
    const open = !!(settingsOpen || profileOpen);
    if (wasOpen.current && !open) refresh();
    wasOpen.current = open;
  }, [settingsOpen, profileOpen, refresh]);

  useEffect(() => () => clearTimeout(burstTimer.current), []);

  const toggle = () => setCollapsed((v) => {
    try { localStorage.setItem(COLLAPSE_KEY, v ? '0' : '1'); } catch { /* ok */ }
    return !v;
  });

  const steps = data?.steps || [];
  const doneCount = steps.filter((s) => s.claimed).length;
  const readyCount = steps.filter((s) => s.done && !s.claimed).length;

  const dismiss = useCallback(() => {
    setData((d) => (d ? { ...d, dismissedAt: new Date().toISOString() } : d));
    setOnboardingMeta('dismiss', true).catch(() => {});
  }, [setData]);

  const claim = async (step) => {
    if (busy) return;
    setBusy(step.key);
    try {
      const r = await claimOnboardingStep(step.key);
      const next = { ...data, steps: steps.map((s) => (s.key === step.key ? { ...s, done: true, claimed: true } : s)) };
      next.earnedCoins = (data.earnedCoins || 0) + (r.coins || step.coins);
      next.allClaimed = next.steps.every((s) => s.claimed);
      setData(next);
      setBurst({ key: step.key, coins: r.coins || step.coins });
      setAnnounce(`Você ganhou ${r.coins || step.coins} moedas: ${step.title}.`);
      clearTimeout(burstTimer.current);
      burstTimer.current = setTimeout(() => setBurst(null), 1800);
      if (next.allClaimed) {
        setFinished(true);
        setAnnounce(`Primeiros passos concluídos! Você ganhou ${next.earnedCoins} moedas no total.`);
      }
    } catch (err) {
      const code = err?.response?.data?.code;
      if (code === 'already-claimed') refresh();
      else useStore.getState().pushNotice(err?.response?.data?.error || 'Não foi possível resgatar agora.');
      if (code === 'not-done') refresh();
    } finally { setBusy(null); }
  };

  const doAction = async (step) => {
    const s = useStore.getState();
    switch (step.action) {
      case 'profile':
      case 'profileTheme':
        s.openSettings();
        break;
      case 'chat': {
        navigate('/');
        break;
      }
      case 'voice': {
        const all = [...(s.channels || []), ...(s.categories || []).flatMap((c) => c.channels || [])];
        const vc = all.find((c) => c.type === 'VOICE');
        if (vc) navigate(channelPath(vc));
        else s.pushNotice('Nenhum canal de voz disponível agora.');
        break;
      }
      case 'notifications': {
        setBusy(step.key);
        const r = await enableWebPush().catch(() => ({ ok: false }));
        setBusy(null);
        if (r?.ok) refresh();
        else if (r?.reason === 'denied') s.pushNotice('As notificações estão bloqueadas no navegador. Libere nas permissões do site e tente de novo.');
        else if (r?.reason === 'unsupported') s.pushNotice('Este navegador não aceita notificações. No celular, use o app do Project Club.');
        else s.pushNotice('Não deu para ativar as notificações agora.');
        break;
      }
      default: break;
    }
  };

  if (hidden || !data || !data.eligible || data.dismissedAt || (data.allClaimed && !finished)) return null;

  return (
    <aside className={`pc-fs${collapsed ? ' is-collapsed' : ''}${finished ? ' is-finished' : ''}`} aria-label="Primeiros passos">
      <div className="pc-sr-only" aria-live="polite">{announce}</div>
      <button
        type="button" className="pc-fs-toggle" onClick={toggle}
        aria-expanded={!collapsed} aria-controls="pc-fs-panel"
      >
        <Ring done={doneCount} total={steps.length} />
        <span className="pc-fs-toggle-text">
          <strong>Primeiros passos</strong>
          <span>
            {finished ? 'Tudo pronto!' : readyCount > 0 ? `${readyCount} recompensa${readyCount > 1 ? 's' : ''} para resgatar` : `${data.earnedCoins || 0} de ${data.totalCoins} moedas`}
          </span>
        </span>
        {readyCount > 0 && !finished && <span className="pc-fs-dot" aria-hidden="true" />}
        <svg className="pc-fs-chev" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>

      {!collapsed && (
        <div id="pc-fs-panel" className="pc-fs-panel">
          {finished ? (
            <div className="pc-fs-done">
              <div className="pc-fs-confetti" aria-hidden="true">{CONFETTI.map((i) => <i key={i} style={{ '--i': i }} />)}</div>
              <strong>Você mandou bem!</strong>
              <p>Ganhou <b>{data.earnedCoins}</b> moedas. Gaste na Loja ou guarde para depois.</p>
              <div className="pc-fs-done-actions">
                <button type="button" className="pc-btn pc-btn-primary" onClick={() => { navigate('/loja'); dismiss(); }}>Ir para a Loja</button>
                <button type="button" className="pc-btn pc-btn-ghost" onClick={dismiss}>Fechar</button>
              </div>
            </div>
          ) : (
            <>
              <div
                className="pc-fs-bar" role="progressbar" aria-label="Progresso dos primeiros passos"
                aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount}
              >
                <span style={{ width: `${steps.length ? (doneCount / steps.length) * 100 : 0}%` }} />
              </div>
              <ul className="pc-fs-list" role="list">
                {steps.map((s) => (
                  <li key={s.key} className={`pc-fs-step${s.claimed ? ' is-claimed' : s.done ? ' is-ready' : ''}`}>
                    <span className="pc-fs-check" aria-hidden="true">
                      {s.claimed ? <svg width="14" height="14" viewBox="0 0 24 24"><path d="m5 12 5 5 9-10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}
                    </span>
                    <span className="pc-fs-step-text">
                      <span className="pc-fs-step-title">{s.title}<span className="pc-sr-only">{s.claimed ? ' (concluído)' : s.done ? ' (pronto para resgatar)' : ''}</span></span>
                      <span className="pc-fs-step-desc">{s.description}</span>
                    </span>
                    {s.claimed ? (
                      <span className="pc-fs-reward is-got"><CoinIcon size={14} />{s.coins}</span>
                    ) : s.done ? (
                      <button type="button" className="pc-fs-claim" disabled={!!busy} onClick={() => claim(s)} aria-label={`Resgatar ${s.coins} moedas: ${s.title}`}>
                        <CoinIcon size={14} /> +{s.coins}
                      </button>
                    ) : (
                      <button type="button" className="pc-fs-go" disabled={busy === s.key} onClick={() => doAction(s)} aria-label={`Fazer agora: ${s.title} (vale ${s.coins} moedas)`}>
                        Fazer <span className="pc-fs-go-coins"><CoinIcon size={12} />{s.coins}</span>
                      </button>
                    )}
                    {burst?.key === s.key && (
                      <span className="pc-fs-burst" aria-hidden="true">
                        <span className="pc-fs-burst-coins">+{burst.coins}</span>
                        {CONFETTI.slice(0, 10).map((i) => <i key={i} style={{ '--i': i }} />)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <div className="pc-fs-foot">
                <button type="button" className="pc-fs-link" onClick={() => window.dispatchEvent(new CustomEvent('pc:open-tour'))}>Rever o tour</button>
                <button type="button" className="pc-fs-link" onClick={dismiss}>Esconder lista</button>
              </div>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
