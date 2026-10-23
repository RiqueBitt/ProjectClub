import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { openPopover, closePopover } from '../utils/popoverCoordinator';
import { cssZoom } from '../utils/cssZoom';
import '../styles/context-menu.css';

const ContextMenuContext = createContext(null);

// One shared context-menu instance for the whole app (Discord-web style
// right-click menus). Callers get `openMenu(event, items)` where `items` is
// an array of either:
//   { label, onClick, danger?, disabled?, icon?, hint?, checked? }
//   { label, submenu: [...itens], icon?, hint? }   <- abre um submenu
//   { divider: true }
// `hint` é uma segunda linha pequena (ex.: "Faltam 42 min"); `checked`
// mostra o item como opção marcada (true) ou desmarcada (false) — usado
// em escolhas tipo "Todas as mensagens / Só @menções / Nada".
// Submenu: no computador abre ao lado (passar o mouse, clicar ou seta →);
// no celular a folha troca pros itens do submenu, com "Voltar" no topo.
// `icon` pode ser o nome de um ícone do mapa abaixo ('reply', 'trash'...);
// emoji/imagem antigos de quem ainda não foi atualizado são trocados por um
// ícone SVG deduzido do texto do item (ver iconFor).
//
// Redesenho: no computador o menu abre onde o clique aconteceu (como no
// Discord), sempre preso dentro da tela — vira pra esquerda/cima quando não
// cabe, já descontando o zoom CSS da interface (utils/cssZoom.js). No
// celular (tela estreita) continua como antes no sentido de "sempre no
// mesmo lugar": vira uma folha presa embaixo da tela, com fundo escuro,
// itens grandes pra tocar. Fecha com clique fora, Esc ou rolagem por trás.
// Teclado: setas/Home/End navegam, Enter/Espaço ativam, Esc fecha.

const ICONS = {
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  id: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="9" cy="11" r="2" /><path d="M6 16a3 3 0 0 1 6 0M14.5 10h4M14.5 13.5h3" /></>,
  smilePlus: <><path d="M21 12a9 9 0 1 1-6.2-8.56" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01M19 2v6M16 5h6" /></>,
  reply: <path d="M10 8 5 12.5 10 17M5.5 12.5H14a5 5 0 0 1 5 5V19" />,
  bookmark: <path d="M6 4h12v17l-6-4-6 4z" />,
  bookmarkOff: <><path d="M6 4h12v17l-6-4-6 4z" /><path d="M4 4l16 16" /></>,
  unread: <><circle cx="17" cy="7" r="3" /><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h7" /></>,
  share: <><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" /><path d="M12 3v12M7 8l5-5 5 5" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  volume: <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></>,
  pin: <><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3z" /><path d="M12 15v6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
  thread: <><path d="M4 6h11M4 11h7" /><path d="M14 13h6v5a2 2 0 0 1-2 2h-2l-2 2v-2a2 2 0 0 1 0 0z" /><path d="M4 16h5" /></>,
  edit: <><path d="M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></>,
  warn: <><path d="M12 4 2.5 20h19z" /><path d="M12 10v4M12 17h.01" /></>,
  mute: <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="m16 9 5 6M21 9l-5 6" /></>,
  star: <path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" />,
  check: <path d="m5 12 5 5 9-10" />,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" /></>,
  hash: <path d="M5 9h14M5 15h14M10 3 8 21M16 3l-2 18" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  eyeOff: <><path d="M3 3l18 18" /><path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4 9.5 6a12.6 12.6 0 0 1-2.6 3.4M6.6 7.6A12.4 12.4 0 0 0 2.5 12c1 2 4.5 6 9.5 6a9.6 9.6 0 0 0 4.2-1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
  chat: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z" />,
  tag: <><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" /><path d="M7.5 7.5h.01" /></>,
  hammer: <><path d="m14 6 4 4M3 21l8.5-8.5" /><path d="m9.5 7.5 5-5 7 7-5 5z" /></>,
  dot: <circle cx="12" cy="12" r="2" />,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" /><path d="M10 21a2 2 0 0 0 4 0" /></>,
  back: <path d="m15 6-6 6 6 6" />,
};

// Ícone deduzido do texto do item — cobre menus de outras telas que ainda
// passam emoji/PNG como ícone, sem precisar mexer em cada uma delas.
const LABEL_ICONS = [
  [/perfil/i, 'user'],
  [/copiar id|^id\b/i, 'id'],
  [/reagir|rea[cç][aã]o/i, 'smilePlus'],
  [/responder/i, 'reply'],
  [/copiar link/i, 'link'],
  [/copiar/i, 'copy'],
  [/fixar|desafixar/i, 'pin'],
  [/t[oó]pico/i, 'thread'],
  [/editar/i, 'edit'],
  [/denunciar/i, 'flag'],
  [/apagar|excluir|remover mensagem/i, 'trash'],
  [/advert/i, 'warn'],
  [/silenc|silêncio|mutar/i, 'mute'],
  [/favorit/i, 'star'],
  [/marcar como lido/i, 'check'],
  [/criar canal/i, 'hash'],
  [/categoria/i, 'folder'],
  [/esconder|ocultar/i, 'eyeOff'],
  [/mensagem/i, 'chat'],
  [/cargo/i, 'tag'],
  [/banir/i, 'hammer'],
];

function iconFor(item) {
  if (typeof item.icon === 'string' && ICONS[item.icon]) return item.icon;
  const hit = LABEL_ICONS.find(([re]) => re.test(item.label || ''));
  return hit ? hit[1] : 'dot';
}

function MenuIcon({ name }) {
  return (
    <svg className="cm-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name] || ICONS.dot}
    </svg>
  );
}

const isSheetViewport = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 600px)').matches;

export function ContextMenuProvider({ children }) {
  const [state, setState] = useState(null); // { items, x, y, sheet }
  const menuRef = useRef(null);
  const returnFocusRef = useRef(null);
  // A stable function reference — openPopover/closePopover compare by
  // identity, so a fresh arrow function on every call would never match
  // itself between open and close.
  const closerRef = useRef(() => setState(null));

  const openMenu = useCallback((event, items) => {
    event.preventDefault();
    event.stopPropagation();
    openPopover(closerRef.current);
    // Ponto de abertura em pixels da tela. Clique pelo teclado (Enter num
    // botão "Mais opções") não tem coordenada — usa o próprio botão.
    let x = event.clientX;
    let y = event.clientY;
    // (clique direito também tem detail 0 — por isso só vale pra 'click'.)
    if ((!x && !y) || (event.type === 'click' && event.detail === 0)) {
      const r = event.currentTarget?.getBoundingClientRect?.();
      if (r) { x = r.left; y = r.bottom; }
    }
    returnFocusRef.current = document.activeElement;
    setState({ items, x: x || 0, y: y || 0, sheet: isSheetViewport() });
  }, []);

  const closeMenu = useCallback(() => { closePopover(closerRef.current); setState(null); }, []);

  useEffect(() => {
    if (!state) return undefined;
    // Submenus ficam fora do menuRef (painel irmão) — vale qualquer .context-menu.
    const insideMenu = (t) => !!t?.closest?.('.context-menu');
    const onDocClick = (e) => {
      if (menuRef.current && !insideMenu(e.target)) closeMenu();
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeMenu();
      const back = returnFocusRef.current;
      if (back && typeof back.focus === 'function' && document.contains(back)) back.focus({ preventScroll: true });
    };
    // Rolar a página por trás fecha; rolar DENTRO do próprio menu (lista
    // longa de moderação) não.
    const onScroll = (e) => { if (!insideMenu(e.target)) closeMenu(); };
    const onResize = () => closeMenu();
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('touchstart', onDocClick);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('touchstart', onDocClick);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [state, closeMenu]);

  return (
    <ContextMenuContext.Provider value={{ openMenu, closeMenu }}>
      {children}
      {state && <ContextMenuRender key={`${state.x},${state.y},${state.items.length}`} menuRef={menuRef} {...state} onClose={closeMenu} />}
    </ContextMenuContext.Provider>
  );
}

// Posição presa dentro da tela. Menu principal: junto do ponto do clique.
// Submenu (`anchorRect`): ao lado do item pai, virando pra esquerda se não couber.
function useClampedPosition(ref, { x, y, anchorRect, sheet }) {
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || sheet) return;
    const z = cssZoom();
    const margin = 8;
    const vw = window.innerWidth / z;
    const vh = window.innerHeight / z;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left;
    let top;
    let originX = 'left';
    let originY = 'top';
    if (anchorRect) {
      const r = { left: anchorRect.left / z, right: anchorRect.right / z, top: anchorRect.top / z };
      left = r.right + 2;
      if (left + w > vw - margin) { left = Math.max(margin, r.left - w - 2); originX = 'right'; }
      top = r.top - 6;
      if (top + h > vh - margin) { top = Math.max(margin, vh - margin - h); originY = 'bottom'; }
    } else {
      const px = x / z;
      const py = y / z;
      left = px + 2;
      top = py + 2;
      if (left + w > vw - margin) left = Math.max(margin, px - w - 2);
      if (top + h > vh - margin) {
        // Não cabe embaixo: abre pra cima; se nem assim couber, encosta no
        // fim da tela (fica o mais perto possível do clique).
        const above = py - h - 2;
        top = above >= margin ? above : Math.max(margin, vh - margin - h);
      }
      originX = left < px ? 'right' : 'left';
      originY = top < py ? 'bottom' : 'top';
    }
    left = Math.min(Math.max(margin, left), Math.max(margin, vw - margin - w));
    top = Math.max(margin, top);
    setPos({ left, top, maxHeight: vh - margin * 2, originX, originY });
  }, [ref, x, y, anchorRect, sheet]);
  return pos;
}

// Agrupa em seções (cada divisor fecha uma) e descarta divisores sobrando.
function toSections(items) {
  const sections = [];
  let cur = [];
  items.forEach((item) => {
    if (item.divider) { if (cur.length) sections.push(cur); cur = []; } else cur.push(item);
  });
  if (cur.length) sections.push(cur);
  return sections;
}

// Setas/Home/End/Tab entre os itens de um painel (← volta do submenu).
function navKeyDown(e, panel, { onLeft } = {}) {
  const list = [...(panel?.querySelectorAll('.cm-item:not(:disabled)') || [])];
  if (!list.length) return;
  const idx = list.indexOf(document.activeElement);
  let next = null;
  if (e.key === 'ArrowDown') next = list[(idx + 1) % list.length];
  else if (e.key === 'ArrowUp') next = list[idx <= 0 ? list.length - 1 : idx - 1];
  else if (e.key === 'Home') next = list[0];
  else if (e.key === 'End') next = list[list.length - 1];
  else if (e.key === 'Tab') next = e.shiftKey ? list[idx <= 0 ? list.length - 1 : idx - 1] : list[(idx + 1) % list.length];
  else if ((e.key === 'Enter' || e.key === ' ') && idx < 0) next = list[0];
  else if (e.key === 'ArrowLeft' && onLeft) { e.preventDefault(); e.stopPropagation(); onLeft(); return; }
  if (next) {
    e.preventDefault();
    next.focus({ preventScroll: false });
  }
}

const Chevron = () => (
  <svg className="cm-chevron" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
    <path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function MenuSections({ items, onClose, onOpenSub, onHoverPlain, openSubKey, prefix = '' }) {
  return toSections(items).map((section, si) => (
    <div className="cm-section" role="group" key={si}>
      {section.map((item, i) => {
        const key = `${prefix}${si}:${i}`;
        if (item.emojis) {
          // Reações rápidas (os emojis que você mais usa), num clique.
          return (
            <div key={key} className="cm-emoji-row" role="group" aria-label="Reações rápidas">
              {item.emojis.map((em) => (
                <button key={em} type="button" role="menuitem" className="cm-emoji" title={`Reagir com ${em}`}
                  onClick={() => { item.onPick?.(em); onClose(); }}
                >{em}</button>
              ))}
            </div>
          );
        }
        const hasSub = Array.isArray(item.submenu) && item.submenu.length > 0;
        const isRadio = typeof item.checked === 'boolean';
        const subOpen = hasSub && openSubKey === key;
        return (
          <button
            key={key}
            type="button"
            role={isRadio ? 'menuitemradio' : 'menuitem'}
            aria-checked={isRadio ? item.checked : undefined}
            aria-haspopup={hasSub ? 'menu' : undefined}
            aria-expanded={hasSub ? subOpen : undefined}
            className={`cm-item context-menu-item ${item.danger ? 'danger' : ''} ${subOpen ? 'is-open' : ''}`}
            disabled={item.disabled}
            onMouseEnter={(e) => {
              if (item.disabled) return;
              e.currentTarget.focus({ preventScroll: true });
              if (hasSub) onOpenSub?.(key, item, e.currentTarget, false);
              else onHoverPlain?.();
            }}
            onKeyDown={(e) => {
              if (hasSub && (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                e.stopPropagation();
                onOpenSub?.(key, item, e.currentTarget, true);
              }
            }}
            onClick={(e) => {
              if (hasSub) { onOpenSub?.(key, item, e.currentTarget, e.detail === 0); return; }
              item.onClick?.();
              onClose();
            }}
          >
            {isRadio
              ? <span className={`cm-radio${item.checked ? ' on' : ''}`} aria-hidden="true" />
              : <MenuIcon name={iconFor(item)} />}
            <span className="cm-text">
              <span className="cm-label">{item.label}</span>
              {item.hint && <span className="cm-hint">{item.hint}</span>}
            </span>
            {hasSub && <Chevron />}
          </button>
        );
      })}
    </div>
  ));
}

function SubmenuPanel({ items, anchorRect, focusFirst, onClose, onBack }) {
  const ref = useRef(null);
  const pos = useClampedPosition(ref, { anchorRect, sheet: false });
  useEffect(() => {
    if (pos && focusFirst) ref.current?.querySelector('.cm-item:not(:disabled)')?.focus({ preventScroll: true });
  }, [pos, focusFirst]);
  return (
    <div
      ref={ref}
      className="context-menu cm-v2 cm-anchored cm-submenu"
      role="menu"
      tabIndex={-1}
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        maxHeight: pos?.maxHeight,
        visibility: pos ? 'visible' : 'hidden',
        transformOrigin: pos ? `${pos.originY} ${pos.originX}` : undefined,
      }}
      onKeyDown={(e) => navKeyDown(e, ref.current, { onLeft: onBack })}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuSections items={items} onClose={onClose} prefix="sub-" />
    </div>
  );
}

function ContextMenuRender({ menuRef, items, x, y, sheet, onClose }) {
  const pos = useClampedPosition(menuRef, { x, y, sheet });
  // Submenu aberto no computador: { key, items, rect, focusFirst, el }.
  const [sub, setSub] = useState(null);
  // Celular: pilha de submenus (a folha mostra o último, com "Voltar").
  const [stack, setStack] = useState([]);

  // Foco no menu assim que ele está visível (setas já funcionam de cara) —
  // elemento com visibility:hidden (antes de medir a posição) não recebe foco.
  const ready = sheet || !!pos;
  useEffect(() => {
    if (ready) menuRef.current?.focus({ preventScroll: true });
  }, [menuRef, ready]);

  const openSub = (key, item, el, focusFirst) => {
    if (sheet) { setStack((st) => [...st, { label: item.label, items: item.submenu }]); return; }
    setSub((cur) => (cur && cur.key === key && !focusFirst
      ? cur
      : { key, items: item.submenu, rect: el.getBoundingClientRect(), focusFirst, el }));
  };
  const closeSub = () => {
    const el = sub?.el;
    setSub(null);
    if (el && document.contains(el)) el.focus({ preventScroll: true });
  };

  const current = sheet && stack.length ? stack[stack.length - 1] : null;
  const shownItems = current ? current.items : items;

  const style = sheet ? undefined : {
    left: pos?.left ?? -9999,
    top: pos?.top ?? -9999,
    maxHeight: pos?.maxHeight,
    visibility: pos ? 'visible' : 'hidden',
    transformOrigin: pos ? `${pos.originY} ${pos.originX}` : undefined,
  };

  return (
    <>
      {/* No celular, fundo escuro atrás da folha (tocar nele fecha). No
          computador não escurece — o menu fica junto do clique. */}
      {sheet && <div className="context-menu-backdrop cm-backdrop" />}
      <div
        ref={menuRef}
        className={`context-menu cm-v2 ${sheet ? 'cm-sheet' : 'cm-anchored'}`}
        role="menu"
        tabIndex={-1}
        style={style}
        onKeyDown={(e) => navKeyDown(e, menuRef.current)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {sheet && <div className="cm-grabber" aria-hidden="true" />}
        {current && (
          <div className="cm-section">
            <button type="button" className="cm-item cm-back" onClick={() => setStack((st) => st.slice(0, -1))}>
              <MenuIcon name="back" />
              <span className="cm-text"><span className="cm-label">{current.label}</span></span>
            </button>
          </div>
        )}
        <MenuSections
          key={stack.length}
          items={shownItems}
          onClose={onClose}
          onOpenSub={openSub}
          onHoverPlain={() => setSub(null)}
          openSubKey={sub?.key}
        />
      </div>
      {!sheet && sub && (
        <SubmenuPanel key={sub.key} items={sub.items} anchorRect={sub.rect} focusFirst={sub.focusFirst} onClose={onClose} onBack={closeSub} />
      )}
    </>
  );
}

export function useContextMenu() {
  return useContext(ContextMenuContext);
}
