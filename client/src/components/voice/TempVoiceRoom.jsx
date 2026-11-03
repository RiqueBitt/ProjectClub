import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createTempVoiceRoom, updateTempVoiceRoom, closeTempVoiceRoom } from '../../api/endpoints';
import { useVoice } from '../../context/VoiceContext.jsx';
import { useStore } from '../../store/useStore';
import { channelPath } from '../../utils/prettyLinks';
import '../../styles/temp-voice.css';

// Salas de voz temporárias (server/src/services/tempVoice.js): qualquer
// membro cria a própria sala; ela some sozinha quando fica vazia.

const errText = (err, fallback) => err?.response?.data?.error || fallback;

/** Botão "+ sala" no cabeçalho de uma categoria de voz. Cria (ou reabre a sua) e entra. */
export function TempVoiceCreateButton({ categoryId, className = '' }) {
  const voice = useVoice();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const create = async (e) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const { channel } = await createTempVoiceRoom({ categoryId });
      navigate(channelPath(channel));
      voice?.joinChannel(null, channel.id, channel.name, 'VOICE');
    } catch (err) {
      useStore.getState().pushNotice(errText(err, 'Não consegui criar a sala agora.'));
    } finally { setBusy(false); }
  };
  return (
    <button
      type="button" className={`icon-btn-small tvr-create ${className}`} onClick={create} disabled={busy}
      title="Criar sala de voz temporária (some quando ficar vazia)" aria-label="Criar sala de voz temporária"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M18 8v8M14 12h8" />
      </svg>
    </button>
  );
}

/** Selo + controles do dono numa sala temporária (renomear, limite, fechar). */
export function TempVoiceRoomBar({ channel, myUserId }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(channel.name);
  const [limit, setLimit] = useState(channel.userLimit || '');
  const [busy, setBusy] = useState(false);
  if (!channel?.tempOwnerId) return null;
  const mine = channel.tempOwnerId === myUserId;
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await updateTempVoiceRoom(channel.id, { name, userLimit: limit === '' ? null : Number(limit) });
      setEditing(false);
    } catch (err) { useStore.getState().pushNotice(errText(err, 'Não consegui salvar.')); } finally { setBusy(false); }
  };
  const close = async () => {
    if (!window.confirm('Fechar a sala agora? Quem estiver nela sai da chamada.')) return;
    try { await closeTempVoiceRoom(channel.id); } catch (err) { useStore.getState().pushNotice(errText(err, 'Não consegui fechar a sala.')); }
  };
  return (
    <div className="tvr-bar">
      <span className="tvr-tag" title="Esta sala some sozinha 1 minuto depois de ficar vazia">Sala temporária</span>
      {mine && !editing && (
        <>
          <button type="button" className="tvr-btn" onClick={() => { setName(channel.name); setLimit(channel.userLimit || ''); setEditing(true); }}>Editar</button>
          <button type="button" className="tvr-btn tvr-danger" onClick={close}>Fechar sala</button>
        </>
      )}
      {mine && editing && (
        <form className="tvr-form" onSubmit={save}>
          <label>Nome <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required /></label>
          <label>Limite <input type="number" min="0" max="99" value={limit} placeholder="sem" onChange={(e) => setLimit(e.target.value)} /></label>
          <button type="submit" className="tvr-btn" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
          <button type="button" className="tvr-btn" onClick={() => setEditing(false)}>Cancelar</button>
        </form>
      )}
    </div>
  );
}
