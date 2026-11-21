import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { WEB_VERSION } from '../utils/nativeUpdateCheck';
import { watchWebVersion, readDismissed, writeDismissed } from '../utils/webVersionWatch';
import { RESTART_EVENT, BACK_EVENT, isServerRestarting } from '../utils/serverRestart';
import { useVoice } from '../context/VoiceContext.jsx';
import '../styles/speed.css';

// Aviso discreto "Nova versão do Project Club disponível" (só no site —
// Electron e Android têm o próprio atualizador). "Atualizar" recarrega;
// "Depois" esconde até sair uma versão mais nova que essa.
function isNativeShell() {
  if (typeof window !== 'undefined' && window.electronAPI) return true;
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

export default function UpdateAvailableBanner() {
  const [version, setVersion] = useState(null);
  // Servidor reiniciando (deploy): aviso calmo em vez de erros pela tela —
  // as leituras já estão tentando de novo sozinhas (utils/serverRestart.js).
  const [restarting, setRestarting] = useState(() => isServerRestarting());
  const voice = useVoice();
  const inCall = !!voice?.call;

  useEffect(() => {
    if (isNativeShell()) return undefined;
    // Só mostra se continuar fora por mais de 2s (um soluço rápido nem aparece).
    let showTimer = null;
    const onRestart = () => { clearTimeout(showTimer); showTimer = setTimeout(() => setRestarting(isServerRestarting()), 2000); };
    const onBack = () => { clearTimeout(showTimer); setRestarting(false); };
    window.addEventListener(RESTART_EVENT, onRestart);
    window.addEventListener(BACK_EVENT, onBack);
    return () => {
      clearTimeout(showTimer);
      window.removeEventListener(RESTART_EVENT, onRestart);
      window.removeEventListener(BACK_EVENT, onBack);
    };
  }, []);

  useEffect(() => {
    if (isNativeShell() || !WEB_VERSION) return undefined;
    return watchWebVersion({
      loaded: WEB_VERSION,
      onNewVersion: (v) => { if (readDismissed() !== v) setVersion(v); },
    });
  }, []);

  if (!version && restarting) {
    return (
      <div className="pc-update-banner" role="status" aria-live="polite">
        <span className="pc-update-icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
        </span>
        <span className="pc-update-text">
          <b>O Project Club está sendo atualizado</b>
          <small>Reconectando sozinho em alguns segundos — não precisa recarregar.</small>
        </span>
      </div>
    );
  }

  if (!version) return null;

  const later = () => { writeDismissed(version); setVersion(null); };
  const update = () => { window.location.reload(); };

  return (
    <div className="pc-update-banner" role="status" aria-live="polite">
      <span className="pc-update-icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
      </span>
      <span className="pc-update-text">
        <b>Nova versão do Project Club disponível</b>
        <small>{inCall ? 'Atualizar vai sair da chamada de voz.' : 'Atualize pra pegar as correções e novidades.'}</small>
      </span>
      <button type="button" className="pc-update-btn primary" onClick={update}>Atualizar</button>
      <button type="button" className="pc-update-btn" onClick={later}>Depois</button>
    </div>
  );
}
