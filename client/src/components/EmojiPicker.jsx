import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { useSheetDrag } from '../utils/useSheetDrag';
import emojiGroups from 'unicode-emoji-json/data-by-group.json';
import StyledEmoji from './StyledEmoji.jsx';
import { addFavoriteGif, removeFavoriteGif } from '../api/endpoints';
import starIcon from '../assets/icons/star.png';

// Item pedido: "coloque os emojis personalizados dentro do menu de
// emojis... mantenha todos os emojis normais/padrão dentro de uma
// única coleção" — antes, o emoji padrão (unicode) tinha 9 categorias
// próprias (Carinhas, Animais, Comida...) numa aba separada da de
// emoji personalizado; agora tudo isso vira UMA seção só, mostrada
// junto com as coleções de emoji personalizado no mesmo rail lateral
// — o padrão sempre por último, depois de qualquer coleção que a
// comunidade tenha criado.
const UNICODE_ALL = emojiGroups.flatMap((g) => g.emojis.map((e) => ({ emoji: e.emoji, name: e.name })));
const UNICODE_COLLECTION_KEY = 'unicode-default';

// Google shut down the Tenor GIF API for good on 2026-06-30 (announced
// 2026-01-13) — every request to tenor.googleapis.com now fails, which is
// why the old picker used to show nothing at all. KLIPY is the closest
// drop-in replacement: same request/response shape as Tenor's v2 API, just
// a different host and your own (free) API key instead of a shared demo
// key. Get a free key at https://partner.klipy.com/ and put it in
// client/.env as VITE_KLIPY_KEY=... (see client/.env.example). Restart
// `npm run dev` (or rebuild) after adding it — Vite only reads env vars at
// startup/build time.
const KLIPY_KEY = import.meta.env.VITE_KLIPY_KEY || '';
const KLIPY_CLIENT = 'embercord';

export default function EmojiPicker({ serverEmojis = [], serverStickers = [], onPick, onPickSticker, onPickGif, onClose, style, variant = 'composer', defaultHeightVh }) {
  const { heightVh, dragHandlers } = useSheetDrag(onClose, defaultHeightVh);
  const usableEmojis = useStore((s) => s.usableEmojis);
  const usableStickers = useStore((s) => s.usableStickers);
  // Item pedido: "emoji personalizado e figurinha vai ter a mesma
  // categoria que o emoji normal, aquela barra lateral" — as coleções
  // já vêm carregadas centralmente (ver MainApp.jsx/SocketContext.jsx),
  // não precisa buscar de novo toda vez que o seletor abre.
  const emojiCollections = useStore((s) => s.emojiCollections);
  const stickerCollections = useStore((s) => s.stickerCollections);
  // Item pedido: "deixando emojis, GIFs e figurinhas centralizados em
  // um único menu compacto" — de 4 abas (Servidor/Outros/Emojis/
  // Figurinhas) mais um seletor de GIF totalmente à parte, pra só 3:
  // Emojis (personalizado + padrão + de outros servidores juntos no
  // mesmo rail), Figurinhas, GIFs.
  const [tab, setTab] = useState('emojis');
  const [query, setQuery] = useState('');
  const emojiScrollRef = useRef(null);
  const stickerScrollRef = useRef(null);
  const catSectionRefs = useRef({});

  const scrollToCategory = (cat) => {
    catSectionRefs.current[cat]?.scrollIntoView({ block: 'start' });
  };

  // Item pedido: mesma barra lateral do emoji nativo, agora agrupando
  // por COLEÇÃO (nome + ícone escolhidos por quem criou) em vez do
  // campo de categoria em texto livre de antes — "Sem coleção" reúne
  // quem ainda não foi organizado em nenhuma.
  const groupByCollection = (items, collections) => {
    const byId = Object.fromEntries(collections.map((c) => [c.id, c]));
    const groups = collections.map((c) => ({ key: c.id, label: c.name, iconUrl: c.iconUrl, list: [] }));
    const uncategorized = { key: 'none', label: 'Sem coleção', iconUrl: null, list: [] };
    for (const item of items) {
      const group = item.collectionId && byId[item.collectionId] ? groups.find((g) => g.key === item.collectionId) : uncategorized;
      group.list.push(item);
    }
    return [...groups, uncategorized].filter((g) => g.list.length > 0);
  };

  const customGroups = useMemo(() => groupByCollection(serverEmojis, emojiCollections), [serverEmojis, emojiCollections]);

  const externalGrouped = useMemo(() => {
    const acc = {};
    const serverEmojiIds = new Set(serverEmojis.map((e) => e.id));
    for (const e of usableEmojis) {
      if (serverEmojiIds.has(e.id)) continue;
      (acc[e.serverName || 'Outros servidores'] ||= []).push(e);
    }
    return acc;
  }, [usableEmojis, serverEmojis]);

  // Stickers work the same "this server's own + every other server's I
  // belong to" split as emojis, just rendered bigger and sent as their own
  // standalone message (see onPickSticker) instead of inserted as text.
  const stickerGroups = useMemo(() => groupByCollection(serverStickers, stickerCollections), [serverStickers, stickerCollections]);
  const externalStickerGrouped = useMemo(() => {
    const serverStickerIds = new Set(serverStickers.map((s) => s.id));
    const others = {};
    for (const s of usableStickers) {
      if (serverStickerIds.has(s.id)) continue;
      (others[s.serverName || 'Outros servidores'] ||= []).push(s);
    }
    return others;
  }, [usableStickers, serverStickers]);
  const hasStickers = serverStickers.length > 0 || Object.keys(externalStickerGrouped).length > 0;

  const q = query.trim().toLowerCase();

  // --- GIFs (movido de GifPicker.jsx pra virar uma aba aqui dentro) ---
  const [gifSubTab, setGifSubTab] = useState('search'); // 'search' | 'favorites'
  const [gifResults, setGifResults] = useState([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [gifFailed, setGifFailed] = useState(false);
  const gifDebounceRef = useRef(null);
  const [gifCategories, setGifCategories] = useState(null); // null = carregando, [] = API não devolveu nada
  const [activeGifCategory, setActiveGifCategory] = useState(null); // { name, searchterm } | null = mural

  const favoriteGifs = useStore((s) => s.favoriteGifs);
  const addFavoriteGifLocal = useStore((s) => s.addFavoriteGifLocal);
  const removeFavoriteGifLocal = useStore((s) => s.removeFavoriteGifLocal);
  const favoriteGifIds = new Set(favoriteGifs.map((g) => g.gifId));

  const searchGifs = async (term) => {
    if (!KLIPY_KEY) { setGifLoading(false); setGifFailed('unconfigured'); setGifResults([]); return; }
    setGifLoading(true);
    setGifFailed(false);
    try {
      const endpoint = term.trim()
        ? `https://api.klipy.com/v2/search?q=${encodeURIComponent(term)}&key=${KLIPY_KEY}&client_key=${KLIPY_CLIENT}&limit=24&media_filter=gif`
        : `https://api.klipy.com/v2/featured?key=${KLIPY_KEY}&client_key=${KLIPY_CLIENT}&limit=24&media_filter=gif`;
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error('klipy request failed');
      const data = await res.json();
      setGifResults((data.results || []).map((r) => ({
        id: r.id,
        preview: r.media_formats?.tinygif?.url || r.media_formats?.gif?.url,
        full: r.media_formats?.gif?.url,
      })).filter((g) => g.full));
    } catch {
      setGifFailed(true);
      setGifResults([]);
    } finally {
      setGifLoading(false);
    }
  };

  useEffect(() => {
    if (!KLIPY_KEY) { setGifCategories([]); return; }
    fetch(`https://api.klipy.com/v2/categories?key=${KLIPY_KEY}&client_key=${KLIPY_CLIENT}&media_filter=gif`)
      .then((r) => (r.ok ? r.json() : { tags: [] }))
      .then((data) => setGifCategories((data.tags || []).slice(0, 12)))
      .catch(() => setGifCategories([]));
  }, []);

  useEffect(() => { if (tab === 'gifs' && gifSubTab === 'search' && !activeGifCategory) searchGifs(''); }, [tab, gifSubTab]);

  const openGifCategory = (cat) => { setActiveGifCategory(cat); searchGifs(cat.searchterm); };
  const backToGifMural = () => { setActiveGifCategory(null); setQuery(''); searchGifs(''); };

  const toggleFavoriteGif = async (e, gif) => {
    e.stopPropagation();
    const key = gif.id ?? gif.full;
    if (favoriteGifIds.has(key)) {
      removeFavoriteGifLocal(key);
      await removeFavoriteGif(key).catch(() => {});
    } else {
      const optimistic = { gifId: key, url: gif.full, preview: gif.preview || gif.full };
      addFavoriteGifLocal(optimistic);
      await addFavoriteGif({ gifId: key, url: gif.full, preview: gif.preview || gif.full }).catch(() => {});
    }
  };

  const shownGifs = gifSubTab === 'favorites'
    ? favoriteGifs.map((g) => ({ id: g.gifId, preview: g.preview || g.url, full: g.url }))
    : gifResults;
  const showGifMural = tab === 'gifs' && gifSubTab === 'search' && !activeGifCategory && !query.trim();

  // Item pedido: "abrir o menu de emoji/GIF no mobile acaba abrindo o
  // teclado do celular" — autoFocus só em telas grandes (mesma régua
  // já usada em outros lugares do app pra "isso é mobile?").
  const searchPlaceholder = tab === 'gifs' ? 'Buscar GIFs...' : tab === 'stickers' ? 'Buscar figurinha...' : 'Buscar emoji...';
  const onSearchChange = (v) => {
    setQuery(v);
    if (tab === 'gifs') {
      setActiveGifCategory(null);
      clearTimeout(gifDebounceRef.current);
      gifDebounceRef.current = setTimeout(() => searchGifs(v), 350);
    }
  };

  return (
    <div className={`emoji-picker-popover ${variant === 'reaction' ? 'reaction-picker' : ''} ${variant === 'composer-centered' ? 'composer-centered-picker' : ''}`} style={{ '--sheet-height': `${heightVh}vh`, ...style }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="sheet-drag-handle" {...dragHandlers} />
      <div className="emoji-picker-tabs">
        <button className={tab === 'emojis' ? 'active' : ''} onClick={() => { setTab('emojis'); setQuery(''); }}>Emojis</button>
        {hasStickers && onPickSticker && <button className={tab === 'stickers' ? 'active' : ''} onClick={() => { setTab('stickers'); setQuery(''); }}>Figurinhas</button>}
        {onPickGif && <button className={tab === 'gifs' ? 'active' : ''} onClick={() => { setTab('gifs'); setQuery(''); setActiveGifCategory(null); }}>GIFs</button>}
      </div>
      {tab === 'gifs' && !showGifMural && (
        <div className="gif-picker-header">
          <button type="button" className="gif-picker-back" onClick={backToGifMural} title="Voltar">←</button>
          <span className="gif-picker-header-title truncate">{activeGifCategory ? activeGifCategory.name : (query.trim() ? `Resultados para "${query}"` : '')}</span>
        </div>
      )}
      {tab === 'gifs' && (
        <div className="emoji-picker-tabs emoji-picker-subtabs">
          <button className={gifSubTab === 'search' ? 'active' : ''} onClick={() => setGifSubTab('search')}>Buscar</button>
          <button className={gifSubTab === 'favorites' ? 'active' : ''} onClick={() => setGifSubTab('favorites')}><img className="ui-icon-sm" src={starIcon} alt="" /> Favoritos</button>
        </div>
      )}
      <input
        className="emoji-picker-search"
        placeholder={searchPlaceholder}
        value={query}
        onChange={(e) => onSearchChange(e.target.value)}
        autoFocus={window.innerWidth > 600}
        disabled={tab === 'gifs' && gifFailed === 'unconfigured'}
      />
      <div className="emoji-picker-body">
        {tab === 'emojis' && (
          <div className="emoji-picker-unicode-layout">
            {!q && (
              <div className="emoji-picker-cat-rail">
                {customGroups.map((g) => (
                  <button key={g.key} className="emoji-picker-cat-rail-btn" title={g.label} onClick={() => scrollToCategory(`server-${g.key}`)}>
                    {g.iconUrl ? <img src={g.iconUrl} alt="" className="asset-collection-rail-icon" /> : '📄'}
                  </button>
                ))}
                {Object.keys(externalGrouped).map((serverName) => (
                  <button key={serverName} className="emoji-picker-cat-rail-btn" title={serverName} onClick={() => scrollToCategory(`ext-${serverName}`)}>🌐</button>
                ))}
                <button className="emoji-picker-cat-rail-btn" title="Emojis padrão" onClick={() => scrollToCategory(UNICODE_COLLECTION_KEY)}>
                  <StyledEmoji emoji="😀" size={20} />
                </button>
              </div>
            )}
            <div className="emoji-picker-unicode-scroll" ref={emojiScrollRef}>
              {customGroups.map((g) => {
                const filtered = q ? g.list.filter((e) => e.name.toLowerCase().includes(q)) : g.list;
                if (filtered.length === 0) return null;
                return (
                  <div key={g.key} ref={(el) => { catSectionRefs.current[`server-${g.key}`] = el; }}>
                    <div className="emoji-picker-group-label">{g.iconUrl && <img src={g.iconUrl} alt="" className="asset-collection-label-icon" />} {g.label}</div>
                    <div className="emoji-picker-grid">
                      {filtered.map((e) => (
                        <button key={e.id} title={`:${e.name}:`} onClick={() => { onPick(`:${e.name}:`); onClose?.(); }}>
                          <img src={e.url} alt={e.name} />
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {Object.entries(externalGrouped).map(([serverName, list]) => {
                const filtered = q ? list.filter((e) => e.name.toLowerCase().includes(q)) : list;
                if (filtered.length === 0) return null;
                return (
                  <div key={serverName} ref={(el) => { catSectionRefs.current[`ext-${serverName}`] = el; }}>
                    <div className="emoji-picker-group-label">🌐 {serverName}</div>
                    <div className="emoji-picker-grid">
                      {filtered.map((e) => (
                        <button key={e.id} title={`:${e.name}:`} onClick={() => { onPick(`:${e.name}:`); onClose?.(); }}>
                          <img src={e.url} alt={e.name} />
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {(() => {
                // Emoji names in this dataset are English-only (no localized
                // names shipped upstream) — search still works fine for the
                // common case (typing "fire", "heart", etc), just doesn't match
                // a Portuguese word typed in.
                const filtered = q ? UNICODE_ALL.filter((e) => e.name.toLowerCase().includes(q)) : UNICODE_ALL;
                if (filtered.length === 0) return null;
                return (
                  <div ref={(el) => { catSectionRefs.current[UNICODE_COLLECTION_KEY] = el; }}>
                    <div className="emoji-picker-group-label">Emojis padrão</div>
                    <div className="emoji-picker-grid">
                      {filtered.map((e) => (
                        <button key={e.emoji} onClick={() => { onPick(e.emoji); onClose?.(); }} title={e.name}>
                          <StyledEmoji emoji={e.emoji} size={24} />
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
        {tab === 'stickers' && (
          <div className="emoji-picker-unicode-layout">
            {!q && stickerGroups.length > 1 && (
              <div className="emoji-picker-cat-rail">
                {stickerGroups.map((g) => (
                  <button key={g.key} className="emoji-picker-cat-rail-btn" title={g.label} onClick={() => scrollToCategory(`sticker-${g.key}`)}>
                    {g.iconUrl ? <img src={g.iconUrl} alt="" className="asset-collection-rail-icon" /> : '📄'}
                  </button>
                ))}
              </div>
            )}
            <div className="emoji-picker-unicode-scroll" ref={stickerScrollRef}>
              {stickerGroups.map((g) => {
                const filtered = q ? g.list.filter((s) => s.name.toLowerCase().includes(q)) : g.list;
                if (filtered.length === 0) return null;
                return (
                  <div key={g.key} ref={(el) => { catSectionRefs.current[`sticker-${g.key}`] = el; }}>
                    <div className="emoji-picker-group-label">{g.iconUrl && <img src={g.iconUrl} alt="" className="asset-collection-label-icon" />} {g.label}</div>
                    <div className="sticker-picker-grid">
                      {filtered.map((s) => (
                        <button key={s.id} title={s.name} onClick={() => { onPickSticker(s); onClose?.(); }}>
                          <img src={s.url} alt={s.name} />
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {Object.entries(externalStickerGrouped).map(([serverName, list]) => {
                const filtered = q ? list.filter((s) => s.name.toLowerCase().includes(q)) : list;
                if (filtered.length === 0) return null;
                return (
                  <div key={serverName}>
                    <div className="emoji-picker-group-label">{serverName}</div>
                    <div className="sticker-picker-grid">
                      {filtered.map((s) => (
                        <button key={s.id} title={s.name} onClick={() => { onPickSticker(s); onClose?.(); }}>
                          <img src={s.url} alt={s.name} />
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {tab === 'gifs' && (
          showGifMural ? (
            <div className="gif-picker-mural">
              <button type="button" className="gif-picker-mural-tile gif-picker-mural-tile-solid" onClick={() => setGifSubTab('favorites')}>
                <span>Favoritos</span>
              </button>
              <button
                type="button" className="gif-picker-mural-tile"
                style={gifResults[0]?.preview ? { backgroundImage: `url(${gifResults[0].preview})` } : undefined}
                onClick={() => openGifCategory({ name: 'GIFs em alta', searchterm: '' })}
              >
                <span>📈 GIFs em alta</span>
              </button>
              {(gifCategories || []).map((cat) => (
                <button
                  type="button" key={cat.searchterm} className="gif-picker-mural-tile"
                  style={cat.image ? { backgroundImage: `url(${cat.image})` } : undefined}
                  onClick={() => openGifCategory(cat)}
                >
                  <span>{cat.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="gif-picker-grid">
              {gifSubTab === 'search' && gifLoading && <div className="dim">Buscando...</div>}
              {gifSubTab === 'search' && !gifLoading && gifFailed === 'unconfigured' && (
                <div className="dim gif-picker-message">
                  Busca de GIFs ainda não configurada.<br />
                  Crie uma chave gratuita em <b>partner.klipy.com</b> e adicione como
                  <code> VITE_KLIPY_KEY </code> em <code>client/.env</code>.
                </div>
              )}
              {gifSubTab === 'search' && !gifLoading && gifFailed === true && <div className="dim">Não foi possível carregar GIFs agora. Tente novamente mais tarde.</div>}
              {gifSubTab === 'favorites' && shownGifs.length === 0 && (
                <div className="dim gif-picker-message">
                  Nenhum GIF favoritado ainda.<br />
                  Clique na ⭐ em qualquer GIF (na busca ou em uma mensagem já enviada) para salvá-lo aqui.
                </div>
              )}
              {gifSubTab === 'search' && !gifLoading && !gifFailed && shownGifs.length === 0 && <div className="dim">Nenhum resultado.</div>}
              {shownGifs.map((g) => (
                <button key={g.id} className="gif-picker-tile" onClick={() => { onPickGif(g.full); onClose?.(); }}>
                  <img src={g.preview} alt="" loading="lazy" />
                  <span
                    className={`gif-favorite-btn ${favoriteGifIds.has(g.id ?? g.full) ? 'active' : ''}`}
                    role="button"
                    title={favoriteGifIds.has(g.id ?? g.full) ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                    onClick={(e) => toggleFavoriteGif(e, g)}
                  >
                    {favoriteGifIds.has(g.id ?? g.full) ? <img className="ui-icon-sm" src={starIcon} alt="" /> : '☆'}
                  </span>
                </button>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
