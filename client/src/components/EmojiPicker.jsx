import { useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { useSheetDrag } from '../utils/useSheetDrag';
import emojiGroups from 'unicode-emoji-json/data-by-group.json';

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
  const [tab, setTab] = useState(serverEmojis.length > 0 ? 'server' : 'unicode');
  const [query, setQuery] = useState('');
  const unicodeScrollRef = useRef(null);
  const catSectionRefs = useRef({});

  const scrollToCategory = (cat) => {
    catSectionRefs.current[cat]?.scrollIntoView({ block: 'start' });
  };

  const customGrouped = useMemo(() => {
    const acc = {};
    for (const e of serverEmojis) (acc[e.category || 'Geral'] ||= []).push(e);
    return acc;
  }, [serverEmojis]);

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
  const stickerGroups = useMemo(() => {
    const serverStickerIds = new Set(serverStickers.map((s) => s.id));
    const others = {};
    for (const s of usableStickers) {
      if (serverStickerIds.has(s.id)) continue;
      (others[s.serverName || 'Outros servidores'] ||= []).push(s);
    }
    return { own: serverStickers, others };
  }, [usableStickers, serverStickers]);
  const hasStickers = stickerGroups.own.length > 0 || Object.keys(stickerGroups.others).length > 0;

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
        {tab === 'server' && Object.entries(customGrouped).map(([cat, list]) => {
          const filtered = q ? list.filter((e) => e.name.toLowerCase().includes(q)) : list;
          if (filtered.length === 0) return null;
          return (
            <div key={cat}>
              <div className="emoji-picker-group-label">{cat}</div>
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
                    {UNICODE_GROUP_ICONS[cat]}
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
                          {e.emoji}
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
          <>
            {stickerGroups.own.length > 0 && (
              <div>
                <div className="emoji-picker-group-label">Servidor</div>
                <div className="sticker-picker-grid">
                  {stickerGroups.own
                    .filter((s) => !q || s.name.toLowerCase().includes(q))
                    .map((s) => (
                      <button key={s.id} title={s.name} onClick={() => { onPickSticker(s); onClose?.(); }}>
                        <img src={s.url} alt={s.name} />
                      </button>
                    ))}
                </div>
              </div>
            )}
            {Object.entries(stickerGroups.others).map(([serverName, list]) => {
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
          </>
        )}
      </div>
    </div>
  );
}
