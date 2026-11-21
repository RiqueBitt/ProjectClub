import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useStore } from '../../store/useStore';
import '../../styles/temp-voice.css';

// Rádio do Project Club (server/src/services/radio.js): a equipe cola os
// links do YouTube e o canal de voz toca em loop pra quem entrar.

export function RadioChip({ channelId }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    api.get(`/radio/${encodeURIComponent(channelId)}`).then(({ data }) => { if (alive) setOn(!!data.station?.enabled); }).catch(() => {});
    return () => { alive = false; };
  }, [channelId]);
  if (!on) return null;
  return <span className="tvr-tag" title="Este canal toca música o tempo todo pra quem entrar">📻 Rádio</span>;
}

export function RadioSettings({ channelId }) {
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState('');
  const [shuffle, setShuffle] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.get(`/radio/${encodeURIComponent(channelId)}`).then(({ data }) => {
      const st = data.station;
      setLinks((st?.tracks || []).map((t) => `https://youtu.be/${t.videoId}`).join('\n'));
      setShuffle(st ? st.shuffle : true);
      setEnabled(st ? st.enabled : true);
      setCount(st?.tracks?.length || 0);
    }).catch(() => {});
  }, [open, channelId]);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.put(`/radio/${encodeURIComponent(channelId)}`, { links, shuffle, enabled });
      setCount(data.station?.tracks?.length || 0);
      useStore.getState().pushNotice(data.station?.enabled ? `Rádio salva com ${data.station.tracks.length} música(s).` : 'Rádio desligada.');
      setOpen(false);
    } catch (err) {
      useStore.getState().pushNotice(err?.response?.data?.error || 'Não consegui salvar a rádio.');
    } finally { setBusy(false); }
  };

  if (!open) return <button type="button" className="tvr-btn" onClick={() => setOpen(true)}>📻 Configurar rádio</button>;
  return (
    <form className="radio-form" onSubmit={save}>
      <label className="radio-label">
        Músicas da rádio (links do YouTube, um por linha)
        <textarea value={links} onChange={(e) => setLinks(e.target.value)} rows={6} placeholder="https://www.youtube.com/watch?v=…" />
      </label>
      <div className="tvr-form">
        <label><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Rádio ligada</label>
        <label><input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} /> Ordem aleatória</label>
        <button type="submit" className="tvr-btn" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
        <button type="button" className="tvr-btn" onClick={() => setOpen(false)}>Cancelar</button>
        {count > 0 && <span className="tvr-tag">{count} música(s) agora</span>}
      </div>
    </form>
  );
}
