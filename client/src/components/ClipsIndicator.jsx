import { useEffect, useRef, useState } from 'react';
import { prettyAccelerator } from '../utils/clipsHotkey';
import { useStore } from '../store/useStore';
import '../styles/clips.css';

// Indicador dos Clipes (Fase 7): enquanto o app de PC estiver guardando os
// últimos 30 s da tela, aparece uma pílula "● Clipes ativos" no canto —
// gravação nunca acontece escondida. Quando um clipe é salvo, mostra
// "Clipe salvo" com o botão de abrir a pasta. Clicar na pílula abre as
// Configurações.
export default function ClipsIndicator() {
  const bridge = typeof window !== 'undefined' ? window.electronAPI?.clips : null;
  const [st, setSt] = useState(null);
  const [saved, setSaved] = useState(null);
  const timer = useRef(null);
  const openSettings = useStore((s) => s.openSettings);

  useEffect(() => {
    if (!bridge) return undefined;
    let alive = true;
    bridge.getState().then((s) => { if (alive) setSt(s); }).catch(() => {});
    const offState = bridge.onState((s) => { if (alive) setSt(s); });
    const offSaved = bridge.onSaved((info) => {
      if (!alive) return;
      setSaved(info);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setSaved(null), 6000);
    });
    return () => { alive = false; offState?.(); offSaved?.(); clearTimeout(timer.current); };
  }, [bridge]);

  if (!bridge) return null;
  const recording = !!st?.recording;
  return (
    <>
      {recording && (
        <button
          type="button" className="clips-indicator"
          title={`Clipes ativos: os últimos 30 s ficam na memória deste PC. ${prettyAccelerator(st.settings.hotkey)} salva um clipe.`}
          aria-label={`Clipes ativos. ${prettyAccelerator(st.settings.hotkey)} salva os últimos 30 segundos. Abrir configurações.`}
          onClick={() => {
            // Abre as Configurações direto em "Jogos e apps" (onde ficam os Clipes).
            try { sessionStorage.setItem('pc-settings-open-tab', JSON.stringify({ tab: 'GAMES', at: Date.now() })); } catch { /* sem storage */ }
            openSettings?.();
          }}
        >
          <span className="clips-status-dot" aria-hidden="true" /> Clipes ativos <kbd>{prettyAccelerator(st.settings.hotkey)}</kbd>
        </button>
      )}
      {saved && (
        <div className="clips-toast" role="status" aria-live="polite">
          <span><strong>Clipe salvo</strong> · {saved.name}</span>
          <button type="button" className="btn-secondary" onClick={() => bridge.openFolder()}>Abrir pasta</button>
        </div>
      )}
    </>
  );
}
