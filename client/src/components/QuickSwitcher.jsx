import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';

// Ctrl+K / Cmd+K quick-jump palette - search across every channel in the
// server you're currently in, plus every DM/group conversation, and jump
// straight there. Adapted from an idea in a Discord-clone reference project
// the user shared (that one used cmdk + Next.js routing; this is the same
// concept rebuilt on this app's own Modal/react-router-dom setup rather
// than pulling in a new UI library for one feature).
export default function QuickSwitcher() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const categories = useStore((s) => s.categories);
  const channels = useStore((s) => s.channels);
  const conversations = useStore((s) => s.conversations);
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) { setQuery(''); setActiveIndex(0); }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const channelItems = [...channels, ...categories.flatMap((c) => c.channels || [])]
      .filter((c) => c.type !== 'VOICE' && c.type !== 'STAGE')
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .map((c) => ({ id: c.id, label: c.name, sub: 'Canal', go: () => navigate(`/channels/${c.id}`) }));

    const dmItems = conversations
      .map((c) => {
        const other = !c.isGroup ? c.members.find((m) => m.id !== user.id) : null;
        const name = c.isGroup ? (c.name || c.members.map((m) => m.displayName).join(', ')) : other?.displayName;
        return { id: c.id, label: name || 'Conversa', sub: c.isGroup ? 'Grupo' : 'Mensagem direta', go: () => navigate(`/conversations/${c.id}`) };
      })
      .filter((it) => !q || it.label.toLowerCase().includes(q));

    return [
      { heading: 'Canais', items: channelItems.slice(0, 8) },
      { heading: 'Conversas', items: dmItems.slice(0, 8) },
    ].filter((g) => g.items.length > 0);
  }, [query, categories, channels, conversations, user.id, navigate]);

  const flat = results.flatMap((g) => g.items);

  const onKeyDownInput = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, flat.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); const item = flat[activeIndex]; if (item) { item.go(); setOpen(false); } }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay quick-switcher-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="quick-switcher-box">
        <input
          autoFocus
          className="quick-switcher-input"
          placeholder="Pular para um canal ou conversa..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
          onKeyDown={onKeyDownInput}
        />
        <div className="quick-switcher-results">
          {flat.length === 0 && <div className="quick-switcher-empty dim">Nada encontrado.</div>}
          {results.map((group) => (
            <div key={group.heading} className="quick-switcher-group">
              <div className="quick-switcher-group-label">{group.heading}</div>
              {group.items.map((item) => {
                const index = flat.indexOf(item);
                return (
                  <button
                    key={item.id}
                    className={`quick-switcher-item ${index === activeIndex ? 'active' : ''}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => { item.go(); setOpen(false); }}
                  >
                    <span className="truncate">{item.label}</span>
                    <span className="dim quick-switcher-item-sub truncate">{item.sub}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="quick-switcher-hint dim">↑↓ pra navegar · Enter pra abrir · Esc pra fechar</div>
      </div>
    </div>
  );
}
