import { useEffect, useRef, useState } from 'react';
import { acceleratorFromEvent, prettyAccelerator } from '../../utils/clipsHotkey';
import '../../styles/clips.css';

// Configurações → Jogos e apps → "Clipes" (Fase 7). Só aparece no app de PC
// com suporte (window.electronAPI.clips). A configuração fica no próprio
// computador (desktop/clipsManager.js) — é lá que a gravação acontece.

function Switch({ on, onChange, label, disabled }) {
  return (
    <button
      type="button" role="switch" aria-checked={!!on} aria-label={label} disabled={disabled}
      className={`toggle-switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}
    />
  );
}

function Choice({ value, options, onChange, label, disabled }) {
  return (
    <div className="chip-choice-row settings-segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} disabled={disabled}
          className={`chip-choice ${value === v ? 'active' : ''}`} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

function statusText(st) {
  if (!st?.settings?.enabled) return { tone: 'off', text: 'Desligado — nada está sendo gravado.' };
  if (st.recording) {
    const secs = Math.min(30, st.bufferedSeconds || 0);
    return { tone: 'rec', text: `Gravando os últimos 30 s${secs < 30 ? ` (já tem ${secs} s)` : ''}. Aperte ${prettyAccelerator(st.settings.hotkey)} pra salvar.` };
  }
  if (st.waitingGame) return { tone: 'wait', text: 'Esperando um jogo abrir (precisa da detecção automática de jogos ligada).' };
  if (st.error) return { tone: 'err', text: `Não deu pra gravar: ${st.error}` };
  return { tone: 'wait', text: 'Começando…' };
}

export default function ClipsSettings() {
  const bridge = typeof window !== 'undefined' ? window.electronAPI?.clips : null;
  const [st, setSt] = useState(null);
  const [displays, setDisplays] = useState([]);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [msg, setMsg] = useState('');
  const msgTimer = useRef(null);

  useEffect(() => {
    if (!bridge) return undefined;
    let alive = true;
    const refresh = () => bridge.getState().then((s) => { if (alive) setSt(s); }).catch(() => {});
    refresh();
    bridge.listDisplays().then((d) => { if (alive) setDisplays(Array.isArray(d) ? d : []); }).catch(() => {});
    const off = bridge.onState((s) => { if (alive) setSt(s); });
    // Contagem "já tem X s" enquanto a tela está aberta.
    const t = setInterval(refresh, 4000);
    return () => { alive = false; off?.(); clearInterval(t); clearTimeout(msgTimer.current); };
  }, [bridge]);

  // Captura do atalho: a próxima combinação válida vira o novo atalho.
  useEffect(() => {
    if (!capturing) return undefined;
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setCapturing(false); return; }
      const acc = acceleratorFromEvent(e);
      if (!acc) return;
      setCapturing(false);
      save({ hotkey: acc });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  if (!bridge) return null;
  if (!st) return <div className="settings-block"><h4>Clipes</h4><p className="dim">Carregando…</p></div>;

  const s = st.settings;
  const flash = (text) => { setMsg(text); clearTimeout(msgTimer.current); msgTimer.current = setTimeout(() => setMsg(''), 4000); };
  async function save(patch) {
    setBusy(true);
    try { setSt(await bridge.setSettings(patch)); } catch { flash('Não foi possível salvar essa opção.'); } finally { setBusy(false); }
  }
  const saveNow = async () => {
    const r = await bridge.saveNow().catch(() => null);
    if (r?.saved) flash(`Clipe salvo: ${r.name}`);
    else if (r?.reason === 'empty') flash('Ainda não tem vídeo suficiente — espere alguns segundos.');
    else flash('Não foi possível salvar o clipe.');
  };
  const status = statusText(st);

  return (
    <>
      <div className="settings-block settings-toggle-row">
        <div>
          <h4>Clipes dos últimos 30 segundos</h4>
          <p className="dim">
            Mantém na memória os últimos 30 s da sua tela (ou só do jogo) e salva um vídeo quando você aperta o atalho.
            Fica só neste computador — nada é enviado pra internet. Desligado, nada é gravado.
          </p>
        </div>
        <Switch on={s.enabled} disabled={busy} onChange={(v) => save({ enabled: v })} label="Clipes dos últimos 30 segundos" />
      </div>

      {s.enabled && (
        <div className="settings-block clips-settings">
          <p className={`clips-status is-${status.tone}`} role="status" aria-live="polite">
            <span className="clips-status-dot" aria-hidden="true" /> {status.text}
          </p>
          {!st.hotkeyOk && (
            <p className="clips-warn" role="alert">
              O atalho {prettyAccelerator(s.hotkey)} está sendo usado por outro programa (ex.: o da placa de vídeo). Escolha outro abaixo.
            </p>
          )}

          <h4 className="settings-h4-row">Atalho pra salvar <span className="settings-chip">{prettyAccelerator(s.hotkey)}</span></h4>
          <div className="settings-inline-actions">
            <button type="button" className={capturing ? 'btn-danger' : 'btn-secondary'} onClick={() => setCapturing((v) => !v)}>
              {capturing ? 'Aperte a combinação… (Esc cancela)' : 'Trocar atalho'}
            </button>
            {s.hotkey !== 'Alt+F10' && <button type="button" className="btn-secondary" disabled={busy} onClick={() => save({ hotkey: 'Alt+F10' })}>Voltar pro Alt + F10</button>}
          </div>

          <h4 className="clips-h4">O que gravar</h4>
          <Choice
            label="O que gravar" value={s.source} disabled={busy}
            options={[['screen', 'Tela inteira'], ['game', 'Só o jogo aberto']]}
            onChange={(v) => save({ source: v })}
          />
          {s.source === 'game' && <p className="dim clips-hint">Grava só enquanto um jogo detectado estiver aberto. Se a janela do jogo não for encontrada (tela cheia exclusiva), grava a tela escolhida abaixo.</p>}

          {displays.length > 1 && (
            <>
              <h4 className="clips-h4">Tela</h4>
              <select
                aria-label="Tela gravada" value={s.displayId ?? ''} disabled={busy}
                onChange={(e) => save({ displayId: e.target.value === '' ? null : Number(e.target.value) })}
              >
                <option value="">Tela principal</option>
                {displays.map((d) => <option key={d.id} value={d.id}>{d.label} ({d.size}){d.primary ? ' — principal' : ''}</option>)}
              </select>
            </>
          )}

          <h4 className="clips-h4">Qualidade</h4>
          <Choice label="Resolução" value={s.quality} disabled={busy} options={[['720p', '720p (mais leve)'], ['1080p', '1080p']]} onChange={(v) => save({ quality: v })} />
          <Choice label="Quadros por segundo" value={s.fps} disabled={busy} options={[[30, '30 fps (mais leve)'], [60, '60 fps']]} onChange={(v) => save({ fps: v })} />

          <div className="settings-toggle-row clips-audio-row">
            <div>
              <h4 className="clips-h4">Som do computador</h4>
              <p className="dim">
                {st.audioAvailable
                  ? 'Inclui o som do jogo e dos outros programas — nunca o som do Project Club, então as vozes da chamada não entram no clipe.'
                  : 'Indisponível neste computador: aqui não dá pra separar o som do Project Club (as vozes da chamada) do resto, então os clipes saem sem som. Precisa do Windows 10 22H2 ou mais novo.'}
              </p>
            </div>
            <Switch on={s.audio && st.audioAvailable} disabled={busy || !st.audioAvailable} onChange={(v) => save({ audio: v })} label="Som do computador nos clipes" />
          </div>

          <div className="settings-inline-actions clips-actions">
            <button type="button" className="btn-secondary" disabled={!st.recording} onClick={saveNow}>Salvar clipe agora</button>
            <button type="button" className="btn-secondary" onClick={() => bridge.openFolder()}>Abrir pasta dos clipes</button>
          </div>
          {msg && <p className="dim clips-msg" role="status">{msg}</p>}
          {st.lastSaved && <p className="dim clips-last">Último clipe: {st.lastSaved.name}</p>}
        </div>
      )}
    </>
  );
}
