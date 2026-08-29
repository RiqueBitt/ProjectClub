import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import { searchUsers, listPosts } from '../api/endpoints';

// Área de busca da plataforma: canais, conversas e usuários num só lugar.
// Reaproveita a mesma ideia do QuickSwitcher.jsx (Ctrl+K, que continua
// funcionando normalmente em paralelo), só que como uma página própria
// acessível pela barra lateral principal, sem precisar do atalho de
// teclado.
export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [userResults, setUserResults] = useState([]);
  const [postResults, setPostResults] = useState([]);
  const [searchingPosts, setSearchingPosts] = useState(false);
  const [searching, setSearching] = useState(false);
  const categories = useStore((s) => s.categories);
  const channels = useStore((s) => s.channels);
  const conversations = useStore((s) => s.conversations);
  const { user } = useAuth();
  const navigate = useNavigate();

  const q = query.trim().toLowerCase();

  const channelResults = useMemo(() => {
    const all = [...channels, ...categories.flatMap((c) => c.channels || [])];
    if (!q) return [];
    return all.filter((c) => c.name.toLowerCase().includes(q));
  }, [q, channels, categories]);

  const conversationResults = useMemo(() => {
    if (!q) return [];
    return conversations.filter((c) => {
      const other = !c.isGroup ? c.members.find((m) => m.id !== user.id) : null;
      const name = c.isGroup ? (c.name || c.members.map((m) => m.displayName).join(', ')) : other?.displayName;
      return (name || '').toLowerCase().includes(q);
    });
  }, [q, conversations, user.id]);

  const onChange = async (e) => {
    const value = e.target.value;
    setQuery(value);
    runUserSearch(value);
    runPostSearch(value);
  };

  const runUserSearch = async (value) => {
    if (value.trim().length < 2) { setUserResults([]); return; }
    setSearching(true);
    const { users } = await searchUsers(value.trim()).catch(() => ({ users: [] }));
    setUserResults(users);
    setSearching(false);
  };

  // Item pedido: busca também encontrando posts dos Feeds — reaproveita
  // o mesmo listPosts que a página de Feeds já usa, só passando o termo
  // digitado como filtro (ver o parâmetro `q` novo em
  // postsController.listPosts).
  const runPostSearch = async (value) => {
    if (value.trim().length < 2) { setPostResults([]); return; }
    setSearchingPosts(true);
    const { posts } = await listPosts({ q: value.trim(), sort: 'new' }).catch(() => ({ posts: [] }));
    setPostResults(posts);
    setSearchingPosts(false);
  };

  // Chega já preenchida quando vem da busca do topo (TopSearchBar.jsx,
  // navega pra /search?q=...) — dispara a busca de usuários na hora, em
  // vez de só preencher o campo e esperar a pessoa digitar de novo.
  useEffect(() => {
    if (searchParams.get('q')) { runUserSearch(searchParams.get('q')); runPostSearch(searchParams.get('q')); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="search-page">
      <h2 className="notifications-page-title">Busca</h2>
      <input
        autoFocus
        className="search-page-input"
        placeholder="Buscar canais, conversas ou pessoas..."
        value={query}
        onChange={onChange}
      />

      {!q && <p className="dim">Digite para buscar em toda a plataforma.</p>}

      {q && (
        <div className="search-page-results">
          <section className="notifications-section">
            <h3>Canais</h3>
            {channelResults.length === 0 && <p className="dim">Nenhum canal encontrado.</p>}
            <ul className="notifications-list">
              {channelResults.map((c) => (
                <li key={c.id} className="notifications-item" onClick={() => navigate(`/channels/${c.id}`)}>
                  <span className="notifications-item-icon">💬</span>
                  <span className="truncate">{c.name}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="notifications-section">
            <h3>Conversas</h3>
            {conversationResults.length === 0 && <p className="dim">Nenhuma conversa encontrada.</p>}
            <ul className="notifications-list">
              {conversationResults.map((c) => {
                const other = !c.isGroup ? c.members.find((m) => m.id !== user.id) : null;
                const name = c.isGroup ? (c.name || c.members.map((m) => m.displayName).join(', ')) : other?.displayName;
                return (
                  <li key={c.id} className="notifications-item" onClick={() => navigate(`/conversations/${c.id}`)}>
                    <span className="notifications-item-icon">✉️</span>
                    <span className="truncate">{name}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="notifications-section">
            <h3>Posts</h3>
            {searchingPosts && <p className="dim">Buscando...</p>}
            {!searchingPosts && postResults.length === 0 && <p className="dim">Nenhum post encontrado.</p>}
            <ul className="notifications-list">
              {postResults.map((p) => (
                <li key={p.id} className="notifications-item" onClick={() => navigate(`/posts/${p.id}`)}>
                  <span className="notifications-item-icon">📝</span>
                  <span className="truncate">{p.title} <span className="dim">em {p.community?.name}</span></span>
                </li>
              ))}
            </ul>
          </section>

          <section className="notifications-section">
            <h3>Pessoas</h3>
            {searching && <p className="dim">Buscando...</p>}
            {!searching && userResults.length === 0 && <p className="dim">Nenhuma pessoa encontrada.</p>}
            <ul className="notifications-list">
              {userResults.map((u) => (
                <li key={u.id} className="notifications-item" onClick={() => useStore.getState().openMiniProfile(u.id, null)}>
                  <span className="notifications-item-icon">👤</span>
                  <span className="truncate">{u.displayName} <span className="dim">@{u.username}</span></span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
