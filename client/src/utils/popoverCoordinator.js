import { useEffect, useRef } from 'react';

// Bug fix: this app has many independently-managed floating menus/popovers
// (the shared right-click ContextMenuContext, every EmojiPicker instance,
// GifPicker, StickerPicker, the online-status dropdown, ...) each tracked
// by its own local component state, with no awareness of each other. That
// meant opening one while another was already open just left both showing
// at once, visually stacked/nested on top of each other instead of the
// first one closing.
//
// This is a tiny module-level registry (no React context needed — it's
// used from event handlers, not rendered) that makes "only one popover
// open at a time" hold across the whole app: whichever popover opens most
// recently closes whatever was open before it, regardless of which
// component/kind it is.
let activeCloser = null;

// Call when a popover is about to open. Closes whatever else was open, and
// remembers `closeFn` as the new "owner" so the next thing that opens can
// close *this* one in turn.
export function openPopover(closeFn) {
  if (activeCloser && activeCloser !== closeFn) activeCloser();
  activeCloser = closeFn;
}

// Call when a popover closes on its own (outside click, Escape, picking
// something, etc) — only actually clears the registry if this popover was
// still the recorded owner (avoids a stale popover accidentally clearing
// out whatever opened after it).
export function closePopover(closeFn) {
  if (activeCloser === closeFn) activeCloser = null;
}

// One-line version of the above for a typical "const [open, setOpen] =
// useState(false)" popover — call with (isOpen, () => setOpen(false)) and
// it handles registering/unregistering itself at the right times.
export function usePopoverCoordination(isOpen, close) {
  const closeRef = useRef(close);
  closeRef.current = close;
  const stableCloser = useRef((...args) => closeRef.current(...args)).current;

  useEffect(() => {
    if (isOpen) {
      openPopover(stableCloser);
      return () => closePopover(stableCloser);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
}
