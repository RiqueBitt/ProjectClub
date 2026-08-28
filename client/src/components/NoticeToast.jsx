import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import cancelIcon from '../assets/icons/cancel.png';

// Dismissible toast queue for moderation notices (timeout applied, warning
// received, anti-raid alert). Rendered at the app-shell root so it's
// visible regardless of which page/modal is currently open.
export default function NoticeToast() {
  const notices = useStore((s) => s.notices);
  const dismissNotice = useStore((s) => s.dismissNotice);

  useEffect(() => {
    if (notices.length === 0) return;
    const timers = notices.map((n) => setTimeout(() => dismissNotice(n.id), 8000));
    return () => timers.forEach(clearTimeout);
  }, [notices, dismissNotice]);

  if (notices.length === 0) return null;

  return (
    <div className="notice-toast-stack">
      {notices.map((n) => (
        <div key={n.id} className="notice-toast">
          <span className="notice-toast-text">{n.message}</span>
          {n.action && (
            <button
              className="notice-toast-action"
              onClick={() => { n.action.onClick(); dismissNotice(n.id); }}
            >
              {n.action.label}
            </button>
          )}
          <button className="icon-btn-small" onClick={() => dismissNotice(n.id)}><img className="ui-icon-sm" src={cancelIcon} alt="x" /></button>
        </div>
      ))}
    </div>
  );
}
