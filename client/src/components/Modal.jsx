import cancelIcon from '../assets/icons/cancel.png';

export default function Modal({ title, onClose, children, width, className, overlayClassName }) {
  // `.modal-box` sets a fixed `width: 440px` by default; passing `width`
  // here as a CSS custom property (read by that rule as `min(var(--modal-width, 440px), 92vw)`)
  // is what actually lets wider modals (server settings, roles, moderation...)
  // render at their requested size instead of being stuck at 440px — a plain
  // inline `maxWidth` can't win against a same-element fixed `width`.
  //
  // Bug fix: touch events inside the modal (e.g. dragging sideways through
  // a horizontally-scrollable tab bar) bubble past the modal by default,
  // all the way up to .app-shell's own touch handlers — which interpret
  // any horizontal drag starting near the screen edge as "swipe to open
  // the channel drawer". That drawer opening on top of/behind the modal is
  // what looked like the settings modal randomly closing. Stopping
  // propagation here keeps touch gestures inside the modal from ever
  // reaching that global listener.
  const stopTouch = (e) => e.stopPropagation();
  return (
    <div className={`modal-overlay ${overlayClassName || ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal-box ${className || ''}`} style={width ? { '--modal-width': width } : undefined} onTouchStart={stopTouch} onTouchEnd={stopTouch}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose}><img className="ui-icon" src={cancelIcon} alt="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
