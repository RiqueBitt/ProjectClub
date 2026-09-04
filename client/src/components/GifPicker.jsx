import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { addFavoriteGif, removeFavoriteGif } from '../api/endpoints';
import { useSheetDrag } from '../utils/useSheetDrag';
import starIcon from '../assets/icons/star.png';

// Google shut down the Tenor GIF API for good on 2026-06-30 (announced
// 2026-01-13) — every request to tenor.googleapis.com now fails, which is
// why this picker used to show nothing at all. KLIPY is the closest drop-in
// replacement: same request/response shape as Tenor's v2 API, just a
// different host and your own (free) API key instead of a shared demo key.
// Get a free key at https://partner.klipy.com/ and put it in client/.env as
// VITE_KLIPY_KEY=... (see client/.env.example). Restart `npm run dev` (or
// rebuild) after adding it — Vite only reads env vars at startup/build time.
const KLIPY_KEY = import.meta.env.VITE_KLIPY_KEY || '';
const KLIPY_CLIENT = 'embercord';

export default function GifPicker({ onPick, onClose, style }) {
  const { heightVh, dragHandlers } = useSheetDrag(onClose);
  const [tab, setTab] = useState('search'); // 'search' | 'favorites'
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const debounceRef = useRef(null);
  // Item pedido: "novo visual para o menu de gif" — tela inicial tipo
  // mural de categorias (Favoritos / Em alta / categorias de verdade
  // buscadas da API), em vez de já cair direto numa busca vazia.
  // Clicar numa categoria entra na busca por aquele termo, com um
  // título + seta de voltar pro mural.
  const [categories, setCategories] = useState(null); // null = ainda carregando, [] = API não devolveu nenhuma
  const [activeCategory, setActiveCategory] = useState(null); // { name, searchterm } | null = está no mural

  const favoriteGifs = useStore((s) => s.favoriteGifs);
  const addFavoriteGifLocal = useStore((s) => s.addFavoriteGifLocal);
  const removeFavoriteGifLocal = useStore((s) => s.removeFavoriteGifLocal);
  const favoriteIds = new Set(favoriteGifs.map((g) => g.gifId));

  const search = async (q) => {
    if (!KLIPY_KEY) {
      setLoading(false);
      setFailed('unconfigured');
      setResults([]);
      return;
    }
    setLoading(true);
    setFailed(false);
    try {
      const endpoint = q.trim()
        ? `https://api.klipy.com/v2/search?q=${encodeURIComponent(q)}&key=${KLIPY_KEY}&client_key=${KLIPY_CLIENT}&limit=24&media_filter=gif`
        : `https://api.klipy.com/v2/featured?key=${KLIPY_KEY}&client_key=${KLIPY_CLIENT}&limit=24&media_filter=gif`;
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error('klipy request failed');
      const data = await res.json();
      setResults((data.results || []).map((r) => ({
        id: r.id,
        preview: r.media_formats?.tinygif?.url || r.media_formats?.gif?.url,
        full: r.media_formats?.gif?.url,
      })).filter((g) => g.full));
    } catch {
      setFailed(true);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  // Item pedido: mural de categorias reais — Klipy é um "drop-in
  // replacement" do Tenor v2 (mesmo formato de request/resposta, só
  // muda o host), e o Tenor documenta um endpoint /v2/categories que
  // devolve { tags: [{ searchterm, name, image }, ...] }. Carrega uma
  // vez só, ao abrir o menu — se a chave não estiver configurada ou o
  // endpoint falhar por qualquer motivo, cai pra lista vazia (o mural
  // ainda mostra Favoritos/Em alta normalmente, só sem as categorias
  // extras) em vez de quebrar a tela inteira.
  useEffect(() => {
    if (!KLIPY_KEY) { setCategories([]); return; }
    fetch(`https://api.klipy.com/v2/categories?key=${KLIPY_KEY}&client_key=${KLIPY_CLIENT}&media_filter=gif`)
      .then((r) => (r.ok ? r.json() : { tags: [] }))
      .then((data) => setCategories((data.tags || []).slice(0, 12)))
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => { if (tab === 'search' && !activeCategory) search(''); }, [tab]);

  const openCategory = (cat) => {
    setActiveCategory(cat);
    search(cat.searchterm);
  };
  const backToMural = () => {
    setActiveCategory(null);
    setQuery('');
    search('');
  };

  const onQueryChange = (v) => {
    setQuery(v);
    setActiveCategory(null); // digitar livremente sai do modo "dentro de uma categoria"
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(v), 350);
  };

  // Shared by both tabs: a search-result gif has a stable provider `id`; a
  // favorited gif (from the Favoritos tab or straight off a chat message,
  // see Message.jsx) only has its URL. Either way the URL is what actually
  // ends up as the outgoing message, so favoriting just needs *a* stable key
  // and the full URL — see gifController.js on the backend for the same
  // id-or-url fallback.
  const toggleFavorite = async (e, gif) => {
    e.stopPropagation();
    const key = gif.id ?? gif.full;
    if (favoriteIds.has(key)) {
      removeFavoriteGifLocal(key);
      await removeFavoriteGif(key).catch(() => {});
    } else {
      const optimistic = { gifId: key, url: gif.full, preview: gif.preview || gif.full };
      addFavoriteGifLocal(optimistic);
      await addFavoriteGif({ gifId: key, url: gif.full, preview: gif.preview || gif.full }).catch(() => {});
    }
  };

  const shownGifs = tab === 'favorites'
    ? favoriteGifs.map((g) => ({ id: g.gifId, preview: g.preview || g.url, full: g.url }))
    : results;

  const showMural = tab === 'search' && !activeCategory && !query.trim();

  return (
    <div className="gif-picker-popover composer-centered-picker" style={{ '--sheet-height': `${heightVh}vh`, ...style }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="sheet-drag-handle" {...dragHandlers} />
      <div className="gif-picker-tabs">
        <button className={tab === 'search' ? 'active' : ''} onClick={() => { setTab('search'); }}>Buscar</button>
        <button className={tab === 'favorites' ? 'active' : ''} onClick={() => setTab('favorites')}><img className="ui-icon-sm" src={starIcon} alt="" /> Favoritos</button>
      </div>
      {tab === 'search' && !showMural && (
        <div className="gif-picker-header">
          <button type="button" className="gif-picker-back" onClick={backToMural} title="Voltar">←</button>
          <span className="gif-picker-header-title truncate">{activeCategory ? activeCategory.name : (query.trim() ? `Resultados para "${query}"` : '')}</span>
        </div>
      )}
      {tab === 'search' && (
        <input
          className="emoji-picker-search"
          placeholder="Buscar GIFs..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          // BUG CORRIGIDO ("abrir o menu de GIFs no mobile acaba
          // abrindo o teclado do celular") — mesma correção do
          // EmojiPicker.jsx: autoFocus só em telas maiores que 600px.
          autoFocus={window.innerWidth > 600}
          disabled={failed === 'unconfigured'}
        />
      )}
      {/* Item pedido: "novo visual para o menu de gif" — mural de
          categorias como tela inicial, no lugar de já cair direto
          numa busca vazia. Favoritos/Em alta são fixos; o resto vem
          da API (ver o useEffect de categories acima) — se a API não
          devolver nada, o mural ainda funciona só com os dois fixos. */}
      {showMural ? (
        <div className="gif-picker-mural">
          <button type="button" className="gif-picker-mural-tile gif-picker-mural-tile-solid" onClick={() => setTab('favorites')}>
            <span>Favoritos</span>
          </button>
          <button
            type="button" className="gif-picker-mural-tile"
            style={results[0]?.preview ? { backgroundImage: `url(${results[0].preview})` } : undefined}
            onClick={() => openCategory({ name: 'GIFs em alta', searchterm: '' })}
          >
            <span>📈 GIFs em alta</span>
          </button>
          {(categories || []).map((cat) => (
            <button
              type="button" key={cat.searchterm} className="gif-picker-mural-tile"
              style={cat.image ? { backgroundImage: `url(${cat.image})` } : undefined}
              onClick={() => openCategory(cat)}
            >
              <span>{cat.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="gif-picker-grid">
          {tab === 'search' && loading && <div className="dim">Buscando...</div>}
          {tab === 'search' && !loading && failed === 'unconfigured' && (
            <div className="dim gif-picker-message">
              Busca de GIFs ainda não configurada.<br />
              Crie uma chave gratuita em <b>partner.klipy.com</b> e adicione como
              <code> VITE_KLIPY_KEY </code> em <code>client/.env</code>.
            </div>
          )}
          {tab === 'search' && !loading && failed === true && <div className="dim">Não foi possível carregar GIFs agora. Tente novamente mais tarde.</div>}
          {tab === 'favorites' && shownGifs.length === 0 && (
            <div className="dim gif-picker-message">
              Nenhum GIF favoritado ainda.<br />
              Clique na ⭐ em qualquer GIF (na busca ou em uma mensagem já enviada) para salvá-lo aqui.
            </div>
          )}
          {tab === 'search' && !loading && !failed && shownGifs.length === 0 && <div className="dim">Nenhum resultado.</div>}
          {shownGifs.map((g) => (
            <button key={g.id} className="gif-picker-tile" onClick={() => { onPick(g.full); onClose?.(); }}>
              <img src={g.preview} alt="" loading="lazy" />
              <span
                className={`gif-favorite-btn ${favoriteIds.has(g.id ?? g.full) ? 'active' : ''}`}
                role="button"
                title={favoriteIds.has(g.id ?? g.full) ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                onClick={(e) => toggleFavorite(e, g)}
              >
                {favoriteIds.has(g.id ?? g.full) ? <img className="ui-icon-sm" src={starIcon} alt="" /> : '☆'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
