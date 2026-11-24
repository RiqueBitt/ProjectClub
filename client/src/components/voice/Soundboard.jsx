import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { useSocket } from '../../context/SocketContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useStore } from '../../store/useStore';
import { getMyCommunityPermissions, hasPermission } from '../../utils/permissions';
import '../../styles/soundboard.css';

// Soundboard nas calls: sons curtos que tocam pra todo mundo da sala
// (server/src/controllers/soundboardController.js + socket 'soundboard:play').
// Quem tem "Gerenciar emojis" adiciona e apaga sons aqui mesmo.

const MAX_SECONDS = 5;
let listCache = null;

async function loadSounds(force = false) {
  if (listCache && !force) return listCache;
  const { data } = await api.get('/soundboard');
  listCache = data.sounds || [];
  return listCache;
}

function audioDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    a.preload = 'metadata';
    const done = (v) => { URL.revokeObjectURL(url); resolve(v); };
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration * 1000 : 0);
    a.onerror = () => done(0);
    a.src = url;
  });
}

function AddSoundForm({ onAdded }) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (!file) return;
    setErr('');
    const ms = await audioDuration(file);
    if (ms > MAX_SECONDS * 1000 + 250) { setErr(`O som tem ${Math.round(ms / 100) / 10}s; o máximo é ${MAX_SECONDS}s.`); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('sound', file); fd.append('name', name); fd.append('emoji', emoji); fd.append('durationMs', String(Math.round(ms)));
      await api.post('/soundboard', fd);
      setName(''); setEmoji(''); setFile(null);
      onAdded();
    } catch (er) { setErr(er?.response?.data?.error || 'Não consegui enviar o som.'); } finally { setBusy(false); }
  };
  return (
    <form className="sb-add" onSubmit={submit}>
      <input value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="😀" aria-label="Emoji do som" className="sb-add-emoji" maxLength={8} />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do som" aria-label="Nome do som" required minLength={2} maxLength={32} />
      <label className="sb-add-file">
        {file ? file.name.slice(0, 18) : `Arquivo (até ${MAX_SECONDS}s)`}
        <input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] || null)} hidden />
      </label>
      <button type="submit" disabled={busy || !file}>{busy ? 'Enviando…' : 'Adicionar'}</button>
      {err && <p className="sb-err" role="alert">{err}</p>}
    </form>
  );
}

/**
 * Painel do Soundboard (lista de sons + gerenciar). Abre pelo menu
 * Atividades da call (PC e celular); `onClose` fecha.
 */
export function SoundboardPanel({ channelId, className = '' }) {
  const { socket } = useSocket() || {};
  const { user } = useAuth();
  const roles = useStore((s) => s.roles);
  const members = useStore((s) => s.members);
  const [sounds, setSounds] = useState(listCache || []);
  const [managing, setManaging] = useState(false);
  const [msg, setMsg] = useState('');
  const canManage = !!user && hasPermission(getMyCommunityPermissions(roles, members, user.id, user.platformRole), 'MANAGE_EMOJIS');

  const refresh = useCallback((force) => { loadSounds(force).then(setSounds).catch(() => {}); }, []);
  useEffect(() => { refresh(false); }, [refresh]);
  useEffect(() => {
    if (!socket) return undefined;
    const on = () => { listCache = null; refresh(true); };
    socket.on('soundboard:changed', on);
    return () => socket.off('soundboard:changed', on);
  }, [socket, refresh]);

  const play = (s) => {
    if (!socket) return;
    socket.emit('soundboard:play', { channelId, soundId: s.id }, (r) => {
      if (r && !r.ok && r.reason) { setMsg(r.reason); setTimeout(() => setMsg(''), 2500); }
    });
  };
  const remove = async (s) => {
    if (!window.confirm(`Apagar o som "${s.name}"?`)) return;
    try { await api.delete(`/soundboard/${encodeURIComponent(s.id)}`); refresh(true); } catch { /* aviso abaixo */ }
  };

  return (
    <div className={`sb-pop ${className}`.trim()} role="dialog" aria-label="Soundboard">
      <div className="sb-head">
        <strong>Soundboard</strong>
        {canManage && <button type="button" className="sb-link" onClick={() => setManaging((v) => !v)}>{managing ? 'Pronto' : 'Gerenciar'}</button>}
      </div>
      {sounds.length === 0 ? (
        <p className="sb-empty">{canManage ? 'Nenhum som ainda. Clique em "Gerenciar" para adicionar.' : 'A equipe ainda não adicionou sons.'}</p>
      ) : (
        <div className="sb-grid">
          {sounds.map((s) => (
            <div key={s.id} className="sb-item">
              <button type="button" className="sb-play" onClick={() => play(s)} title={`Tocar "${s.name}" pra todo mundo`}>
                <span aria-hidden="true">{s.emoji || '🔉'}</span>
                <span className="sb-name">{s.name}</span>
              </button>
              {managing && <button type="button" className="sb-del" aria-label={`Apagar ${s.name}`} onClick={() => remove(s)}>×</button>}
            </div>
          ))}
        </div>
      )}
      {msg && <p className="sb-err" role="status">{msg}</p>}
      {managing && <AddSoundForm onAdded={() => refresh(true)} />}
    </div>
  );
}
