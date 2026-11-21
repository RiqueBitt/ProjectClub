import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { applyExtraPrefs, resolveExtra, setExtra } from '../utils/extraPrefs';
import '../styles/extra-prefs.css';

// Aplica as preferências extras (tema colorido, ícone do app, modo
// streamer, links sublinhados...) em qualquer tela, inclusive login.
export function useApplyExtraPrefs() {
  const server = useStore((s) => s.userSettings?.extraPrefs);
  useEffect(() => {
    const p = resolveExtra(server);
    applyExtraPrefs(p);
    if (server && typeof server === 'object') {
      try { localStorage.setItem('pc-extra-prefs', JSON.stringify(server)); } catch { /* sem storage */ }
    }
  }, [server]);
}

// Selo "Modo streamer ativo" (clique desliga), como no Discord.
export function StreamerBadge() {
  const on = useStore((s) => !!s.userSettings?.extraPrefs?.streamerMode);
  if (!on) return null;
  return (
    <button type="button" className="pc-streamer-badge" onClick={() => setExtra({ streamerMode: false })} title="Clique pra desligar">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" /></svg>
      Modo streamer ativo
    </button>
  );
}
