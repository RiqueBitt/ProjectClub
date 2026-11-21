import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Modal from './Modal.jsx';
import { useStore } from '../store/useStore';
import { getMessageEdits, forwardMessage, unfurlLink } from '../api/endpoints';
import { findInternalLinks } from '../utils/internalLinks';
import { formatEmbedTime } from '../utils/formatTime';
import { findYouTubeLink, youTubeEmbedUrl, readCaptionsPref } from './voice/ytUtils';
import '../styles/message-extras.css';

// ---------------------------------------------------------------------
// "(editado)" clicável → histórico de versões (GET /messages/:id/edits).
// ---------------------------------------------------------------------
export function EditedTag({ message }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const btnRef = useRef(null);
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    setError('');
    setData(null);
    let alive = true;
    getMessageEdits(message.id)
      .then((d) => { if (alive) setData(d); })
      .catch((err) => { if (alive) setError(err.response?.data?.error || 'Não foi possível carregar o histórico.'); });
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const width = Math.min(360, window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const below = r.bottom + 6;
      const top = below + 280 > window.innerHeight ? Math.max(8, r.top - 286) : below;
      setPos({ left, top, width });
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => { alive = false; window.removeEventListener('keydown', onKey); };
  }, [open, message.id, message.content]);

  return (
    <>
      <button
        ref={btnRef} type="button" className="edited-tag edited-tag-btn"
        title="Ver histórico de edições" onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        {' '}(editado)
      </button>
      {open && pos && createPortal(
        <div className="edit-history-overlay" onMouseDown={() => setOpen(false)}>
          <div
            className="edit-history-pop" role="dialog" aria-label="Histórico de edições"
            style={{ left: pos.left, top: pos.top, width: pos.width }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="edit-history-head">
              <strong>Histórico de edições</strong>
              <button type="button" className="btn-link" onClick={() => setOpen(false)}>fechar</button>
            </div>
            {error && <div className="dim">{error}</div>}
            {!error && !data && <div className="dim">Carregando…</div>}
            {data && (
              <ol className="edit-history-list">
                <li className="current">
                  <span className="edit-history-when">Atual{data.current?.editedAt ? ` · ${formatEmbedTime(data.current.editedAt)}` : ''}</span>
                  <span className="edit-history-text">{data.current?.content || <i className="dim">(sem texto)</i>}</span>
                </li>
                {data.edits.map((e) => (
                  <li key={e.id}>
                    <span className="edit-history-when">Antes de {formatEmbedTime(e.editedAt)}</span>
                    <span className="edit-history-text">{e.content || <i className="dim">(sem texto)</i>}</span>
                  </li>
                ))}
                {data.edits.length === 0 && <li className="dim">Sem versões anteriores guardadas.</li>}
              </ol>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// ---------------------------------------------------------------------
// "Encaminhada" — de onde a mensagem veio.
// ---------------------------------------------------------------------
export function ForwardedLabel({ forwardedFrom }) {
  const info = useMemo(() => {
    if (!forwardedFrom) return null;
    try { return typeof forwardedFrom === 'string' ? JSON.parse(forwardedFrom) : forwardedFrom; } catch { return null; }
  }, [forwardedFrom]);
  if (!info) return null;
  const where = info.channelName ? ` em #${info.channelName}` : info.conversationId ? ' de uma conversa' : '';
  return (
    <div className="forwarded-label" title={info.createdAt ? `Original: ${formatEmbedTime(info.createdAt)}` : undefined}>
      <span aria-hidden="true">↪</span> Encaminhada · <b>{info.authorName || 'Alguém'}</b>{where}
      {info.createdAt && <span className="dim"> · {formatEmbedTime(info.createdAt)}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------
// Modal "Encaminhar" — escolhe um canal de texto ou uma DM.
// ---------------------------------------------------------------------
const FORWARDABLE_TYPES = new Set(['TEXT', 'ANNOUNCEMENT', undefined, null]);
export function ForwardMessageModal({ message, myUserId, onClose }) {
  const categories = useStore((s) => s.categories);
  const looseChannels = useStore((s) => s.channels);
  const conversations = useStore((s) => s.conversations);
  const [query, setQuery] = useState('');
  const [sendingTo, setSendingTo] = useState(null);
  const [error, setError] = useState('');

  const targets = useMemo(() => {
    const q = query.trim().toLowerCase();
    const channels = [...looseChannels, ...categories.flatMap((c) => c.channels || [])]
      .filter((c) => FORWARDABLE_TYPES.has(c.type))
      .map((c) => ({ key: `ch:${c.id}`, label: `# ${c.name}`, target: { channelId: c.id } }));
    const dms = conversations.map((c) => {
      const others = (c.members || []).filter((m) => m.id !== myUserId);
      const label = c.isGroup ? (c.name || others.map((m) => m.displayName).join(', ')) : (others[0]?.displayName || 'Conversa');
      return { key: `dm:${c.id}`, label: `@ ${label}`, target: { conversationId: c.id } };
    });
    const all = [...dms, ...channels];
    return q ? all.filter((t) => t.label.toLowerCase().includes(q)) : all;
  }, [categories, looseChannels, conversations, query, myUserId]);

  const send = async (t) => {
    setSendingTo(t.key);
    setError('');
    try {
      await forwardMessage(message.id, t.target);
      useStore.getState().pushNotice(`Mensagem encaminhada para ${t.label.replace(/^[#@] /, '')}.`);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível encaminhar.');
      setSendingTo(null);
    }
  };

  return (
    <Modal title="Encaminhar mensagem" onClose={onClose}>
      <div className="forward-modal">
        <div className="forward-preview">{message.content ? message.content.slice(0, 200) : <i className="dim">Anexo / mídia</i>}</div>
        <input autoFocus placeholder="Buscar canal ou conversa…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {error && <div className="auth-error">{error}</div>}
        <ul className="forward-target-list">
          {targets.slice(0, 80).map((t) => (
            <li key={t.key}>
              <span className="truncate">{t.label}</span>
              <button type="button" className="btn-primary btn-small" disabled={!!sendingTo} onClick={() => send(t)}>
                {sendingTo === t.key ? '…' : 'Enviar'}
              </button>
            </li>
          ))}
          {targets.length === 0 && <li className="dim">Nada encontrado.</li>}
        </ul>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Prévia de link externo (GET /api/unfurl) — no máximo 1 por mensagem.
// ---------------------------------------------------------------------
const URL_RE = /\bhttps?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?)\]]/i;
const MEDIA_URL_RE = /\.(gif|png|jpe?g|webp|mp4|webm|mov|mp3|ogg|wav)(\?\S*)?$/i;
const SKIP_HOSTS = /(^|\.)(tenor\.com|giphy\.com|media\.discordapp\.net)$/i;
const previewCache = new Map(); // url -> Promise<preview|null>

function firstPreviewableUrl(content) {
  if (!content || !content.includes('http')) return null;
  const m = URL_RE.exec(content);
  if (!m) return null;
  const url = m[0];
  if (MEDIA_URL_RE.test(url)) return null;
  try {
    const u = new URL(url);
    if (SKIP_HOSTS.test(u.hostname)) return null;
    if (u.origin === window.location.origin) return null; // links internos já têm cartão próprio
  } catch { return null; }
  if (findInternalLinks(url).length) return null;
  return url;
}

export function LinkPreview({ content }) {
  const enabled = useStore((s) => s.userSettings?.showLinkPreviews !== false);
  // Vídeo do YouTube vira o player leve (miniatura + play) em vez do cartão.
  const yt = useMemo(() => (enabled ? findYouTubeLink(content) : null), [content, enabled]);
  if (yt) return <YouTubeLite video={yt} />;
  return <OpenGraphPreview content={content} enabled={enabled} />;
}

function loadPreview(url) {
  if (!previewCache.has(url)) {
    if (previewCache.size > 300) previewCache.delete(previewCache.keys().next().value);
    previewCache.set(url, unfurlLink(url).then((d) => d?.preview || null).catch(() => null));
  }
  return previewCache.get(url);
}

// ---------------------------------------------------------------------
// YouTube "leve": só a miniatura (i.ytimg.com) e um botão de play — nada
// do YouTube carrega até a pessoa clicar. Aí troca pelo player sem cookies
// (youtube-nocookie.com, liberado no frame-src da CSP do servidor) já
// tocando. Shorts ficam em pé (9:16).
// ---------------------------------------------------------------------
function YouTubeLite({ video }) {
  const [playing, setPlaying] = useState(false);
  const [title, setTitle] = useState('');
  const [thumbSrc, setThumbSrc] = useState(`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`);
  const ref = useRef(null);
  useEffect(() => { setPlaying(false); setTitle(''); setThumbSrc(`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`); }, [video.id]);
  // Título pela prévia do servidor (mesmo cache dos cartões), só quando aparece na tela.
  useEffect(() => {
    let alive = true;
    const el = ref.current;
    const go = () => loadPreview(video.url).then((p) => { if (alive && p?.title) setTitle(p.title); });
    if (!el || typeof IntersectionObserver === 'undefined') { go(); return () => { alive = false; }; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); go(); }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => { alive = false; io.disconnect(); };
  }, [video.url]);

  const label = title || 'Vídeo do YouTube';
  return (
    <div ref={ref} className={`yt-lite ${video.isShort ? 'is-short' : ''} ${playing ? 'is-playing' : ''}`}>
      {playing ? (
        <iframe
          src={youTubeEmbedUrl(video.id, { start: video.start, origin: window.location.origin, captions: readCaptionsPref() })}
          title={label}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <button type="button" className="yt-lite-poster" onClick={() => setPlaying(true)} aria-label={`Reproduzir: ${label}`}>
          <img
            src={thumbSrc} alt="" loading="lazy" referrerPolicy="no-referrer"
            onError={() => { if (!thumbSrc.endsWith('/0.jpg')) setThumbSrc(`https://i.ytimg.com/vi/${video.id}/0.jpg`); }}
          />
          <span className="yt-lite-shade" aria-hidden="true" />
          {title && <span className="yt-lite-title">{title}</span>}
          <span className="yt-lite-play" aria-hidden="true">
            <svg viewBox="0 0 68 48" width="68" height="48"><path d="M66.5 7.7a8.6 8.6 0 0 0-6-6C55.2.3 34 .3 34 .3S12.8.3 7.5 1.7a8.6 8.6 0 0 0-6 6C.1 13 .1 24 .1 24s0 11 1.4 16.3a8.6 8.6 0 0 0 6 6C12.8 47.7 34 47.7 34 47.7s21.2 0 26.5-1.4a8.6 8.6 0 0 0 6-6C67.9 35 67.9 24 67.9 24s0-11-1.4-16.3z" fill="#f00" /><path d="M45 24 27 14v20z" fill="#fff" /></svg>
          </span>
        </button>
      )}
      <a className="yt-lite-link" href={video.url} target="_blank" rel="noreferrer noopener">Abrir no YouTube</a>
    </div>
  );
}

function OpenGraphPreview({ content, enabled }) {
  const url = useMemo(() => (enabled ? firstPreviewableUrl(content) : null), [content, enabled]);
  const [preview, setPreview] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    setPreview(null);
    if (!url) return undefined;
    let alive = true;
    const load = () => {
      loadPreview(url).then((p) => { if (alive) setPreview(p); });
    };
    // Só busca quando a mensagem aparece na tela.
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { load(); return () => { alive = false; }; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); load(); }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => { alive = false; io.disconnect(); };
  }, [url]);

  if (!url) return null;
  if (!preview) return <span ref={ref} className="link-preview-anchor" />;
  return (
    <div ref={ref} className="embed-card link-preview-card" style={{ borderColor: preview.themeColor || undefined }}>
      <div className="embed-card-body">
        <div className="embed-card-main">
          {preview.siteName && <div className="link-preview-site">{preview.siteName}</div>}
          {preview.title && (
            <a className="embed-card-title" href={preview.url || url} target="_blank" rel="noreferrer noopener">{preview.title}</a>
          )}
          {preview.description && <div className="embed-card-description link-preview-desc">{preview.description}</div>}
        </div>
        {preview.image && (
          <img className="embed-card-thumbnail link-preview-thumb" src={preview.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// "Visto" embaixo da última mensagem própria numa DM 1:1.
// ---------------------------------------------------------------------
export function SeenReceipt({ at }) {
  if (!at) return null;
  return <div className="seen-receipt" title={formatEmbedTime(at)}>Visto</div>;
}
