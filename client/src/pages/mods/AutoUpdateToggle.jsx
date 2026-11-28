import { useEffect, useState } from 'react';
import { Icon } from './shared.jsx';
import { autoUpdateBridge, normalizeSettings, gameAutoEnabled, SETTINGS_EVENT } from './autoUpdatePolicy.js';

// Interruptores da atualização automática de mods (Fase 7). Só aparecem no
// app de PC com suporte (versão nova do app); a configuração fica no
// próprio computador (desktop/modAutoUpdate.js), porque é ele que instala.

function useAutoUpdateSettings() {
  const bridge = autoUpdateBridge();
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!bridge) return undefined;
    let alive = true;
    const load = () => bridge.getSettings().then((r) => { if (alive) setSettings(normalizeSettings(r?.settings)); }).catch(() => { if (alive) setSettings(normalizeSettings(null)); });
    load();
    // Outro interruptor (álbum ↔ jogo) mudou: relê.
    window.addEventListener(SETTINGS_EVENT, load);
    return () => { alive = false; window.removeEventListener(SETTINGS_EVENT, load); };
  }, [bridge]);
  const save = async (patch) => {
    setBusy(true);
    try {
      const r = await bridge.setSettings(patch);
      const next = normalizeSettings(r?.settings);
      setSettings(next);
      window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: next }));
    } finally { setBusy(false); }
  };
  return { bridge, settings, busy, save };
}

// Álbum de Mods: liga/desliga pra todos os jogos.
export function AutoUpdateToggle() {
  const { bridge, settings, busy, save } = useAutoUpdateSettings();
  if (!bridge || !settings) return null;
  const on = settings.enabled;
  return (
    <div className="mdx-nexus-toggle mdx-autoupd-toggle">
      <span className="mdx-nexus-toggle-icon"><Icon name="refresh" size={17} /></span>
      <div className="mdx-nexus-toggle-text">
        <strong>Atualizar mods automaticamente</strong>
        <span>{on
          ? 'Ligado: o Project Club atualiza seus mods em segundo plano, só com o jogo fechado, e avisa o que mudou. Se algo der errado, a versão anterior é mantida.'
          : 'Desligado: você vê as atualizações aqui e atualiza quando quiser. Ligue pra atualizar sozinho, só com o jogo fechado.'}</span>
      </div>
      <button
        type="button" className={`mdx-switch ${on ? 'on' : ''}`} role="switch" aria-checked={on}
        aria-label="Atualizar mods automaticamente" disabled={busy} onClick={() => save({ enabled: !on })}
      >
        <span />
      </button>
    </div>
  );
}

// Aba "Instalados" de um jogo: exceção por jogo (só faz sentido com a
// opção geral ligada).
export function GameAutoUpdateToggle({ steamAppId }) {
  const { bridge, settings, busy, save } = useAutoUpdateSettings();
  if (!bridge || !settings || !settings.enabled) return null;
  const on = gameAutoEnabled(settings, steamAppId);
  return (
    <label className={`mdx-ux-toggle ${on ? 'on' : ''}`} title="Atualiza os mods deste jogo sozinho, só com o jogo fechado">
      <input
        type="checkbox" checked={on} disabled={busy}
        onChange={(e) => save({ game: { steamAppId: Number(steamAppId), enabled: e.target.checked } })}
      />
      <span className="mdx-ux-toggle-track" aria-hidden="true"><span /></span>
      Atualizar sozinho neste jogo
    </label>
  );
}
