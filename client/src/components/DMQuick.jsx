import { useMemo, useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, isConversationUnread } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import { createConversation } from '../api/endpoints';
import PresenceDot from './PresenceDot.jsx';
import UserAvatar from './UserAvatar.jsx';
import ConversationIcon from './ConversationIcon.jsx';
import NewDMModal from './modals/NewDMModal.jsx';
import '../styles/dmquick.css';

// Atalhos de DM: barra de conversas recentes (troca de DM com um clique),
// caixa "Enviar mensagem para…" e helpers compartilhados.

const ONLINE = (st) => st && st !== 'OFFLINE' && st !== 'INVISIBLE';

export function convName(c, meId) {
  if (c.isGroup) return c.name || c.members.filter((m) => m.id !== meId).map((m) => m.displayName).join(', ') || 'Grupo';
  return c.members.find((m) => m.id !== meId)?.displayName || 'Conversa';
}

export function useSortedConversations() {
  const conversations = useStore((s) => s.conversations);
  return useMemo(() => [...conversations].sort((a, b) => new Date(b.lastMessage?.createdAt || b.updatedAt || 0) - new Date(a.lastMessage?.createdAt || a.updatedAt || 0)), [conversations]);
}

export function useOpenDM() {
  const navigate = useNavigate();
  return async (userId) => {
    const existing = useStore.getState().conversations.find((c) => !c.isGroup && c.members.some((m) => m.id === userId));
    if (existing) { navigate(`/conversations/${existing.id}`); return; }
    try {
      const { conversation } = await createConversation([userId]);
      navigate(`/conversations/${conversation.id}`);
    } catch { /* a pessoa pode ter bloqueado DMs */ }
  };
}

export function timeAgo(d) {
  if (!d) return '';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'agora';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d`;
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function lastPreview(c, meId) {
  const m = c.lastMessage;
  if (!m) return 'Diga oi!';
  const mine = (m.authorId || m.author?.id || m.userId) === meId;
  const body = (m.content || '').trim() || ((m.attachments?.length || m.attachmentCount) ? 'Enviou um anexo' : m.stickerUrl || m.stickerId || m.sticker ? 'Enviou uma figurinha' : 'Mensagem');
  return `${mine ? 'Você: ' : ''}${body}`.replace(/\s+/g, ' ').slice(0, 90);
}

function Avatar({ c, meId, size = 32 }) {
  const presence = useStore((s) => s.presence);
  const other = !c.isGroup ? c.members.find((m) => m.id !== meId) : null;
  const status = other ? (presence[other.id]?.status || other.status) : null;
  return (
    <span className="dmq-av" style={{ width: size, height: size }}>
      {c.isGroup ? <ConversationIcon conversation={c} size="small" /> : <UserAvatar user={other || {}} size={size} />}
      {status && <PresenceDot status={status} userId={other?.id} />}
    </span>
  );
}

const Svg = ({ d, size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const PLUS = 'M12 5v14M5 12h14';
const BACK = 'M15 18l-6-6 6-6';
const SEARCH = 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5';

// Barra fina no topo de uma DM: voltar pro Social + conversas recentes.
export function DMSwitcher({ currentId }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const list = useSortedConversations().slice(0, 30);
  const [newOpen, setNewOpen] = useState(false);
  const curRef = useRef(null);
  useEffect(() => { curRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }, [currentId]);
  if (!user) return null;
  return (
    <div className="dmq-switcher" role="navigation" aria-label="Trocar de conversa">
      <button type="button" className="dmq-sw-btn" onClick={() => navigate('/dms?tab=mensagens')} title="Voltar para o Social" aria-label="Voltar para o Social"><Svg d={BACK} /></button>
      <div className="dmq-sw-list">
        {list.map((c) => {
          const unread = isConversationUnread(c, user.id);
          const on = c.id === currentId;
          return (
            <button
              key={c.id} ref={on ? curRef : null} type="button"
              className={`dmq-chip${on ? ' is-on' : ''}${unread ? ' is-unread' : ''}`}
              onClick={() => navigate(`/conversations/${c.id}`)} title={convName(c, user.id)}
            >
              <Avatar c={c} meId={user.id} size={22} />
              <span className="dmq-chip-name" data-no-translate>{convName(c, user.id)}</span>
              {unread && !on && <span className="dmq-unread" />}
            </button>
          );
        })}
      </div>
      <button type="button" className="dmq-sw-btn" onClick={() => setNewOpen(true)} title="Nova conversa" aria-label="Nova conversa"><Svg d={PLUS} /></button>
      {newOpen && <NewDMModal onClose={() => setNewOpen(false)} />}
    </div>
  );
}

// "Enviar mensagem para…" — busca amigos e conversas; Enter abre a DM.
export function QuickMessageBox() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const openDM = useOpenDM();
  const friends = useStore((s) => s.friends);
  const presence = useStore((s) => s.presence);
  const convs = useSortedConversations();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    const match = (...xs) => !term || xs.some((x) => (x || '').toLowerCase().includes(term));
    const out = [];
    const seenUsers = new Set();
    for (const c of convs) {
      const name = convName(c, user.id);
      const other = !c.isGroup ? c.members.find((m) => m.id !== user.id) : null;
      if (match(name, other?.username)) { out.push({ key: `c${c.id}`, kind: 'conv', c, name, sub: lastPreview(c, user.id) }); if (other) seenUsers.add(other.id); }
    }
    const fr = friends.filter((f) => f.status === 'ACCEPTED' && !seenUsers.has(f.user.id) && match(f.user.displayName, f.user.username))
      .sort((a, b) => Number(ONLINE(presence[b.user.id]?.status || b.user.status)) - Number(ONLINE(presence[a.user.id]?.status || a.user.status)));
    for (const f of fr) out.push({ key: `u${f.user.id}`, kind: 'user', u: f.user, name: f.user.displayName, sub: `@${f.user.username || ''} · nova conversa` });
    return out.slice(0, 8);
  }, [q, convs, friends, presence, user.id]);

  const pick = (r) => {
    setOpen(false); setQ('');
    if (r.kind === 'conv') navigate(`/conversations/${r.c.id}`); else openDM(r.u.id);
  };

  return (
    <div className="dmq-box" ref={boxRef}>
      <label className="dmq-input">
        <Svg d={SEARCH} size={16} />
        <input
          value={q} placeholder="Enviar mensagem para…" aria-label="Enviar mensagem para"
          onChange={(e) => { setQ(e.target.value); setSel(0); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            else if (e.key === 'Enter' && results[sel]) { e.preventDefault(); pick(results[sel]); }
            else if (e.key === 'Escape') setOpen(false);
          }}
        />
      </label>
      {open && (
        <div className="dmq-pop" role="listbox">
          {!results.length && <p className="dmq-empty">Ninguém encontrado.</p>}
          {results.map((r, i) => (
            <button key={r.key} type="button" role="option" aria-selected={i === sel} className={`dmq-opt${i === sel ? ' is-sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => pick(r)}>
              {r.kind === 'conv' ? <Avatar c={r.c} meId={user.id} /> : (
                <span className="dmq-av" style={{ width: 32, height: 32 }}><UserAvatar user={r.u} size={32} /><PresenceDot status={presence[r.u.id]?.status || r.u.status} userId={r.u.id} /></span>
              )}
              <span className="dmq-opt-text"><b data-no-translate>{r.name}</b><small data-no-translate>{r.sub}</small></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Fileira de conversas recentes + amigos online (um clique abre a DM).
export function RecentDMs() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const openDM = useOpenDM();
  const friends = useStore((s) => s.friends);
  const presence = useStore((s) => s.presence);
  const convs = useSortedConversations();
  const items = useMemo(() => {
    const out = convs.slice(0, 10).map((c) => ({ key: c.id, c }));
    const have = new Set(convs.slice(0, 10).flatMap((c) => (c.isGroup ? [] : c.members.map((m) => m.id))));
    friends.filter((f) => f.status === 'ACCEPTED' && !have.has(f.user.id) && ONLINE(presence[f.user.id]?.status || f.user.status))
      .slice(0, 6).forEach((f) => out.push({ key: `u${f.user.id}`, u: f.user }));
    return out;
  }, [convs, friends, presence]);
  if (!items.length) return null;
  return (
    <div className="dmq-recent" aria-label="Conversas recentes">
      {items.map((it) => {
        const unread = it.c && isConversationUnread(it.c, user.id);
        const name = it.c ? convName(it.c, user.id) : it.u.displayName;
        return (
          <button key={it.key} type="button" className={`dmq-recent-item${unread ? ' is-unread' : ''}`} title={name}
            onClick={() => (it.c ? navigate(`/conversations/${it.c.id}`) : openDM(it.u.id))}>
            {it.c ? <Avatar c={it.c} meId={user.id} size={52} /> : (
              <span className="dmq-av" style={{ width: 52, height: 52 }}><UserAvatar user={it.u} size={52} /><PresenceDot status={presence[it.u.id]?.status || it.u.status} userId={it.u.id} /></span>
            )}
            {unread && <span className="dmq-unread" />}
            <span className="dmq-recent-name" data-no-translate>{name.split(' ')[0]}</span>
          </button>
        );
      })}
    </div>
  );
}
