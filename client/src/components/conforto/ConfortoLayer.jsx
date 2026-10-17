import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useStore } from '../../store/useStore';
import { getOnboarding, setOnboardingMeta } from '../../api/conforto';
import WelcomeTour from './WelcomeTour.jsx';
import ShortcutsModal from './ShortcutsModal.jsx';
import FirstStepsWidget from './FirstStepsWidget.jsx';
import { useGlobalShortcuts } from './useGlobalShortcuts';
import { startA11yRuntime } from './a11yRuntime';
import '../../styles/conforto.css';

// Camada de "conforto" montada uma vez no app logado (MainApp.jsx):
// tour de boas-vindas, checklist "Primeiros passos", tela de atalhos
// (Ctrl+/ ou ?) e os atalhos globais novos. Abrir de outros lugares:
//   window.dispatchEvent(new CustomEvent('pc:open-tour'))
//   window.dispatchEvent(new CustomEvent('pc:open-shortcuts'))
const seenKey = (uid) => `pc-tour-seen:${uid}`;
const BLOCKING_UI = '.modal-overlay, [role="dialog"][aria-modal="true"], .announcement-overlay';

export default function ConfortoLayer() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => startA11yRuntime(), []);
  useEffect(() => {
    let alive = true;
    getOnboarding().then((d) => { if (alive) setData(d); }).catch(() => {});
    return () => { alive = false; };
  }, [user?.id]);

  // Tour automático: só conta nova que ainda não viu (servidor + cache local).
  useEffect(() => {
    if (!data || !user?.id || data.tourSeenAt || !data.eligible) return undefined;
    try { if (localStorage.getItem(seenKey(user.id))) return undefined; } catch { /* ok */ }
    let tries = 0;
    let timer = null;
    const attempt = () => {
      tries += 1;
      if (document.querySelector(BLOCKING_UI) && tries < 20) { timer = setTimeout(attempt, 3000); return; }
      setTourOpen(true);
    };
    timer = setTimeout(attempt, 1500);
    return () => clearTimeout(timer);
  }, [data?.tourSeenAt, data?.eligible, !!data, user?.id]);

  const closeTour = useCallback(() => {
    setTourOpen(false);
    try { localStorage.setItem(seenKey(user?.id), '1'); } catch { /* ok */ }
    setData((d) => (d ? { ...d, tourSeenAt: d.tourSeenAt || new Date().toISOString() } : d));
    setOnboardingMeta('tour', true).catch(() => {});
  }, [user?.id]);

  useEffect(() => {
    const openTour = () => { setShortcutsOpen(false); useStore.getState().closeSettings?.(); setTourOpen(true); };
    const openShortcuts = () => { setTourOpen(false); setShortcutsOpen(true); };
    window.addEventListener('pc:open-tour', openTour);
    window.addEventListener('pc:open-shortcuts', openShortcuts);
    return () => {
      window.removeEventListener('pc:open-tour', openTour);
      window.removeEventListener('pc:open-shortcuts', openShortcuts);
    };
  }, []);

  useGlobalShortcuts({
    shortcutsOpen,
    onOpenShortcuts: () => setShortcutsOpen(true),
    onCloseShortcuts: () => setShortcutsOpen(false),
  });

  return (
    <>
      <FirstStepsWidget data={data} setData={setData} hidden={tourOpen} />
      {tourOpen && <WelcomeTour onClose={closeTour} />}
      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}
    </>
  );
}

