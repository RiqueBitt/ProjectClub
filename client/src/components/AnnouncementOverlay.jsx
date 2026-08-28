import { useEffect, useState } from 'react';
import { getActiveAnnouncement, dismissAnnouncement } from '../api/endpoints';

// Checked once on app load and shown full-screen, "OK to dismiss" style —
// see announcementController.js's getActiveAnnouncement for how the
// targeting (ALL/USER/SERVER) and per-user dismissal actually work. An
// offline user simply sees it the next time they load the app (this check
// happens right after login/on MainApp mount), no separate "queue" needed.
// After dismissing, immediately checks again in case there's a backlog of
// more than one waiting.
export default function AnnouncementOverlay() {
  const [announcement, setAnnouncement] = useState(null);

  const check = () => getActiveAnnouncement().then((d) => setAnnouncement(d.announcement)).catch(() => {});
  useEffect(() => { check(); }, []);

  if (!announcement) return null;

  const dismiss = async () => {
    setAnnouncement(null);
    try { await dismissAnnouncement(announcement.id); } catch { /* not fatal — worst case it shows again */ }
    check();
  };

  return (
    <div className="modal-overlay">
      <div className="modal-box announcement-overlay-box">
        {announcement.bannerUrl && <img className="announcement-banner" src={announcement.bannerUrl} alt="" />}
        <div className="modal-body">
          <h2>{announcement.title}</h2>
          {announcement.description && <p className="announcement-description">{announcement.description}</p>}
          {announcement.buttonUrl && (
            <a className="btn-secondary announcement-link-btn" href={announcement.buttonUrl} target="_blank" rel="noreferrer">
              {announcement.buttonLabel || 'Saiba mais'}
            </a>
          )}
          <button className="btn-primary announcement-ok-btn" onClick={dismiss}>OK</button>
        </div>
      </div>
    </div>
  );
}
