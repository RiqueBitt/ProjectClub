import { useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { useSheetDrag } from '../utils/useSheetDrag';
import emojiGroups from 'unicode-emoji-json/data-by-group.json';
import StyledEmoji from './StyledEmoji.jsx';

// The FULL Unicode emoji set (~1900, all 9 official groups — see
// node_modules/unicode-emoji-json), not a hand-picked shortlist — rendered
// as the browser/OS's own native emoji glyphs (plain text), same as
// everywhere else in the app.
const GROUP_LABEL_PT = {
  smileys_emotion: 'Carinhas e emoções',
  people_body: 'Pessoas e corpo',
  animals_nature: 'Animais e natureza',
  food_drink: 'Comidas e bebidas',
  travel_places: 'Viagens e lugares',
  activities: 'Atividades',
  objects: 'Objetos',
  symbols: 'Símbolos',
  flags: 'Bandeiras',
};
// One representative emoji per group, used as that category's own icon in
// the side rail (see .emoji-picker-cat-rail below) — same idea as a
// Discord-clone reference project the user shared, which uses a vertical
// icon rail down the side of its emoji picker to jump straight to a
// category instead of only scrolling through one long list.
const GROUP_RAIL_ICON = {
  smileys_emotion: '😀',
  people_body: '🖐️',
  animals_nature: '🐶',
  food_drink: '🍔',
  travel_places: '✈️',
  activities: '⚽',
  objects: '💡',
  symbols: '❤️',
  flags: '🏳️',
};
const UNICODE_GROUPS = Object.fromEntries(
  emojiGroups.map((g) => [GROUP_LABEL_PT[g.slug] || g.name, g.emojis.map((e) => ({ emoji: e.emoji, name: e.name }))]),
);
const UNICODE_GROUP_ICONS = Object.fromEntries(
  emojiGroups.map((g) => [GROUP_LABEL_PT[g.slug] || g.name, GROUP_RAIL_ICON[g.slug] || '🙂']),
);

export default function EmojiPicker({ serverEmojis = [], serverStickers = [], onPick, onPickSticker, onClose, style, variant = 'composer', defaultHeightVh }) {
  const { heightVh, dragHandlers } = useSheetDrag(onClose, defaultHeightVh);
  const usableEmojis = useStore((s) => s.usableEmojis);
  const usableStickers = useStore((s) => s.usableStickers);
  // Item pedido: "emoji personalizado e figurinha vai ter a mesma
  // categoria que o emoji normal, aquela barra lateral" — as coleções
  // já vêm carregadas centralmente (ver MainApp.jsx/SocketContext.jsx),
  // não precisa buscar de novo toda vez que o seletor abre.
  const emojiCollections = useStore((s) => s.emojiCollections);
  const stickerCollections = useStore((s) => s.stickerCollections);
  const [tab, setTab] = useState(serverEmojis.length > 0 ? 'server' : 'unicode');
  const [query, setQuery] = useState('');
  const unicodeScrollRef = useRef(null);
  const serverScrollRef = useRef(null);
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

  return (
    <div className={`emoji-picker-popover ${variant === 'reaction' ? 'reaction-picker' : ''} ${variant === 'composer-centered' ? 'composer-centered-picker' : ''}`} style={{ '--sheet-height': `${heightVh}vh`, ...style }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="sheet-drag-handle" {...dragHandlers} />
      <div className="emoji-picker-tabs">
        {serverEmojis.length > 0 && <button className={tab === 'server' ? 'active' : ''} onClick={() => setTab('server')}>Servidor</button>}
        {usableEmojis.length > 0 && <button className={tab === 'external' ? 'active' : ''} onClick={() => setTab('external')}>Outros</button>}
        <button className={tab === 'unicode' ? 'active' : ''} onClick={() => setTab('unicode')}>Emojis</button>
        {hasStickers && onPickSticker && <button className={tab === 'stickers' ? 'active' : ''} onClick={() => setTab('stickers')}>Figurinhas</button>}
      </div>
      <input
        className="emoji-picker-search"
        placeholder="Buscar emoji..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        // BUG CORRIGIDO ("abrir o menu de emoji/GIF no mobile acaba
        // abrindo o teclado do celular"): autoFocus sempre ativo faz
        // QUALQUER navegador/WebView levantar o teclado virtual assim
        // que o campo ganha foco — bom em desktop (já digita direto),
        // ruim em mobile (o teclado cobre boa parte da tela sem a
        // pessoa ter pedido). window.innerWidth > 600 é a mesma régua
        // já usada em outros lugares do app pra "isso é mobile?".
        autoFocus={window.innerWidth > 600}
      />
      <div className="emoji-picker-body">
        {tab === 'server' && (
          <div className="emoji-picker-unicode-layout">
            {!q && customGroups.length > 1 && (
              <div className="emoji-picker-cat-rail">
                {customGroups.map((g) => (
                  <button key={g.key} className="emoji-picker-cat-rail-btn" title={g.label} onClick={() => scrollToCategory(`server-${g.key}`)}>
                    {g.iconUrl ? <img src={g.iconUrl} alt="" className="asset-collection-rail-icon" /> : '📄'}
                  </button>
                ))}
              </div>
            )}
            <div className="emoji-picker-unicode-scroll" ref={serverScrollRef}>
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
            </div>
          </div>
        )}
        {tab === 'external' && Object.entries(externalGrouped).map(([serverName, list]) => {
          const filtered = q ? list.filter((e) => e.name.toLowerCase().includes(q)) : list;
          if (filtered.length === 0) return null;
          return (
            <div key={serverName}>
              <div className="emoji-picker-group-label">{serverName}</div>
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
        {tab === 'unicode' && (
          <div className="emoji-picker-unicode-layout">
            {!q && (
              <div className="emoji-picker-cat-rail">
                {Object.keys(UNICODE_GROUPS).map((cat) => (
                  <button
                    key={cat}
                    className="emoji-picker-cat-rail-btn"
                    title={cat}
                    onClick={() => scrollToCategory(cat)}
                  >
                    {UNICODE_GROUP_ICONS[cat] && <StyledEmoji emoji={UNICODE_GROUP_ICONS[cat]} size={20} />}
                  </button>
                ))}
              </div>
            )}
            <div className="emoji-picker-unicode-scroll" ref={unicodeScrollRef}>
              {Object.entries(UNICODE_GROUPS).map(([cat, list]) => {
                // Emoji names in this dataset are English-only (no localized
                // names shipped upstream) — search still works fine for the
                // common case (typing "fire", "heart", etc), just doesn't match
                // a Portuguese word typed in.
                const filtered = q ? list.filter((e) => e.name.toLowerCase().includes(q)) : list;
                if (filtered.length === 0) return null;
                return (
                  <div key={cat} ref={(el) => { catSectionRefs.current[cat] = el; }}>
                    <div className="emoji-picker-group-label">{cat}</div>
                    <div className="emoji-picker-grid">
                      {filtered.map((e) => (
                        <button key={e.emoji} onClick={() => { onPick(e.emoji); onClose?.(); }} title={e.name}>
                          <StyledEmoji emoji={e.emoji} size={24} />
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
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
      </div>
    </div>
  );
}
