import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store/useStore';
import { getMessageReactors } from '../api/endpoints';
import { usePopoverCoordination } from '../utils/popoverCoordinator';
import { cssZoom } from '../utils/cssZoom';
import { reactorsSentence } from '../utils/reactions';
import StyledEmoji from './StyledEmoji.jsx';
import UserAvatar from './UserAvatar.jsx';
import '../styles/context-menu.css';
import '../styles/reaction-users.css';

// Chip de reação de uma mensagem + menu "quem reagiu".
// - clique (esquerdo/toque curto): reage/remove a reação, como sempre;
// - clique direito (PC), segurar ~450ms (toque) ou tecla Menu/Shift+F10:
//   abre a lista de quem reagiu com aquele emoji (no celular, folha embaixo
//   da tela, igual ao menu de contexto). Clicar numa pessoa abre o
//   miniperfil dela;
// - passar o mouse (PC): dica "Fulano, Beltrano e mais 3 reagiram com 😀".

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE = 10;
const TOOLTIP_DELAY_MS = 450;

const isSheetViewport = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 600px)').matches;
const canHover = () => typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

// ":nome:" ou "<:nome:id>"/"<a:nome:id>" → nome do emoji personalizado.
function customEmojiName(emoji) {
  const m = /^:([^:\s]+):$/.exec(emoji) || /^<a?:([^:\s]+):[^>]+>$/.exec(emoji);
  return m ? m[1] : null;
}

export function ReactionEmoji({ emoji, emojiMap, size = 16 }) {
  const name = customEmojiName(emoji);
  const url = name ? emojiMap?.[name] : null;
  if (url) return <img className="inline-emoji" src={url} alt={`:${name}:`} draggable={false} style={{ width: size, height: size }} />;
  return <StyledEmoji emoji={emoji} size={size} />;
}

const emojiLabel = (emoji) => {
  const name = customEmojiName(emoji);
  return name ? `:${name}:` : emoji;
};

export default function ReactionChip({ messageId, emoji, count, mine, rows, trimmed, emojiMap, onToggle, disabled }) {
  const chipRef = useRef(null);
  const [menu, setMenu] = useState(null); // { x, y, sheet }
  const [tip, setTip] = useState(null); // DOMRect do chip
  const press = useRef(null);
  const suppressClick = useRef(false);
  const tipTimer = useRef(null);

  const hideTip = useCallback(() => { clearTimeout(tipTimer.current); tipTimer.current = null; setTip(null); }, []);
  useEffect(() => () => { clearTimeout(tipTimer.current); clearTimeout(press.current?.timer); }, []);

  const openMenuAt = (x, y, forceSheet = false, fromTouch = false) => {
    if (disabled) return;
    hideTip();
    setMenu((cur) => cur || { x, y, sheet: forceSheet || isSheetViewport(), fromTouch });
  };
  const openFromChip = () => {
    const r = chipRef.current?.getBoundingClientRect();
    if (r) openMenuAt(r.left, r.bottom + 4);
  };

  const onContextMenu = (e) => {
    // Nunca o menu nativo / o menu da mensagem (que fica no pai).
    e.preventDefault();
    e.stopPropagation();
    if (menu) return; // o toque longo já abriu (Android dispara os dois)
    if (!e.clientX && !e.clientY) openFromChip();
    else openMenuAt(e.clientX, e.clientY);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      e.stopPropagation();
      openFromChip();
    }
  };

  const cancelPress = () => { if (press.current) { clearTimeout(press.current.timer); press.current = null; } };
  const onPointerDown = (e) => {
    suppressClick.current = false;
    if (e.pointerType === 'mouse' || disabled) return;
    cancelPress();
    const { clientX: x, clientY: y } = e;
    press.current = {
      x, y,
      timer: setTimeout(() => {
        press.current = null;
        suppressClick.current = true; // soltar o dedo não pode virar "reagir"
        navigator.vibrate?.(10);
        openMenuAt(x, y, false, true);
      }, LONG_PRESS_MS),
    };
  };
  const onPointerMove = (e) => {
    const p = press.current;
    if (p && (Math.abs(e.clientX - p.x) > MOVE_TOLERANCE || Math.abs(e.clientY - p.y) > MOVE_TOLERANCE)) cancelPress();
  };

  const onClick = () => {
    hideTip();
    if (suppressClick.current) { suppressClick.current = false; return; }
    // Clique no próprio chip com o menu aberto: só fecha.
    if (menu) { setMenu(null); return; }
    onToggle(emoji);
  };

  const onMouseEnter = () => {
    if (!canHover() || menu) return;
    clearTimeout(tipTimer.current);
    tipTimer.current = setTimeout(() => {
      const r = chipRef.current?.getBoundingClientRect();
      if (r) setTip(r);
    }, TOOLTIP_DELAY_MS);
  };

  const names = rows.map((r) => r.user?.displayName).filter(Boolean);
  const label = `${count} ${count === 1 ? 'reação' : 'reações'} com ${emojiLabel(emoji)}${mine ? ', incluindo a sua' : ''}`;

  return (
    <>
      <button
        ref={chipRef}
        type="button"
        className={`reaction-chip ${mine ? 'mine' : ''} ${menu ? 'menu-open' : ''}`}
        aria-pressed={mine}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        aria-label={label}
        data-emoji={emoji}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onPointerLeave={cancelPress}
        // Soltar o dedo depois do toque longo não pode virar "clique" no
        // que a folha abriu por cima do chip (ex.: uma pessoa da lista).
        onTouchEnd={(e) => { if (suppressClick.current && e.cancelable) e.preventDefault(); }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={hideTip}
        onBlur={hideTip}
      >
        <ReactionEmoji emoji={emoji} emojiMap={emojiMap} size={16} /> {count}
      </button>
      {tip && !menu && createPortal(
        <ReactionTooltip rect={tip} text={reactorsSentence(names, count)} emoji={emoji} emojiMap={emojiMap} />,
        document.body,
      )}
      {menu && createPortal(
        <ReactionUsersMenu
          messageId={messageId}
          emoji={emoji}
          count={count}
          mine={mine}
          rows={rows}
          trimmed={trimmed}
          emojiMap={emojiMap}
          anchor={menu}
          returnFocusEl={chipRef.current}
          onToggle={() => onToggle(emoji)}
          onClose={() => setMenu(null)}
        />,
        document.body,
      )}
    </>
  );
}

function ReactionTooltip({ rect, text, emoji, emojiMap }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const z = cssZoom();
    const vw = window.innerWidth / z;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const cx = (rect.left + rect.width / 2) / z;
    let top = rect.top / z - h - 8;
    if (top < 8) top = rect.bottom / z + 8;
    const left = Math.min(Math.max(8, cx - w / 2), Math.max(8, vw - 8 - w));
    setPos({ left, top });
  }, [rect]);
  return (
    <div
      ref={ref}
      className="reaction-tooltip"
      role="tooltip"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
    >
      <ReactionEmoji emoji={emoji} emojiMap={emojiMap} size={28} />
      <span>{text} <b>{emojiLabel(emoji)}</b></span>
    </div>
  );
}

const usersFromRows = (rows) => {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (!r.user?.id || seen.has(r.user.id)) continue;
    seen.add(r.user.id);
    out.push(r.user);
  }
  return out;
};

export function ReactionUsersMenu({ messageId, emoji, count, mine, rows, trimmed, emojiMap, anchor, returnFocusEl, onToggle, onClose }) {
  const menuRef = useRef(null);
  const listRef = useRef(null);
  const openedAt = useRef(Date.now());
  // Aberto pelo toque longo: até o dedo tocar de novo DENTRO do menu,
  // nenhum clique conta (o "soltar" do mesmo toque cai em cima da folha).
  const awaitingFreshTouch = useRef(!!anchor.fromTouch);
  const [users, setUsers] = useState(() => usersFromRows(rows));
  const [total, setTotal] = useState(count);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pos, setPos] = useState(null);
  const loadingRef = useRef(false);
  const { sheet } = anchor;

  const close = useCallback((restoreFocus = false) => {
    onClose();
    if (restoreFocus && returnFocusEl && document.contains(returnFocusEl)) returnFocusEl.focus({ preventScroll: true });
  }, [onClose, returnFocusEl]);
  usePopoverCoordination(true, () => close(false));

  // O payload da mensagem pode vir só com uma amostra (ou sem os usuários):
  // aí busca a lista completa no servidor, de página em página.
  const needsFetch = trimmed || users.length < count;
  const load = useCallback(async (from) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const data = await getMessageReactors(messageId, emoji, from || undefined);
      const page = Array.isArray(data?.users) ? data.users : [];
      setUsers((cur) => {
        const base = from ? cur : [];
        const seen = new Set(base.map((u) => u.id));
        return [...base, ...page.filter((u) => u?.id && !seen.has(u.id))];
      });
      if (typeof data?.count === 'number') setTotal(data.count);
      setCursor(data?.nextCursor || null);
    } catch (err) {
      setError(err?.response?.data?.error || 'Não foi possível carregar quem reagiu.');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [messageId, emoji]);

  useEffect(() => {
    if (needsFetch) load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rolou até perto do fim da lista: próxima página.
  const onListScroll = (e) => {
    const el = e.currentTarget;
    if (cursor && !loadingRef.current && el.scrollTop + el.clientHeight >= el.scrollHeight - 80) load(cursor);
  };
  // Página curta demais pra rolar mas ainda tem mais: carrega já.
  useEffect(() => {
    const el = listRef.current;
    if (el && cursor && !loading && el.scrollHeight <= el.clientHeight + 4) load(cursor);
  }, [cursor, loading, users.length, load]);

  // Posição presa dentro da tela (no PC, junto do clique).
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el || sheet) return;
    const z = cssZoom();
    const m = 8;
    const vw = window.innerWidth / z;
    const vh = window.innerHeight / z;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const px = anchor.x / z;
    const py = anchor.y / z;
    let left = px + 2;
    let top = py + 2;
    if (left + w > vw - m) left = Math.max(m, px - w - 2);
    if (top + h > vh - m) {
      const above = py - h - 2;
      top = above >= m ? above : Math.max(m, vh - m - h);
    }
    left = Math.min(Math.max(m, left), Math.max(m, vw - m - w));
    top = Math.max(m, top);
    setPos({ left, top, maxHeight: vh - m * 2 });
  }, [anchor.x, anchor.y, sheet, users.length, loading]);

  const ready = sheet || !!pos;
  useEffect(() => { if (ready) menuRef.current?.focus({ preventScroll: true }); }, [ready]);

  // Fecha: toque/clique fora, Esc, rolar o que está por trás, redimensionar.
  useEffect(() => {
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target)) return;
      // O próprio toque longo que abriu não conta.
      if (Date.now() - openedAt.current < 250) return;
      if (returnFocusEl?.contains(e.target)) return; // o chip fecha no próprio clique
      close(false);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      close(true);
    };
    const onScroll = (e) => { if (!menuRef.current?.contains(e.target)) close(false); };
    const onResize = () => { if (!sheet) close(false); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('touchstart', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('touchstart', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [close, sheet, returnFocusEl]);

  const onKeyDown = (e) => {
    const list = [...(menuRef.current?.querySelectorAll('.cm-item:not(:disabled)') || [])];
    if (!list.length) return;
    const idx = list.indexOf(document.activeElement);
    let next = null;
    if (e.key === 'ArrowDown') next = list[(idx + 1) % list.length];
    else if (e.key === 'ArrowUp') next = list[idx <= 0 ? list.length - 1 : idx - 1];
    else if (e.key === 'Home') next = list[0];
    else if (e.key === 'End') next = list[list.length - 1];
    else if (e.key === 'Tab') next = e.shiftKey ? list[idx <= 0 ? list.length - 1 : idx - 1] : list[(idx + 1) % list.length];
    if (next) {
      e.preventDefault();
      next.focus({ preventScroll: false });
    }
  };

  const openUser = (u, e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    close(false);
    useStore.getState().openMiniProfile(u.id, rect);
  };

  const style = sheet ? undefined : {
    left: pos?.left ?? -9999,
    top: pos?.top ?? -9999,
    maxHeight: pos?.maxHeight,
    visibility: pos ? 'visible' : 'hidden',
  };

  return (
    <>
      {sheet && <div className="context-menu-backdrop cm-backdrop reaction-users-backdrop" aria-hidden="true" />}
      <div
        ref={menuRef}
        className={`context-menu cm-v2 reaction-users-menu ${sheet ? 'cm-sheet' : 'cm-anchored'}`}
        role="menu"
        aria-label={`Quem reagiu com ${emojiLabel(emoji)}`}
        tabIndex={-1}
        style={style}
        onKeyDown={onKeyDown}
        onPointerDownCapture={() => { awaitingFreshTouch.current = false; }}
        onClickCapture={(e) => {
          if (awaitingFreshTouch.current && e.detail !== 0) { e.preventDefault(); e.stopPropagation(); }
        }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        {sheet && <div className="cm-grabber" aria-hidden="true" />}
        <div className="rum-header">
          <span className="rum-emoji"><ReactionEmoji emoji={emoji} emojiMap={emojiMap} size={28} /></span>
          <span className="rum-count"><b>{total}</b> {total === 1 ? 'reação' : 'reações'}</span>
          {sheet && (
            <button type="button" className="rum-close" aria-label="Fechar" onClick={() => close(true)}>✕</button>
          )}
        </div>
        <div className="cm-section" role="group">
          <button
            type="button"
            role="menuitem"
            className={`cm-item rum-action ${mine ? 'danger' : ''}`}
            onMouseEnter={(e) => e.currentTarget.focus({ preventScroll: true })}
            onClick={() => { onToggle(); close(true); }}
          >
            {mine ? (
              <span className="cm-label">Remover reação</span>
            ) : (
              <span className="cm-label rum-react-label">Reagir com <ReactionEmoji emoji={emoji} emojiMap={emojiMap} size={18} /></span>
            )}
          </button>
        </div>
        <div className="cm-section rum-list" role="group" aria-label="Quem reagiu" ref={listRef} onScroll={onListScroll}>
          {users.map((u) => (
            <button
              key={u.id}
              type="button"
              role="menuitem"
              className="cm-item rum-user"
              data-user-id={u.id}
              onMouseEnter={(e) => e.currentTarget.focus({ preventScroll: true })}
              onClick={(e) => openUser(u, e)}
            >
              <span className="rum-avatar"><UserAvatar user={u} size={28} /></span>
              <span className="rum-names">
                <span className="rum-display">{u.displayName || u.username}</span>
                {u.username && <span className="rum-username">@{u.username}</span>}
              </span>
            </button>
          ))}
          {loading && <div className="rum-status" role="status">Carregando…</div>}
          {!loading && error && (
            <div className="rum-status rum-error" role="alert">
              {error}{' '}
              <button type="button" className="btn-link" onClick={() => load(users.length && cursor ? cursor : null)}>Tentar de novo</button>
            </div>
          )}
          {!loading && !error && users.length === 0 && <div className="rum-status">Ninguém por aqui ainda.</div>}
        </div>
      </div>
    </>
  );
}
