import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { useSheetDrag } from '../utils/useSheetDrag';
import emojiGroups from 'unicode-emoji-json/data-by-group.json';
import StyledEmoji from './StyledEmoji.jsx';
import PersonalStickersSection from './PersonalStickersSection.jsx';
import CreatorStickersSection from './CreatorStickersSection.jsx';
import { addFavoriteGif, removeFavoriteGif, searchGifsApi, listGifCategories } from '../api/endpoints';
import starIcon from '../assets/icons/star.png';

// Item pedido: "coloque os emojis personalizados dentro do menu de
// emojis... mantenha todos os emojis normais/padrão dentro de uma
// única coleção" — antes, o emoji padrão (unicode) tinha 9 categorias
// próprias (Carinhas, Animais, Comida...) numa aba separada da de
// emoji personalizado; agora tudo isso vira UMA seção só, mostrada
// junto com as coleções de emoji personalizado no mesmo rail lateral
// — o padrão sempre por último, depois de qualquer coleção que a
// comunidade tenha criado.
const UNICODE_ALL = emojiGroups.flatMap((g) => g.emojis.map((e) => ({ emoji: e.emoji, name: e.name, lower: e.name.toLowerCase() })));
const UNICODE_COLLECTION_KEY = 'unicode-default';
// Quantos emojis padrão entram no 1º quadro ao abrir (o resto vem logo em
// seguida, quando o navegador fica livre) — abrir não trava mais.
const UNICODE_FIRST_BATCH = 240;
const UNICODE_BATCH = 280;

// Cache da sessão: categorias de GIF (mudam raramente) e "GIFs em alta"
// (5 min). Antes eram buscadas no servidor (EUA) a CADA abertura.
let gifCategoriesCache = null;
let trendingCache = null; // { at, results }
const TRENDING_TTL_MS = 5 * 60 * 1000;

// Rodapé de prévia com estado PRÓPRIO: passar o mouse num emoji só
// redesenha este rodapé. Antes o estado ficava no seletor inteiro e cada
// movimento do mouse redesenhava ~2000 botões.
const PickerPreview = forwardRef(function PickerPreview(_props, ref) {
  const [hovered, setHovered] = useState(null); // { img?, emoji?, name }
  useImperativeHandle(ref, () => ({ show: (h) => setHovered((prev) => (prev && h && prev.name === h.name ? prev : h)) }), []);
  return (
    <div className="emoji-picker-preview" aria-hidden="true">
      {hovered ? (
        <>
          {hovered.img ? <img src={hovered.img} alt="" /> : <StyledEmoji emoji={hovered.emoji} size={30} />}
          <span className="truncate">{hovered.name}</span>
        </>
      ) : <span className="emoji-picker-preview-hint">Passe o mouse para ver o nome</span>}
    </div>
  );
});

// Grades memorizadas: só redesenham quando a lista/busca muda (não a cada
// passada de mouse). A prévia é lida dos atributos data-pv-* do botão.
const ImageGrid = memo(function ImageGrid({ list, className, onPickItem, nameOf }) {
  return (
    <div className={className}>
      {list.map((e) => (
        <button key={e.id} title={nameOf(e)} data-pv-img={e.url} data-pv-name={nameOf(e)} onClick={() => onPickItem(e)}>
          <img src={e.url} alt={e.name} loading="lazy" decoding="async" />
        </button>
      ))}
    </div>
  );
});

// Um pedaço fixo da lista (memorizado): lotes novos não redesenham os já
// mostrados.
const UnicodeChunk = memo(function UnicodeChunk({ list, onPickEmoji }) {
  return list.map((e) => (
    <button key={e.emoji} data-pv-emoji={e.emoji} data-pv-name={e.name} onClick={() => onPickEmoji(e.emoji)} title={e.name}>
      <StyledEmoji emoji={e.emoji} size={24} />
    </button>
  ));
});

const UNICODE_CHUNKS = (() => {
  const out = [UNICODE_ALL.slice(0, UNICODE_FIRST_BATCH)];
  for (let i = UNICODE_FIRST_BATCH; i < UNICODE_ALL.length; i += UNICODE_BATCH) out.push(UNICODE_ALL.slice(i, i + UNICODE_BATCH));
  return out;
})();

function UnicodeGrid({ chunks, onPickEmoji }) {
  return (
    <div className="emoji-picker-grid">
      {chunks.map((list, i) => <UnicodeChunk key={i} list={list} onPickEmoji={onPickEmoji} />)}
    </div>
  );
}

const emojiName = (e) => `:${e.name}:`;
const stickerName = (s) => s.name;

// Google desligou a API do Tenor em 2026-06-30; a busca usa a KLIPY (mesmo
// formato do Tenor v2). A chave fica SÓ no servidor: o navegador chama
// /api/gifs/* (ver server/src/controllers/gifController.js). Antes a chave
// vinha de VITE_KLIPY_KEY, embutida na compilação — e o build de produção
// (CI) não tinha essa variável, então os GIFs nunca funcionavam no site.

export default function EmojiPicker({ serverEmojis = [], serverStickers = [], onPick, onPickSticker, onPickGif, onClose, style, variant = 'composer', defaultHeightVh, initialTab = 'emojis', onTabChange }) {
  const { heightVh, dragHandlers } = useSheetDrag(onClose, defaultHeightVh);
  // Fecha com Esc ou clicando fora. O fechar-por-fora espera o clique
  // terminar (setTimeout): se o clique foi no próprio botão que abre o
  // seletor, ele já fecha sozinho e isso só confirma — nunca reabre.
  const rootRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current?.(); } };
    const onDown = (e) => {
      const root = rootRef.current;
      if (!root || root.contains(e.target)) return;
      if (e.target.closest?.('.chat-composer-btn')) return; // GIF/figurinha/emoji do chat trocam de aba sozinhos
      setTimeout(() => onCloseRef.current?.(), 0);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('click', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('click', onDown, true);
    };
  }, []);
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
  const [tab, setTab] = useState(initialTab);
  // Prévia do que está sob o mouse (rodapé) — ver PickerPreview.
  const previewRef = useRef(null);
  const setHovered = (h) => previewRef.current?.show(h);
  const onGridHover = (e) => {
    const el = e.target.closest?.('[data-pv-name]');
    if (!el) return;
    setHovered(el.dataset.pvImg ? { img: el.dataset.pvImg, name: el.dataset.pvName } : { emoji: el.dataset.pvEmoji, name: el.dataset.pvName });
  };
  const [query, setQuery] = useState('');
  // Emojis padrão em lotes (ver UNICODE_FIRST_BATCH): cada lote entra
  // quando o navegador fica livre, sem travar a rolagem nem o mouse.
  const [unicodeChunks, setUnicodeChunks] = useState(1);
  const unicodeAll = unicodeChunks >= UNICODE_CHUNKS.length;
  useEffect(() => {
    if (unicodeAll) return undefined;
    const ric = window.requestIdleCallback || ((cb) => setTimeout(cb, 16));
    const cic = window.cancelIdleCallback || clearTimeout;
    const id = ric(() => setUnicodeChunks((n) => n + 1), { timeout: 200 });
    return () => cic(id);
  }, [unicodeChunks, unicodeAll]);
  // Callbacks estáveis pras grades memorizadas.
  const onPickRef = useRef(onPick); onPickRef.current = onPick;
  const onPickStickerRef = useRef(onPickSticker); onPickStickerRef.current = onPickSticker;
  const onCloseRef2 = useRef(onClose); onCloseRef2.current = onClose;
  const pickEmojiItem = useCallback((e) => { onPickRef.current?.(`:${e.name}:`); onCloseRef2.current?.(); }, []);
  const pickUnicode = useCallback((emoji) => { onPickRef.current?.(emoji); onCloseRef2.current?.(); }, []);
  const pickStickerItem = useCallback((st) => { onPickStickerRef.current?.(st); onCloseRef2.current?.(); }, []);
  // Avisa quem abriu (barra de mensagem) qual aba ficou por último.
  useEffect(() => { onTabChange?.(tab); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
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

  const q = query.trim().toLowerCase();
  const shownChunks = useMemo(() => UNICODE_CHUNKS.slice(0, unicodeChunks), [unicodeChunks]);
  const unicodeMatches = useMemo(() => (q ? [UNICODE_ALL.filter((e) => e.lower.includes(q))] : null), [q]);

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

  // Só a resposta da busca mais recente vale: cada busca cancela a anterior
  // (sem isso, uma resposta lenta de "ga" podia sobrescrever a de "gato").
  const gifAbortRef = useRef(null);
  useEffect(() => () => gifAbortRef.current?.abort(), []);
  const searchGifs = async (term) => {
    // "Em alta" (busca vazia) recente: aparece na hora, sem ir ao servidor.
    if (!term.trim() && trendingCache && Date.now() - trendingCache.at < TRENDING_TTL_MS) {
      gifAbortRef.current?.abort();
      setGifFailed(false); setGifLoading(false); setGifResults(trendingCache.results);
      return;
    }
    gifAbortRef.current?.abort();
    const ctrl = new AbortController();
    gifAbortRef.current = ctrl;
    setGifLoading(true);
    setGifFailed(false);
    try {
      const data = await searchGifsApi(term.trim(), { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      const results = (data.results || []).filter((g) => g.full);
      if (!term.trim()) trendingCache = { at: Date.now(), results };
      setGifResults(results);
    } catch (err) {
      if (ctrl.signal.aborted || err?.code === 'ERR_CANCELED') return;
      setGifFailed(err?.response?.data?.code === 'unconfigured' ? 'unconfigured' : true);
      setGifResults([]);
    } finally {
      if (gifAbortRef.current === ctrl) setGifLoading(false);
    }
  };

  // Categorias: só quando a aba de GIFs é aberta, e uma vez por sessão.
  useEffect(() => {
    if (tab !== 'gifs' || gifCategories !== null) return undefined;
    if (gifCategoriesCache) { setGifCategories(gifCategoriesCache); return undefined; }
    let alive = true;
    listGifCategories()
      .then((data) => { gifCategoriesCache = (data.tags || []).slice(0, 12); if (alive) setGifCategories(gifCategoriesCache); })
      .catch(() => { if (alive) setGifCategories([]); });
    return () => { alive = false; };
  }, [tab, gifCategories]);

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
    <div ref={rootRef} className={`emoji-picker-popover ${variant === 'reaction' ? 'reaction-picker' : ''} ${variant === 'composer-centered' ? 'composer-centered-picker' : ''}`} style={{ '--sheet-height': `${heightVh}vh`, ...style }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="sheet-drag-handle" {...dragHandlers} />
      <div className="emoji-picker-tabs">
        <button className={tab === 'emojis' ? 'active' : ''} onClick={() => { setTab('emojis'); setQuery(''); setHovered(null); }}>Emojis</button>
        {/* Aba sempre visível quando dá pra mandar figurinha: mesmo sem
            figurinha da comunidade, tem a seção "Minhas figurinhas". */}
        {onPickSticker && <button className={tab === 'stickers' ? 'active' : ''} onClick={() => { setTab('stickers'); setQuery(''); }}>Figurinhas</button>}
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
            <div className="emoji-picker-unicode-scroll" ref={emojiScrollRef} onMouseOver={onGridHover}>
              {customGroups.map((g) => {
                const filtered = q ? g.list.filter((e) => e.name.toLowerCase().includes(q)) : g.list;
                if (filtered.length === 0) return null;
                return (
                  <div key={g.key} ref={(el) => { catSectionRefs.current[`server-${g.key}`] = el; }}>
                    <div className="emoji-picker-group-label">{g.iconUrl && <img src={g.iconUrl} alt="" className="asset-collection-label-icon" />} {g.label}</div>
                    <ImageGrid list={filtered} className="emoji-picker-grid" onPickItem={pickEmojiItem} nameOf={emojiName} />
                  </div>
                );
              })}
              {Object.entries(externalGrouped).map(([serverName, list]) => {
                const filtered = q ? list.filter((e) => e.name.toLowerCase().includes(q)) : list;
                if (filtered.length === 0) return null;
                return (
                  <div key={serverName} ref={(el) => { catSectionRefs.current[`ext-${serverName}`] = el; }}>
                    <div className="emoji-picker-group-label">🌐 {serverName}</div>
                    <ImageGrid list={filtered} className="emoji-picker-grid" onPickItem={pickEmojiItem} nameOf={emojiName} />
                  </div>
                );
              })}
              {(() => {
                // Emoji names in this dataset are English-only (no localized
                // names shipped upstream) — search still works fine for the
                // common case (typing "fire", "heart", etc), just doesn't match
                // a Portuguese word typed in.
                const chunks = q ? unicodeMatches : shownChunks;
                if (!chunks[0]?.length) return null;
                return (
                  <div ref={(el) => { catSectionRefs.current[UNICODE_COLLECTION_KEY] = el; }}>
                    <div className="emoji-picker-group-label">Emojis padrão</div>
                    <UnicodeGrid chunks={chunks} onPickEmoji={pickUnicode} />
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
            <div className="emoji-picker-unicode-scroll" ref={stickerScrollRef} onMouseOver={onGridHover}>
              {/* Pacote de figurinhas personalizadas (Assinante/Super) — no topo. */}
              <PersonalStickersSection query={query} onPickSticker={onPickSticker} onClose={onClose} />
              {/* Fase 8: figurinhas compradas na Loja dos criadores. */}
              <CreatorStickersSection query={query} onPickSticker={onPickSticker} onClose={onClose} />
              {stickerGroups.map((g) => {
                const filtered = q ? g.list.filter((s) => s.name.toLowerCase().includes(q)) : g.list;
                if (filtered.length === 0) return null;
                return (
                  <div key={g.key} ref={(el) => { catSectionRefs.current[`sticker-${g.key}`] = el; }}>
                    <div className="emoji-picker-group-label">{g.iconUrl && <img src={g.iconUrl} alt="" className="asset-collection-label-icon" />} {g.label}</div>
                    <ImageGrid list={filtered} className="sticker-picker-grid" onPickItem={pickStickerItem} nameOf={stickerName} />
                  </div>
                );
              })}
              {Object.entries(externalStickerGrouped).map(([serverName, list]) => {
                const filtered = q ? list.filter((s) => s.name.toLowerCase().includes(q)) : list;
                if (filtered.length === 0) return null;
                return (
                  <div key={serverName}>
                    <div className="emoji-picker-group-label">{serverName}</div>
                    <ImageGrid list={filtered} className="sticker-picker-grid" onPickItem={pickStickerItem} nameOf={stickerName} />
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
                  A staff precisa definir <code>KLIPY_KEY</code> nas variáveis do servidor.
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
                  <img src={g.preview} alt="" loading="lazy" style={g.width && g.height ? { aspectRatio: `${g.width} / ${g.height}` } : undefined} />
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
      {(tab === 'emojis' || tab === 'stickers') && <PickerPreview ref={previewRef} />}
    </div>
  );
}
