import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import { searchUsers, listPosts } from '../api/endpoints';
import UserAvatar from '../components/UserAvatar.jsx';
import { Ico, PageHero, PillTabs, EmptyState, Skeleton } from '../components/PagesKit.jsx';
import '../styles/search.css';

// Destaca o trecho buscado dentro do texto (sem diferenciar maiúsculas).
function Hl({ text, q }) {
  const str = String(text || '');
  if (!q) return str;
  const i = str.toLowerCase().indexOf(q);
  if (i < 0) return str;
  return <>{str.slice(0, i)}<mark className="sr-mark">{str.slice(i, i + q.length)}</mark>{str.slice(i + q.length)}</>;
}

// Recorte do conteúdo do post em volta do termo, pra mostrar o destaque.
function snippet(text, q, size = 110) {
  const str = String(text || '').replace(/\s+/g, ' ').trim();
  if (!str) return '';
  const i = q ? str.toLowerCase().indexOf(q) : -1;
  if (i < 0) return str.length > size ? `${str.slice(0, size)}…` : str;
  const start = Math.max(0, i - 40);
  const out = str.slice(start, start + size);
  return `${start > 0 ? '…' : ''}${out}${start + size < str.length ? '…' : ''}`;
}

const TYPES = [
  { id: 'ALL', label: 'Tudo', icon: 'search' },
  { id: 'PEOPLE', label: 'Pessoas', icon: 'user' },
  { id: 'POSTS', label: 'Posts', icon: 'news' },
  { id: 'CHANNELS', label: 'Canais', icon: 'hash' },
  { id: 'CONVERSATIONS', label: 'Conversas', icon: 'mail' },
];
const PREVIEW = 4;

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
  const [type, setType] = useState('ALL');
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

  // Item pedido: otimização/velocidade — sem atraso nenhum, cada tecla
  // digitada disparava as 2 buscas (usuários + posts) na hora, mesmo
  // sabendo que a próxima tecla ia invalidar isso quase imediatamente.
  // Digitar uma palavra de 10 letras chegava a mandar ~20 requisições
  // pro servidor, quase todas jogadas fora. Um "debounce" simples
  // (useRef guarda o temporizador, sem precisar de mais um useState só
  // pra isso) espera a pessoa realmente PARAR de digitar por 300ms
  // antes de buscar de verdade — tempo curto o bastante pra continuar
  // parecendo instantâneo, mas já corta a esmagadora maioria das
  // requisições desperdiçadas.
  const searchDebounceRef = useRef(null);
  const onChange = (e) => {
    const value = e.target.value;
    setQuery(value);
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      runUserSearch(value);
      runPostSearch(value);
    }, 300);
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

  const convName = (c) => {
    const other = !c.isGroup ? c.members.find((m) => m.id !== user.id) : null;
    return { name: c.isGroup ? (c.name || c.members.map((m) => m.displayName).join(', ')) : other?.displayName, other };
  };

  const counts = {
    PEOPLE: userResults.length, POSTS: postResults.length, CHANNELS: channelResults.length, CONVERSATIONS: conversationResults.length,
  };
  counts.ALL = counts.PEOPLE + counts.POSTS + counts.CHANNELS + counts.CONVERSATIONS;
  const busy = searching || searchingPosts;
  const show = (t) => type === 'ALL' || type === t;
  const cut = (list) => (type === 'ALL' ? list.slice(0, PREVIEW) : list);

  const Section = ({ id, title, icon, loading, emptyText, children, total }) => {
    if (!show(id)) return null;
    // Em "Tudo", esconde a seção vazia (menos barulho); na aba própria mostra o vazio.
    if (type === 'ALL' && !loading && total === 0) return null;
    return (
      <section className="notifications-section sr-section">
        <header className="sr-section-head">
          <h3><Ico name={icon} size={16} /> {title} {total > 0 && <span>{total}</span>}</h3>
          {type === 'ALL' && total > PREVIEW && (
            <button className="sr-more" onClick={() => setType(id)}>Ver todos <Ico name="right" size={14} /></button>
          )}
        </header>
        {loading && total === 0 ? <Skeleton rows={2} height={56} /> : total === 0 ? (
          <EmptyState compact icon={icon} text={emptyText} />
        ) : children}
      </section>
    );
  };

  return (
    <div className="search-page pk-page sr">
      <div className="pk-inner narrow">
        <PageHero icon="search" eyebrow="Encontre qualquer coisa" title="Busca" desc="Pessoas, posts dos Feeds, canais e conversas — tudo num só lugar.">
          <label className="sr-input-wrap">
            <Ico name="search" size={20} />
            <input
              autoFocus
              className="search-page-input sr-input"
              placeholder="Buscar canais, conversas ou pessoas..."
              value={query}
              onChange={onChange}
            />
            {busy && <span className="sr-spinner" aria-label="Buscando" />}
          </label>
        </PageHero>

        {!q && (
          <EmptyState icon="search" title="O que você procura?" text="Digite para buscar em toda a plataforma." />
        )}

        {q && (
          <>
            <PillTabs
              className="small" label="Tipo de resultado" value={type} onChange={setType}
              tabs={TYPES.map((t) => ({ ...t, count: counts[t.id] }))}
            />

            {type === 'ALL' && !busy && counts.ALL === 0 && (
              <EmptyState icon="search" title="Nada encontrado" text={`Nenhum resultado para "${query.trim()}". Tente outra palavra.`} />
            )}

            <div className="search-page-results sr-results">
              <Section id="PEOPLE" title="Pessoas" icon="user" loading={searching} total={userResults.length} emptyText="Nenhuma pessoa encontrada.">
                <ul className="notifications-list sr-list sr-people">
                  {cut(userResults).map((u) => (
                    <li key={u.id} className="notifications-item sr-item" onClick={() => useStore.getState().openMiniProfile(u.id, null)}>
                      <UserAvatar user={u} size={40} />
                      <div className="sr-item-body">
                        <strong className="truncate"><Hl text={u.displayName} q={q} /></strong>
                        <span className="truncate">@<Hl text={u.username} q={q} /></span>
                      </div>
                      <Ico name="right" size={16} className="sr-chev" />
                    </li>
                  ))}
                </ul>
              </Section>

              <Section id="POSTS" title="Posts" icon="news" loading={searchingPosts} total={postResults.length} emptyText="Nenhum post encontrado.">
                <ul className="notifications-list sr-list">
                  {cut(postResults).map((p) => (
                    <li key={p.id} className="notifications-item sr-item sr-post" onClick={() => navigate(`/posts/${p.id}`)}>
                      <span className="sr-item-icon"><Ico name="news" size={18} /></span>
                      <div className="sr-item-body">
                        <strong className="sr-post-title"><Hl text={p.title} q={q} /></strong>
                        {p.content && <span className="sr-post-snippet"><Hl text={snippet(p.content, q)} q={q} /></span>}
                        <span className="sr-meta">
                          {p.community?.name && <span className="pk-chip brand">{p.community.name}</span>}
                          {p.author?.displayName && <span>por {p.author.displayName}</span>}
                          {typeof p.commentCount === 'number' && <span><Ico name="chat" size={13} /> {p.commentCount}</span>}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>

              <Section id="CHANNELS" title="Canais" icon="hash" total={channelResults.length} emptyText="Nenhum canal encontrado.">
                <ul className="notifications-list sr-list">
                  {cut(channelResults).map((c) => (
                    <li key={c.id} className="notifications-item sr-item" onClick={() => navigate(`/channels/${c.id}`)}>
                      <span className="sr-item-icon"><Ico name={c.type === 'VOICE' ? 'volume' : 'hash'} size={18} /></span>
                      <div className="sr-item-body">
                        <strong className="truncate"><Hl text={c.name} q={q} /></strong>
                        <span>{c.type === 'VOICE' ? 'Canal de voz' : 'Canal de texto'}</span>
                      </div>
                      <Ico name="right" size={16} className="sr-chev" />
                    </li>
                  ))}
                </ul>
              </Section>

              <Section id="CONVERSATIONS" title="Conversas" icon="mail" total={conversationResults.length} emptyText="Nenhuma conversa encontrada.">
                <ul className="notifications-list sr-list">
                  {cut(conversationResults).map((c) => {
                    const { name, other } = convName(c);
                    return (
                      <li key={c.id} className="notifications-item sr-item" onClick={() => navigate(`/conversations/${c.id}`)}>
                        {other ? <UserAvatar user={other} size={40} /> : <span className="sr-item-icon"><Ico name="users" size={18} /></span>}
                        <div className="sr-item-body">
                          <strong className="truncate"><Hl text={name} q={q} /></strong>
                          <span>{c.isGroup ? `Grupo · ${c.members.length} pessoas` : 'Conversa direta'}</span>
                        </div>
                        <Ico name="right" size={16} className="sr-chev" />
                      </li>
                    );
                  })}
                </ul>
              </Section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
