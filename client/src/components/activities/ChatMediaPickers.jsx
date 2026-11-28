import { useEffect, useRef, useState } from 'react';
import { ytSearch, ytTrending } from '../../api/endpoints';
import { MusicSources } from '../../music/MusicSources.jsx';
import '../../styles/music.css';
import '../../styles/media-cards.css';

// Atividades do chat → YouTube / Música: escolhe e manda o cartão especial
// no chat (/atividade/video/<id> ou /atividade/musica/<id>). Nada toca
// sozinho; quem recebe clica pra assistir/ouvir.

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
function videoIdFrom(text) {
  const s = String(text || '').trim();
  if (ID_RE.test(s)) return s;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
    let id = null;
    if (host === 'youtu.be') id = u.pathname.split('/')[1];
    else if (/youtube(-nocookie)?\.com$/.test(host)) id = u.pathname === '/watch' ? u.searchParams.get('v') : (u.pathname.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/) || [])[2];
    return id && ID_RE.test(id) ? id : null;
  } catch { return null; }
}

function useEscape(onClose) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

export function ChatVideoPicker({ onSend, onClose }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const req = useRef(0);
  useEscape(onClose);
  const load = (query) => {
    const my = ++req.current;
    setItems(null);
    (query ? ytSearch(query) : ytTrending('now'))
      .then((d) => { if (my === req.current) setItems((d?.items || d?.videos || []).filter((v) => v.videoId)); })
      .catch(() => { if (my === req.current) setItems([]); });
  };
  useEffect(() => { load(null); }, []);
  const send = async (videoId) => {
    setBusy(videoId); setError('');
    try { await onSend(videoId); onClose(); } catch (e) { setError(e?.response?.data?.error || 'Não deu pra mandar o vídeo.'); } finally { setBusy(null); }
  };
  const submit = (e) => {
    e.preventDefault();
    const id = videoIdFrom(q);
    if (id) send(id); else if (q.trim()) load(q.trim());
  };
  return (
    <div className="mu-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mu-panel" role="dialog" aria-label="Mandar vídeo do YouTube">
        <div className="mu-head">
          <span className="mu-logo" style={{ background: '#ff0000' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.5 8v8l6.5-4z" /></svg></span>
          <span className="mu-head-text"><strong>YouTube</strong><small>O vídeo vai pro chat — assiste quem clicar</small></span>
          <span style={{ flex: 1 }} />
          <button type="button" className="mu-icon-btn" onClick={onClose} aria-label="Fechar">×</button>
        </div>
        <form className="mu-search" onSubmit={submit}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar vídeo ou colar o link do YouTube" aria-label="Buscar vídeo ou colar link" autoFocus />
        </form>
        {error && <p className="mu-error">{error}</p>}
        <div className="mu-list">
          {items === null && Array.from({ length: 6 }).map((_, i) => <div key={i} className="mu-row mu-skel" />)}
          {items?.length === 0 && <p className="mu-empty">Nada encontrado.</p>}
          {items?.map((v) => (
            <div key={v.videoId} className={`mu-row${busy === v.videoId ? ' is-busy' : ''}`}>
              <button type="button" className="mu-row-main" onClick={() => send(v.videoId)} disabled={!!busy}>
                <img src={v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`} alt="" loading="lazy" className="mu-thumb-wide" />
                <span className="mu-row-text"><b data-no-translate>{v.title}</b><small data-no-translate>{v.channel}{v.duration ? ` · ${v.duration}` : ''}</small></span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ChatMusicPicker({ onSend, onClose }) {
  useEscape(onClose);
  return (
    <div className="mu-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mu-panel" role="dialog" aria-label="Mandar música">
        <div className="mu-head">
          <span className="mu-logo"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z" /></svg></span>
          <span className="mu-head-text"><strong>Música</strong><small>A música vai pro chat — ouve quem clicar</small></span>
          <span style={{ flex: 1 }} />
          <button type="button" className="mu-icon-btn" onClick={onClose} aria-label="Fechar">×</button>
        </div>
        <MusicSources onPlay={async (t) => { await onSend(t.videoId); onClose(); }} />
      </div>
    </div>
  );
}
