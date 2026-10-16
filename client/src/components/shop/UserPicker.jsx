import { useEffect, useMemo, useState } from 'react';
import UserAvatar from '../UserAvatar.jsx';
import { Ico } from '../PagesKit.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useStore } from '../../store/useStore';
import { searchUsers } from '../../api/endpoints';

// Escolher uma pessoa: aceita nome, ClubTag ou "@clubtag". Filtra na hora
// quem já está carregado (membros da comunidade + amigos) e completa com a
// busca do servidor. Sem digitar nada, mostra uma lista pra clicar direto.
const clean = (s) => String(s || '').trim().replace(/^@+/, '').toLowerCase();

export default function UserPicker({ value, onChange, includeSelf = false, placeholder = 'Nome ou @ da pessoa', autoFocus = false }) {
  const { user: me } = useAuth();
  const members = useStore((s) => s.members);
  const friends = useStore((s) => s.friends);
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState([]);
  const [loading, setLoading] = useState(false);
  const term = clean(q);

  // Gente já carregada no app (sem esperar o servidor).
  const local = useMemo(() => {
    const map = new Map();
    (members || []).forEach((m) => m?.user && map.set(m.user.id, m.user));
    (friends || []).forEach((f) => f?.status === 'ACCEPTED' && f.user && map.set(f.user.id, f.user));
    if (includeSelf && me) map.set(me.id, me);
    if (!includeSelf && me) map.delete(me.id);
    return [...map.values()];
  }, [members, friends, includeSelf, me]);

  useEffect(() => {
    if (term.length < 2) { setRemote([]); setLoading(false); return undefined; }
    setLoading(true);
    const t = setTimeout(() => {
      searchUsers(term, { self: includeSelf })
        .then((d) => setRemote(d.users || []))
        .catch(() => setRemote([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [term, includeSelf]);

  const results = useMemo(() => {
    const match = (u) => !term || `${u.displayName || ''} ${u.username || ''}`.toLowerCase().includes(term);
    const map = new Map();
    local.filter(match).forEach((u) => map.set(u.id, u));
    remote.forEach((u) => { if (includeSelf || u.id !== me?.id) map.set(u.id, u); });
    return [...map.values()]
      .sort((a, b) => {
        // Quem bate exatamente com a ClubTag vem primeiro.
        const ea = (a.username || '').toLowerCase() === term ? 0 : 1;
        const eb = (b.username || '').toLowerCase() === term ? 0 : 1;
        return ea - eb || (a.displayName || '').localeCompare(b.displayName || '', 'pt-BR');
      })
      .slice(0, term ? 12 : 8);
  }, [local, remote, term, includeSelf, me]);

  return (
    <div className="user-picker">
      <label className="user-picker-field">
        <Ico name="search" size={16} />
        <input
          type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
          aria-label={placeholder} autoComplete="off" spellCheck={false} autoFocus={autoFocus}
          onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); onChange(results[0]); } }}
        />
        {q && <button type="button" aria-label="Limpar" onClick={() => setQ('')}><Ico name="close" size={13} /></button>}
      </label>
      {value && (
        <div className="user-picker-chosen">
          <UserAvatar user={value} size={28} />
          <span><b>{value.displayName}</b> <small>@{value.username}</small></span>
          <button type="button" onClick={() => onChange(null)}>Trocar</button>
        </div>
      )}
      {!value && (
        <div className="user-picker-list" role="listbox">
          {!term && results.length > 0 && <small className="user-picker-hint">Toque pra escolher, ou escreva o nome/@:</small>}
          {results.map((u) => (
            <button key={u.id} type="button" role="option" aria-selected={false} onClick={() => onChange(u)}>
              <UserAvatar user={u} size={28} />
              <span><b>{u.displayName}{u.id === me?.id ? ' (você)' : ''}</b> <small>@{u.username}</small></span>
            </button>
          ))}
          {term && !loading && results.length === 0 && <small className="user-picker-hint">Ninguém com "{q.trim()}".</small>}
          {loading && results.length === 0 && <small className="user-picker-hint">Procurando…</small>}
        </div>
      )}
    </div>
  );
}
