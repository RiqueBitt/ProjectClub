import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { openPopover, closePopover } from '../utils/popoverCoordinator';

const ContextMenuContext = createContext(null);

// One shared context-menu instance for the whole app (Discord-web style
// right-click menus). Callers get `openMenu(event, items)` where `items` is
// an array of either:
//   { label, onClick, danger?, disabled? }
//   { divider: true }
// Always opens in the same fixed spot (centered on screen) instead of at
// the click/tap position — deliberate, not a bug: it means the menu is
// always exactly where you expect it regardless of where on the message
// (or which message) you clicked/held, so "Reagir"/"Responder"/etc. are
// always in the same physical spot to tap, not chasing your finger around
// the screen. Closes itself on outside click, Escape, or scroll.
export function ContextMenuProvider({ children }) {
  const [state, setState] = useState(null); // { items }
  const menuRef = useRef(null);
  // A stable function reference — openPopover/closePopover compare by
  // identity, so a fresh arrow function on every call would never match
  // itself between open and close.
  const closerRef = useRef(() => setState(null));

  const openMenu = useCallback((event, items) => {
    event.preventDefault();
    event.stopPropagation();
    openPopover(closerRef.current);
    setState({ items });
  }, []);

  const closeMenu = useCallback(() => { closePopover(closerRef.current); setState(null); }, []);

  useEffect(() => {
    if (!state) return;
    const onDocClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) closeMenu();
    };
    const onKey = (e) => { if (e.key === 'Escape') closeMenu(); };
    const onScroll = () => closeMenu();
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('touchstart', onDocClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('touchstart', onDocClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [state, closeMenu]);

  return (
    <ContextMenuContext.Provider value={{ openMenu, closeMenu }}>
      {children}
      {state && <ContextMenuRender menuRef={menuRef} {...state} onClose={closeMenu} />}
    </ContextMenuContext.Provider>
  );
}

function ContextMenuRender({ menuRef, items, onClose }) {
  return (
    <>
      {/* A dim backdrop makes it clear the menu is a fixed overlay, not
          anchored to whatever was clicked — also doubles as an easy "tap
          anywhere to dismiss" target on touch, same idea as a modal
          overlay. */}
      <div className="context-menu-backdrop" />
      <div ref={menuRef} className="context-menu context-menu-fixed">
        {items.map((item, i) => (
          item.divider
            ? <div key={i} className="context-menu-divider" />
            : (
              <button
                key={i}
                className={`context-menu-item ${item.danger ? 'danger' : ''}`}
                disabled={item.disabled}
                onClick={() => { item.onClick?.(); onClose(); }}
              >
                {item.icon && <span className="context-menu-icon">{item.icon}</span>}
                {item.label}
              </button>
            )
        ))}
      </div>
    </>
  );
}

export function useContextMenu() {
  return useContext(ContextMenuContext);
}
